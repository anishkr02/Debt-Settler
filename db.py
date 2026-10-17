import os
from dotenv import load_dotenv
from sqlalchemy import DateTime, inspect, text
from sqlmodel import SQLModel, create_engine, Session

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./debt_settle.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db():
    SQLModel.metadata.create_all(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("user")}
    datetime_type = DateTime().compile(dialect=engine.dialect)
    with engine.begin() as connection:
        if "consented_at" not in columns:
            connection.execute(text(f"ALTER TABLE user ADD COLUMN consented_at {datetime_type}"))
        if "consent_version" not in columns:
            connection.execute(text("ALTER TABLE user ADD COLUMN consent_version VARCHAR"))


def get_session():
    with Session(engine) as session:
        yield session
