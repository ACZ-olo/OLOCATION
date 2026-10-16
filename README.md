# OLOCATION

App Android de OLO Soluciones Logísticas para corregir las coordenadas de las tiendas a las que
van los transportistas: listado de tiendas con buscador, registro de la ubicación por GPS o en el
mapa, y conteo e historial (con fecha) de los cambios de coordenadas de cada tienda.

- `mobile/` — app (Vite + Capacitor → proyecto de Android Studio / APK). Ver [`mobile/README.md`](mobile/README.md)
- `supabase/` — base de datos **en uso** (Supabase: tablas + funciones RPC). Ver [`docs/SUPABASE.md`](docs/SUPABASE.md)
- `backend/` — API REST v2 (FastAPI + SQLite), alternativa local con la misma interfaz. Ver [`backend/README.md`](backend/README.md)
- `docs/API_CONTRACT.md` — contrato de la API v2
- `coordination/` — canal de mensajes entre Claude y Kiro (versión anterior)

Arranque rápido en el PC (los datos vienen de Supabase según `mobile/.env`):

```bash
cd mobile && npm install && npm run dev        # http://localhost:5173
```
