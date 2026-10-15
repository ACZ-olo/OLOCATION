-- Clientes y sus ubicaciones (coordenadas) asociadas.

CREATE TABLE clients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,          -- código de negocio del cliente
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE client_locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    label       TEXT,
    latitude    REAL    NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
    longitude   REAL    NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_client_locations_client_id ON client_locations(client_id);
