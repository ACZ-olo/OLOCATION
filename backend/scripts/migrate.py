"""Crea la base de datos (si no existe) y aplica las migraciones pendientes.

Uso:  python -m scripts.migrate
"""
from app.config import db_path
from app.db import connect, migrate


def main() -> None:
    conn = connect()
    try:
        applied = migrate(conn)
    finally:
        conn.close()
    print(f"Base de datos: {db_path()}")
    print("Migraciones aplicadas: " + (", ".join(applied) if applied else "ninguna (ya al día)"))


if __name__ == "__main__":
    main()
