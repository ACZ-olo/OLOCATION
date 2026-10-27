-- OLOCATION v2 en Supabase: correcciones de la auditoría de seguridad (2026-10-27).
--
-- 1) El límite de intentos fallidos se podía saltar: private.client_ip() tomaba la PRIMERA IP de
--    X-Forwarded-For, que la elige el cliente (verificado: un intento con el encabezado
--    "203.0.113.77" quedó registrado con esa IP). Ahora se usa la ÚLTIMA, que agrega la
--    infraestructura de Supabase y el cliente no controla, y además hay un tope GLOBAL de intentos
--    fallidos (todas las IP) para frenar ataques distribuidos. Si se alcanza, nadie puede iniciar
--    sesión por unos minutos; las sesiones ya abiertas siguen funcionando.
-- 2) Cerrar sesión no invalidaba el token en el servidor: nueva RPC revoke_access(p_token), que la
--    app llama al tocar "Salir".
-- 3) Cambiar una contraseña no cerraba las sesiones abiertas (duran 365 días): un trigger borra las
--    sesiones del rol cuya contraseña cambió (admin o empleado).

-- ---------------------------------------------------------------------------
-- 1) IP del cliente y límite de intentos
-- ---------------------------------------------------------------------------

create or replace function private.client_ip()
returns text
language sql
stable
set search_path = ''
as $$
  -- Última entrada de X-Forwarded-For: la agrega el proxy de Supabase (no el cliente).
  select coalesce(
    nullif(trim(regexp_replace(
      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
      '^.*,', ''
    )), ''),
    'desconocida'
  );
$$;

create or replace function public.verify_access(p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ip         text := private.client_ip();
  v_admin      text;
  v_user       text;
  v_role       text;
  v_token      text;
  v_expires    timestamptz := now() + interval '365 days';
  c_per_ip     constant int := 10;   -- intentos fallidos por IP en 15 minutos
  c_global     constant int := 50;   -- intentos fallidos en total (todas las IP) en 15 minutos
begin
  if (select count(*) from private.failed_access
      where ip = v_ip and created_at > now() - interval '15 minutes') >= c_per_ip
     or (select count(*) from private.failed_access
         where created_at > now() - interval '15 minutes') >= c_global then
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
-- 2) Cerrar sesión en el servidor
-- ---------------------------------------------------------------------------

-- Borra la sesión del token (si existe). No lanza error con un token inválido o ya vencido:
-- salir siempre funciona.
create or replace function public.revoke_access(p_token text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.access_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

revoke execute on function public.revoke_access(text) from public;
grant execute on function public.revoke_access(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Cambiar una contraseña cierra las sesiones de ese rol
-- ---------------------------------------------------------------------------

create or replace function private.revoke_sessions_on_password_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.value is distinct from old.value then
    if new.key = 'admin_password_hash' then
      delete from private.access_sessions where role = 'admin';
    elsif new.key = 'access_password_hash' then
      delete from private.access_sessions where role = 'empleado';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.revoke_sessions_on_password_change() from public;

create trigger app_settings_revoke_sessions
  after update on private.app_settings
  for each row execute function private.revoke_sessions_on_password_change();
