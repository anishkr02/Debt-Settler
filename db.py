import os
from dotenv import load_dotenv
from sqlmodel import SQLModel, create_engine, Session

load_dotenv()

def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return "postgresql://" + database_url[len("postgres://"):]
    return database_url


def sqlalchemy_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return "postgresql+psycopg://" + database_url[len("postgresql://"):]
    return database_url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./debt_settle.db"))
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(sqlalchemy_database_url(DATABASE_URL), echo=False, connect_args=connect_args, pool_pre_ping=True)


def init_db():
    if engine.dialect.name != "sqlite":
        return

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
