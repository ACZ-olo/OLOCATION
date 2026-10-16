-- OLOCATION v2: facturas (fotos) por tienda.
-- Cada tienda puede acumular varias facturas; cada una es una imagen con su fecha de registro.
-- La imagen NO se guarda en la base: se guarda en disco (backend/data/invoices/) y aquí queda
-- solo la ruta relativa y el tipo MIME. El esquema equivalente para Supabase (PostgreSQL +
-- Storage) está en supabase/migrations/.

CREATE TABLE store_invoices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    image_path  TEXT    NOT NULL,                            -- ruta relativa a data/invoices/
    mime_type   TEXT    NOT NULL,                            -- image/jpeg, image/png, image/webp
    byte_size   INTEGER CHECK (byte_size >= 0),              -- tamaño del archivo en bytes
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_store_invoices_store ON store_invoices(store_id, created_at);
