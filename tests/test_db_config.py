from db import normalize_database_url, sqlalchemy_database_url


def test_parse_cors_origins_and_default():
    from fastapi.middleware.cors import CORSMiddleware
    from main import CORS_ALLOWED_ORIGINS, CORS_DEFAULT_ORIGINS, app, parse_cors_allowed_origins

    assert parse_cors_allowed_origins("https://app.example, https://admin.example ") == [
        "https://app.example",
        "https://admin.example",
    ]
    assert parse_cors_allowed_origins("") == CORS_DEFAULT_ORIGINS
    assert parse_cors_allowed_origins(" , ") == CORS_DEFAULT_ORIGINS
    cors = next(middleware for middleware in app.user_middleware if middleware.cls is CORSMiddleware)
    assert cors.kwargs["allow_origins"] == CORS_ALLOWED_ORIGINS
    assert "*" not in cors.kwargs["allow_origins"]


def test_normalize_legacy_postgres_url():
    assert normalize_database_url("postgres://user:pass@host/db") == "postgresql://user:pass@host/db"


def test_preserve_postgresql_and_sqlite_urls():
    assert normalize_database_url("postgresql://user:pass@host/db") == "postgresql://user:pass@host/db"
    assert normalize_database_url("sqlite:///./debt_settle.db") == "sqlite:///./debt_settle.db"


def test_postgres_urls_use_psycopg_three_driver():
    assert sqlalchemy_database_url("postgresql://user:pass@host/db") == (
        "postgresql+psycopg://user:pass@host/db"
    )
    assert sqlalchemy_database_url("postgresql+psycopg://user:pass@host/db") == (
        "postgresql+psycopg://user:pass@host/db"
    )


def test_init_db_skips_schema_creation_for_non_sqlite(monkeypatch):
    from types import SimpleNamespace
    import db

    monkeypatch.setattr(db, "engine", SimpleNamespace(dialect=SimpleNamespace(name="postgresql")))
    monkeypatch.setattr(
        db.SQLModel.metadata,
        "create_all",
        lambda engine: (_ for _ in ()).throw(AssertionError("create_all called for PostgreSQL")),
    )
    db.init_db()
