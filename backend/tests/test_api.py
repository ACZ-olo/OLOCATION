import os
import subprocess
import sys
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import security
from app.config import BASE_DIR
from app.db import connect

PASSWORD = "clave-de-prueba"


@pytest.fixture()
def db_file(tmp_path, monkeypatch):
    path = tmp_path / "test.db"
    monkeypatch.setenv("OLOCATION_DB_PATH", str(path))
    monkeypatch.setenv("OLOCATION_INVOICES_DIR", str(tmp_path / "invoices"))
    monkeypatch.setenv("OLOCATION_ACCESS_PASSWORD", PASSWORD)
    monkeypatch.setenv("OLOCATION_TOKEN_SECRET", "secreto")
    return path


@pytest.fixture()
def client(db_file):
    """Tiendas 1 (T2 Beta, con coordenada) y 2 (T1 alfa, sin coordenada)."""
    from app.main import app, failed_attempts

    failed_attempts.reset()
    with TestClient(app) as test_client:
        conn = connect(db_file)
        with conn:
            conn.execute(
                "INSERT INTO stores (code, name, address, latitude, longitude) VALUES"
                " ('T2', 'Beta', 'San José', 9.9, -84.1), ('T1', 'alfa', NULL, NULL, NULL)"
            )
        conn.close()
        yield test_client


@pytest.fixture()
def auth(client):
    res = client.post("/api/v2/access", json={"password": PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


def register(client, auth, store_id=1, **body):
    payload = {"latitude": 9.93, "longitude": -84.08, "source": "gps", "accuracyM": 8.5, **body}
    return client.post(f"/api/v2/stores/{store_id}/location-changes", json=payload, headers=auth)


# --- Acceso con contraseña general -------------------------------------------


def test_access_returns_token(client):
    res = client.post("/api/v2/access", json={"password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["token"].startswith("v2.") and body["expiresAt"].endswith("Z")


def test_access_wrong_password(client):
    res = client.post("/api/v2/access", json={"password": "otra"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_PASSWORD"


def test_access_empty_password_is_validation_error(client):
    res = client.post("/api/v2/access", json={"password": ""})
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "password"


def test_access_locks_after_too_many_failures(client):
    for _ in range(security.MAX_FAILED_ATTEMPTS):
        assert client.post("/api/v2/access", json={"password": "mal"}).status_code == 401
    res = client.post("/api/v2/access", json={"password": PASSWORD})
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    assert int(res.headers["Retry-After"]) > 0


def test_access_not_configured(client, monkeypatch):
    monkeypatch.delenv("OLOCATION_ACCESS_PASSWORD")
    res = client.post("/api/v2/access", json={"password": PASSWORD})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ACCESS_NOT_CONFIGURED"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer inventado"}])
def test_routes_require_token(client, headers):
    res = client.get("/api/v2/stores", headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_changing_password_invalidates_tokens(client, auth, monkeypatch):
    monkeypatch.setenv("OLOCATION_ACCESS_PASSWORD", "nueva-clave")
    assert client.get("/api/v2/stores", headers=auth).status_code == 401


def test_expired_token_is_rejected():
    now = security.utcnow()
    token, _ = security.issue_token(PASSWORD, "s", now - security.TOKEN_TTL - timedelta(seconds=1))
    assert not security.verify_token(token, PASSWORD, "s", now)
    fresh, _ = security.issue_token(PASSWORD, "s", now)
    assert security.verify_token(fresh, PASSWORD, "s", now)
    assert not security.verify_token(fresh, PASSWORD, "otro-secreto", now)


def test_failed_attempts_window_expires():
    attempts = security.FailedAttempts(limit=2, window=timedelta(minutes=1))
    attempts.record_failure("ip", now=0)
    attempts.record_failure("ip", now=1)
    assert attempts.retry_after("ip", now=2) == 58
    assert attempts.retry_after("ip", now=61) == 0


# --- Tiendas -------------------------------------------------------------------


def test_list_stores_sorted_by_name(client, auth):
    res = client.get("/api/v2/stores", headers=auth)
    assert res.status_code == 200
    assert res.json()["items"] == [
        {"id": 2, "code": "T1", "name": "alfa", "address": None, "latitude": None,
         "longitude": None, "locationUpdatedAt": None, "changeCount": 0,
         "invoiceCount": 0, "latestInvoice": None},
        {"id": 1, "code": "T2", "name": "Beta", "address": "San José", "latitude": 9.9,
         "longitude": -84.1, "locationUpdatedAt": None, "changeCount": 0,
         "invoiceCount": 0, "latestInvoice": None},
    ]


def test_get_store(client, auth):
    res = client.get("/api/v2/stores/1", headers=auth)
    assert res.status_code == 200 and res.json()["code"] == "T2"


@pytest.mark.parametrize(
    "path",
    ["/api/v2/stores/99", "/api/v2/stores/99/location-changes"],
)
def test_unknown_store(client, auth, path):
    res = client.get(path, headers=auth)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "STORE_NOT_FOUND"


def test_invalid_store_id(client, auth):
    res = client.get("/api/v2/stores/0", headers=auth)
    assert res.status_code == 400
    assert res.json()["error"]["details"][0]["field"] == "storeId"


# --- Registro de ubicación y conteo de cambios ---------------------------------


def test_register_location_updates_store_and_counts(client, auth):
    res = register(client, auth)
    assert res.status_code == 201
    body = res.json()
    change = body["change"]
    assert change["storeId"] == 1 and change["source"] == "gps" and change["accuracyM"] == 8.5
    assert (change["previousLatitude"], change["previousLongitude"]) == (9.9, -84.1)
    assert change["createdAt"].endswith("Z")
    assert body["store"]["latitude"] == 9.93 and body["store"]["longitude"] == -84.08
    assert body["store"]["changeCount"] == 1
    assert body["store"]["locationUpdatedAt"] == change["createdAt"]

    second = register(client, auth, latitude=9.94, longitude=-84.07, accuracyM=None)
    assert second.json()["store"]["changeCount"] == 2
    assert second.json()["change"]["previousLatitude"] == 9.93
    assert second.json()["change"]["accuracyM"] is None


def test_store_without_location_has_null_previous(client, auth):
    change = register(client, auth, store_id=2).json()["change"]
    assert change["previousLatitude"] is None and change["previousLongitude"] is None


def test_history_most_recent_first(client, auth):
    first = register(client, auth).json()["change"]
    second = register(client, auth, latitude=10.0).json()["change"]
    res = client.get("/api/v2/stores/1/location-changes", headers=auth)
    assert [c["id"] for c in res.json()["items"]] == [second["id"], first["id"]]
    other = client.get("/api/v2/stores/2/location-changes", headers=auth)
    assert other.json()["items"] == []


@pytest.mark.parametrize(
    "body, field",
    [
        ({"latitude": 91}, "latitude"),
        ({"longitude": -181}, "longitude"),
        ({"latitude": "9.93"}, "latitude"),
        ({"source": "wifi"}, "source"),
        ({"source": "map"}, "source"),  # ya no se puede elegir el punto en el mapa
        ({"accuracyM": -1}, "accuracyM"),
        ({"extra": 1}, "extra"),
    ],
)
def test_register_validation(client, auth, body, field):
    res = register(client, auth, **body)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
    assert field in [d["field"] for d in res.json()["error"]["details"]]


def test_register_requires_source(client, auth):
    res = client.post(
        "/api/v2/stores/1/location-changes", json={"latitude": 9.9, "longitude": -84.1}, headers=auth
    )
    assert res.status_code == 400
    assert res.json()["error"]["details"][0] == {"field": "source", "message": "Campo obligatorio."}


def test_register_unknown_store(client, auth):
    res = register(client, auth, store_id=99)
    assert res.status_code == 404


# --- Borrado de registros -----------------------------------------------------


def delete_change(client, auth, change_id, store_id=1):
    return client.delete(f"/api/v2/stores/{store_id}/location-changes/{change_id}", headers=auth)


def history(client, auth, store_id=1):
    return client.get(f"/api/v2/stores/{store_id}/location-changes", headers=auth).json()["items"]


def test_delete_latest_reverts_to_previous_record(client, auth):
    first = register(client, auth, latitude=9.91).json()["change"]
    second = register(client, auth, latitude=9.92).json()["change"]
    res = delete_change(client, auth, second["id"])
    assert res.status_code == 200
    store = res.json()["store"]
    assert store["changeCount"] == 1
    assert store["latitude"] == 9.91 and store["locationUpdatedAt"] == first["createdAt"]
    assert [c["id"] for c in history(client, auth)] == [first["id"]]


def test_delete_only_record_restores_initial_coordinate(client, auth):
    change = register(client, auth).json()["change"]
    store = delete_change(client, auth, change["id"]).json()["store"]
    assert (store["latitude"], store["longitude"]) == (9.9, -84.1)
    assert store["changeCount"] == 0 and store["locationUpdatedAt"] is None


def test_delete_only_record_of_store_without_initial_coordinate(client, auth):
    change = register(client, auth, store_id=2).json()["change"]
    store = delete_change(client, auth, change["id"], store_id=2).json()["store"]
    assert store["latitude"] is None and store["longitude"] is None


def test_delete_middle_record_keeps_current_and_fixes_chain(client, auth):
    register(client, auth, latitude=9.91)
    middle = register(client, auth, latitude=9.92).json()["change"]
    last = register(client, auth, latitude=9.93).json()["change"]
    store = delete_change(client, auth, middle["id"]).json()["store"]
    assert store["latitude"] == 9.93 and store["changeCount"] == 2
    assert store["locationUpdatedAt"] == last["createdAt"]
    newest = history(client, auth)[0]
    assert newest["id"] == last["id"] and newest["previousLatitude"] == 9.91

    # borrar ahora el último vuelve a 9.91 (la coordenada que sigue existiendo)
    assert delete_change(client, auth, last["id"]).json()["store"]["latitude"] == 9.91


def test_delete_unknown_or_foreign_record(client, auth):
    change = register(client, auth).json()["change"]
    for store_id, change_id in [(1, 999), (2, change["id"])]:
        res = delete_change(client, auth, change_id, store_id=store_id)
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "CHANGE_NOT_FOUND"
    assert delete_change(client, auth, change["id"], store_id=99).json()["error"]["code"] == "STORE_NOT_FOUND"


def test_delete_requires_token(client, auth):
    change = register(client, auth).json()["change"]
    assert delete_change(client, {}, change["id"]).status_code == 401


# --- Respaldo (JSON) ------------------------------------------------------------


def test_backup_export_contains_stores_and_history(client, auth):
    first = register(client, auth, latitude=9.91).json()["change"]
    second = register(client, auth, latitude=9.92).json()["change"]
    res = client.get("/api/v2/backup", headers=auth)
    assert res.status_code == 200
    backup = res.json()
    assert backup["format"] == "olocation-backup" and backup["version"] == 1
    assert backup["exportedAt"].endswith("Z")
    assert [s["code"] for s in backup["stores"]] == ["T1", "T2"]
    beta = backup["stores"][1]
    assert beta["latitude"] == 9.92 and beta["locationUpdatedAt"] == second["createdAt"]
    assert [c["latitude"] for c in beta["changes"]] == [9.92, 9.91]
    assert beta["changes"][1]["createdAt"] == first["createdAt"]
    assert "id" not in beta and "storeId" not in beta["changes"][0]


def test_backup_roundtrip_replaces_all_data(client, auth):
    register(client, auth, latitude=9.91)
    register(client, auth, latitude=9.92)
    backup = client.get("/api/v2/backup", headers=auth).json()

    register(client, auth, store_id=2)  # cambios después del respaldo: se pierden al restaurar
    res = client.post("/api/v2/backup", json=backup, headers=auth)
    assert res.status_code == 200
    assert res.json() == {"stores": 2, "changes": 2}
    assert client.get("/api/v2/backup", headers=auth).json()["stores"] == backup["stores"]
    stores = {s["code"]: s for s in client.get("/api/v2/stores", headers=auth).json()["items"]}
    assert stores["T2"]["changeCount"] == 2 and stores["T1"]["changeCount"] == 0
    changes = history(client, auth, store_id=stores["T2"]["id"])
    assert [c["latitude"] for c in changes] == [9.92, 9.91]  # orden cronológico conservado


def test_backup_restore_minimal_file_and_dates_with_offset(client, auth):
    backup = {
        "format": "olocation-backup",
        "version": 1,
        "stores": [
            {"code": "N1", "name": "Nueva", "latitude": 10.0, "longitude": -84.0,
             "locationUpdatedAt": "2026-10-15T08:00:00-06:00",
             "changes": [{"latitude": 10.0, "longitude": -84.0, "source": "map",
                          "createdAt": "2026-10-15T08:00:00-06:00"}]},
            {"code": "N2", "name": "Sin coordenada"},
        ],
    }
    assert client.post("/api/v2/backup", json=backup, headers=auth).json() == {"stores": 2, "changes": 1}
    items = client.get("/api/v2/stores", headers=auth).json()["items"]
    assert [s["code"] for s in items] == ["N1", "N2"]
    assert items[0]["locationUpdatedAt"] == "2026-10-15T14:00:00Z"
    assert history(client, auth, store_id=items[0]["id"])[0]["source"] == "map"


@pytest.mark.parametrize(
    "mutate, field",
    [
        (lambda b: b.update(format="otro"), "format"),
        (lambda b: b.update(version=2), "version"),
        (lambda b: b["stores"].append(dict(b["stores"][0])), "body"),  # código repetido
        # stores[1] es "Beta" (T2), la que tiene coordenada e historial
        (lambda b: b["stores"][1].update(latitude=None), "stores.1"),  # coordenada a medias
        (lambda b: b["stores"][1]["changes"][0].update(createdAt="ayer"), "stores.1.changes.0.createdAt"),
        (lambda b: b["stores"][1]["changes"][0].update(createdAt="2026-10-15T08:00:00"), "stores.1.changes.0.createdAt"),
        (lambda b: b["stores"][1]["changes"][0].update(latitude=95), "stores.1.changes.0.latitude"),
        (lambda b: b["stores"][0].update(code=""), "stores.0.code"),
    ],
)
def test_backup_restore_rejects_invalid_file_without_touching_data(client, auth, mutate, field):
    register(client, auth)
    backup = client.get("/api/v2/backup", headers=auth).json()
    mutate(backup)
    res = client.post("/api/v2/backup", json=backup, headers=auth)
    assert res.status_code == 400
    assert any(d["field"].startswith(field) for d in res.json()["error"]["details"]), res.json()
    assert len(client.get("/api/v2/stores", headers=auth).json()["items"]) == 2
    assert len(history(client, auth)) == 1


def test_backup_requires_token(client):
    assert client.get("/api/v2/backup").status_code == 401
    assert client.post("/api/v2/backup", json={}).status_code == 401


def test_import_accepts_csv_downloaded_from_app(db_file, tmp_path):
    csv_file = tmp_path / "tiendas.csv"
    csv_file.write_text(
        "﻿code,name,address,latitude,longitude,change_count,location_updated_at\n"
        "A1,Tienda A,Centro,9.5,-84.5,3,2026-10-15T14:00:00Z\n",
        encoding="utf-8",
    )
    assert run_import(db_file, csv_file).returncode == 0


def test_unknown_route_and_method(client, auth):
    assert client.get("/api/v2/nada", headers=auth).json()["error"]["code"] == "NOT_FOUND"
    res = client.delete("/api/v2/stores", headers=auth)
    assert res.status_code == 405 and res.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_cors_allows_android_app(client):
    res = client.options(
        "/api/v2/stores",
        headers={"Origin": "https://localhost", "Access-Control-Request-Method": "GET"},
    )
    assert res.headers["access-control-allow-origin"] == "https://localhost"


# --- Importación de tiendas desde CSV -------------------------------------------


def run_import(db_file, csv_path):
    return subprocess.run(
        [sys.executable, "-m", "scripts.import_stores", str(csv_path)],
        cwd=BASE_DIR,
        env={**os.environ, "OLOCATION_DB_PATH": str(db_file), "PYTHONIOENCODING": "utf-8"},
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_import_demo_csv(db_file):
    res = run_import(db_file, BASE_DIR / "seed" / "stores.demo.csv")
    assert res.returncode == 0, res.stderr
    conn = connect(db_file)
    assert conn.execute("SELECT COUNT(*) FROM stores").fetchone()[0] == 15
    assert conn.execute("SELECT COUNT(*) FROM stores WHERE latitude IS NULL").fetchone()[0] == 2
    conn.close()


def test_import_semicolon_excel_csv_and_keeps_app_locations(db_file, tmp_path):
    csv_file = tmp_path / "tiendas.csv"
    csv_file.write_text(
        "﻿Code;Name;Address;Latitude;Longitude\nA1;Tienda A;Centro;9,5;-84,5\nB1;Tienda B;;;\n",
        encoding="utf-8",
    )
    assert run_import(db_file, csv_file).returncode == 0
    conn = connect(db_file)
    row = conn.execute("SELECT * FROM stores WHERE code = 'A1'").fetchone()
    assert (row["latitude"], row["longitude"], row["address"]) == (9.5, -84.5, "Centro")
    with conn:  # un transportista corrige la ubicación desde la app
        conn.execute(
            "INSERT INTO store_location_changes (store_id, latitude, longitude, source)"
            " VALUES (?, 9.6, -84.6, 'gps')",
            (row["id"],),
        )
        conn.execute("UPDATE stores SET latitude = 9.6, longitude = -84.6 WHERE id = ?", (row["id"],))
    conn.close()

    csv_file.write_text(
        "code;name;address;latitude;longitude\nA1;Tienda A2;Centro;9,5;-84,5\nB1;Tienda B;;9;-84\n",
        encoding="utf-8",
    )
    res = run_import(db_file, csv_file)
    assert res.returncode == 0, res.stderr
    conn = connect(db_file)
    a1 = conn.execute("SELECT * FROM stores WHERE code = 'A1'").fetchone()
    b1 = conn.execute("SELECT * FROM stores WHERE code = 'B1'").fetchone()
    assert a1["name"] == "Tienda A2" and (a1["latitude"], a1["longitude"]) == (9.6, -84.6)
    assert (b1["latitude"], b1["longitude"]) == (9.0, -84.0)
    conn.close()


@pytest.mark.parametrize(
    "content, message",
    [
        ("code,address\nA,x\n", "faltan columnas obligatorias: name"),
        ("code,name,color\nA,B,rojo\n", "columnas desconocidas: color"),
        ("code,name\nA,B\nA,C\n", "código repetido"),
        ("code,name,latitude,longitude\nA,B,99,1\n", "latitude fuera de rango"),
        ("code,name,latitude,longitude\nA,B,9,\n", "las dos o ninguna"),
        ("code,name,latitude,longitude\nA,B,abc,1\n", "no es un número"),
    ],
)
def test_import_rejects_invalid_files(db_file, tmp_path, content, message):
    csv_file = tmp_path / "malo.csv"
    csv_file.write_text(content, encoding="utf-8")
    res = run_import(db_file, csv_file)
    assert res.returncode != 0
    assert message in res.stderr


# --- Facturas (fotos) por tienda -----------------------------------------------

# Imagen PNG mínima válida (firma + relleno); invoices.validate solo mira la firma y el tamaño.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff" + b"\x00" * 32
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 16


def upload_invoice(client, auth, store_id=1, content=PNG, mime="image/png", filename="factura.png"):
    return client.post(
        f"/api/v2/stores/{store_id}/invoices",
        files={"image": (filename, content, mime)},
        headers=auth,
    )


def test_register_invoice_updates_store_and_count(client, auth):
    res = upload_invoice(client, auth)
    assert res.status_code == 201
    body = res.json()
    invoice = body["invoice"]
    assert invoice["storeId"] == 1 and invoice["mimeType"] == "image/png"
    assert invoice["byteSize"] == len(PNG) and invoice["createdAt"].endswith("Z")
    assert invoice["imageUrl"] == f"/api/v2/stores/1/invoices/{invoice['id']}/image"
    store = body["store"]
    assert store["invoiceCount"] == 1
    assert store["latestInvoice"]["id"] == invoice["id"]

    second = upload_invoice(client, auth, content=JPEG, mime="image/jpeg", filename="f2.jpg")
    assert second.json()["store"]["invoiceCount"] == 2
    assert second.json()["store"]["latestInvoice"]["id"] == second.json()["invoice"]["id"]


def test_register_invoice_accepts_webp(client, auth):
    res = upload_invoice(client, auth, content=WEBP, mime="image/webp", filename="f.webp")
    assert res.status_code == 201 and res.json()["invoice"]["mimeType"] == "image/webp"


def test_latest_invoice_shown_on_store_list_and_detail(client, auth):
    invoice = upload_invoice(client, auth).json()["invoice"]
    detail = client.get("/api/v2/stores/1", headers=auth).json()
    assert detail["latestInvoice"]["id"] == invoice["id"] and detail["invoiceCount"] == 1
    listed = {s["id"]: s for s in client.get("/api/v2/stores", headers=auth).json()["items"]}
    assert listed[1]["latestInvoice"]["id"] == invoice["id"]
    assert listed[2]["latestInvoice"] is None and listed[2]["invoiceCount"] == 0


def test_list_invoices_most_recent_first(client, auth):
    first = upload_invoice(client, auth).json()["invoice"]
    second = upload_invoice(client, auth).json()["invoice"]
    items = client.get("/api/v2/stores/1/invoices", headers=auth).json()["items"]
    assert [i["id"] for i in items] == [second["id"], first["id"]]
    assert client.get("/api/v2/stores/2/invoices", headers=auth).json()["items"] == []


def test_get_invoice_image_returns_bytes(client, auth):
    invoice = upload_invoice(client, auth).json()["invoice"]
    res = client.get(invoice["imageUrl"], headers=auth)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/png")
    assert res.content == PNG


def test_delete_invoice_lowers_count_and_updates_latest(client, auth):
    first = upload_invoice(client, auth).json()["invoice"]
    second = upload_invoice(client, auth).json()["invoice"]
    res = client.delete(f"/api/v2/stores/1/invoices/{second['id']}", headers=auth)
    assert res.status_code == 200
    store = res.json()["store"]
    assert store["invoiceCount"] == 1 and store["latestInvoice"]["id"] == first["id"]
    # la imagen borrada ya no se puede descargar
    assert client.get(second["imageUrl"], headers=auth).status_code == 404
    # borrar la última deja la tienda sin factura
    store = client.delete(f"/api/v2/stores/1/invoices/{first['id']}", headers=auth).json()["store"]
    assert store["invoiceCount"] == 0 and store["latestInvoice"] is None


@pytest.mark.parametrize(
    "content, mime",
    [
        (b"no soy imagen", "image/png"),  # contenido que no coincide con el tipo
        (PNG, "application/pdf"),           # tipo no permitido
        (b"", "image/png"),                  # vacío
    ],
)
def test_register_invoice_rejects_invalid_image(client, auth, content, mime):
    res = upload_invoice(client, auth, content=content, mime=mime)
    assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_register_invoice_requires_file(client, auth):
    res = client.post("/api/v2/stores/1/invoices", headers=auth)
    assert res.status_code == 400 and res.json()["error"]["code"] == "VALIDATION_ERROR"


def test_invoice_endpoints_unknown_store(client, auth):
    assert upload_invoice(client, auth, store_id=99).status_code == 404
    assert client.get("/api/v2/stores/99/invoices", headers=auth).status_code == 404


def test_delete_unknown_or_foreign_invoice(client, auth):
    invoice = upload_invoice(client, auth).json()["invoice"]
    for store_id, invoice_id in [(1, 999), (2, invoice["id"])]:
        res = client.delete(f"/api/v2/stores/{store_id}/invoices/{invoice_id}", headers=auth)
        assert res.status_code == 404 and res.json()["error"]["code"] == "INVOICE_NOT_FOUND"


def test_invoice_routes_require_token(client, auth):
    invoice = upload_invoice(client, auth).json()["invoice"]
    assert client.get("/api/v2/stores/1/invoices").status_code == 401
    assert upload_invoice(client, {}).status_code == 401
    assert client.get(invoice["imageUrl"]).status_code == 401
    assert client.delete(f"/api/v2/stores/1/invoices/{invoice['id']}").status_code == 401
