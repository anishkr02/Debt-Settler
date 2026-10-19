"""
Database tables for Debt-Settle (SQLModel = SQLAlchemy + Pydantic in one).
"""

from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import DateTime, UniqueConstraint
from sqlmodel import SQLModel, Field, Relationship


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    firebase_uid: Optional[str] = Field(default=None, unique=True, index=True)
    email: str = Field(index=True)
    username: str = Field(unique=True, index=True)
    username_confirmed: bool = Field(default=False)
    consented_at: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))
    consent_version: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))

    memberships: List["GroupMember"] = Relationship(back_populates="user")


class Group(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))
    fully_settled_at: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))

    members: List["GroupMember"] = Relationship(back_populates="group")
    expenses: List["ExpenseDB"] = Relationship(back_populates="group")
    debts: List["PersonalDebtDB"] = Relationship(back_populates="group")
    invites: List["Invite"] = Relationship(back_populates="group")
    settlements: List["SettlementTransactionDB"] = Relationship(back_populates="group")
    messages: List["ChatMessageDB"] = Relationship(back_populates="group")


class GroupMember(SQLModel, table=True):
    # A user can belong to a group only once. Without this, two simultaneous
    # "join" requests (double click, React dev double-effect) could create two
    # membership rows for the same person.
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_groupmember_group_user"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    upi_id: Optional[str] = None
    is_admin: bool = Field(default=False)
    active: bool = Field(default=True)
    last_read_chat_id: Optional[int] = Field(default=None)
    last_seen_expense_id: Optional[int] = Field(default=None)
    last_seen_member_id: Optional[int] = Field(default=None)

    group: Optional[Group] = Relationship(back_populates="members")
    user: Optional[User] = Relationship(back_populates="memberships")


class Invite(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    method: str = Field(description="email | join_link | username")
    invited_email: Optional[str] = Field(default=None, index=True)
    join_token: Optional[str] = Field(default=None, unique=True, index=True)
    status: str = Field(default="pending", description="pending | accepted")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))

    group: Optional[Group] = Relationship(back_populates="invites")


class ExpenseDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    description: str
    total_amount: float
    split_type: str = Field(default="equal", description="equal | exact | percentage | shares")
    created_by_member_id: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))

    group: Optional[Group] = Relationship(back_populates="expenses")
    payers: List["ExpensePayerDB"] = Relationship(back_populates="expense")
    splits: List["ExpenseSplitDB"] = Relationship(back_populates="expense")


class ExpensePayerDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    expense_id: int = Field(foreign_key="expensedb.id", index=True)
    member_id: int = Field(foreign_key="groupmember.id", index=True)
    amount_paid: float

    expense: Optional[ExpenseDB] = Relationship(back_populates="payers")


class ExpenseSplitDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    expense_id: int = Field(foreign_key="expensedb.id", index=True)
    member_id: int = Field(foreign_key="groupmember.id", index=True)
    share_amount: float

    expense: Optional[ExpenseDB] = Relationship(back_populates="splits")


class PersonalDebtDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    from_member_id: int = Field(foreign_key="groupmember.id", index=True)
    to_member_id: int = Field(foreign_key="groupmember.id", index=True)
    amount: float
    note: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))

    group: Optional[Group] = Relationship(back_populates="debts")


class SettlementTransactionDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    from_member_id: int = Field(foreign_key="groupmember.id", index=True)
    to_member_id: int = Field(foreign_key="groupmember.id", index=True)
    amount: float
    status: str = Field(default="pending", description="pending | paid_pending_confirmation | confirmed")
    algorithm_used: str = Field(default="exact", description="exact | greedy")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))
    paid_at: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))
    confirmed_at: Optional[datetime] = Field(default=None, sa_type=DateTime(timezone=True))

    group: Optional[Group] = Relationship(back_populates="settlements")


class ChatMessageDB(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="group.id", index=True)
    sender_member_id: int = Field(foreign_key="groupmember.id", index=True)
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_type=DateTime(timezone=True))

    group: Optional[Group] = Relationship(back_populates="messages")
