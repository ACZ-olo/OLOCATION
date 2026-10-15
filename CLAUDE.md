# OLOCATION

App Android para transportistas: seleccionar un cliente y guardar la coordenada de una de sus ubicaciones.

- Claude es responsable del **backend** (`backend/`, FastAPI + SQLite). Kiro es responsable del
  **frontend Android** (`android/`) y de la web de prueba (`backend/app/web/`); no modificar su código.
- Comandos del backend (desde `backend/`): `python -m pytest`, `python -m scripts.migrate`,
  `python -m scripts.seed seed/clients.example.json`, `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

## Coordinación con Kiro

- Al empezar cada sesión: revisar `coordination/messages/` (mensajes con `to: claude` y
  `status: open`) y `coordination/BOARD.md`, y responder antes de seguir con otra tarea.
- Protocolo en `coordination/README.md`: un archivo nuevo por mensaje
  (`AAAAMMDD-HHMM_claude_<asunto>.md`, con `reply_to` al responder).
- El contrato `docs/API_CONTRACT.md` solo cambia tras acordarlo por mensaje; después del cambio,
  regenerar `docs/openapi.json`, actualizar tests y avisar a Kiro.
