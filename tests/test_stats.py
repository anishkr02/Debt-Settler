from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from db_models import ExpenseDB, Group, GroupMember, SettlementTransactionDB, User
from scripts.stats import collect_stats


def test_stats_returns_aggregate_counts_only():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user = User(email="private@example.com", username="private_user")
            group = Group(name="Private Group")
            session.add_all([user, group])
            session.commit()
            session.refresh(user)
            session.refresh(group)

            member = GroupMember(group_id=group.id, user_id=user.id)
            session.add(member)
            session.commit()
            session.refresh(member)

            session.add(ExpenseDB(group_id=group.id, description="Private", total_amount=10))
            session.add(SettlementTransactionDB(
                group_id=group.id,
                from_member_id=member.id,
                to_member_id=member.id,
                amount=10,
                status="confirmed",
            ))
            session.commit()

            assert collect_stats(session) == {
                "users": 1,
                "groups": 1,
                "expenses": 1,
                "groups_with_settlement": 1,
                "confirmed_settlements": 1,
            }
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
