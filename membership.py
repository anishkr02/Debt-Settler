"""Small helper so every path that adds someone to a group behaves the same."""

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from db_models import GroupMember


def add_member_idempotent(session: Session, group_id: int, user_id: int):
    """Add user_id to group_id unless they're already in it.

    Returns (member, created). Safe against two requests racing: if the
    database rejects the duplicate row, we roll back and return the row the
    other request created instead of failing.
    """
    def _find():
        return session.exec(select(GroupMember).where(
            GroupMember.group_id == group_id, GroupMember.user_id == user_id
        )).first()

    existing = _find()
    if existing:
        return existing, False

    member = GroupMember(group_id=group_id, user_id=user_id, is_admin=False)
    session.add(member)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = _find()
        if existing:
            return existing, False
        raise
    session.refresh(member)
    return member, True
