import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BASE_DIR / "migrations"


def db_path() -> Path:
    path = Path(os.environ.get("OLOCATION_DB_PATH", "data/olocation.db"))
    return path if path.is_absolute() else BASE_DIR / path
