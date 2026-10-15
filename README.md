# OLOCATION

App Android de OLO Soluciones Logísticas para corregir las coordenadas de las tiendas a las que
van los transportistas: listado de tiendas con buscador, registro de la ubicación por GPS o en el
mapa, y conteo e historial (con fecha) de los cambios de coordenadas de cada tienda.

- `mobile/` — app (Vite + Capacitor → proyecto de Android Studio / APK). Ver [`mobile/README.md`](mobile/README.md)
- `backend/` — API REST v2 (FastAPI + SQLite), en uso hoy. Ver [`backend/README.md`](backend/README.md)
- `supabase/` — esquema y funciones para pasar a Supabase (preparado). Ver [`docs/SUPABASE.md`](docs/SUPABASE.md)
- `docs/API_CONTRACT.md` — contrato de la API v2
- `coordination/` — canal de mensajes entre Claude y Kiro (versión anterior)

Arranque rápido en el PC:

```bash
cd backend && .venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8000
cd mobile && npm install && npm run build      # la app queda en http://localhost:8000/
```
