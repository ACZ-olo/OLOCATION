-- OLOCATION v2: se quita el registro de facturas (fotos) por tienda (deshace 002_invoices.sql).
-- La app ya no guarda fotos de facturas: "Escanear factura" solo las lee con OCR en el teléfono.
-- Las imágenes que hubiera en data/invoices/ quedan en disco y se pueden borrar a mano.

DROP INDEX IF EXISTS idx_store_invoices_store;
DROP TABLE IF EXISTS store_invoices;
