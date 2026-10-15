# OLOCATION v2 sobre Supabase (preparado, todavía no en uso)

Hoy la app usa el backend FastAPI (`backend/`). Todo está listo para pasar a Supabase sin tocar
las pantallas: la app habla con una **capa de datos** (`mobile/src/data/`) que tiene dos
implementaciones con la misma interfaz:

| Proveedor | Archivo | Estado |
|---|---|---|
| `api` | `mobile/src/data/api.js` → FastAPI `/api/v2` | **En uso** |
| `supabase` | `mobile/src/data/supabase.js` → funciones RPC de Supabase | Preparado |

Se elige con `VITE_DATA_PROVIDER` en `mobile/.env`.

## Qué hay preparado

- `supabase/migrations/20261015120000_olocation_v2.sql`: tablas `stores` y
  `store_location_changes` (igual que SQLite), contraseña general, sesiones y 4 funciones RPC.
  Se probó en PostgreSQL 17 con los roles `anon`/`authenticated` simulados: acceso
  con contraseña correcta e incorrecta, token inválido, listado con conteo, registro GPS/mapa,
  validaciones, historial y que `anon` **no** puede leer las tablas ni las funciones privadas.
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
2. Aplicar la migración: **SQL Editor** → pegar el contenido de
   `supabase/migrations/20261015120000_olocation_v2.sql` → *Run*.
   (O con la CLI: `supabase link --project-ref <ref>` y `supabase db push`.)
3. **Cambiar la contraseña inicial** (`cambiar-esta-clave`) en el SQL Editor:

   ```sql
   update private.app_settings
      set value = extensions.crypt('NUEVA-CONTRASEÑA', extensions.gen_salt('bf')), updated_at = now()
    where key = 'access_password_hash';
   delete from private.access_sessions;   -- cierra el acceso en todos los dispositivos
   ```

   Repetir lo mismo cada vez que se quiera cambiar la contraseña.
4. Cargar las tiendas: **Table Editor** → `stores` → *Insert* → *Import data from CSV* con las
   columnas `code,name,address,latitude,longitude` (el mismo CSV de `backend/seed/`).
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
