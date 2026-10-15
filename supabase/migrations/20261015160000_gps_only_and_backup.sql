-- 1) Solo se registra la ubicación actual del teléfono (GPS). Los registros "map" anteriores se
--    conservan; el CHECK de la tabla sigue aceptando 'map' para ellos y para restaurar respaldos.
-- 2) Respaldo en JSON (mismo formato que GET/POST /api/v2/backup del backend FastAPI, así un
--    archivo sirve para los dos):
--      export_backup(p_token)            → { format, version, exportedAt, stores: [...] }
--      restore_backup(p_token, p_backup) → { stores, changes }   (REEMPLAZA todos los datos)

create or replace function public.register_store_location(
  p_token      text,
  p_store_id   bigint,
  p_latitude   double precision,
  p_longitude  double precision,
  p_source     text,
  p_accuracy_m double precision default null
)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store  public.stores%rowtype;
  v_change public.store_location_changes%rowtype;
begin
  perform private.check_token(p_token);

  if p_latitude is null or p_latitude not between -90 and 90 or p_latitude = 'NaN'::float8 then
    raise exception 'VALIDATION_ERROR' using hint = 'latitude: debe estar entre -90 y 90.';
  end if;
  if p_longitude is null or p_longitude not between -180 and 180 or p_longitude = 'NaN'::float8 then
    raise exception 'VALIDATION_ERROR' using hint = 'longitude: debe estar entre -180 y 180.';
  end if;
  if p_source is distinct from 'gps' then
    raise exception 'VALIDATION_ERROR' using hint = 'source: solo se puede registrar la ubicación actual (gps).';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m not between 0 and 100000 or p_accuracy_m = 'NaN'::float8) then
    raise exception 'VALIDATION_ERROR' using hint = 'accuracyM: debe estar entre 0 y 100000.';
  end if;

  select * into v_store from public.stores where id = p_store_id for update;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe una tienda con id %s.', p_store_id);
  end if;

  insert into public.store_location_changes
    (store_id, latitude, longitude, accuracy_m, source, previous_latitude, previous_longitude)
  values
    (p_store_id, p_latitude, p_longitude, p_accuracy_m, p_source, v_store.latitude, v_store.longitude)
  returning * into v_change;

  update public.stores
  set latitude = p_latitude, longitude = p_longitude, location_updated_at = v_change.created_at
  where id = p_store_id;

  return json_build_object('store', private.store_json(p_store_id), 'change', row_to_json(v_change));
end;
$$;

create or replace function private.iso_utc(p_value timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

create or replace function public.export_backup(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.check_token(p_token);
  return json_build_object(
    'format', 'olocation-backup',
    'version', 1,
    'exportedAt', private.iso_utc(now()),
    'stores', coalesce((
      select json_agg(json_build_object(
        'code', s.code,
        'name', s.name,
        'address', s.address,
        'latitude', s.latitude,
        'longitude', s.longitude,
        'locationUpdatedAt', private.iso_utc(s.location_updated_at),
        'createdAt', private.iso_utc(s.created_at),
        'changes', coalesce((
          select json_agg(json_build_object(
            'latitude', c.latitude,
            'longitude', c.longitude,
            'accuracyM', c.accuracy_m,
            'source', c.source,
            'previousLatitude', c.previous_latitude,
            'previousLongitude', c.previous_longitude,
            'createdAt', private.iso_utc(c.created_at)
          ) order by c.created_at desc, c.id desc)
          from public.store_location_changes c where c.store_id = s.id
        ), '[]'::json)
      ) order by lower(s.name), s.code)
      from public.stores s
    ), '[]'::json)
  );
end;
$$;

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
    delete from public.store_location_changes;
    delete from public.stores;

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

revoke execute on function private.iso_utc(timestamptz) from public;
revoke execute on function public.export_backup(text) from public;
revoke execute on function public.restore_backup(text, json) from public;
grant execute on function public.export_backup(text) to anon, authenticated;
grant execute on function public.restore_backup(text, json) to anon, authenticated;
