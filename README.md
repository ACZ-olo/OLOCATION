# OLOCATION

App Android para transportistas: seleccionar un cliente y guardar la coordenada de una de sus ubicaciones.

- `backend/` — API REST (FastAPI + SQLite). Instalación, carga de datos y conexión desde Android: [`backend/README.md`](backend/README.md)
- `docs/API_CONTRACT.md` — contrato de API acordado entre backend y frontend Android
- Frontend Android — a cargo de Kiro
- `coordination/` — canal de mensajes entre Claude (backend) y Kiro (frontend); ver [`coordination/README.md`](coordination/README.md)
