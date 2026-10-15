-- Borrar un registro del historial de ubicación de una tienda (equivalente a
-- DELETE /api/v2/stores/{storeId}/location-changes/{changeId} del backend FastAPI).
--
--   delete_store_location_change(p_token, p_store_id, p_change_id) → { store }
--
-- - El registro siguiente (más nuevo) hereda la coordenada "anterior" del borrado.
-- - Si se borra el más reciente, la tienda vuelve a la coordenada anterior y su
--   location_updated_at pasa a ser la del registro que queda como último (o NULL).

create or replace function public.delete_store_location_change(
  p_token     text,
  p_store_id  bigint,
  p_change_id bigint
)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_change public.store_location_changes%rowtype;
  v_newer  bigint;
  v_latest timestamptz;
begin
  perform private.check_token(p_token);

  perform 1 from public.stores where id = p_store_id for update;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe una tienda con id %s.', p_store_id);
  end if;

  select * into v_change from public.store_location_changes
  where id = p_change_id and store_id = p_store_id;
  if not found then
    raise exception 'CHANGE_NOT_FOUND'
      using hint = format('La tienda %s no tiene un registro con id %s.', p_store_id, p_change_id);
  end if;

  select id into v_newer from public.store_location_changes
  where store_id = p_store_id
    and (created_at > v_change.created_at or (created_at = v_change.created_at and id > v_change.id))
  order by created_at, id
  limit 1;

  delete from public.store_location_changes where id = v_change.id;

  if v_newer is not null then
    update public.store_location_changes
    set previous_latitude = v_change.previous_latitude, previous_longitude = v_change.previous_longitude
    where id = v_newer;
  else
    select max(created_at) into v_latest from public.store_location_changes where store_id = p_store_id;
    update public.stores
    set latitude = v_change.previous_latitude,
        longitude = v_change.previous_longitude,
        location_updated_at = v_latest
    where id = p_store_id;
  end if;

  return json_build_object('store', private.store_json(p_store_id));
end;
$$;

revoke execute on function public.delete_store_location_change(text, bigint, bigint) from public;
grant execute on function public.delete_store_location_change(text, bigint, bigint) to anon, authenticated;
