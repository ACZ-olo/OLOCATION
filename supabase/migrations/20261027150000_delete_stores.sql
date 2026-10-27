-- OLOCATION v2 en Supabase: el admin puede borrar tiendas.
--   delete_store(p_token, p_store_id)          → { id }   Registro viejo (stores)
--   delete_invoice_store(p_token, p_store_id)  → { id }   Registro nuevo (invoice_stores)
-- Solo admin (FORBIDDEN para empleado). Se borra también todo su historial de ubicaciones
-- (on delete cascade). STORE_NOT_FOUND si ya no existe. No se puede deshacer (salvo con un respaldo).

create or replace function public.delete_store(p_token text, p_store_id bigint)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.check_admin(p_token);
  delete from public.stores where id = p_store_id;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe una tienda con id %s.', p_store_id);
  end if;
  return json_build_object('id', p_store_id);
end;
$$;

create or replace function public.delete_invoice_store(p_token text, p_store_id bigint)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.check_admin(p_token);
  delete from public.invoice_stores where id = p_store_id;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe un registro por factura con id %s.', p_store_id);
  end if;
  return json_build_object('id', p_store_id);
end;
$$;

revoke execute on function public.delete_store(text, bigint) from public;
revoke execute on function public.delete_invoice_store(text, bigint) from public;
grant execute on function public.delete_store(text, bigint) to anon, authenticated;
grant execute on function public.delete_invoice_store(text, bigint) to anon, authenticated;
