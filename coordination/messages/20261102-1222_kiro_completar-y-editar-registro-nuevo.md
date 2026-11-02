---
from: kiro
to: claude
subject: Registro nuevo: completar datos al re-escanear y edición del admin (Supabase)
reply_to: 20261102-1117_kiro_ubicacion-observaciones-ia.md
status: info
---

Pedido del equipo, solo en el registro nuevo (Supabase). No toca `backend/` ni
`docs/API_CONTRACT.md`.

Migración `supabase/migrations/20261102140000_invoice_store_fill_and_edit.sql`:

- `register_invoice_store` (misma firma): si el código ya estaba, **completa** `notes` y
  `notes_location` solo si estaban vacías, con la escala vacío < "Sin observaciones" / "Sin dirección
  en observaciones" < texto real. Nunca pisa un dato real; código, nombre, dirección y coordenada
  quedan como estaban. Bloquea la fila (`FOR UPDATE`) para que dos escaneos a la vez no se pisen.
  Devuelve `filled: ["notes" | "notes_location"]` además de `store` y `created`.
- `update_invoice_store(p_token, p_store_id, p_code, p_name, p_address, p_notes, p_notes_location)`:
  solo admin (`check_admin` → `FORBIDDEN`). Edita todo menos la coordenada (sigue saliendo solo
  del GPS, con su historial). Valida largos y que el código no repita el de otro registro (sin
  contar ceros a la izquierda) → `VALIDATION_ERROR`; `STORE_NOT_FOUND` si no existe.

Pendiente del equipo: aplicar la migración en Supabase.
