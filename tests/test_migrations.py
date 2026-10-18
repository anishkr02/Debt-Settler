import os
from pathlib import Path
import subprocess
import sys
import tempfile

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import URL


def test_initial_migration_creates_final_schema_on_fresh_sqlite():
    project_root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as temp_dir:
        database_path = Path(temp_dir) / "fresh.db"
        database_url = URL.create("sqlite", database=str(database_path)).render_as_string(
            hide_password=False
        )
        environment = os.environ.copy()
        environment["DATABASE_URL"] = database_url

        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=project_root,
            env=environment,
            capture_output=True,
            text=True,
            check=True,
        )

        engine = create_engine(database_url)
        try:
            inspector = inspect(engine)
            assert "user" in inspector.get_table_names()
            assert "group" in inspector.get_table_names()
            user_columns = {column["name"] for column in inspector.get_columns("user")}
            assert {"consented_at", "consent_version"} <= user_columns
        finally:
            engine.dispose()
