# OLOCATION — Contrato de API v2 (backend ↔ app móvil)

> Estado: **v2.0 — implementada en la rama `feature/nueva-version`** (2026‑10‑15).
> Reemplaza a v1.x: ya no hay transportistas, PIN ni clientes asignados. Ahora hay un **listado
> de tiendas**, una **contraseña general** para entrar y un **historial de cambios de coordenadas**
> por tienda (con su conteo y fecha).
> Especificación OpenAPI generada desde el código: [`openapi.json`](openapi.json) (también en vivo
> en `GET /openapi.json` y la UI en `/docs`, con botón **Authorize** para el token).
> La misma interfaz está preparada sobre Supabase: ver [`SUPABASE.md`](SUPABASE.md).

## Flujo

1. Pantalla de acceso: el transportista escribe la **contraseña general** → `POST /api/v2/access`.
   La app guarda el `token` (si marcó *Recordar este dispositivo*, de forma permanente).
2. Listado de tiendas con buscador → `GET /api/v2/stores` (todas; el filtrado es en la app).
3. Detalle de una tienda: coordenada actual, conteo e historial → `GET /api/v2/stores/{storeId}/location-changes`.
4. Registrar la ubicación **actual del teléfono (GPS)** → `POST /api/v2/stores/{storeId}/location-changes`.
   No se puede elegir un punto en el mapa: el mapa de la app es fijo y solo muestra la posición.
5. Borrar un registro del historial → `DELETE /api/v2/stores/{storeId}/location-changes/{changeId}`.
6. **Facturas** de la tienda: registrar una foto (cámara o galería) → `POST /api/v2/stores/{storeId}/invoices`;
   ver el historial → `GET /api/v2/stores/{storeId}/invoices`; ver la imagen →
   `GET /api/v2/stores/{storeId}/invoices/{invoiceId}/image`; borrar → `DELETE` de la misma ruta.
   La tienda muestra siempre la factura más reciente (`latestInvoice`).
7. Pestaña **Respaldo**: descargar/restaurar respaldo JSON → `GET`/`POST /api/v2/backup`; el CSV de
   tiendas lo arma la app con el listado del paso 2.

Los pasos 2–7 envían `Authorization: Bearer <token>`.

## Convenciones

| Tema | Regla |
|---|---|
| Base URL | `http://<host>:8000/api/v2` (ver `mobile/README.md`) |
| Formato | JSON UTF‑8. `Content-Type: application/json` en los POST. |
| Autenticación | `Authorization: Bearer <token>` en todo salvo `POST /access` |
| Campos | `camelCase` |
| IDs | Enteros positivos |
| Coordenadas | Grados decimales WGS84, **números JSON** (no texto) |
| Fechas | ISO‑8601 UTC con `Z`, p. ej. `2026-10-15T14:49:46Z` |
| Listas | `{ "items": [...] }`, sin paginación |

---

## 1. Acceso con contraseña general

`POST /api/v2/access` — no requiere token.

```json
{ "password": "la-contraseña" }
```

`200 OK`:

```json
{ "token": "v2.1792000000.9f2c…", "expiresAt": "2027-10-15T14:49:46Z" }
```

- El token dura **365 días**. Si la contraseña (o `OLOCATION_TOKEN_SECRET`) cambia en el servidor,
  **todos** los tokens dejan de valer y la app vuelve a pedir la contraseña.
- Nunca se guarda la contraseña en el teléfono, solo el token.

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Contraseña vacía |
| 401 | `INVALID_PASSWORD` | Contraseña incorrecta |
| 429 | `TOO_MANY_ATTEMPTS` | 10 fallos en 15 min desde la misma IP (header `Retry-After`) |
| 503 | `ACCESS_NOT_CONFIGURED` | El servidor no tiene `OLOCATION_ACCESS_PASSWORD` |

## 2. Listado de tiendas

`GET /api/v2/stores` — ordenado por nombre.

```json
{
  "items": [
    {
      "id": 1,
      "code": "T-001",
      "name": "Súper La Sabana",
      "address": "Mata Redonda, San José",
      "latitude": 9.9351,
      "longitude": -84.1012,
      "locationUpdatedAt": "2026-10-15T17:31:00Z",
      "changeCount": 2,
      "invoiceCount": 1,
      "latestInvoice": {
        "id": 4, "storeId": 1, "mimeType": "image/jpeg", "byteSize": 182734,
        "createdAt": "2026-10-15T18:02:00Z"
      }
    }
  ]
}
```

| Campo | Notas |
|---|---|
| `address` | `null` si no se cargó |
| `latitude` / `longitude` | Coordenada vigente; `null` si la tienda todavía no tiene |
| `locationUpdatedAt` | Último registro desde la app; `null` si nunca se registró (la coordenada vino de la carga inicial) |
| `changeCount` | Cantidad de veces que se registró la ubicación desde la app |
| `invoiceCount` | Cantidad de facturas registradas |
| `latestInvoice` | La factura más reciente (sin la imagen), o `null` si no tiene. Ver sección 7 |

`GET /api/v2/stores/{storeId}` devuelve una sola tienda con el mismo formato (`404 STORE_NOT_FOUND`).

## 3. Historial de cambios de una tienda

`GET /api/v2/stores/{storeId}/location-changes` — del más reciente al más antiguo.

```json
{
  "items": [
    {
      "id": 7,
      "storeId": 1,
      "latitude": 9.93525,
      "longitude": -84.10085,
      "accuracyM": 7.0,
      "source": "gps",
      "previousLatitude": 9.9351,
      "previousLongitude": -84.1012,
      "createdAt": "2026-10-15T17:31:00Z"
    }
  ]
}
```

- `source`: `gps` (ubicación actual del teléfono). `map` solo aparece en registros hechos antes de
  que se quitara la opción de elegir el punto en el mapa (o que vengan de un respaldo).
- `accuracyM`: precisión del GPS en metros; `null` en registros `map`.
- `previousLatitude/Longitude`: la coordenada que tenía la tienda antes (`null` si no tenía).

## 4. Registrar la ubicación de una tienda

`POST /api/v2/stores/{storeId}/location-changes`

```json
{ "latitude": 9.93525, "longitude": -84.10085, "source": "gps", "accuracyM": 7.0 }
```

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| `latitude` | number | sí | −90…90, finito |
| `longitude` | number | sí | −180…180, finito |
| `source` | string | sí | Solo `gps` (`map` → `400 VALIDATION_ERROR`) |
| `accuracyM` | number | no | 0…100000 |

`201 Created` — la tienda actualizada (con el nuevo `changeCount`) y el cambio registrado:

```json
{ "store": { "id": 1, "changeCount": 3, "...": "..." }, "change": { "id": 8, "...": "..." } }
```

Cada POST crea un cambio nuevo y suma uno al conteo: la app pide confirmación y deshabilita
**Guardar** mientras envía. No reintentar automáticamente.

## 5. Borrar un registro del historial

`DELETE /api/v2/stores/{storeId}/location-changes/{changeId}` — sin cuerpo.

`200 OK` — la tienda ya actualizada:

```json
{ "store": { "id": 1, "latitude": 9.9351, "longitude": -84.1012, "changeCount": 1, "...": "..." } }
```

- El conteo (`changeCount`) baja en uno. El borrado es definitivo.
- **Si se borra el registro más reciente**, la tienda vuelve a la coordenada anterior (la del
  registro previo, o la de la carga inicial si no queda ninguno, o `null` si no tenía) y
  `locationUpdatedAt` pasa a ser la fecha del registro que queda como último (o `null`).
- **Si se borra uno del medio**, la coordenada vigente no cambia; el registro siguiente hereda
  el `previousLatitude/Longitude` del borrado para que su "Antes" siga siendo correcto.

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 404 | `STORE_NOT_FOUND` | La tienda no existe |
| 404 | `CHANGE_NOT_FOUND` | El registro no existe o es de otra tienda (p. ej. ya lo borró otra persona) |

## 7. Facturas (fotos) de una tienda

Cada tienda puede tener varias facturas (una foto cada una, con su fecha de registro). El objeto
`Invoice` **no** trae la imagen, solo sus datos; la imagen se pide aparte:

```json
{ "id": 4, "storeId": 1, "mimeType": "image/jpeg", "byteSize": 182734, "createdAt": "2026-10-15T18:02:00Z" }
```

### 7.1 Listar las facturas

`GET /api/v2/stores/{storeId}/invoices` — del más reciente al más antiguo.

```json
{ "items": [ { "id": 4, "storeId": 1, "mimeType": "image/jpeg", "byteSize": 182734, "createdAt": "2026-10-15T18:02:00Z" } ] }
```

### 7.2 Registrar una factura (subir la foto)

`POST /api/v2/stores/{storeId}/invoices` — `multipart/form-data` con un campo `image` (el archivo).

| Regla | Valor |
|---|---|
| Tipos | `image/jpeg`, `image/png`, `image/webp` (se verifica el contenido, no solo el nombre) |
| Tamaño máximo | 12 MB (si se supera → `413` con `error.code` `VALIDATION_ERROR`) |

`201 Created` — la tienda actualizada (con el nuevo `invoiceCount` y `latestInvoice`) y la factura:

```json
{ "store": { "id": 1, "invoiceCount": 2, "latestInvoice": { "id": 5, "...": "..." }, "...": "..." },
  "invoice": { "id": 5, "storeId": 1, "mimeType": "image/jpeg", "byteSize": 201344, "createdAt": "2026-10-16T09:10:00Z" } }
```

### 7.3 Ver la imagen de una factura

`GET /api/v2/stores/{storeId}/invoices/{invoiceId}/image` — responde la imagen binaria con su
`Content-Type` (p. ej. `image/jpeg`). Requiere el token igual que el resto (la app la descarga con
el header `Authorization`, no es una URL pública).

### 7.4 Borrar una factura

`DELETE /api/v2/stores/{storeId}/invoices/{invoiceId}` — sin cuerpo. `200 OK` → `{ "store": { "...": "..." } }`
(la tienda ya con el `invoiceCount` y `latestInvoice` actualizados). El borrado es definitivo.

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Falta el archivo, tipo no permitido o imagen inválida |
| 404 | `STORE_NOT_FOUND` | La tienda no existe |
| 404 | `INVOICE_NOT_FOUND` | La factura no existe o es de otra tienda |

> **Las facturas no entran en el respaldo JSON** (sección 8): el respaldo es solo tiendas e
> historial de ubicaciones, para que siga siendo liviano y de texto. Las imágenes se conservan en
> su almacenamiento (disco en FastAPI, base de datos en Supabase; ver `SUPABASE.md`).

## 8. Respaldo de datos (JSON)

`GET /api/v2/backup` — todas las tiendas con su historial completo. Es el archivo que descarga la
pestaña **Respaldo** (`olocation-respaldo-AAAA-MM-DD-HHMM.json`):

```json
{
  "format": "olocation-backup",
  "version": 1,
  "exportedAt": "2026-10-15T20:35:00Z",
  "stores": [
    {
      "code": "T-001", "name": "Súper La Sabana", "address": "Mata Redonda, San José",
      "latitude": 9.93525, "longitude": -84.10085,
      "locationUpdatedAt": "2026-10-15T17:31:00Z", "createdAt": "2026-10-15T15:00:00Z",
      "changes": [
        { "latitude": 9.93525, "longitude": -84.10085, "accuracyM": 7.0, "source": "gps",
          "previousLatitude": 9.9351, "previousLongitude": -84.1012, "createdAt": "2026-10-15T17:31:00Z" }
      ]
    }
  ]
}
```

- Las tiendas se identifican por `code` (no lleva IDs internos), así el archivo sirve para pasar
  los datos a otro servidor, incluido Supabase (`docs/SUPABASE.md`), que usa el mismo formato.
- `changes` va del más reciente al más antiguo.

`POST /api/v2/backup` — cuerpo: un respaldo con ese formato. **Reemplaza todos los datos** (tiendas
e historial) en una sola operación. `200 OK`: `{ "stores": 15, "changes": 6 }`.

- Se valida todo antes de escribir; si algo está mal (`format`/`version` desconocidos, códigos
  repetidos, coordenadas fuera de rango o a medias, fechas sin zona horaria…) responde
  `400 VALIDATION_ERROR` con el detalle (p. ej. `stores.3.changes.0.createdAt`) y **no se toca nada**.
- Los campos opcionales pueden faltar: `address`, `latitude/longitude`, `locationUpdatedAt`,
  `createdAt` (de la tienda), `changes`, `accuracyM`, `previousLatitude/Longitude`.
- Las fechas aceptan `Z` u offset (`-06:00`) y se guardan en UTC.

### CSV de tiendas

Lo genera la app (no es un endpoint) con el listado de tiendas: UTF‑8 con BOM, separado por comas.

```csv
code,name,address,latitude,longitude,change_count,location_updated_at
T-015,Súper Grecia,"Grecia centro, Alajuela",10.0739,-84.3116,1,2026-10-15T20:35:31Z
```

Se puede volver a importar con `python -m scripts.import_stores` (ignora las dos últimas columnas).

## Formato de error

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Los datos enviados no son válidos.",
             "details": [ { "field": "latitude", "message": "Debe ser menor o igual que 90." } ] } }
```

| HTTP | `error.code` | Qué hace la app |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Mostrar `details` |
| 401 | `INVALID_PASSWORD` | Mostrar mensaje en la pantalla de acceso |
| 401 | `UNAUTHORIZED` | Borrar el token y volver a la pantalla de acceso |
| 404 | `STORE_NOT_FOUND` | Refrescar el listado |
| 404 | `CHANGE_NOT_FOUND` | Recargar el historial |
| 404 | `INVOICE_NOT_FOUND` | Recargar el historial de facturas |
| 404 / 405 | `NOT_FOUND` / `METHOD_NOT_ALLOWED` | — |
| 429 | `TOO_MANY_ATTEMPTS` | Mostrar `message` |
| 503 | `ACCESS_NOT_CONFIGURED` | Avisar al administrador |
| 500 | `INTERNAL_ERROR` | Mensaje genérico |

## Pendientes

- Producción: HTTPS obligatorio. Plan: migrar a Supabase con la misma interfaz (`docs/SUPABASE.md`).
- El sistema de acceso con contraseña general es provisional y puede cambiar.
