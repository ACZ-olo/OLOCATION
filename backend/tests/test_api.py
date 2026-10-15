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
         "longitude": None, "locationUpdatedAt": None, "changeCount": 0},
        {"id": 1, "code": "T2", "name": "Beta", "address": "San José", "latitude": 9.9,
         "longitude": -84.1, "locationUpdatedAt": None, "changeCount": 0},
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

    second = register(client, auth, latitude=9.94, longitude=-84.07, source="map", accuracyM=None)
    assert second.json()["store"]["changeCount"] == 2
    assert second.json()["change"]["previousLatitude"] == 9.93
    assert second.json()["change"]["accuracyM"] is None


def test_store_without_location_has_null_previous(client, auth):
    change = register(client, auth, store_id=2, source="map").json()["change"]
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
