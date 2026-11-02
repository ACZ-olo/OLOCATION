---
from: kiro
to: claude
subject: Campo "Ubicación - Observaciones" en el registro nuevo y análisis de facturas con IA (Supabase)
reply_to: -
status: info
---

Pedido del equipo, implementado en el módulo **Por factura** (solo Supabase). No toca `backend/`
ni `docs/API_CONTRACT.md`: el registro nuevo no existe en el backend FastAPI.

**Base de datos** (`supabase/migrations/20261102110000_invoice_notes_location.sql`):

- Columna nueva `invoice_stores.notes_location` (texto ≤ 500): la dirección que traen las
  observaciones, normalizada con el formato de la dirección de arriba de la factura, o
  `Sin dirección en observaciones`. Null = no se analizó.
- `register_invoice_store` tiene el parámetro nuevo `p_notes_location` (opcional). Se borró la
  versión de 5 parámetros para que PostgREST no tenga dos candidatas; las apps anteriores siguen
  funcionando porque el parámetro tiene `default null`.
- `private.invoice_store_json` devuelve `notes_location`; `export_backup` / `restore_backup`
  agregan `notesLocation` en `invoiceStores` (se recrearon con `check_admin`, como las dejó
  `20261027090000_roles.sql`; un respaldo anterior sin la clave restaura con null).
- RPC nueva `check_session(p_token)` → `'admin' | 'empleado'` (o `UNAUTHORIZED`).

**Edge Function** `supabase/functions/analyze-invoice`: recibe solo las observaciones y la
dirección de arriba, valida el token con `check_session` y llama a OpenAI (Responses API, JSON con
esquema estricto, `store: false`). Devuelve `{ notesIsAddress, notesLocation }`. La API key queda
solo como secreto de Supabase (`OPENAI_API_KEY`, `OPENAI_MODEL`), nunca en la app.

**App**: `mobile/src/lib/invoice-ai.js` usa la IA **solo** para la Ubicación - Observaciones. No
toca el código, el nombre ni la dirección del cliente: si no se leen, se pide otra foto como
antes y no se llama a la IA. Descarta la dirección si trae lugares que no están en la factura.
Sin IA el escaneo funciona igual que antes.

**Pendiente del equipo:** aplicar la migración, desplegar la función y cargar los secretos (ver
`docs/SUPABASE.md`, sección "Análisis de facturas con IA"). Si en algún momento el registro nuevo
pasa al backend FastAPI, habría que sumar el campo y un endpoint equivalente; avisame y lo vemos.
