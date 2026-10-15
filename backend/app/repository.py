import sqlite3

_STORE_SELECT = (
    "SELECT s.id, s.code, s.name, s.address, s.latitude, s.longitude,"
    " s.location_updated_at AS locationUpdatedAt,"
    " (SELECT COUNT(*) FROM store_location_changes c WHERE c.store_id = s.id) AS changeCount"
    " FROM stores s"
)

_CHANGE_COLUMNS = (
    "id, store_id AS storeId, latitude, longitude, accuracy_m AS accuracyM, source,"
    " previous_latitude AS previousLatitude, previous_longitude AS previousLongitude,"
    " created_at AS createdAt"
)


def list_stores(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(f"{_STORE_SELECT} ORDER BY s.name COLLATE NOCASE, s.code")
    return [dict(row) for row in rows]


def get_store(conn: sqlite3.Connection, store_id: int) -> dict | None:
    row = conn.execute(f"{_STORE_SELECT} WHERE s.id = ?", (store_id,)).fetchone()
    return dict(row) if row else None


def list_location_changes(conn: sqlite3.Connection, store_id: int) -> list[dict]:
    rows = conn.execute(
        f"SELECT {_CHANGE_COLUMNS} FROM store_location_changes"
        " WHERE store_id = ? ORDER BY created_at DESC, id DESC",
        (store_id,),
    )
    return [dict(row) for row in rows]


def create_location_change(
    conn: sqlite3.Connection,
    store_id: int,
    latitude: float,
    longitude: float,
    source: str,
    accuracy_m: float | None,
) -> dict:
    """Registra el cambio (guardando la coordenada anterior) y actualiza la tienda, todo junto."""
    with conn:
        previous = conn.execute(
            "SELECT latitude, longitude FROM stores WHERE id = ?", (store_id,)
        ).fetchone()
        cursor = conn.execute(
            "INSERT INTO store_location_changes"
            " (store_id, latitude, longitude, accuracy_m, source, previous_latitude, previous_longitude)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (store_id, latitude, longitude, accuracy_m, source, previous["latitude"], previous["longitude"]),
        )
        change = dict(
            conn.execute(
                f"SELECT {_CHANGE_COLUMNS} FROM store_location_changes WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        )
        conn.execute(
            "UPDATE stores SET latitude = ?, longitude = ?, location_updated_at = ? WHERE id = ?",
            (latitude, longitude, change["createdAt"], store_id),
        )
    return change
