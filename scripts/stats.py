import json
from pathlib import Path
import sys

from sqlalchemy import func
from sqlmodel import Session, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import engine
from db_models import ExpenseDB, Group, SettlementTransactionDB, User


def collect_stats(session: Session) -> dict[str, int]:
    return {
        "users": session.exec(select(func.count()).select_from(User)).one(),
        "groups": session.exec(select(func.count()).select_from(Group)).one(),
        "expenses": session.exec(select(func.count()).select_from(ExpenseDB)).one(),
        "groups_with_settlement": session.exec(
            select(func.count(func.distinct(SettlementTransactionDB.group_id)))
        ).one(),
        "confirmed_settlements": session.exec(
            select(func.count()).select_from(SettlementTransactionDB).where(
                SettlementTransactionDB.status == "confirmed"
            )
        ).one(),
    }


def main() -> None:
    with Session(engine) as session:
        print(json.dumps(collect_stats(session), sort_keys=True))


if __name__ == "__main__":
    main()
