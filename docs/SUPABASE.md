# OLOCATION v2 sobre Supabase (EN USO desde 2026‑10‑16)

La app está conectada a Supabase (proyecto `defxbcwtwtokfwhggkcy`, región us-east-1). La app
habla con una **capa de datos** (`mobile/src/data/`) que tiene dos implementaciones con la misma
interfaz:

| Proveedor | Archivo | Estado |
|---|---|---|
| `supabase` | `mobile/src/data/supabase.js` → funciones RPC de Supabase | **En uso** |
| `api` | `mobile/src/data/api.js` → FastAPI `/api/v2` (`backend/`) | Alternativa local / pruebas |

Se elige con `VITE_DATA_PROVIDER` en `mobile/.env` (junto con `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY`). Después de cambiarlo hay que volver a compilar la app y el APK.

**Estado del proyecto:** migraciones aplicadas (las de `supabase/migrations/`), contraseñas de
admin y de empleados definidas en la base (**nunca escribirlas en este repositorio: es público**),
y los datos migrados desde el backend local con un respaldo (15 tiendas de
prueba y su historial). Probado de punta a punta desde el navegador y desde el APK.

## Qué hay preparado

- `supabase/migrations/20261015120000_olocation_v2.sql`: tablas `stores` y
  `store_location_changes` (igual que SQLite), contraseña general, sesiones y 4 funciones RPC.
- `supabase/migrations/20261015140000_delete_location_change.sql`: función
  `delete_store_location_change` para borrar registros del historial (misma lógica que el backend).
- `supabase/migrations/20261015160000_gps_only_and_backup.sql`: el registro solo acepta `gps`, y
  funciones `export_backup` / `restore_backup` con el **mismo formato JSON** que el backend
  (un respaldo descargado hoy se puede restaurar en Supabase para migrar los datos).
- `supabase/migrations/20261016090000_fix_restore_safeupdate.sql`: en Supabase la API rechaza
  `DELETE` sin `WHERE` (extensión *pg_safeupdate*); `restore_backup` usa `where true`.
- `supabase/migrations/20261016100000_invoices.sql` y `20261021100000_remove_invoices.sql`: el
  registro de fotos de facturas se agregó y después se quitó (la segunda borra la tabla
  `store_invoices` y sus funciones). Hoy la app solo escanea la factura con OCR y no la guarda.
- `supabase/migrations/20261026090000_invoice_stores.sql`: módulo **Por factura**. Tablas
  `invoice_stores` (código, nombre, dirección y observaciones tal cual la factura; un registro por
  código, sin importar ceros a la izquierda) e `invoice_store_location_changes` (coordenada e
  historial propios). RPC `list_invoice_stores`, `register_invoice_store` (si el código ya existe
  lo deja como está), `list_invoice_store_location_changes`, `register_invoice_store_location`,
  `delete_invoice_store_location_change`. El respaldo agrega `invoiceStores` (un respaldo sin esa
  clave no toca este módulo).
- `supabase/migrations/20261027090000_roles.sql`: dos contraseñas. **admin** (`admin_password_hash`)
  ve registro viejo, registro nuevo y respaldo; **empleado** (`access_password_hash`) solo usa el
  registro nuevo y no borra historial. `verify_access` devuelve `role`; las funciones de admin
  lanzan `FORBIDDEN` con un empleado. En el registro viejo ya no se registran ubicaciones.
- `supabase/migrations/20261027120000_security.sql`: auditoría de seguridad. El límite de intentos
  fallidos usa la IP que agrega Supabase (antes se podía falsificar con `X-Forwarded-For`) y tiene
  un tope global (50 en 15 min); `revoke_access` cierra la sesión en el servidor al tocar "Salir";
  cambiar una contraseña cierra todas las sesiones de ese rol.
- `supabase/migrations/20261027150000_delete_stores.sql`: `delete_store` y `delete_invoice_store`
  (solo admin) borran una tienda del registro viejo o nuevo junto con su historial.
  Aplicar las migraciones **en orden** (por nombre de archivo).
- **Cambiar una contraseña** (SQL Editor). Cierra todas las sesiones de ese rol:
  `update private.app_settings set value = extensions.crypt('<nueva>', extensions.gen_salt('bf')) where key = 'admin_password_hash';`
  (o `'access_password_hash'` para la de empleados). Usar contraseñas largas (12+ caracteres).
- Para aplicar una migración nueva desde el PC (psql): connection string del botón **Connect →
  Session pooler** del proyecto, `psql "<connection string>" -1 -v ON_ERROR_STOP=1 -f archivo.sql`.
  Se probó en PostgreSQL 17 con los roles `anon`/`authenticated` simulados: acceso
  con contraseña correcta e incorrecta, bloqueo tras 10 fallos, token inválido, listado con
  conteo, registro solo GPS, borrado de registros, respaldo (exportar, restaurar, rechazo de
  archivos inválidos sin tocar los datos, archivo exportado por el backend FastAPI), validaciones,
  historial y que `anon` **no** puede leer las tablas ni las funciones privadas.
- `mobile/src/data/supabase.js`: el adaptador (usa `@supabase/supabase-js`, ya instalado y que
  solo se descarga si se elige este proveedor). **No se probó contra un proyecto real.**

### Seguridad (sin Supabase Auth)

No hay usuarios, así que la app usa la *anon key* (pública). Para que la contraseña general
proteja de verdad los datos:

- Las tablas tienen **RLS activado sin políticas** → la anon key no puede leerlas ni escribirlas.
- Todo pasa por funciones `SECURITY DEFINER`: `verify_access(p_password)` compara la contraseña
  (guardada con bcrypt en `private.app_settings`) y entrega un token aleatorio de 365 días (solo
  se guarda su SHA‑256 en `private.access_sessions`); las demás funciones exigen ese token.
- 10 contraseñas incorrectas en 15 minutos desde la misma IP bloquean el acceso un rato.
- El esquema `private` no se expone en la API.

## Pasos para activarlo

1. Crear el proyecto en <https://supabase.com> (región cercana, p. ej. `us-east-1`).
2. Aplicar las migraciones: **SQL Editor** → pegar el contenido de cada archivo de
   `supabase/migrations/`, en orden → *Run*.
   (O con la CLI: `supabase link --project-ref <ref>` y `supabase db push`.)
3. **Cambiar la contraseña inicial** (`cambiar-esta-clave`) en el SQL Editor:

   ```sql
   update private.app_settings
      set value = extensions.crypt('NUEVA-CONTRASEÑA', extensions.gen_salt('bf')), updated_at = now()
    where key = 'access_password_hash';
   delete from private.access_sessions;   -- cierra el acceso en todos los dispositivos
   ```

   Repetir lo mismo cada vez que se quiera cambiar la contraseña.
4. Cargar los datos. Lo más simple: en la app actual (backend FastAPI) ir a **Respaldo →
   Descargar respaldo**; después de activar Supabase (paso 5–6), **Respaldo → Restaurar** con
   ese archivo: pasan las tiendas con todo su historial.
   Alternativa solo con tiendas: **Table Editor** → `stores` → *Import data from CSV* con las
   columnas `code,name,address,latitude,longitude`.
5. En `mobile/.env`:

   ```
   VITE_DATA_PROVIDER=supabase
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key de Project Settings → API>
   ```

6. Compilar la app de nuevo (`npm run android:sync`) y generar el APK.
7. Con Supabase (HTTPS) ya no hace falta permitir HTTP: en `mobile/capacitor.config.json` se
   pueden quitar `server.cleartext` y `android.allowMixedContent`.

## Consultas útiles (SQL Editor)

```sql
-- Tiendas con más cambios de ubicación
select s.code, s.name, count(c.id) as cambios, max(c.created_at) as ultimo
from stores s left join store_location_changes c on c.store_id = s.id
group by s.id order by cambios desc;

-- Historial de una tienda
select * from store_location_changes
where store_id = (select id from stores where code = 'T-001') order by created_at desc;
```
