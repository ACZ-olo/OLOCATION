import json
import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app.config import BASE_DIR
from app.db import connect
from app.security import hash_pin

LOGIN = {"idNumber": "1-2345-6789", "pin": "1234"}


@pytest.fixture()
def db_file(tmp_path, monkeypatch):
    path = tmp_path / "test.db"
    monkeypatch.setenv("OLOCATION_DB_PATH", str(path))
    return path


@pytest.fixture()
def client(db_file):
    """Clientes 1 (C2 Beta) y 2 (C1 alfa).
    Transportista 1 (cédula 123456789, PIN 1234) asignado solo al cliente 1.
    Transportista 2 (cédula 999, PIN 9999) asignado al cliente 2."""
    from app.main import app

    with TestClient(app) as test_client:
        conn = connect(db_file)
        with conn:
            conn.execute("INSERT INTO clients (code, name) VALUES ('C2', 'Beta'), ('C1', 'alfa')")
            conn.execute(
                "INSERT INTO carriers (id_number, name, plate, pin_hash) VALUES"
                " ('123456789', 'Ana', 'ABC123', ?), ('999', 'Beto', 'XYZ1', ?)",
                (hash_pin("1234"), hash_pin("9999")),
            )
            conn.execute("INSERT INTO carrier_clients VALUES (1, 1), (2, 2)")
        conn.close()
        yield test_client


@pytest.fixture()
def auth(client):
    res = client.post("/api/v1/auth/login", json=LOGIN)
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


def run_seed(db_file, seed_path):
    return subprocess.run(
        [sys.executable, "-m", "scripts.seed", str(seed_path)],
        cwd=BASE_DIR,
        env={**os.environ, "OLOCATION_DB_PATH": str(db_file)},
        capture_output=True,
        text=True,
    )


# --- Login --------------------------------------------------------------------


def test_login_returns_token_and_updates_profile(client):
    res = client.post(
        "/api/v1/auth/login", json={**LOGIN, "name": "Ana Mora", "plate": "new-1", "phone": "8888"}
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["token"]) >= 32 and body["expiresAt"].endswith("Z")
    assert body["carrier"] == {
        "id": 1, "name": "Ana Mora", "idNumber": "123456789", "plate": "NEW1", "phone": "8888",
        "createdAt": body["carrier"]["createdAt"],
    }


def test_login_without_profile_keeps_data(client):
    res = client.post("/api/v1/auth/login", json=LOGIN)
    assert res.json()["carrier"]["name"] == "Ana" and res.json()["carrier"]["plate"] == "ABC123"


@pytest.mark.parametrize(
    "payload", [{**LOGIN, "pin": "0000"}, {**LOGIN, "idNumber": "555"}]
)
def test_login_wrong_credentials_same_error(client, payload):
    res = client.post("/api/v1/auth/login", json=payload)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_carrier_without_pin_cannot_login(client, db_file):
    conn = connect(db_file)
    with conn:
        conn.execute("UPDATE carriers SET pin_hash = NULL WHERE id = 1")
    conn.close()
    assert client.post("/api/v1/auth/login", json=LOGIN).status_code == 401


def test_lockout_after_five_failures(client):
    codes = [
        client.post("/api/v1/auth/login", json={**LOGIN, "pin": "0000"}).json()["error"]["code"]
        for _ in range(5)
    ]
    assert codes == ["INVALID_CREDENTIALS"] * 4 + ["TOO_MANY_ATTEMPTS"]
    res = client.post("/api/v1/auth/login", json=LOGIN)  # PIN correcto, pero bloqueado
    assert res.status_code == 429 and "minuto" in res.json()["error"]["message"]


def test_successful_login_resets_failures(client):
    for _ in range(4):
        client.post("/api/v1/auth/login", json={**LOGIN, "pin": "0000"})
    assert client.post("/api/v1/auth/login", json=LOGIN).status_code == 200
    for _ in range(4):
        client.post("/api/v1/auth/login", json={**LOGIN, "pin": "0000"})
    assert client.post("/api/v1/auth/login", json=LOGIN).status_code == 200


@pytest.mark.parametrize(
    "payload, field",
    [
        ({"idNumber": "1"}, "pin"),
        ({**LOGIN, "pin": "12"}, "pin"),
        ({**LOGIN, "pin": "12a4"}, "pin"),
        ({**LOGIN, "pin": 1234}, "pin"),
        ({**LOGIN, "idNumber": "12.34"}, "idNumber"),
        ({**LOGIN, "extra": 1}, "extra"),
    ],
)
def test_login_validation(client, payload, field):
    res = client.post("/api/v1/auth/login", json=payload)
    assert res.status_code == 400
    assert field in [d["field"] for d in res.json()["error"]["details"]]


# --- Token requerido ----------------------------------------------------------


@pytest.mark.parametrize(
    "method, path",
    [
        ("get", "/api/v1/carriers/1/clients"),
        ("get", "/api/v1/clients/1/locations"),
        ("post", "/api/v1/clients/1/locations"),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer inventado"}])
def test_protected_routes_require_valid_token(client, method, path, headers):
    res = getattr(client, method)(path, headers=headers)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    assert res.headers["WWW-Authenticate"] == "Bearer"


def test_expired_token_is_rejected(client, auth, db_file):
    conn = connect(db_file)
    with conn:
        conn.execute("UPDATE carrier_tokens SET expires_at = '2000-01-01T00:00:00Z'")
    conn.close()
    assert client.get("/api/v1/carriers/1/clients", headers=auth).status_code == 401


def test_token_is_stored_hashed(client, auth, db_file):
    conn = connect(db_file)
    stored = conn.execute("SELECT token_hash FROM carrier_tokens").fetchone()[0]
    pin = conn.execute("SELECT pin_hash FROM carriers WHERE id = 1").fetchone()[0]
    conn.close()
    assert stored not in auth["Authorization"] and "1234" not in pin


# --- Clientes -----------------------------------------------------------------


def test_list_own_clients_only_assigned(client, auth):
    res = client.get("/api/v1/carriers/1/clients", headers=auth)
    assert res.status_code == 200
    assert res.json() == {"items": [{"id": 1, "code": "C2", "name": "Beta"}]}


def test_cannot_list_other_carrier_clients(client, auth):
    res = client.get("/api/v1/carriers/2/clients", headers=auth)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_carrier_locations_history(client, auth, db_file):
    # Carlos (1) guarda en el cliente 1; Beto (2) guarda en el cliente 2; una sin autor (seed).
    for lat in (1, 2):
        client.post("/api/v1/clients/1/locations", json={"latitude": lat, "longitude": 0, "label": f"p{lat}"}, headers=auth)
    beto = client.post("/api/v1/auth/login", json={"idNumber": "999", "pin": "9999"}).json()["token"]
    client.post("/api/v1/clients/2/locations", json={"latitude": 5, "longitude": 5},
                headers={"Authorization": f"Bearer {beto}"})
    conn = connect(db_file)
    with conn:
        conn.execute("INSERT INTO client_locations (client_id, latitude, longitude) VALUES (1, 7, 7)")
        conn.execute("DELETE FROM carrier_clients WHERE carrier_id = 1")  # cliente desasignado
    conn.close()

    res = client.get("/api/v1/carriers/1/locations", headers=auth)
    assert res.status_code == 200
    items = res.json()["items"]
    assert [i["label"] for i in items] == ["p2", "p1"]  # solo las suyas, más reciente primero
    assert items[0] | {"id": 0, "createdAt": ""} == {
        "id": 0, "clientId": 1, "carrierId": 1, "label": "p2", "latitude": 2, "longitude": 0,
        "createdAt": "", "clientCode": "C2", "clientName": "Beta",
    }


def test_carrier_locations_empty_and_forbidden(client, auth):
    assert client.get("/api/v1/carriers/1/locations", headers=auth).json() == {"items": []}
    res = client.get("/api/v1/carriers/2/locations", headers=auth)
    assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"
    assert client.get("/api/v1/carriers/1/locations").status_code == 401
    assert client.get("/api/v1/carriers/abc/locations", headers=auth).status_code == 400


def test_global_clients_route_removed(client, auth):
    assert client.get("/api/v1/clients", headers=auth).status_code in (404, 405)


# --- Ubicaciones --------------------------------------------------------------


def test_save_location_uses_carrier_from_token(client, auth, db_file):
    res = client.post(
        "/api/v1/clients/1/locations",
        json={"latitude": 9.9325, "longitude": -84.0796, "label": "  Bodega  "},
        headers=auth,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["clientId"] == 1 and body["carrierId"] == 1 and body["label"] == "Bodega"
    assert body["latitude"] == 9.9325 and body["createdAt"].endswith("Z")

    listed = client.get("/api/v1/clients/1/locations", headers=auth).json()["items"]
    assert [loc["id"] for loc in listed] == [body["id"]]

    conn = connect(db_file)
    row = conn.execute("SELECT client_id, carrier_id, latitude FROM client_locations").fetchone()
    conn.close()
    assert tuple(row) == (1, 1, 9.9325)


def test_integer_coordinates_and_no_label_are_accepted(client, auth):
    res = client.post(
        "/api/v1/clients/1/locations", json={"latitude": 10, "longitude": -84}, headers=auth
    )
    assert res.status_code == 201
    assert res.json()["label"] is None


def test_unknown_client_returns_404(client, auth):
    for res in (
        client.get("/api/v1/clients/999/locations", headers=auth),
        client.post(
            "/api/v1/clients/999/locations", json={"latitude": 0, "longitude": 0}, headers=auth
        ),
    ):
        assert res.status_code == 404
        assert res.json()["error"]["code"] == "CLIENT_NOT_FOUND"


def test_client_not_assigned_returns_403(client, auth):
    for res in (
        client.get("/api/v1/clients/2/locations", headers=auth),
        client.post(
            "/api/v1/clients/2/locations", json={"latitude": 0, "longitude": 0}, headers=auth
        ),
    ):
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "CLIENT_NOT_ASSIGNED"


@pytest.mark.parametrize(
    "payload, field",
    [
        ({"latitude": 91, "longitude": 0}, "latitude"),
        ({"latitude": 0, "longitude": -180.5}, "longitude"),
        ({"latitude": "9.9", "longitude": 0}, "latitude"),
        ({"latitude": True, "longitude": 0}, "latitude"),
        ({"longitude": 0}, "latitude"),
        ({"latitude": 0, "longitude": 0, "label": ""}, "label"),
        ({"latitude": 0, "longitude": 0, "label": "x" * 101}, "label"),
        ({"latitude": 0, "longitude": 0, "carrierId": 2}, "carrierId"),
    ],
)
def test_invalid_location_returns_400(client, auth, payload, field):
    res = client.post("/api/v1/clients/1/locations", json=payload, headers=auth)
    assert res.status_code == 400
    error = res.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert field in [d["field"] for d in error["details"]]


def test_invalid_json_and_path_ids_return_400(client, auth):
    res = client.post(
        "/api/v1/clients/1/locations",
        content="{bad json",
        headers={**auth, "Content-Type": "application/json"},
    )
    assert res.status_code == 400
    assert client.get("/api/v1/clients/abc/locations", headers=auth).status_code == 400
    assert client.get("/api/v1/clients/0/locations", headers=auth).status_code == 400
    assert client.get("/api/v1/carriers/abc/clients", headers=auth).status_code == 400


def test_unknown_route_uses_error_format(client):
    res = client.get("/api/v1/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


# --- Seed ---------------------------------------------------------------------


def test_seed_is_idempotent_and_replaces_assignments(db_file, tmp_path):
    seed = tmp_path / "seed.json"
    data = {
        "clients": [
            {"code": "A", "name": "Uno", "locations": [{"latitude": 1, "longitude": 2}]},
            {"code": "B", "name": "Dos"},
        ],
        "carriers": [
            {"idNumber": "1-1", "name": "Ana", "plate": "p1", "pin": "1111", "clients": ["A", "B"]}
        ],
    }
    seed.write_text(json.dumps(data), encoding="utf-8")
    for _ in range(2):
        assert run_seed(db_file, seed).returncode == 0

    conn = connect(db_file)
    assert conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM client_locations").fetchone()[0] == 1
    assert tuple(conn.execute("SELECT id_number, plate FROM carriers").fetchone()) == ("11", "P1")
    assert conn.execute("SELECT COUNT(*) FROM carrier_clients").fetchone()[0] == 2

    pin_before = conn.execute("SELECT pin_hash FROM carriers").fetchone()[0]
    data["carriers"][0]["clients"] = ["B"]
    del data["carriers"][0]["pin"]  # existente sin pin → conserva el PIN anterior
    seed.write_text(json.dumps(data), encoding="utf-8")
    assert run_seed(db_file, seed).returncode == 0
    assert conn.execute("SELECT COUNT(*) FROM carrier_clients").fetchone()[0] == 1
    assert conn.execute("SELECT pin_hash FROM carriers").fetchone()[0] == pin_before
    conn.close()


def test_demo_seed_loads_and_login_works(db_file):
    assert run_seed(db_file, BASE_DIR / "seed" / "demo.json").returncode == 0
    from app.main import app

    with TestClient(app) as c:
        res = c.post("/api/v1/auth/login", json={"idNumber": "1-1111-1111", "pin": "1234"})
        assert res.status_code == 200
        headers = {"Authorization": f"Bearer {res.json()['token']}"}
        assert len(c.get("/api/v1/carriers/1/clients", headers=headers).json()["items"]) == 4


@pytest.mark.parametrize(
    "data",
    [
        {"clients": [{"code": "A", "name": "X", "locations": [{"latitude": 99, "longitude": 0}]}]},
        {"carriers": [{"idNumber": "1", "name": "Ana", "plate": "P", "pin": "1111", "clients": ["NOPE"]}]},
        {"carriers": [{"idNumber": "1", "name": "Ana", "plate": "P"}]},
        {"carriers": [{"idNumber": "1", "name": "Ana", "plate": "P", "pin": "12"}]},
    ],
)
def test_seed_rejects_invalid_file_and_loads_nothing(db_file, tmp_path, data):
    seed = tmp_path / "bad.json"
    seed.write_text(json.dumps({"clients": [{"code": "OK", "name": "Ok"}], **data}), encoding="utf-8")
    assert run_seed(db_file, seed).returncode != 0
    if db_file.exists():
        conn = connect(db_file)
        assert conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0] == 0
        conn.close()
