-- OLOCATION v2: tiendas con su coordenada actual e historial de cambios de coordenadas.
-- El esquema equivalente para Supabase (PostgreSQL) está en supabase/migrations/.

CREATE TABLE stores (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    code                 TEXT    NOT NULL UNIQUE,          -- código de negocio de la tienda
    name                 TEXT    NOT NULL,
    address              TEXT,                              -- dirección / zona, ayuda a buscar
    latitude             REAL    CHECK (latitude  BETWEEN -90  AND 90),
    longitude            REAL    CHECK (longitude BETWEEN -180 AND 180),
    location_updated_at  TEXT,                              -- último registro desde la app (UTC)
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

-- Cada vez que alguien registra la ubicación de una tienda desde la app queda una fila aquí.
-- La cantidad de filas de una tienda es su "conteo de cambios".
CREATE TABLE store_location_changes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id            INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    latitude            REAL    NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
    longitude           REAL    NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_m          REAL    CHECK (accuracy_m >= 0),    -- precisión del GPS en metros
    source              TEXT    NOT NULL CHECK (source IN ('gps', 'map')),
    previous_latitude   REAL,                               -- coordenada que tenía antes
    previous_longitude  REAL,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_store_location_changes_store ON store_location_changes(store_id, created_at);
