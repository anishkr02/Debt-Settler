"""
Debt-Settle API.
Complete FastAPI backend implementing identity, group invites, multi-payer/unequal expenses,
hybrid debt settlement, two-step payment confirmation, cancel rules, group chat, and retention.
"""

import logging
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Optional, List, Dict

from fastapi import FastAPI, HTTPException, Depends, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlmodel import Session, select

RETENTION_ADMIN_KEY = os.getenv("RETENTION_ADMIN_KEY", "")

from db import init_db, get_session
from db_models import (
    User, Group, GroupMember, Invite, ExpenseDB, ExpensePayerDB,
    ExpenseSplitDB, PersonalDebtDB, SettlementTransactionDB, ChatMessageDB
)
from auth import get_current_user, get_group_membership, require_group_admin, DEV_MODE
from expense_helpers import validate_and_compute_payers, compute_splits
from retention import cleanup_expired_groups
from membership import add_member_idempotent

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

logger = logging.getLogger("debt_settle")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
limiter = Limiter(key_func=get_remote_address, enabled=RATE_LIMIT_ENABLED)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
CORS_DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def parse_cors_allowed_origins(value: str) -> List[str]:
    origins = [origin.strip() for origin in value.split(",") if origin.strip()]
    return origins or CORS_DEFAULT_ORIGINS.copy()


CORS_ALLOWED_ORIGINS = parse_cors_allowed_origins(os.getenv("CORS_ALLOWED_ORIGINS", ""))


def configure_sentry(dsn: str) -> None:
    if dsn:
        import sentry_sdk
        sentry_sdk.init(
            dsn=dsn,
            send_default_pii=False,
            max_request_body_size="never",
        )


configure_sentry(os.getenv("SENTRY_DSN", ""))


# Anything unexpected becomes a generic 500. The real error goes to the server
# log only; exception text (SQL, user ids, file paths) never reaches the client.
# This middleware is added BEFORE CORSMiddleware on purpose, so CORS wraps it
# and the browser can still read the error response.
@app.middleware("http")
async def catch_unhandled_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong"})


# Two requests racing to create the same row (e.g. same username) -> clean 409.
@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.warning("IntegrityError on %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse(
        status_code=409,
        content={"detail": "That already exists or was just taken. Please try again."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------------------------------------------
# Request & Response Schemas
# -------------------------------------------------------------

class UserSignup(BaseModel):
    username: str
    email: EmailStr
    firebase_uid: Optional[str] = None


class UsernameUpdate(BaseModel):
    username: str


class MemberUpiUpdate(BaseModel):
    upi_id: Optional[str]


class ConsentUpdate(BaseModel):
    version: str


# 3-20 chars, lowercase letters / digits / underscore only
USERNAME_RE = re.compile(r'^[a-z0-9_]{3,20}$')
UPI_ID_RE = re.compile(r'^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$')


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
@limiter.limit("10/minute")
def signup(payload: UserSignup, request: Request, session: Session = Depends(get_session)):
    """Registers or sets up a user profile in DEV_MODE. Disabled in production."""
    if not DEV_MODE:
        raise HTTPException(
            status_code=403,
            detail="Signup endpoint is disabled in production. Users are auto-provisioned via Firebase authentication."
        )

    # Normalize and validate username (stored lowercase, [a-z0-9_], 3-20 chars)
    username = validate_username(payload.username)
    email = payload.email.strip().lower()

    # Case-insensitive uniqueness check (usernames are always stored lowercase,
    # so a plain equality check on the normalized value is sufficient)
    existing_username = session.exec(select(User).where(User.username == username)).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username is already taken")

    user = User(
        username=username,
        email=email,
        firebase_uid=payload.firebase_uid,
        username_confirmed=True
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # Claim pending email invites
    pending_invites = session.exec(
        select(Invite).where(Invite.invited_email == email, Invite.status == "pending")
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
        "username_confirmed": user.username_confirmed,
        "firebase_uid": user.firebase_uid,
        "created_at": user.created_at
    }


@app.get("/auth/me")
@limiter.limit("30/minute")
def get_me(request: Request, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Returns profile of currently authenticated user and active group count."""
    memberships = session.exec(
        select(GroupMember).where(GroupMember.user_id == current_user.id, GroupMember.active == True)
    ).all()
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "username_confirmed": current_user.username_confirmed,
        "consented_at": current_user.consented_at,
        "consent_version": current_user.consent_version,
        "group_count": len(memberships)
    }


@app.post("/auth/me/consent")
@limiter.limit("10/minute")
def record_consent(
    payload: ConsentUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    current_user.consented_at = datetime.now(timezone.utc)
    current_user.consent_version = payload.version
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return {
        "consented_at": current_user.consented_at,
        "consent_version": current_user.consent_version
    }


@app.delete("/auth/me")
@limiter.limit("10/minute")
def delete_my_account(
    request: Request,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    memberships = session.exec(
        select(GroupMember).where(GroupMember.user_id == current_user.id)
    ).all()
    member_ids = [membership.id for membership in memberships]

    if member_ids:
        transactions = session.exec(
            select(SettlementTransactionDB).where(
                or_(
                    SettlementTransactionDB.from_member_id.in_(member_ids),
                    SettlementTransactionDB.to_member_id.in_(member_ids)
                )
            )
        ).all()
        for transaction in transactions:
            group = session.get(Group, transaction.group_id)
            if group and group.fully_settled_at is None and transaction.status != "confirmed":
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete your account while a settlement transaction is unconfirmed."
                )

    for membership in memberships:
        if not membership.is_admin:
            continue
        group = session.get(Group, membership.group_id)
        if not group or group.fully_settled_at is not None:
            continue
        other_members = session.exec(
            select(GroupMember).where(
                GroupMember.group_id == membership.group_id,
                GroupMember.id != membership.id
            )
        ).first()
        if other_members:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete your account while you administer an unsettled group with other members."
            )

    old_email = current_user.email
    if not DEV_MODE:
        if not current_user.firebase_uid:
            raise HTTPException(
                status_code=502,
                detail="Could not delete your Firebase account; no account data was changed. Please retry."
            )
        try:
            from firebase_admin import auth as fb_auth
            fb_auth.delete_user(current_user.firebase_uid)
        except Exception:
            logger.exception("Firebase user deletion failed")
            raise HTTPException(
                status_code=502,
                detail="Could not delete your Firebase account; no account data was changed. Please retry."
            )

    deleted_identifier = f"deleted_{current_user.id}"
    current_user.username = deleted_identifier
    current_user.email = f"{deleted_identifier}@invalid.local"
    current_user.firebase_uid = deleted_identifier
    for membership in memberships:
        membership.upi_id = None

    pending_invites = session.exec(
        select(Invite).where(
            Invite.invited_email == old_email,
            Invite.status == "pending"
        )
    ).all()
    for invite in pending_invites:
        session.delete(invite)

    session.add(current_user)
    session.add_all(memberships)
    session.commit()
    return {"status": "deleted"}


@app.patch("/auth/me/username")
@limiter.limit("10/minute")
def update_username(
    payload: UsernameUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Updates username for a newly auto-provisioned user. Allowed only once while username_confirmed is False."""
    if current_user.username_confirmed:
        raise HTTPException(
            status_code=400,
            detail="Username has already been confirmed and cannot be changed."
        )

    new_username = validate_username(payload.username)

    # Check uniqueness (409 if taken by another user)
    existing = session.exec(
        select(User).where(User.username == new_username, User.id != current_user.id)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username is already taken")

    current_user.username = new_username
    current_user.username_confirmed = True
    session.add(current_user)
    try:
        session.commit()
    except IntegrityError:
        # Someone claimed it between our check and the commit.
        session.rollback()
        raise HTTPException(status_code=409, detail="Username is already taken")
    session.refresh(current_user)

    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "username_confirmed": current_user.username_confirmed
    }


@app.get("/users/search")
@limiter.limit("30/minute")
def search_users(q: str, request: Request, current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
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
    me = get_group_membership(group_id, current_user, session)
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

    expenses_count = len(session.exec(
        select(ExpenseDB).where(ExpenseDB.group_id == group_id)
    ).all())

    return {
        "id": group.id,
        "name": group.name,
        "is_frozen": is_frozen,
        "fully_settled_at": group.fully_settled_at,
        "is_admin": me.is_admin,            # is the CALLER the admin of this group
        "expenses_count": expenses_count,
        "members": members_data
    }


@app.patch("/groups/{group_id}/members/me")
def update_my_group_member(
    group_id: int,
    payload: MemberUpiUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Updates the authenticated user's UPI ID for this group."""
    membership = get_group_membership(group_id, current_user, session)
    if payload.upi_id not in (None, "") and not UPI_ID_RE.fullmatch(payload.upi_id):
        raise HTTPException(status_code=422, detail="Invalid UPI ID format")

    membership.upi_id = payload.upi_id or None
    session.add(membership)
    session.commit()
    session.refresh(membership)

    return {
        "id": membership.id,
        "user_id": membership.user_id,
        "name": current_user.username,
        "email": current_user.email,
        "upi_id": membership.upi_id,
        "is_admin": membership.is_admin,
        "active": membership.active
    }


@app.post("/groups/{group_id}/invite")
@limiter.limit("10/minute")
def invite_member(
    group_id: int,
    payload: InviteCreate,
    request: Request,
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
        
        target_email = payload.email.strip().lower()

        # Check if user already exists with this email -> add immediately!
        target_user = session.exec(select(User).where(User.email == target_email)).first()
        if target_user:
            mem, created = add_member_idempotent(session, group_id, target_user.id)
            return {"status": "added" if created else "already_member", "method": "email", "member_id": mem.id}

        # Inviting the same address twice reuses the pending invite.
        existing_invite = session.exec(select(Invite).where(
            Invite.group_id == group_id, Invite.invited_email == target_email,
            Invite.method == "email", Invite.status == "pending"
        )).first()
        if existing_invite:
            return {"status": "pending_invite_created", "invite_id": existing_invite.id}

        invite = Invite(group_id=group_id, method="email", invited_email=target_email, status="pending")
        session.add(invite)
        session.commit()
        session.refresh(invite)
        return {"status": "pending_invite_created", "invite_id": invite.id}

    elif payload.method == "join_link":
        # One stable link per group: reuse it instead of minting a new one
        # every time somebody opens the Link tab.
        existing_link = session.exec(select(Invite).where(
            Invite.group_id == group_id, Invite.method == "join_link"
        ).order_by(Invite.id.desc())).first()
        if existing_link and existing_link.join_token:
            token = existing_link.join_token
        else:
            token = secrets.token_urlsafe(16)
            invite = Invite(group_id=group_id, method="join_link", join_token=token, status="pending")
            session.add(invite)
            session.commit()
        return {"status": "link_created", "join_token": token, "join_url": f"/groups/join/{token}"}

    elif payload.method == "username":
        if not payload.username:
            raise HTTPException(400, "Username is required for username invite")
        lookup = normalize_username(payload.username)  # case-insensitive, strip @
        target_user = session.exec(select(User).where(User.username == lookup)).first()
        if not target_user:
            raise HTTPException(404, f"User '@{lookup}' not found")
        
        mem, created = add_member_idempotent(session, group_id, target_user.id)
        if not created:
            return {"status": "already_member", "member_id": mem.id}
        return {"status": "added", "method": "username", "member_id": mem.id}

    raise HTTPException(400, "Invalid invite method. Choose 'email', 'join_link', or 'username'")


@app.post("/groups/join/{join_token}")
@limiter.limit("10/minute")
def join_group_via_link(
    join_token: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Accepts a join-link invite and adds the authenticated user to the group."""
    invite = session.exec(select(Invite).where(Invite.join_token == join_token)).first()
    if not invite:
        raise HTTPException(404, "Invalid or expired join link")

    mem, created = add_member_idempotent(session, invite.group_id, current_user.id)
    if not created:
        return {"status": "already_member", "group_id": invite.group_id, "member_id": mem.id}
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

    # Name every member the same way on every path (username, or "Member N").
    names = {}
    for m in member_by_id.values():
        u = session.get(User, m.user_id) if m.user_id else None
        names[m.id] = u.username if u else f"Member {m.id}"

    # Everyone appears, even people with no expenses yet (balance 0.0).
    result = {name: 0.0 for name in names.values()}

    if algo_expenses or algo_debts:
        balances = compute_balances(algo_expenses, algo_debts)
        for mid, bal in balances.items():
            if int(mid) in names:
                result[names[int(mid)]] = bal
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

        to_upi_id = to_m.upi_id if to_m else None
        algo_member = AlgoMember(id=str(to_m.id) if to_m else str(s.to_member_id), name=to_name, upi_id=to_upi_id)
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
            "to_upi_id": to_upi_id,
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
