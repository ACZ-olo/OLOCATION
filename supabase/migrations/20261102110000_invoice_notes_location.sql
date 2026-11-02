-- OLOCATION v2 en Supabase: campo "Ubicación - Observaciones" en el registro nuevo.
-- Al escanear una factura, si las observaciones traen una dirección se guarda normalizada (mismo
-- formato que la dirección de arriba de la factura: "PROVINCIA, CANTON, DISTRITO SEÑAS"); si no
-- traen dirección, "Sin dirección en observaciones". Si no se pudo analizar (sin IA), queda null.
-- La detección y la normalización las hace la Edge Function "analyze-invoice" (OpenAI); la base
-- solo guarda el resultado.
--
-- Cambios:
--   invoice_stores.notes_location                 columna nueva (texto, hasta 500)
--   private.invoice_store_json                    incluye 'notes_location'
--   register_invoice_store(..., p_notes_location) parámetro nuevo (opcional: las apps anteriores
--                                                 siguen funcionando sin mandarlo)
--   export_backup / restore_backup                "notesLocation" en "invoiceStores"
--   check_session(p_token) → rol                  para que la Edge Function valide el token

alter table public.invoice_stores
  add column notes_location text check (length(notes_location) <= 500);
comment on column public.invoice_stores.notes_location is
  'Ubicación - Observaciones: dirección encontrada en las observaciones, normalizada, o "Sin dirección en observaciones". Null si no se analizó.';

-- ---------------------------------------------------------------------------
-- Funciones internas
-- ---------------------------------------------------------------------------

create or replace function private.invoice_store_json(p_store_id bigint)
returns json
language sql
stable
set search_path = ''
as $$
  select json_build_object(
    'id', s.id, 'code', s.code, 'name', s.name, 'address', s.address, 'notes', s.notes,
    'notes_location', s.notes_location,
    'latitude', s.latitude, 'longitude', s.longitude,
    'location_updated_at', s.location_updated_at,
    'created_at', s.created_at,
    'change_count', (select count(*) from public.invoice_store_location_changes c where c.invoice_store_id = s.id)
  )
  from public.invoice_stores s
  where s.id = p_store_id;
$$;

-- ---------------------------------------------------------------------------
-- register_invoice_store: con p_notes_location. Se borra la versión de 5 parámetros para que no
-- haya dos funciones con el mismo nombre (PostgREST no sabría cuál usar). Las apps anteriores
-- llaman sin p_notes_location y siguen funcionando porque es opcional.
-- ---------------------------------------------------------------------------

drop function if exists public.register_invoice_store(text, text, text, text, text);

create or replace function public.register_invoice_store(
  p_token          text,
  p_code           text,
  p_name           text,
  p_address        text default null,
  p_notes          text default null,
  p_notes_location text default null
)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := trim(coalesce(p_code, ''));
  v_name text := left(trim(coalesce(p_name, '')), 200);
  v_id   bigint;
begin
  perform private.check_token(p_token);

  if v_code = '' or length(v_code) > 50 then
    raise exception 'VALIDATION_ERROR' using hint = 'code: el código es obligatorio (hasta 50 caracteres).';
  end if;
  if v_name = '' then
    raise exception 'VALIDATION_ERROR' using hint = 'name: el nombre es obligatorio.';
  end if;

  insert into public.invoice_stores (code, name, address, notes, notes_location)
  values (
    v_code,
    v_name,
    nullif(left(trim(p_address), 500), ''),
    nullif(left(trim(p_notes), 2000), ''),
    nullif(left(trim(p_notes_location), 500), '')
  )
  on conflict (ltrim(code, '0')) do nothing
  returning id into v_id;

  if v_id is not null then
    return json_build_object('store', private.invoice_store_json(v_id), 'created', true);
  end if;
  -- El código ya estaba: el registro queda como está.
  select id into v_id from public.invoice_stores where ltrim(code, '0') = ltrim(v_code, '0');
  return json_build_object('store', private.invoice_store_json(v_id), 'created', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- check_session: rol del token ('admin' | 'empleado'), o UNAUTHORIZED. Lo usa la Edge Function
-- "analyze-invoice" para atender solo a la app (no expone ningún dato).
-- ---------------------------------------------------------------------------

create or replace function public.check_session(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.token_role(p_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Respaldo: "notesLocation" en "invoiceStores". Mismo código que 20261026090000_invoice_stores.sql
-- con la validación de admin que le puso 20261027090000_roles.sql (check_admin).
-- ---------------------------------------------------------------------------

create or replace function public.export_backup(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.check_admin(p_token);
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
    ), '[]'::json),
    'invoiceStores', coalesce((
      select json_agg(json_build_object(
        'code', s.code,
        'name', s.name,
        'address', s.address,
        'notes', s.notes,
        'notesLocation', s.notes_location,
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
          from public.invoice_store_location_changes c where c.invoice_store_id = s.id
        ), '[]'::json)
      ) order by lower(s.name), s.code)
      from public.invoice_stores s
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
  v_store            json;
  v_change           json;
  v_store_id         bigint;
  v_stores           int := 0;
  v_changes          int := 0;
  v_invoice_stores   int := 0;
  v_invoice_changes  int := 0;
  v_has_invoice      boolean;
  v_where            text := 'tienda';
begin
  perform private.check_admin(p_token);

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
  -- Respaldos anteriores al módulo "Por factura" no traen la clave: ese módulo no se toca.
  v_has_invoice := p_backup -> 'invoiceStores' is not null
                   and json_typeof(p_backup -> 'invoiceStores') <> 'null';
  if v_has_invoice and json_typeof(p_backup -> 'invoiceStores') <> 'array' then
    raise exception 'VALIDATION_ERROR' using hint = 'invoiceStores: debe ser una lista.';
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

    if v_has_invoice then
      v_where := 'registro por factura';
      delete from public.invoice_store_location_changes where true;
      delete from public.invoice_stores where true;

      for v_store in select value from json_array_elements(p_backup -> 'invoiceStores') loop
        insert into public.invoice_stores
          (code, name, address, notes, notes_location, latitude, longitude, location_updated_at, created_at)
        values (
          trim(v_store ->> 'code'),
          trim(v_store ->> 'name'),
          nullif(trim(v_store ->> 'address'), ''),
          nullif(trim(v_store ->> 'notes'), ''),
          nullif(trim(v_store ->> 'notesLocation'), ''),  -- respaldos anteriores no la traen: null
          (v_store ->> 'latitude')::float8,
          (v_store ->> 'longitude')::float8,
          (v_store ->> 'locationUpdatedAt')::timestamptz,
          coalesce((v_store ->> 'createdAt')::timestamptz, now())
        )
        returning id into v_store_id;
        v_invoice_stores := v_invoice_stores + 1;

        for v_change in
          select value from json_array_elements(coalesce(v_store -> 'changes', '[]'::json)) with ordinality
          order by ordinality desc
        loop
          insert into public.invoice_store_location_changes
            (invoice_store_id, latitude, longitude, accuracy_m, source, previous_latitude, previous_longitude, created_at)
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
          v_invoice_changes := v_invoice_changes + 1;
        end loop;
      end loop;
    end if;
  exception
    -- cualquier dato inválido deshace el bloque completo: los datos anteriores quedan intactos
    when check_violation or not_null_violation or unique_violation
      or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_ERROR'
        using hint = format('El respaldo tiene datos inválidos (%s %s): %s', v_where,
                            case when v_where = 'tienda' then v_stores else v_invoice_stores end + 1,
                            sqlerrm);
  end;

  return json_build_object(
    'stores', v_stores,
    'changes', v_changes,
    'invoiceStores', v_invoice_stores,
    'invoiceChanges', v_invoice_changes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

revoke execute on function public.register_invoice_store(text, text, text, text, text, text) from public;
revoke execute on function public.check_session(text) from public;
grant execute on function public.register_invoice_store(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.check_session(text) to anon, authenticated;
