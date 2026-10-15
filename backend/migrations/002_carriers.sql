-- Transportistas, clientes asignados a cada uno y autoría de las ubicaciones.

CREATE TABLE carriers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    id_number   TEXT    NOT NULL UNIQUE,          -- cédula normalizada (sin espacios ni guiones, mayúsculas)
    name        TEXT    NOT NULL,
    plate       TEXT    NOT NULL,                 -- placa del vehículo, mayúsculas
    phone       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE carrier_clients (
    carrier_id  INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    client_id   INTEGER NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
    PRIMARY KEY (carrier_id, client_id)
);

CREATE INDEX idx_carrier_clients_client_id ON carrier_clients(client_id);

-- NULL en ubicaciones cargadas por el seed o guardadas antes de v1.1.
ALTER TABLE client_locations ADD COLUMN carrier_id INTEGER REFERENCES carriers(id) ON DELETE SET NULL;
