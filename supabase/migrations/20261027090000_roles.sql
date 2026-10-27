-- OLOCATION v2 en Supabase: dos contraseñas, dos roles.
--   admin     ve todo: "Registro viejo" (stores) y "Registro nuevo" (invoice_stores) y el respaldo.
--             En Registro viejo ya no se registran ubicaciones (sí se pueden borrar registros).
--   empleado  (transportista) solo usa Registro nuevo: listar, escanear/registrar clientes y
--             guardar ubicaciones. No borra registros del historial.
-- La contraseña de empleados sigue siendo la de 'access_password_hash'; la de admin es nueva
-- ('admin_password_hash'). Las sesiones abiertas antes de esta migración quedan como empleado.
-- verify_access ahora devuelve también "role". Error nuevo: FORBIDDEN (rol sin permiso).

alter table private.access_sessions
  add column role text not null default 'empleado' check (role in ('admin', 'empleado'));

-- Contraseña inicial de admin: cambiarla con
--   update private.app_settings set value = extensions.crypt('<nueva>', extensions.gen_salt('bf'))
--   where key = 'admin_password_hash';
insert into private.app_settings (key, value)
values ('admin_password_hash', extensions.crypt('admin123', extensions.gen_salt('bf')))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Funciones internas
-- ---------------------------------------------------------------------------

-- Rol del token vigente; UNAUTHORIZED si el token no sirve.
create or replace function private.token_role(p_token text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from private.access_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and expires_at > now();
  if v_role is null then
    raise exception 'UNAUTHORIZED'
      using hint = 'El acceso venció o la contraseña cambió. Ingresala de nuevo.';
  end if;
  return v_role;
end;
$$;

create or replace function private.check_admin(p_token text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.token_role(p_token) <> 'admin' then
    raise exception 'FORBIDDEN' using hint = 'Solo el administrador puede hacer esto.';
  end if;
end;
$$;

revoke execute on function private.token_role(text) from public;
revoke execute on function private.check_admin(text) from public;

-- ---------------------------------------------------------------------------
-- verify_access: admin o empleado según la contraseña
-- ---------------------------------------------------------------------------

create or replace function public.verify_access(p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ip      text := private.client_ip();
  v_admin   text;
  v_user    text;
  v_role    text;
  v_token   text;
  v_expires timestamptz := now() + interval '365 days';
begin
  if (select count(*) from private.failed_access
      where ip = v_ip and created_at > now() - interval '15 minutes') >= 10 then
    return json_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS',
      'message', 'Demasiados intentos fallidos. Intentá de nuevo en unos minutos.');
  end if;

  select value into v_admin from private.app_settings where key = 'admin_password_hash';
  select value into v_user  from private.app_settings where key = 'access_password_hash';
  if coalesce(p_password, '') <> '' then
    if v_admin is not null and extensions.crypt(p_password, v_admin) = v_admin then
      v_role := 'admin';
    elsif v_user is not null and extensions.crypt(p_password, v_user) = v_user then
      v_role := 'empleado';
    end if;
  end if;

  if v_role is null then
    insert into private.failed_access (ip) values (v_ip);
    delete from private.failed_access where created_at < now() - interval '1 day';
    return json_build_object('ok', false, 'error', 'INVALID_PASSWORD', 'message', 'Contraseña incorrecta.');
  end if;

  delete from private.failed_access where ip = v_ip;
  delete from private.access_sessions where expires_at <= now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.access_sessions (token_hash, expires_at, role)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, v_role);
  return json_build_object('ok', true, 'token', v_token, 'expires_at', v_expires, 'role', v_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Funciones solo para admin. Se recrean con su mismo código cambiando únicamente la validación
-- del token (check_token → check_admin), para no duplicar aquí cuerpos largos que no cambian.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  regprocedure;
  v_def text;
begin
  foreach v_fn in array array[
    'public.list_stores(text)',
    'public.list_store_location_changes(text, bigint)',
    'public.delete_store_location_change(text, bigint, bigint)',
    'public.export_backup(text)',
    'public.restore_backup(text, json)',
    'public.delete_invoice_store_location_change(text, bigint, bigint)'
  ]::regprocedure[] loop
    v_def := pg_get_functiondef(v_fn);
    if position('private.check_token(p_token)' in v_def) = 0 then
      raise exception 'La función % no valida el token como se esperaba', v_fn;
    end if;
    execute replace(v_def, 'private.check_token(p_token)', 'private.check_admin(p_token)');
  end loop;
end;
$$;

-- Registro viejo: ya no se registran ubicaciones (para nadie).
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
begin
  perform private.check_token(p_token);
  raise exception 'FORBIDDEN'
    using hint = 'En el registro viejo ya no se registran ubicaciones: usá el registro nuevo.';
end;
$$;
