-- Corrige restore_backup en Supabase: la API (PostgREST) tiene activado pg_safeupdate, que
-- rechaza DELETE sin WHERE ("DELETE requires a WHERE clause"). Se agrega "where true".
create or replace function public.restore_backup(p_token text, p_backup json)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store    json;
  v_change   json;
  v_store_id bigint;
  v_stores   int := 0;
  v_changes  int := 0;
begin
  perform private.check_token(p_token);

  if p_backup is null or json_typeof(p_backup) <> 'object'
     or p_backup ->> 'format' is distinct from 'olocation-backup' then
    raise exception 'VALIDATION_ERROR' using hint = 'format: el archivo no es un respaldo de OLOCATION.';
  end if;
  if p_backup ->> 'version' is distinct from '1' then
    raise exception 'VALIDATION_ERROR' using hint = 'version: versión de respaldo no soportada.';
  end if;
  if json_typeof(p_backup -> 'stores') is distinct from 'array' then
    raise exception 'VALIDATION_ERROR' using hint = 'stores: debe ser una lista.';
  end if;

  begin
    delete from public.store_location_changes where true;
    delete from public.stores where true;

    for v_store in select value from json_array_elements(p_backup -> 'stores') loop
      insert into public.stores (code, name, address, latitude, longitude, location_updated_at, created_at)
      values (
        trim(v_store ->> 'code'),
        trim(v_store ->> 'name'),
        nullif(trim(v_store ->> 'address'), ''),
        (v_store ->> 'latitude')::float8,
        (v_store ->> 'longitude')::float8,
        (v_store ->> 'locationUpdatedAt')::timestamptz,
        coalesce((v_store ->> 'createdAt')::timestamptz, now())
      )
      returning id into v_store_id;
      v_stores := v_stores + 1;

      -- del más antiguo al más nuevo, para que los id sigan el orden cronológico
      for v_change in
        select value from json_array_elements(coalesce(v_store -> 'changes', '[]'::json)) with ordinality
        order by ordinality desc
      loop
        insert into public.store_location_changes
          (store_id, latitude, longitude, accuracy_m, source, previous_latitude, previous_longitude, created_at)
        values (
          v_store_id,
          (v_change ->> 'latitude')::float8,
          (v_change ->> 'longitude')::float8,
          (v_change ->> 'accuracyM')::float8,
          v_change ->> 'source',
          (v_change ->> 'previousLatitude')::float8,
          (v_change ->> 'previousLongitude')::float8,
          (v_change ->> 'createdAt')::timestamptz
        );
        v_changes := v_changes + 1;
      end loop;
    end loop;
  exception
    -- cualquier dato inválido deshace el bloque completo: los datos anteriores quedan intactos
    when check_violation or not_null_violation or unique_violation
      or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_ERROR'
        using hint = format('El respaldo tiene datos inválidos (tienda %s): %s', v_stores + 1, sqlerrm);
  end;

  return json_build_object('stores', v_stores, 'changes', v_changes);
end;
$$;
