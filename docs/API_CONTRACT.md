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
4. Registrar ubicación (GPS o punto en el mapa) → `POST /api/v2/stores/{storeId}/location-changes`.

Los pasos 2–4 envían `Authorization: Bearer <token>`.

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
      "changeCount": 2
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

- `source`: `gps` (ubicación actual del teléfono) o `map` (punto elegido/ajustado en el mapa).
- `accuracyM`: precisión del GPS en metros; `null` si se eligió en el mapa.
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
| `source` | string | sí | `gps` o `map` |
| `accuracyM` | number | no | 0…100000 |

`201 Created` — la tienda actualizada (con el nuevo `changeCount`) y el cambio registrado:

```json
{ "store": { "id": 1, "changeCount": 3, "...": "..." }, "change": { "id": 8, "...": "..." } }
```

Cada POST crea un cambio nuevo y suma uno al conteo: la app pide confirmación y deshabilita
**Guardar** mientras envía. No reintentar automáticamente.

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
| 404 / 405 | `NOT_FOUND` / `METHOD_NOT_ALLOWED` | — |
| 429 | `TOO_MANY_ATTEMPTS` | Mostrar `message` |
| 503 | `ACCESS_NOT_CONFIGURED` | Avisar al administrador |
| 500 | `INTERNAL_ERROR` | Mensaje genérico |

## Pendientes

- Producción: HTTPS obligatorio. Plan: migrar a Supabase con la misma interfaz (`docs/SUPABASE.md`).
- El sistema de acceso con contraseña general es provisional y puede cambiar.
