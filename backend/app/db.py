import sqlite3
from collections.abc import Iterator
from pathlib import Path

from app.config import MIGRATIONS_DIR, db_path


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_connection() -> Iterator[sqlite3.Connection]:
    """Dependencia de FastAPI: una conexión por request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Aplica en orden los archivos migrations/NNN_*.sql pendientes. Devuelve los aplicados."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version TEXT PRIMARY KEY,"
        " applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))"
    )
    applied = {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}
    newly_applied = []
    for file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if file.name in applied:
            continue
        version = file.name.replace("'", "''")
        # El SQL y su registro en schema_migrations se aplican en una sola transacción.
        try:
            conn.executescript(
                "BEGIN;\n"
                + file.read_text(encoding="utf-8")
                + f"\nINSERT INTO schema_migrations (version) VALUES ('{version}');\nCOMMIT;"
            )
        except sqlite3.Error:
            if conn.in_transaction:
                conn.rollback()
            raise
        newly_applied.append(file.name)
    return newly_applied
