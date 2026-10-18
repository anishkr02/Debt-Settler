"""
7-Day Retention Cleanup Service.
Deletes groups and associated data 7 days after the group reached fully_settled_at.
"""

from datetime import datetime, timezone, timedelta
from typing import List
from sqlmodel import Session, select
from db_models import (
    Group, GroupMember, Invite, ExpenseDB, ExpensePayerDB,
    ExpenseSplitDB, PersonalDebtDB, SettlementTransactionDB, ChatMessageDB
)


def cleanup_expired_groups(session: Session, retention_days: int = 7) -> List[int]:
    """
    Finds all groups where fully_settled_at <= (now - retention_days) and cascade-deletes them.
    Returns the list of deleted group IDs.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    settled_groups = session.exec(
        select(Group).where(Group.fully_settled_at.is_not(None))
    ).all()
    expired_groups = []
    for group in settled_groups:
        settled_at = group.fully_settled_at
        if settled_at.tzinfo is None:
            settled_at = settled_at.replace(tzinfo=timezone.utc)
        else:
            settled_at = settled_at.astimezone(timezone.utc)
        if settled_at <= cutoff:
            expired_groups.append(group)

    deleted_ids = []
    
    for group in expired_groups:
        g_id = group.id
        
        # 1. Chat messages
        session.exec(select(ChatMessageDB).where(ChatMessageDB.group_id == g_id))
        for msg in session.exec(select(ChatMessageDB).where(ChatMessageDB.group_id == g_id)).all():
            session.delete(msg)
            
        # 2. Settlement transactions
        for st in session.exec(select(SettlementTransactionDB).where(SettlementTransactionDB.group_id == g_id)).all():
            session.delete(st)
            
        # 3. Personal debts
        for pd in session.exec(select(PersonalDebtDB).where(PersonalDebtDB.group_id == g_id)).all():
            session.delete(pd)
            
        # 4. Expenses, Payers & Splits
        expenses = session.exec(select(ExpenseDB).where(ExpenseDB.group_id == g_id)).all()
        for exp in expenses:
            for p in session.exec(select(ExpensePayerDB).where(ExpensePayerDB.expense_id == exp.id)).all():
                session.delete(p)
            for s in session.exec(select(ExpenseSplitDB).where(ExpenseSplitDB.expense_id == exp.id)).all():
                session.delete(s)
            session.delete(exp)
            
        # 5. Invites
        for inv in session.exec(select(Invite).where(Invite.group_id == g_id)).all():
            session.delete(inv)
            
        # 6. Group members
        for mem in session.exec(select(GroupMember).where(GroupMember.group_id == g_id)).all():
            session.delete(mem)
            
        # 7. Group itself
        session.delete(group)
        deleted_ids.append(g_id)
        
    session.commit()
    return deleted_ids
