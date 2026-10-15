"""Carga clientes, ubicaciones, transportistas y asignaciones desde un archivo JSON.

Uso:  python -m scripts.seed seed/clients.example.json

Es idempotente:
- los clientes se identifican por `code` (se crean o se actualiza su nombre);
- una ubicación no se vuelve a insertar si el cliente ya tiene una con la misma latitud y longitud;
- los transportistas se identifican por `idNumber` (cédula) y la lista `clients` de cada uno
  REEMPLAZA sus asignaciones (quitar un código del archivo desasigna ese cliente);
- `pin` es obligatorio para un transportista nuevo; en uno existente, si se envía, reemplaza su
  PIN y lo desbloquea. Se guarda solo el hash.
Si el archivo tiene algún error, no se carga nada.
"""
import json
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.db import connect, migrate
from app.schemas import IdNumber, Label, Phone, Pin, Plate, SeedLocation
from app.security import hash_pin


class SeedClient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Label
    name: Label
    locations: list[SeedLocation] = Field(default_factory=list)


class SeedCarrier(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idNumber: IdNumber
    name: Label
    plate: Plate
    pin: Pin | None = None  # obligatorio para transportistas nuevos; si se envía, reemplaza el PIN
    phone: Phone | None = None
    clients: list[Label] = Field(default_factory=list)  # códigos de cliente asignados


class SeedFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clients: list[SeedClient] = Field(default_factory=list)
    carriers: list[SeedCarrier] = Field(default_factory=list)


def _duplicates(values: list[str]) -> list[str]:
    return sorted({v for v in values if values.count(v) > 1})


def main(path: str) -> None:
    try:
        data = SeedFile.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        sys.exit(f"Archivo de carga inválido ({path}):\n{exc}")

    if dup := _duplicates([c.code for c in data.clients]):
        sys.exit(f"Códigos de cliente repetidos en el archivo: {', '.join(dup)}")
    if dup := _duplicates([c.idNumber for c in data.carriers]):
        sys.exit(f"Cédulas de transportista repetidas en el archivo: {', '.join(dup)}")

    conn = connect()
    counts = dict.fromkeys(
        ["clientes creados", "clientes actualizados", "ubicaciones creadas",
         "transportistas creados", "transportistas actualizados", "asignaciones"], 0
    )
    try:
        migrate(conn)
        with conn:
            for client in data.clients:
                row = conn.execute("SELECT id FROM clients WHERE code = ?", (client.code,)).fetchone()
                if row:
                    client_id = row["id"]
                    conn.execute("UPDATE clients SET name = ? WHERE id = ?", (client.name, client_id))
                    counts["clientes actualizados"] += 1
                else:
                    client_id = conn.execute(
                        "INSERT INTO clients (code, name) VALUES (?, ?)", (client.code, client.name)
                    ).lastrowid
                    counts["clientes creados"] += 1
                for loc in client.locations:
                    exists = conn.execute(
                        "SELECT 1 FROM client_locations"
                        " WHERE client_id = ? AND latitude = ? AND longitude = ?",
                        (client_id, loc.latitude, loc.longitude),
                    ).fetchone()
                    if not exists:
                        conn.execute(
                            "INSERT INTO client_locations (client_id, label, latitude, longitude)"
                            " VALUES (?, ?, ?, ?)",
                            (client_id, loc.label, loc.latitude, loc.longitude),
                        )
                        counts["ubicaciones creadas"] += 1

            client_ids = {row["code"]: row["id"] for row in conn.execute("SELECT id, code FROM clients")}
            for carrier in data.carriers:
                missing = [code for code in carrier.clients if code not in client_ids]
                if missing:
                    raise ValueError(
                        f"El transportista {carrier.idNumber} tiene clientes inexistentes: "
                        + ", ".join(missing)
                    )
                row, created = _upsert_in_tx(conn, carrier)
                counts["transportistas creados" if created else "transportistas actualizados"] += 1
                conn.execute("DELETE FROM carrier_clients WHERE carrier_id = ?", (row,))
                for code in dict.fromkeys(carrier.clients):
                    conn.execute(
                        "INSERT INTO carrier_clients (carrier_id, client_id) VALUES (?, ?)",
                        (row, client_ids[code]),
                    )
                    counts["asignaciones"] += 1
    except ValueError as exc:
        sys.exit(f"No se cargó nada: {exc}")
    finally:
        conn.close()
    print(". ".join(f"{k.capitalize()}: {v}" for k, v in counts.items()) + ".")


def _upsert_in_tx(conn, carrier: SeedCarrier) -> tuple[int, bool]:
    row = conn.execute(
        "SELECT id, pin_hash FROM carriers WHERE id_number = ?", (carrier.idNumber,)
    ).fetchone()
    if row is None and carrier.pin is None:
        raise ValueError(f"El transportista nuevo {carrier.idNumber} necesita un `pin`.")
    if row:
        conn.execute(
            "UPDATE carriers SET name = ?, plate = ?, phone = ? WHERE id = ?",
            (carrier.name, carrier.plate, carrier.phone, row["id"]),
        )
        if carrier.pin is not None:
            conn.execute(
                "UPDATE carriers SET pin_hash = ?, failed_attempts = 0, locked_until = NULL"
                " WHERE id = ?",
                (hash_pin(carrier.pin), row["id"]),
            )
        return row["id"], False
    return conn.execute(
        "INSERT INTO carriers (id_number, name, plate, phone, pin_hash) VALUES (?, ?, ?, ?, ?)",
        (carrier.idNumber, carrier.name, carrier.plate, carrier.phone, hash_pin(carrier.pin)),
    ).lastrowid, True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: python -m scripts.seed <archivo.json>")
    main(sys.argv[1])
