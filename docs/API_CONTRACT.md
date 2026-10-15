# OLOCATION — Contrato de API v1.3 (backend ↔ app Android)

> Estado: **v1.3 — implementada y aprobada por Kiro (2026‑10‑15,
> `coordination/messages/20261015-1905_kiro_aprobacion-v1.3.md`).** v1.3 solo **agrega**
> `GET /carriers/{carrierId}/locations` (pantalla "Registros", pedido D11 en
> `coordination/messages/20261015-1830_kiro_endpoint-registros-por-transportista.md`); no cambia nada de v1.2.
> Historial: v1, v1.1 y v1.2 aprobadas por Kiro el 2026‑10‑15. v1.2 agregó autenticación con
> **cédula + PIN** (decisión D3 del equipo, hilo `coordination/messages/20261015-1730_claude_contrato-v1.2-autenticacion.md`).
> Cualquier cambio se acuerda por `coordination/` antes de implementarlo.
> Especificación OpenAPI generada a partir del código: [`openapi.json`](openapi.json)
> (también en vivo en `GET /openapi.json` y la UI en `/docs`, con botón **Authorize** para el token).

## Flujo que cubre

1. El transportista ingresa **cédula + PIN** (y confirma nombre, placa y teléfono) → `POST /api/v1/auth/login`.
   La app guarda `token` y `carrier.id`.
2. La app muestra los clientes asignados → `GET /api/v1/carriers/{carrierId}/clients`
3. Al elegir un cliente, muestra sus ubicaciones → `GET /api/v1/clients/{clientId}/locations`
4. Marca un punto, escribe la etiqueta opcional y toca **Guardar** → `POST /api/v1/clients/{clientId}/locations`

Los pasos 2–4 envían siempre `Authorization: Bearer <token>`.

Pantalla **Registros**: historial de lo que guardó el transportista → `GET /api/v1/carriers/{carrierId}/locations`.

## Cambios v1.2 → v1.3

| Cambio | Tipo |
|---|---|
| Nuevo `GET /carriers/{carrierId}/locations` (historial del transportista, con `clientCode` y `clientName`) | nuevo, compatible |

## Cambios v1.1 → v1.2

| Cambio | Tipo |
|---|---|
| Nuevo `POST /auth/login` (cédula + PIN → token) | nuevo |
| `POST /carriers` (registro libre) **eliminado**: los transportistas los da de alta el supervisor en la carga de datos, con su PIN | **rompe compatibilidad** |
| Todas las demás rutas exigen `Authorization: Bearer <token>` | **rompe compatibilidad** |
| `POST /clients/{clientId}/locations` **ya no recibe `carrierId`**: se toma del token (enviarlo da `400`) | **rompe compatibilidad** |
| `GET /clients` (todos los clientes) **eliminado** | **rompe compatibilidad** |
| `GET /clients/{clientId}/locations` solo para clientes asignados (`403 CLIENT_NOT_ASSIGNED`) | restricción |
| Errores nuevos: `INVALID_CREDENTIALS`, `TOO_MANY_ATTEMPTS`, `UNAUTHORIZED`, `FORBIDDEN`. Se elimina `CARRIER_NOT_FOUND` | cambio |

## Convenciones generales

| Tema | Regla |
|---|---|
| Base URL | `http://<host>:8000/api/v1` (ver *Conexión desde Android* en `backend/README.md`) |
| Formato | JSON UTF‑8. Enviar `Content-Type: application/json` en los POST. |
| Autenticación | `Authorization: Bearer <token>` en todas las rutas salvo `POST /auth/login` |
| Nombres de campos | `camelCase` |
| IDs | Enteros positivos (`Long` en Kotlin) |
| Coordenadas | Grados decimales WGS84, como **números JSON**, no texto. |
| Fechas | ISO‑8601 en UTC con `Z`, p. ej. `2026-10-15T14:49:46Z` |
| Listas | Siempre envueltas en `{ "items": [...] }` (sin paginación) |

---

## 1. Iniciar sesión

`POST /api/v1/auth/login` — **no** requiere token.

```json
{ "idNumber": "1-1111-1111", "pin": "1234", "name": "Carlos Jiménez Rojas", "plate": "ABC-123", "phone": "8800-1111" }
```

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| `idNumber` | string | sí | Cédula. Máx. 30; letras, números, espacios o guiones. Se normaliza (sin espacios/guiones, mayúsculas) |
| `pin` | string | sí | **Texto** de 4 a 8 dígitos (`"0123"` es válido; no enviar como número) |
| `name` | string | no | 1–100. Si se envía, actualiza el nombre |
| `plate` | string | no | Máx. 15; se normaliza como la cédula. Si se envía, actualiza la placa (cambio de vehículo) |
| `phone` | string | no | 1–30. Si se envía, actualiza el teléfono |

Respuesta `200 OK`:

```json
{
  "token": "q3V9...43 caracteres...",
  "expiresAt": "2026-11-14T15:53:32Z",
  "carrier": {
    "id": 1,
    "name": "Carlos Jiménez Rojas",
    "idNumber": "111111111",
    "plate": "ABC123",
    "phone": "8800-1111",
    "createdAt": "2026-10-15T15:20:00Z"
  }
}
```

- El token dura **30 días**. Guardarlo de forma segura (p. ej. `EncryptedSharedPreferences` /
  DataStore cifrado) junto con `carrier.id`. **No guardar el PIN.**
- Cada login crea un token nuevo; los anteriores siguen válidos hasta vencer (se puede usar en
  varios teléfonos).
- Solo pueden entrar los transportistas cargados por el supervisor con PIN. No existe auto-registro.

Errores:

| HTTP | `error.code` | Cuándo / qué hacer |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Formato inválido (p. ej. PIN de 3 dígitos) |
| 401 | `INVALID_CREDENTIALS` | Cédula no registrada o PIN incorrecto (mismo mensaje en ambos casos, a propósito) |
| 429 | `TOO_MANY_ATTEMPTS` | 5 PIN incorrectos seguidos → cuenta bloqueada **15 minutos**. Mostrar `message` (incluye los minutos restantes). Durante el bloqueo, incluso el PIN correcto da `429` |

---

## 2. Clientes asignados al transportista

`GET /api/v1/carriers/{carrierId}/clients` — requiere token.

Respuesta `200 OK` — ordenada por nombre:

```json
{ "items": [ { "id": 1, "code": "CLI-001", "name": "Distribuidora La Sabana" } ] }
```

- `carrierId` debe ser el del token (`carrier.id` del login); otro → `403 FORBIDDEN`.
- Lista vacía → mostrar *"No tenés clientes asignados. Contactá a tu supervisor."*

Errores: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `400 VALIDATION_ERROR`.

---

## 3. Listar ubicaciones de un cliente

`GET /api/v1/clients/{clientId}/locations` — requiere token; solo clientes asignados.

```json
{
  "items": [
    {
      "id": 2,
      "clientId": 1,
      "carrierId": 1,
      "label": "Entrada",
      "latitude": 10.0163,
      "longitude": -84.2116,
      "createdAt": "2026-10-15T14:49:46Z"
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `carrierId` | integer \| null | Quién la guardó. `null` en ubicaciones de la carga inicial |
| `label` | string \| null | |
| `latitude` / `longitude` | number | |
| `createdAt` | string | ISO‑8601 UTC; orden de la más reciente a la más antigua |

Errores: `401 UNAUTHORIZED`, `403 CLIENT_NOT_ASSIGNED`, `404 CLIENT_NOT_FOUND`, `400 VALIDATION_ERROR`.

---

## 4. Guardar la ubicación seleccionada

`POST /api/v1/clients/{clientId}/locations` — requiere token; solo clientes asignados.

```json
{ "latitude": 10.0163, "longitude": -84.2116, "label": "Entrada" }
```

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| `latitude` | number | sí | −90 ≤ x ≤ 90, finito; no texto ni booleano |
| `longitude` | number | sí | −180 ≤ x ≤ 180, finito; no texto ni booleano |
| `label` | string | no | 1–100; se recortan espacios. Se ingresa **antes** de Guardar |

El transportista que guarda es el del token (no se envía `carrierId`).

Respuesta `201 Created` — la ubicación guardada (mismo formato que el listado).
No reintentar automáticamente un POST que haya llegado a responder; deshabilitar **Guardar**
durante el envío.

Errores: `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 CLIENT_NOT_ASSIGNED`, `404 CLIENT_NOT_FOUND`.

---

## 5. Registros del transportista (historial)

`GET /api/v1/carriers/{carrierId}/locations` — requiere token.

Todas las ubicaciones que guardó **ese transportista**, de la más reciente a la más antigua.
La app las agrupa por mes del lado del cliente (a partir de `createdAt`, convertida a hora local).

```json
{
  "items": [
    {
      "id": 10,
      "clientId": 1,
      "clientCode": "CLI-001",
      "clientName": "Distribuidora La Sabana",
      "carrierId": 1,
      "label": "Entrada",
      "latitude": 9.93,
      "longitude": -84.08,
      "createdAt": "2026-10-15T14:49:46Z"
    }
  ]
}
```

- Mismos campos que una ubicación (sección 3) **más `clientCode` y `clientName`**, para mostrar a
  qué cliente pertenece cada punto sin otra llamada. `carrierId` siempre es el del transportista.
- Incluye registros de clientes que **ya no** le están asignados (es su historial). Abrir esos
  clientes con `GET /clients/{id}/locations` dará `403 CLIENT_NOT_ASSIGNED`: la pantalla de
  Registros debe mostrar los datos que ya trae esta lista.
- Solo las que guardó él: no incluye las precargadas (`carrierId` `null`) ni las de otros
  transportistas en clientes compartidos.
- Sin paginación. Lista vacía → mostrar *"Todavía no guardaste ubicaciones."*
- `carrierId` debe ser el del token; otro → `403 FORBIDDEN`.

Errores: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `400 VALIDATION_ERROR`.

---

## Formato de error (todas las rutas)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos.",
    "details": [ { "field": "pin", "message": "Debe tener de 4 a 8 dígitos." } ]
  }
}
```

- Decidir siempre por `error.code`. `message` y `details[].message` están en español y se pueden
  mostrar. `details` siempre está presente.
- Las respuestas `401` incluyen el header `WWW-Authenticate: Bearer`.

| HTTP | `error.code` | Cuándo | Qué hace la app |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Datos inválidos | Mostrar `details` |
| 401 | `INVALID_CREDENTIALS` | Login con cédula/PIN incorrectos | Mostrar mensaje, permitir reintentar |
| 401 | `UNAUTHORIZED` | Falta el token, es inválido o venció | Borrar token y volver al login |
| 403 | `FORBIDDEN` | Consultar clientes o registros de otro transportista | Error de programación de la app |
| 403 | `CLIENT_NOT_ASSIGNED` | Cliente no asignado a este transportista | Mostrar mensaje y refrescar la lista de clientes |
| 404 | `CLIENT_NOT_FOUND` | El cliente no existe | Refrescar la lista de clientes |
| 404 | `NOT_FOUND` | Ruta inexistente | — |
| 405 | `METHOD_NOT_ALLOWED` | Método no soportado | — |
| 429 | `TOO_MANY_ATTEMPTS` | Login bloqueado 15 min | Mostrar `message` |
| 500 | `INTERNAL_ERROR` | Error inesperado | Mensaje genérico |

---

## Decisiones

**Cerradas**

- D1/D9 — Contratos v1 y v1.1 aprobados por Kiro (2026‑10‑15).
- D2 — "Seleccionar el punto" = marcar una coordenada nueva (mapa o GPS).
- D3 — **Autenticación: cédula + PIN** → token Bearer de 30 días; bloqueo de 15 min tras 5 fallos;
  sin auto-registro (2026‑10‑15).
- D5 — Transportista: nombre, cédula y placa; teléfono opcional; se identifica por cédula.
- D6 — Cada transportista ve solo sus clientes asignados.
- D7 — Cada ubicación registra qué transportista la guardó.
- D8 — La etiqueta se ingresa antes de guardar, en el mismo POST.
- D11 — Pantalla "Registros": `GET /carriers/{carrierId}/locations` con datos del cliente;
  incluye registros de clientes desasignados (aprobada por Kiro, 2026‑10‑15).

**Pendientes (equipo)**

- D4 — Datos reales de clientes, transportistas (con PIN) y asignaciones, y quién mantiene el
  archivo de carga. Mientras tanto se usan los datos de prueba de `backend/seed/demo.json`.
- Producción: HTTPS obligatorio (el token y el PIN viajan en cada petición); si se publica en AWS,
  migrar SQLite → PostgreSQL con este mismo contrato.
