import sqlite3


def list_carrier_clients(conn: sqlite3.Connection, carrier_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT c.id, c.code, c.name FROM clients c"
        " JOIN carrier_clients cc ON cc.client_id = c.id"
        " WHERE cc.carrier_id = ? ORDER BY c.name COLLATE NOCASE, c.id",
        (carrier_id,),
    )
    return [dict(row) for row in rows]


def client_exists(conn: sqlite3.Connection, client_id: int) -> bool:
    return conn.execute("SELECT 1 FROM clients WHERE id = ?", (client_id,)).fetchone() is not None


def is_client_assigned(conn: sqlite3.Connection, carrier_id: int, client_id: int) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM carrier_clients WHERE carrier_id = ? AND client_id = ?",
            (carrier_id, client_id),
        ).fetchone()
        is not None
    )


_CARRIER_COLUMNS = "id, name, id_number AS idNumber, plate, phone, created_at AS createdAt"


def get_carrier(conn: sqlite3.Connection, carrier_id: int) -> dict:
    row = conn.execute(f"SELECT {_CARRIER_COLUMNS} FROM carriers WHERE id = ?", (carrier_id,))
    return dict(row.fetchone())


def get_carrier_credentials(conn: sqlite3.Connection, id_number: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, pin_hash, failed_attempts, locked_until FROM carriers WHERE id_number = ?",
        (id_number,),
    ).fetchone()


def record_failed_login(
    conn: sqlite3.Connection, carrier_id: int, failed_attempts: int, locked_until: str | None
) -> None:
    with conn:
        conn.execute(
            "UPDATE carriers SET failed_attempts = ?, locked_until = ? WHERE id = ?",
            (failed_attempts, locked_until, carrier_id),
        )


def record_successful_login(
    conn: sqlite3.Connection,
    carrier_id: int,
    profile: dict,
    token_hash: str,
    expires_at: str,
    now: str,
) -> None:
    """Reinicia el contador de fallos, actualiza los datos enviados y registra el token."""
    with conn:
        conn.execute(
            "UPDATE carriers SET failed_attempts = 0, locked_until = NULL WHERE id = ?", (carrier_id,)
        )
        for column, value in profile.items():  # columnas fijas: name, plate, phone
            conn.execute(f"UPDATE carriers SET {column} = ? WHERE id = ?", (value, carrier_id))
        conn.execute(
            "DELETE FROM carrier_tokens WHERE carrier_id = ? AND expires_at <= ?", (carrier_id, now)
        )
        conn.execute(
            "INSERT INTO carrier_tokens (token_hash, carrier_id, expires_at) VALUES (?, ?, ?)",
            (token_hash, carrier_id, expires_at),
        )


def carrier_id_for_token(conn: sqlite3.Connection, token_hash: str, now: str) -> int | None:
    row = conn.execute(
        "SELECT carrier_id FROM carrier_tokens WHERE token_hash = ? AND expires_at > ?",
        (token_hash, now),
    ).fetchone()
    return row["carrier_id"] if row else None


_LOCATION_COLUMNS = (
    "id, client_id AS clientId, carrier_id AS carrierId, label, latitude, longitude,"
    " created_at AS createdAt"
)


def list_locations(conn: sqlite3.Connection, client_id: int) -> list[dict]:
    rows = conn.execute(
        f"SELECT {_LOCATION_COLUMNS} FROM client_locations"
        " WHERE client_id = ? ORDER BY created_at DESC, id DESC",
        (client_id,),
    )
    return [dict(row) for row in rows]


def list_carrier_locations(conn: sqlite3.Connection, carrier_id: int) -> list[dict]:
    """Todas las ubicaciones guardadas por el transportista, aunque el cliente ya no le esté asignado."""
    rows = conn.execute(
        "SELECT l.id, l.client_id AS clientId, l.carrier_id AS carrierId, l.label, l.latitude,"
        " l.longitude, l.created_at AS createdAt, c.code AS clientCode, c.name AS clientName"
        " FROM client_locations l JOIN clients c ON c.id = l.client_id"
        " WHERE l.carrier_id = ? ORDER BY l.created_at DESC, l.id DESC",
        (carrier_id,),
    )
    return [dict(row) for row in rows]


def create_location(
    conn: sqlite3.Connection,
    client_id: int,
    carrier_id: int,
    latitude: float,
    longitude: float,
    label: str | None,
) -> dict:
    with conn:
        cursor = conn.execute(
            "INSERT INTO client_locations (client_id, carrier_id, label, latitude, longitude)"
            " VALUES (?, ?, ?, ?, ?)",
            (client_id, carrier_id, label, latitude, longitude),
        )
    row = conn.execute(
        f"SELECT {_LOCATION_COLUMNS} FROM client_locations WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return dict(row)
