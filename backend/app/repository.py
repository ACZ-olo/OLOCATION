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


def export_backup(conn: sqlite3.Connection) -> list[dict]:
    """Todas las tiendas (por nombre) con su historial completo (más reciente primero)."""
    stores = [
        dict(row)
        for row in conn.execute(
            "SELECT id, code, name, address, latitude, longitude,"
            " location_updated_at AS locationUpdatedAt, created_at AS createdAt"
            " FROM stores ORDER BY name COLLATE NOCASE, code"
        )
    ]
    changes: dict[int, list[dict]] = {}
    for row in conn.execute(
        "SELECT store_id, latitude, longitude, accuracy_m AS accuracyM, source,"
        " previous_latitude AS previousLatitude, previous_longitude AS previousLongitude,"
        " created_at AS createdAt FROM store_location_changes ORDER BY created_at DESC, id DESC"
    ):
        change = dict(row)
        changes.setdefault(change.pop("store_id"), []).append(change)
    for store in stores:
        store["changes"] = changes.get(store.pop("id"), [])
    return stores


def restore_backup(conn: sqlite3.Connection, stores: list[dict]) -> tuple[int, int]:
    """Reemplaza TODOS los datos por los del respaldo, en una sola transacción."""
    total_changes = 0
    with conn:
        conn.execute("DELETE FROM store_location_changes")
        conn.execute("DELETE FROM stores")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('stores', 'store_location_changes')")
        for store in stores:
            store_id = conn.execute(
                "INSERT INTO stores (code, name, address, latitude, longitude, location_updated_at,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))",
                (
                    store["code"], store["name"], store["address"], store["latitude"],
                    store["longitude"], store["locationUpdatedAt"], store["createdAt"],
                ),
            ).lastrowid
            # Se insertan del más antiguo al más nuevo para que los id sigan el orden cronológico.
            for change in reversed(store["changes"]):
                conn.execute(
                    "INSERT INTO store_location_changes (store_id, latitude, longitude, accuracy_m,"
                    " source, previous_latitude, previous_longitude, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        store_id, change["latitude"], change["longitude"], change["accuracyM"],
                        change["source"], change["previousLatitude"], change["previousLongitude"],
                        change["createdAt"],
                    ),
                )
                total_changes += 1
    return len(stores), total_changes


def get_location_change(conn: sqlite3.Connection, store_id: int, change_id: int) -> dict | None:
    row = conn.execute(
        f"SELECT {_CHANGE_COLUMNS} FROM store_location_changes WHERE id = ? AND store_id = ?",
        (change_id, store_id),
    ).fetchone()
    return dict(row) if row else None


def delete_location_change(conn: sqlite3.Connection, store_id: int, change: dict) -> None:
    """Borra un registro manteniendo coherente el historial y la coordenada de la tienda.

    - El registro siguiente (más nuevo) hereda la coordenada "anterior" del borrado, para que
      su "Antes" siga apuntando a una coordenada que existe en el historial (o a la inicial).
    - Si se borra el más reciente, la tienda vuelve a la coordenada anterior y su fecha de
      actualización pasa a ser la del registro que queda como último (o NULL si no queda ninguno).
    """
    order = "(created_at > :created OR (created_at = :created AND id > :id))"
    params = {"store": store_id, "id": change["id"], "created": change["createdAt"]}
    with conn:
        newer = conn.execute(
            f"SELECT id FROM store_location_changes WHERE store_id = :store AND {order}"
            " ORDER BY created_at, id LIMIT 1",
            params,
        ).fetchone()
        conn.execute("DELETE FROM store_location_changes WHERE id = ?", (change["id"],))
        if newer:
            conn.execute(
                "UPDATE store_location_changes SET previous_latitude = ?, previous_longitude = ?"
                " WHERE id = ?",
                (change["previousLatitude"], change["previousLongitude"], newer["id"]),
            )
            return
        latest = conn.execute(
            "SELECT created_at FROM store_location_changes WHERE store_id = ?"
            " ORDER BY created_at DESC, id DESC LIMIT 1",
            (store_id,),
        ).fetchone()
        conn.execute(
            "UPDATE stores SET latitude = ?, longitude = ?, location_updated_at = ? WHERE id = ?",
            (
                change["previousLatitude"],
                change["previousLongitude"],
                latest["created_at"] if latest else None,
                store_id,
            ),
        )


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
