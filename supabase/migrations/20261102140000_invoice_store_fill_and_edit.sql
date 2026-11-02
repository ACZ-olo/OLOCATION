-- OLOCATION v2 en Supabase: registro nuevo.
--   1. Al volver a escanear una factura de un código ya registrado se COMPLETAN "Observaciones" y
--      "Ubicación - Observaciones" si estaban vacías. Nunca se pisa un dato que ya tenía:
--        vacío (null / "")  <  "Sin observaciones" / "Sin dirección en observaciones"  <  texto real
--      Un campo solo se reemplaza por uno de más arriba en esa escala. El resto del registro
--      (código, nombre, dirección, coordenada) queda como estaba.
--   2. El admin puede editar código, nombre, dirección, observaciones y Ubicación - Observaciones.
--      La coordenada no: sigue saliendo solo del GPS, con su historial.
--
--   register_invoice_store(...)  → { store, created, filled: ["notes" | "notes_location"] }
--   update_invoice_store(p_token, p_store_id, p_code, p_name, p_address, p_notes, p_notes_location)
--                                → { store }   (solo admin: FORBIDDEN para empleado)

-- 0 = vacío, 1 = marcador ("Sin …"), 2 = texto real.
create or replace function private.info_rank(p_value text, p_placeholder text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then 0
    when lower(trim(p_value)) = lower(p_placeholder) then 1
    else 2
  end;
$$;
revoke execute on function private.info_rank(text, text) from public;

-- ---------------------------------------------------------------------------
-- register_invoice_store: completa los campos vacíos si el código ya estaba
-- ---------------------------------------------------------------------------

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
  v_code     text := trim(coalesce(p_code, ''));
  v_name     text := left(trim(coalesce(p_name, '')), 200);
  v_notes    text := nullif(left(trim(p_notes), 2000), '');
  v_location text := nullif(left(trim(p_notes_location), 500), '');
  v_id       bigint;
  v_store    public.invoice_stores%rowtype;
  v_filled   text[] := '{}';
begin
  perform private.check_token(p_token);

  if v_code = '' or length(v_code) > 50 then
    raise exception 'VALIDATION_ERROR' using hint = 'code: el código es obligatorio (hasta 50 caracteres).';
  end if;
  if v_name = '' then
    raise exception 'VALIDATION_ERROR' using hint = 'name: el nombre es obligatorio.';
  end if;

  insert into public.invoice_stores (code, name, address, notes, notes_location)
  values (v_code, v_name, nullif(left(trim(p_address), 500), ''), v_notes, v_location)
  on conflict (ltrim(code, '0')) do nothing
  returning id into v_id;

  if v_id is not null then
    return json_build_object('store', private.invoice_store_json(v_id), 'created', true, 'filled', '[]'::json);
  end if;

  -- El código ya estaba: se bloquea el registro para que dos escaneos a la vez no se pisen.
  select * into v_store from public.invoice_stores
  where ltrim(code, '0') = ltrim(v_code, '0')
  for update;

  if private.info_rank(v_notes, 'Sin observaciones')
     > private.info_rank(v_store.notes, 'Sin observaciones') then
    v_store.notes := v_notes;
    v_filled := v_filled || 'notes'::text;
  end if;
  if private.info_rank(v_location, 'Sin dirección en observaciones')
     > private.info_rank(v_store.notes_location, 'Sin dirección en observaciones') then
    v_store.notes_location := v_location;
    v_filled := v_filled || 'notes_location'::text;
  end if;

  if cardinality(v_filled) > 0 then
    update public.invoice_stores
    set notes = v_store.notes, notes_location = v_store.notes_location
    where id = v_store.id;
  end if;

  return json_build_object(
    'store', private.invoice_store_json(v_store.id),
    'created', false,
    'filled', to_json(v_filled)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- update_invoice_store: edición del admin (todos los datos menos la coordenada)
-- ---------------------------------------------------------------------------

create or replace function public.update_invoice_store(
  p_token          text,
  p_store_id       bigint,
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
  v_name text := trim(coalesce(p_name, ''));
begin
  perform private.check_admin(p_token);

  if v_code = '' or length(v_code) > 50 then
    raise exception 'VALIDATION_ERROR' using hint = 'Código: es obligatorio (hasta 50 caracteres).';
  end if;
  if v_name = '' or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR' using hint = 'Nombre: es obligatorio (hasta 200 caracteres).';
  end if;
  if length(trim(coalesce(p_address, ''))) > 500 then
    raise exception 'VALIDATION_ERROR' using hint = 'Dirección: hasta 500 caracteres.';
  end if;
  if length(trim(coalesce(p_notes, ''))) > 2000 then
    raise exception 'VALIDATION_ERROR' using hint = 'Observaciones: hasta 2000 caracteres.';
  end if;
  if length(trim(coalesce(p_notes_location, ''))) > 500 then
    raise exception 'VALIDATION_ERROR' using hint = 'Ubicación - Observaciones: hasta 500 caracteres.';
  end if;

  -- Primero que exista (y se bloquea mientras se edita).
  perform 1 from public.invoice_stores where id = p_store_id for update;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe un registro por factura con id %s.', p_store_id);
  end if;

  -- Un registro por código (sin contar los ceros a la izquierda): no puede repetir el de otro.
  if exists (
    select 1 from public.invoice_stores
    where ltrim(code, '0') = ltrim(v_code, '0') and id <> p_store_id
  ) then
    raise exception 'VALIDATION_ERROR' using hint = format('Código: ya hay otro registro con el código %s.', v_code);
  end if;

  begin
    update public.invoice_stores
    set code = v_code,
        name = v_name,
        address = nullif(trim(p_address), ''),
        notes = nullif(trim(p_notes), ''),
        notes_location = nullif(trim(p_notes_location), '')
    where id = p_store_id;
  exception when unique_violation then
    -- Otro registro tomó ese código entre la revisión de arriba y este cambio.
    raise exception 'VALIDATION_ERROR' using hint = format('Código: ya hay otro registro con el código %s.', v_code);
  end;
  if not found then
    raise exception 'STORE_NOT_FOUND' using hint = format('No existe un registro por factura con id %s.', p_store_id);
  end if;

  return json_build_object('store', private.invoice_store_json(p_store_id));
end;
$$;

revoke execute on function public.update_invoice_store(text, bigint, text, text, text, text, text) from public;
grant execute on function public.update_invoice_store(text, bigint, text, text, text, text, text) to anon, authenticated;
