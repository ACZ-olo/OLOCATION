-- OLOCATION v2 en Supabase: se quita el registro de facturas (fotos) por tienda.
-- Deshace 20261016100000_invoices.sql: la app ya no guarda fotos de facturas (el botón
-- "Escanear factura" solo las lee con OCR en el teléfono y no las sube).
-- ATENCIÓN: borra la tabla store_invoices con todas las fotos guardadas. No se puede deshacer.

drop function if exists public.list_store_invoices(text, bigint);
drop function if exists public.get_store_invoice_image(text, bigint, bigint);
drop function if exists public.register_store_invoice(text, bigint, text, text);
drop function if exists public.delete_store_invoice(text, bigint, bigint);

-- store_json vuelve a la versión de 20261015120000_olocation_v2.sql (sin invoice_count ni
-- latest_invoice). Se redefine antes de borrar la tabla porque la versión actual la usa.
create or replace function private.store_json(p_store_id bigint)
returns json
language sql
stable
set search_path = ''
as $$
  select json_build_object(
    'id', s.id, 'code', s.code, 'name', s.name, 'address', s.address,
    'latitude', s.latitude, 'longitude', s.longitude,
    'location_updated_at', s.location_updated_at,
    'change_count', (select count(*) from public.store_location_changes c where c.store_id = s.id)
  )
  from public.stores s
  where s.id = p_store_id;
$$;

drop function if exists private.invoice_json(public.store_invoices);
drop table if exists public.store_invoices;
