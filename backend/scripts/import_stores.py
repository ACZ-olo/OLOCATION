"""Carga o actualiza el listado de tiendas desde un CSV (por ejemplo, exportado de Excel).

Uso:  python -m scripts.import_stores seed/stores.demo.csv

Columnas (con encabezado; separador "," o ";"):
    code       obligatorio, identifica la tienda
    name       obligatorio
    address    opcional (dirección o zona; también se usa en el buscador)
    latitude   opcional  ┐ coordenada que se tiene hoy (aunque esté mal).
    longitude  opcional  ┘ Las dos o ninguna.

Es idempotente:
- una tienda con el mismo `code` se actualiza (nombre y dirección); si no existe, se crea;
- la coordenada del CSV solo se aplica a tiendas que todavía NO tienen ubicación registrada desde
  la app: así volver a importar el listado nunca pisa una ubicación corregida por un transportista;
- la carga no cuenta como "cambio de ubicación" (el conteo es solo de registros hechos en la app).
Si el archivo tiene algún error, no se carga nada.
"""
import csv
import math
import sys
from pathlib import Path

from app.db import connect, migrate

REQUIRED = ("code", "name")
KNOWN = ("code", "name", "address", "latitude", "longitude")


def _coordinate(raw: str, low: float, high: float, field: str, line: int) -> float | None:
    raw = (raw or "").strip().replace(",", ".")  # Excel en español usa coma decimal
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"línea {line}: {field} no es un número ({raw!r})") from None
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"línea {line}: {field} fuera de rango ({value})")
    return value


def read_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")  # utf-8-sig: tolera el BOM que agrega Excel
    try:
        dialect = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;")
    except (csv.Error, IndexError):
        dialect = csv.excel
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    headers = [h.strip().lower() for h in reader.fieldnames or []]
    if missing := [h for h in REQUIRED if h not in headers]:
        raise ValueError(f"faltan columnas obligatorias: {', '.join(missing)}")
    if unknown := [h for h in headers if h and h not in KNOWN]:
        raise ValueError(f"columnas desconocidas: {', '.join(unknown)} (válidas: {', '.join(KNOWN)})")

    rows, seen = [], set()
    for line, raw in enumerate(reader, start=2):
        row = {k.strip().lower(): (v or "").strip() for k, v in raw.items() if k}
        if not any(row.values()):
            continue
        code, name = row.get("code", ""), row.get("name", "")
        if not code or not name:
            raise ValueError(f"línea {line}: code y name son obligatorios")
        if code in seen:
            raise ValueError(f"línea {line}: código repetido {code!r}")
        seen.add(code)
        lat = _coordinate(row.get("latitude", ""), -90, 90, "latitude", line)
        lng = _coordinate(row.get("longitude", ""), -180, 180, "longitude", line)
        if (lat is None) != (lng is None):
            raise ValueError(f"línea {line}: latitude y longitude van juntas (las dos o ninguna)")
        rows.append({
            "code": code[:50], "name": name[:200], "address": row.get("address") or None,
            "latitude": lat, "longitude": lng,
        })
    return rows


def main(path: str) -> None:
    try:
        rows = read_rows(Path(path))
    except (OSError, ValueError) as exc:
        sys.exit(f"No se cargó nada ({path}): {exc}")

    counts = dict.fromkeys(["creadas", "actualizadas", "coordenadas aplicadas"], 0)
    conn = connect()
    try:
        migrate(conn)
        with conn:
            for row in rows:
                existing = conn.execute(
                    "SELECT s.id, (SELECT COUNT(*) FROM store_location_changes c"
                    " WHERE c.store_id = s.id) AS changes FROM stores s WHERE s.code = ?",
                    (row["code"],),
                ).fetchone()
                if existing is None:
                    conn.execute(
                        "INSERT INTO stores (code, name, address, latitude, longitude)"
                        " VALUES (:code, :name, :address, :latitude, :longitude)",
                        row,
                    )
                    counts["creadas"] += 1
                    counts["coordenadas aplicadas"] += row["latitude"] is not None
                    continue
                conn.execute(
                    "UPDATE stores SET name = ?, address = ? WHERE id = ?",
                    (row["name"], row["address"], existing["id"]),
                )
                counts["actualizadas"] += 1
                if row["latitude"] is not None and existing["changes"] == 0:
                    conn.execute(
                        "UPDATE stores SET latitude = ?, longitude = ? WHERE id = ?",
                        (row["latitude"], row["longitude"], existing["id"]),
                    )
                    counts["coordenadas aplicadas"] += 1
    finally:
        conn.close()
    print("Tiendas " + ", ".join(f"{k}: {v}" for k, v in counts.items()) + ".")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: python -m scripts.import_stores <archivo.csv>")
    main(sys.argv[1])
