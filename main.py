"""
Debt-Settle API.
Complete FastAPI backend implementing identity, group invites, multi-payer/unequal expenses,
hybrid debt settlement, two-step payment confirmation, cancel rules, group chat, and retention.
"""

import os
import re
import secrets
from datetime import datetime, timezone
from typing import Optional, List, Dict

from fastapi import FastAPI, HTTPException, Depends, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select

RETENTION_ADMIN_KEY = os.getenv("RETENTION_ADMIN_KEY", "")

from db import init_db, get_session
from db_models import (
    User, Group, GroupMember, Invite, ExpenseDB, ExpensePayerDB,
    ExpenseSplitDB, PersonalDebtDB, SettlementTransactionDB, ChatMessageDB
)
from auth import get_current_user, get_group_membership, require_group_admin
from expense_helpers import validate_and_compute_payers, compute_splits
from retention import cleanup_expired_groups

# Core algorithm modules (intact & tested)
from models import (
    Expense as AlgoExpense,
    Payer as AlgoPayer,
    Split as AlgoSplit,
    PersonalDebt as AlgoDebt,
    Member as AlgoMember
)
from balances import compute_balances
from settle import settle
from upi import build_upi_link

app = FastAPI(title="Debt-Settle API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# -------------------------------------------------------------
# Request & Response Schemas
# -------------------------------------------------------------

class UserSignup(BaseModel):
    username: str
    email: EmailStr
    firebase_uid: Optional[str] = None


# 3-20 chars, lowercase letters / digits / underscore only
USERNAME_RE = re.compile(r'^[a-z0-9_]{3,20}$')


def normalize_username(raw: str) -> str:
    """Lowercase and strip whitespace; does NOT validate format."""
    return raw.strip().lower()


def validate_username(raw: str) -> str:
    """Normalize then assert format; raises HTTPException 422 on violation."""
    norm = normalize_username(raw)
    if not USERNAME_RE.match(norm):
        raise HTTPException(
            status_code=422,
            detail=(
                "Username must be 3-20 characters and contain only "
                "lowercase letters, digits, or underscores (a-z, 0-9, _)."
            )
        )
    return norm


class GroupCreate(BaseModel):
    name: str
    admin_upi_id: Optional[str] = None


class InviteCreate(BaseModel):
    method: str  # email | join_link | username
    email: Optional[EmailStr] = None
    username: Optional[str] = None


class EqualExpenseCreate(BaseModel):
    description: str
    total_amount: float
    paid_by: int          # member_id
    split_among: List[int]  # member_ids


class ExpenseCreate(BaseModel):
    description: str
    total_amount: float
    split_type: str = "equal"  # equal | exact | percentage | shares
    paid_by: List[Dict]        # [{"member_id": int, "amount_paid": float}]
    split_among: List[Dict]    # [{"member_id": int, "amount"|"percentage"|"shares": float}] or [member_id, ...]


class DebtCreate(BaseModel):
    from_member_id: int
    to_member_id: int
    amount: float
    note: str = ""


class ChatCreate(BaseModel):
    body: str


# -------------------------------------------------------------
# Helpers
# -------------------------------------------------------------

def check_group_not_frozen(group_id: int, session: Session) -> Group:
    """Enforces permanent group freeze: rejects modifications if any settlement rows exist."""
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    existing_settlements = session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group_id)
    ).first()

    if existing_settlements:
        raise HTTPException(
            status_code=400,
            detail="Group is frozen: a settlement plan is active or fully settled. No new expenses or debts allowed."
        )
    return group


def _load_algo_inputs(group_id: int, session: Session):
    """Converts DB rows into the pure dataclasses the algorithm layer expects."""
    members = session.exec(select(GroupMember).where(GroupMember.group_id == group_id)).all()
    member_by_id = {m.id: m for m in members}

    db_expenses = session.exec(select(ExpenseDB).where(ExpenseDB.group_id == group_id)).all()
    algo_expenses = []
    for e in db_expenses:
        payers = session.exec(select(ExpensePayerDB).where(ExpensePayerDB.expense_id == e.id)).all()
        splits = session.exec(select(ExpenseSplitDB).where(ExpenseSplitDB.expense_id == e.id)).all()
        algo_expenses.append(AlgoExpense(
            id=str(e.id),
            description=e.description,
            total_amount=e.total_amount,
            payers=[AlgoPayer(member_id=str(p.member_id), amount_paid=p.amount_paid) for p in payers],
            splits=[AlgoSplit(member_id=str(s.member_id), share_amount=s.share_amount) for s in splits],
        ))

    db_debts = session.exec(select(PersonalDebtDB).where(PersonalDebtDB.group_id == group_id)).all()
    algo_debts = [
        AlgoDebt(id=str(d.id), from_member_id=str(d.from_member_id),
                 to_member_id=str(d.to_member_id), amount=d.amount, note=d.note)
        for d in db_debts
    ]
    return member_by_id, algo_expenses, algo_debts


# -------------------------------------------------------------
# User & Identity Routes
# -------------------------------------------------------------

@app.post("/auth/signup")
def signup(payload: UserSignup, session: Session = Depends(get_session)):
    """Registers or sets up a user profile and claims any pending email invites."""
    # Normalize and validate username (stored lowercase, [a-z0-9_], 3-20 chars)
    username = validate_username(payload.username)

    # Case-insensitive uniqueness check (usernames are always stored lowercase,
    # so a plain equality check on the normalized value is sufficient)
    existing_username = session.exec(select(User).where(User.username == username)).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username is already taken")

    user = User(
        username=username,
        email=payload.email,
        firebase_uid=payload.firebase_uid
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # Claim pending email invites
    pending_invites = session.exec(
        select(Invite).where(Invite.invited_email == user.email, Invite.status == "pending")
    ).all()

    for inv in pending_invites:
        # Check if already a member
        existing_mem = session.exec(select(GroupMember).where(
            GroupMember.group_id == inv.group_id, GroupMember.user_id == user.id
        )).first()
        if not existing_mem:
            session.add(GroupMember(group_id=inv.group_id, user_id=user.id, is_admin=False))
        inv.status = "accepted"

    session.commit()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "firebase_uid": user.firebase_uid,
        "created_at": user.created_at
    }


@app.get("/auth/me")
def get_me(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Returns profile of currently authenticated user and active group count."""
    memberships = session.exec(
        select(GroupMember).where(GroupMember.user_id == current_user.id, GroupMember.active == True)
    ).all()
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "group_count": len(memberships)
    }


@app.get("/users/search")
def search_users(q: str, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Search users by username prefix. Returns only {id, username} — never email."""
    q = q.strip().lower().lstrip('@')  # normalize: lowercase, strip leading @
    if len(q) < 2:
        return []
    users = session.exec(
        select(User)
        .where(User.username.startswith(q, autoescape=True))
        .limit(10)
    ).all()
    return [{"id": u.id, "username": u.username} for u in users]


# -------------------------------------------------------------
# Groups & Member Invites
# -------------------------------------------------------------

@app.post("/groups")
def create_group(
    payload: GroupCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Creates a new group; caller automatically becomes member with is_admin=True."""
    group = Group(name=payload.name)
    session.add(group)
    session.commit()
    session.refresh(group)

    # Add creator as admin
    admin_member = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        upi_id=payload.admin_upi_id,
        is_admin=True
    )
    session.add(admin_member)
    session.commit()
    session.refresh(admin_member)

    return {
        "id": group.id,
        "name": group.name,
        "created_at": group.created_at,
        "admin_member_id": admin_member.id
    }


@app.get("/groups")
def list_my_groups(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Lists all groups the authenticated user belongs to."""
    memberships = session.exec(
        select(GroupMember).where(GroupMember.user_id == current_user.id, GroupMember.active == True)
    ).all()
    
    result = []
    for mem in memberships:
        group = session.get(Group, mem.group_id)
        if group:
            members_count = len(session.exec(select(GroupMember).where(GroupMember.group_id == group.id)).all())
            expenses_count = len(session.exec(select(ExpenseDB).where(ExpenseDB.group_id == group.id)).all())
            is_frozen = bool(session.exec(
                select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group.id)
            ).first())
            
            result.append({
                "id": group.id,
                "name": group.name,
                "is_admin": mem.is_admin,
                "members_count": members_count,
                "expenses_count": expenses_count,
                "is_frozen": is_frozen,
                "fully_settled_at": group.fully_settled_at,
                "created_at": group.created_at
            })
    return result


@app.get("/groups/{group_id}")
def get_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Returns group details, member profiles, and freeze/settlement status."""
    get_group_membership(group_id, current_user, session)
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(404, "Group not found")

    members = session.exec(select(GroupMember).where(GroupMember.group_id == group_id)).all()
    members_data = []
    for m in members:
        u = session.get(User, m.user_id) if m.user_id else None
        members_data.append({
            "id": m.id,
            "user_id": m.user_id,
            "name": u.username if u else "Pending Member",
            "email": u.email if u else None,
            "upi_id": m.upi_id,
            "is_admin": m.is_admin,
            "active": m.active
        })

    is_frozen = bool(session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group_id)
    ).first())

    return {
        "id": group.id,
        "name": group.name,
        "is_frozen": is_frozen,
        "fully_settled_at": group.fully_settled_at,
        "members": members_data
    }


@app.post("/groups/{group_id}/invite")
def invite_member(
    group_id: int,
    payload: InviteCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Invites a member by email, shareable join link, or existing username."""
    get_group_membership(group_id, current_user, session)
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(404, "Group not found")

    if payload.method == "email":
        if not payload.email:
            raise HTTPException(400, "Email is required for email invite")
        
        # Check if user already exists
        target_user = session.exec(select(User).where(User.email == payload.email)).first()
        if target_user:
            existing_mem = session.exec(select(GroupMember).where(
                GroupMember.group_id == group_id, GroupMember.user_id == target_user.id
            )).first()
            if not existing_mem:
                mem = GroupMember(group_id=group_id, user_id=target_user.id, is_admin=False)
                session.add(mem)
                session.commit()
                session.refresh(mem)
                return {"status": "added", "method": "email", "member_id": mem.id}
            return {"status": "already_member", "method": "email"}

        invite = Invite(group_id=group_id, method="email", invited_email=payload.email, status="pending")
        session.add(invite)
        session.commit()
        session.refresh(invite)
        return {"status": "pending_invite_created", "invite_id": invite.id}

    elif payload.method == "join_link":
        token = secrets.token_urlsafe(16)
        invite = Invite(group_id=group_id, method="join_link", join_token=token, status="pending")
        session.add(invite)
        session.commit()
        session.refresh(invite)
        return {"status": "link_created", "join_token": token, "join_url": f"/groups/join/{token}"}

    elif payload.method == "username":
        if not payload.username:
            raise HTTPException(400, "Username is required for username invite")
        lookup = normalize_username(payload.username)  # case-insensitive, strip @
        target_user = session.exec(select(User).where(User.username == lookup)).first()
        if not target_user:
            raise HTTPException(404, f"User '@{lookup}' not found")
        
        existing_mem = session.exec(select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == target_user.id
        )).first()
        if existing_mem:
            return {"status": "already_member", "member_id": existing_mem.id}
        
        mem = GroupMember(group_id=group_id, user_id=target_user.id, is_admin=False)
        session.add(mem)
        session.commit()
        session.refresh(mem)
        return {"status": "added", "method": "username", "member_id": mem.id}

    raise HTTPException(400, "Invalid invite method. Choose 'email', 'join_link', or 'username'")


@app.post("/groups/join/{join_token}")
def join_group_via_link(
    join_token: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Accepts a join-link invite and adds the authenticated user to the group."""
    invite = session.exec(select(Invite).where(Invite.join_token == join_token)).first()
    if not invite:
        raise HTTPException(404, "Invalid or expired join link")

    existing_mem = session.exec(select(GroupMember).where(
        GroupMember.group_id == invite.group_id, GroupMember.user_id == current_user.id
    )).first()
    if existing_mem:
        return {"status": "already_member", "group_id": invite.group_id, "member_id": existing_mem.id}

    mem = GroupMember(group_id=invite.group_id, user_id=current_user.id, is_admin=False)
    session.add(mem)
    session.commit()
    session.refresh(mem)
    return {"status": "joined", "group_id": invite.group_id, "member_id": mem.id}


# -------------------------------------------------------------
# Expenses & Debts Logging
# -------------------------------------------------------------

@app.post("/groups/{group_id}/expenses/equal")
def add_equal_expense(
    group_id: int,
    payload: EqualExpenseCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Convenience endpoint: single payer, equal split among members."""
    get_group_membership(group_id, current_user, session)
    check_group_not_frozen(group_id, session)

    splits = compute_splits("equal", payload.split_among, payload.total_amount)
    payers = validate_and_compute_payers([{"member_id": payload.paid_by, "amount_paid": payload.total_amount}], payload.total_amount)

    expense = ExpenseDB(
        group_id=group_id,
        description=payload.description,
        total_amount=payload.total_amount,
        split_type="equal"
    )
    session.add(expense)
    session.commit()
    session.refresh(expense)

    for m_id, amt in payers:
        session.add(ExpensePayerDB(expense_id=expense.id, member_id=m_id, amount_paid=amt))
    for m_id, share in splits:
        session.add(ExpenseSplitDB(expense_id=expense.id, member_id=m_id, share_amount=share))
    session.commit()

    return {"id": expense.id, "description": expense.description, "total_amount": expense.total_amount}


@app.post("/groups/{group_id}/expenses")
def add_expense_general(
    group_id: int,
    payload: ExpenseCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Multi-payer and unequal split endpoint (equal, exact, percentage, shares)."""
    get_group_membership(group_id, current_user, session)
    check_group_not_frozen(group_id, session)

    payers = validate_and_compute_payers(payload.paid_by, payload.total_amount)
    splits = compute_splits(payload.split_type, payload.split_among, payload.total_amount)

    expense = ExpenseDB(
        group_id=group_id,
        description=payload.description,
        total_amount=payload.total_amount,
        split_type=payload.split_type
    )
    session.add(expense)
    session.commit()
    session.refresh(expense)

    for m_id, amt in payers:
        session.add(ExpensePayerDB(expense_id=expense.id, member_id=m_id, amount_paid=amt))
    for m_id, share in splits:
        session.add(ExpenseSplitDB(expense_id=expense.id, member_id=m_id, share_amount=share))
    session.commit()

    return {
        "id": expense.id,
        "description": expense.description,
        "total_amount": expense.total_amount,
        "split_type": expense.split_type,
        "payers": [{"member_id": m, "amount_paid": a} for m, a in payers],
        "splits": [{"member_id": m, "share_amount": s} for m, s in splits]
    }


@app.get("/groups/{group_id}/expenses")
def list_expenses(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """List all logged expenses for a group."""
    get_group_membership(group_id, current_user, session)
    expenses = session.exec(select(ExpenseDB).where(ExpenseDB.group_id == group_id)).all()
    result = []
    for e in expenses:
        payers = session.exec(select(ExpensePayerDB).where(ExpensePayerDB.expense_id == e.id)).all()
        splits = session.exec(select(ExpenseSplitDB).where(ExpenseSplitDB.expense_id == e.id)).all()
        result.append({
            "id": e.id,
            "description": e.description,
            "total_amount": e.total_amount,
            "split_type": e.split_type,
            "created_at": e.created_at,
            "payers": [{"member_id": p.member_id, "amount_paid": p.amount_paid} for p in payers],
            "splits": [{"member_id": s.member_id, "share_amount": s.share_amount} for s in splits],
        })
    return result


@app.post("/groups/{group_id}/debts")
def add_debt(
    group_id: int,
    payload: DebtCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Logs a direct 1-to-1 personal IOU."""
    get_group_membership(group_id, current_user, session)
    check_group_not_frozen(group_id, session)

    if payload.from_member_id == payload.to_member_id:
        raise HTTPException(400, "Debtor and creditor cannot be the same member")
    if payload.amount <= 0:
        raise HTTPException(400, "Debt amount must be positive")

    debt = PersonalDebtDB(
        group_id=group_id,
        from_member_id=payload.from_member_id,
        to_member_id=payload.to_member_id,
        amount=round(payload.amount, 2),
        note=payload.note
    )
    session.add(debt)
    session.commit()
    session.refresh(debt)
    return {
        "id": debt.id,
        "group_id": debt.group_id,
        "from_member_id": debt.from_member_id,
        "to_member_id": debt.to_member_id,
        "amount": debt.amount,
        "note": debt.note,
        "created_at": debt.created_at
    }


@app.get("/groups/{group_id}/balances")
def get_balances(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Computes live net balances for all members."""
    get_group_membership(group_id, current_user, session)
    member_by_id, algo_expenses, algo_debts = _load_algo_inputs(group_id, session)
    if not algo_expenses and not algo_debts:
        return {m.id: 0.0 for m in member_by_id.values()}

    balances = compute_balances(algo_expenses, algo_debts)
    
    result = {}
    for mid, bal in balances.items():
        m_id_int = int(mid)
        if m_id_int in member_by_id:
            m = member_by_id[m_id_int]
            u = session.get(User, m.user_id) if m.user_id else None
            name = u.username if u else f"Member {m.id}"
            result[name] = bal
    return result


# -------------------------------------------------------------
# Settlement Lifecycle, Confirmations & Cancellation
# -------------------------------------------------------------

@app.post("/groups/{group_id}/settle")
def run_settle(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Admin-only: Generates and persists the optimal settlement plan."""
    require_group_admin(group_id, current_user, session)
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(404, "Group not found")

    # If settlement plan already exists, return it
    existing_settlements = session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group_id)
    ).all()

    if existing_settlements:
        return get_settlements(group_id, current_user, session)

    member_by_id, algo_expenses, algo_debts = _load_algo_inputs(group_id, session)
    balances = compute_balances(algo_expenses, algo_debts) if (algo_expenses or algo_debts) else {}

    settlements, algorithm_used = settle(balances)

    saved_rows = []
    for s in settlements:
        row = SettlementTransactionDB(
            group_id=group_id,
            from_member_id=int(s.from_member_id),
            to_member_id=int(s.to_member_id),
            amount=s.amount,
            status="pending",
            algorithm_used=algorithm_used
        )
        session.add(row)
        saved_rows.append(row)

    session.commit()
    return get_settlements(group_id, current_user, session)


@app.get("/groups/{group_id}/settlements")
def get_settlements(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Returns the locked-in settlement plan, statuses, and UPI deep-links."""
    get_group_membership(group_id, current_user, session)
    settlements = session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group_id)
    ).all()

    members = session.exec(select(GroupMember).where(GroupMember.group_id == group_id)).all()
    member_by_id = {m.id: m for m in members}

    result = []
    for s in settlements:
        from_m = member_by_id.get(s.from_member_id)
        to_m = member_by_id.get(s.to_member_id)
        from_u = session.get(User, from_m.user_id) if (from_m and from_m.user_id) else None
        to_u = session.get(User, to_m.user_id) if (to_m and to_m.user_id) else None

        from_name = from_u.username if from_u else f"Member {s.from_member_id}"
        to_name = to_u.username if to_u else f"Member {s.to_member_id}"

        upi_link = None
        if to_m and to_m.upi_id:
            algo_member = AlgoMember(id=str(to_m.id), name=to_name, upi_id=to_m.upi_id)
            upi_link = build_upi_link(algo_member, s.amount, note="Debt Settlement")

        result.append({
            "id": s.id,
            "from_member_id": s.from_member_id,
            "from_name": from_name,
            "to_member_id": s.to_member_id,
            "to_name": to_name,
            "amount": s.amount,
            "status": s.status,
            "algorithm_used": s.algorithm_used,
            "upi_link": upi_link,
            "paid_at": s.paid_at,
            "confirmed_at": s.confirmed_at
        })

    all_confirmed = len(settlements) > 0 and all(s.status == "confirmed" for s in settlements)
    return {
        "group_id": group_id,
        "transaction_count": len(result),
        "is_fully_settled": all_confirmed,
        "settlements": result
    }


@app.post("/settlements/{transaction_id}/mark-paid")
def mark_paid(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Payer marks the payment as made (moves to paid_pending_confirmation)."""
    tx = session.get(SettlementTransactionDB, transaction_id)
    if not tx:
        raise HTTPException(404, "Settlement transaction not found")

    from_member = session.get(GroupMember, tx.from_member_id)
    if not from_member or from_member.user_id != current_user.id:
        raise HTTPException(403, "Only the designated payer can mark this transaction as paid")

    if tx.status != "pending":
        raise HTTPException(400, f"Cannot mark as paid: transaction is currently '{tx.status}'")

    tx.status = "paid_pending_confirmation"
    tx.paid_at = datetime.now(timezone.utc)
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return {
        "id": tx.id,
        "status": tx.status,
        "paid_at": tx.paid_at
    }


@app.post("/settlements/{transaction_id}/confirm")
def confirm_payment(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Receiver confirms receipt of payment. If all transactions are confirmed, stamps fully_settled_at."""
    tx = session.get(SettlementTransactionDB, transaction_id)
    if not tx:
        raise HTTPException(404, "Settlement transaction not found")

    to_member = session.get(GroupMember, tx.to_member_id)
    if not to_member or to_member.user_id != current_user.id:
        raise HTTPException(403, "Only the designated receiver can confirm this transaction")

    if tx.status != "paid_pending_confirmation":
        raise HTTPException(400, f"Transaction is not awaiting confirmation (status: '{tx.status}')")

    tx.status = "confirmed"
    tx.confirmed_at = datetime.now(timezone.utc)
    session.add(tx)

    # Check if ALL settlement transactions for this group are now confirmed
    all_settlements = session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == tx.group_id)
    ).all()

    if all(s.id == tx.id or s.status == "confirmed" for s in all_settlements):
        group = session.get(Group, tx.group_id)
        if group and not group.fully_settled_at:
            group.fully_settled_at = datetime.now(timezone.utc)
            session.add(group)

    session.commit()
    session.refresh(tx)
    return {
        "id": tx.id,
        "status": tx.status,
        "confirmed_at": tx.confirmed_at
    }


@app.post("/settlements/{transaction_id}/deny")
def deny_payment(
    transaction_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Receiver denies receiving payment. Resets status back to pending."""
    tx = session.get(SettlementTransactionDB, transaction_id)
    if not tx:
        raise HTTPException(404, "Settlement transaction not found")

    to_member = session.get(GroupMember, tx.to_member_id)
    if not to_member or to_member.user_id != current_user.id:
        raise HTTPException(403, "Only the designated receiver can deny this transaction")

    if tx.status != "paid_pending_confirmation":
        raise HTTPException(400, f"Cannot deny: transaction is currently '{tx.status}', not awaiting confirmation")

    tx.status = "pending"
    tx.paid_at = None
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return {
        "id": tx.id,
        "status": tx.status
    }


@app.post("/groups/{group_id}/cancel-settlement")
def cancel_settlement(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Admin-only: Cancels the settlement plan ONLY IF all transactions are still pending."""
    require_group_admin(group_id, current_user, session)
    
    settlements = session.exec(
        select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == group_id)
    ).all()

    if not settlements:
        raise HTTPException(400, "No active settlement plan to cancel")

    # Anti-cheat / Safety Rule: Can only cancel if EVERY row is still 'pending'
    if any(s.status != "pending" for s in settlements):
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel settlement: one or more payments are already in motion or confirmed"
        )

    for s in settlements:
        session.delete(s)
    session.commit()

    return {"status": "success", "message": "Settlement plan cancelled. Group reopened to active state."}


# -------------------------------------------------------------
# Group Chat (REST with Auto-Lock)
# -------------------------------------------------------------

@app.post("/groups/{group_id}/chat")
def send_chat_message(
    group_id: int,
    payload: ChatCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Sends a chat message to the group. Rejects if group is fully settled."""
    membership = get_group_membership(group_id, current_user, session)
    group = session.get(Group, group_id)

    if group.fully_settled_at:
        raise HTTPException(status_code=400, detail="Chat is closed (group is fully settled and read-only)")

    if not payload.body.strip():
        raise HTTPException(400, "Message body cannot be empty")

    msg = ChatMessageDB(
        group_id=group_id,
        sender_member_id=membership.id,
        body=payload.body.strip()
    )
    session.add(msg)
    session.commit()
    session.refresh(msg)
    return {
        "id": msg.id,
        "sender_member_id": msg.sender_member_id,
        "sender_username": current_user.username,
        "body": msg.body,
        "created_at": msg.created_at
    }


@app.get("/groups/{group_id}/chat")
def get_chat_history(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Retrieves chat message history for the group."""
    get_group_membership(group_id, current_user, session)
    group = session.get(Group, group_id)
    if not group:
        raise HTTPException(404, "Group not found")

    messages = session.exec(
        select(ChatMessageDB).where(ChatMessageDB.group_id == group_id).order_by(ChatMessageDB.created_at)
    ).all()

    members = session.exec(select(GroupMember).where(GroupMember.group_id == group_id)).all()
    user_by_member = {}
    for m in members:
        u = session.get(User, m.user_id) if m.user_id else None
        user_by_member[m.id] = u.username if u else "Unknown"

    return {
        "group_id": group_id,
        "is_read_only": bool(group.fully_settled_at),
        "messages": [
            {
                "id": msg.id,
                "sender_member_id": msg.sender_member_id,
                "sender_username": user_by_member.get(msg.sender_member_id, "Unknown"),
                "body": msg.body,
                "created_at": msg.created_at
            }
            for msg in messages
        ]
    }


# -------------------------------------------------------------
# Retention Trigger Endpoint
# -------------------------------------------------------------

@app.post("/admin/retention/cleanup")
def trigger_retention_cleanup(
    days: int = 7,
    x_admin_key: str = Header(default=""),
    session: Session = Depends(get_session)
):
    if not RETENTION_ADMIN_KEY or x_admin_key != RETENTION_ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Not authorized")
    deleted_ids = cleanup_expired_groups(session, retention_days=days)
    return {"status": "success", "deleted_group_ids": deleted_ids}
