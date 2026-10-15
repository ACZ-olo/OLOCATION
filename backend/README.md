# OLOCATION — Backend v2

API REST de la app móvil: listado de tiendas, acceso con contraseña general y registro de la
ubicación de cada tienda con historial y conteo de cambios. Es el backend **en uso hoy**; la
migración planeada a Supabase está preparada en [`../docs/SUPABASE.md`](../docs/SUPABASE.md).

- **Stack:** Python 3.12+ · FastAPI · SQLite (módulo estándar `sqlite3`)
- **Contrato:** [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) · OpenAPI: [`../docs/openapi.json`](../docs/openapi.json)

```
backend/
├── app/
│   ├── main.py         # rutas, acceso y manejo de errores; sirve ../mobile/dist en "/"
│   ├── schemas.py      # modelos de entrada/salida y validaciones
│   ├── repository.py   # consultas SQL
│   ├── security.py     # tokens firmados y límite de intentos
│   ├── db.py           # conexión y aplicador de migraciones
│   └── config.py       # variables OLOCATION_* (lee backend/.env)
├── db/migrations/      # NNN_descripcion.sql, se aplican en orden
├── scripts/
│   ├── migrate.py         # crea la BD y aplica migraciones
│   └── import_stores.py   # carga/actualiza tiendas desde CSV
├── seed/stores.demo.csv   # 15 tiendas ficticias
└── tests/
```

## Modelo de datos

```
stores                                   store_location_changes
───────────────────────────────          ─────────────────────────────────────
id                   INTEGER PK  1───*   id                  INTEGER PK
code                 TEXT UNIQUE         store_id            FK → stores.id
name                 TEXT                latitude, longitude REAL
address              TEXT NULL           accuracy_m          REAL NULL  (GPS, metros)
latitude, longitude  REAL NULL           source              'gps' | 'map'
location_updated_at  TEXT NULL (UTC)     previous_latitude, previous_longitude  REAL NULL
created_at           TEXT (UTC)          created_at          TEXT (UTC)
```

- `stores.latitude/longitude` es la coordenada **vigente**. Cada registro desde la app agrega una
  fila en `store_location_changes` (con la coordenada anterior) y actualiza la tienda.
- El **conteo de cambios** de una tienda es la cantidad de filas de su historial.

## Puesta en marcha

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate      Linux/macOS:  source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                       # y poner la contraseña en OLOCATION_ACCESS_PASSWORD

python -m scripts.migrate                  # crea data/olocation-v2.db
python -m scripts.import_stores seed/stores.demo.csv
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- La API aplica las migraciones pendientes al arrancar.
- Documentación interactiva: <http://localhost:8000/docs>.
- Si existe `../mobile/dist` (después de `npm run build` en `mobile/`), la app se abre en
  <http://localhost:8000/>.
- Pruebas: `pip install -r requirements-dev.txt` y `pytest`.

### Configuración (`backend/.env`, ver `.env.example`)

| Variable | Para qué |
|---|---|
| `OLOCATION_ACCESS_PASSWORD` | **Obligatoria.** Contraseña general de la app. Cambiarla cierra el acceso en todos los dispositivos. |
| `OLOCATION_TOKEN_SECRET` | Secreto extra para firmar los tokens (recomendado en producción). |
| `OLOCATION_DB_PATH` | Ruta del SQLite (por defecto `data/olocation-v2.db`). |
| `OLOCATION_CORS_ORIGINS` | Orígenes permitidos (por defecto la app Android y Vite). |

Las variables del entorno tienen prioridad sobre `.env`.

## Cargar el listado de tiendas

Desde un CSV (por ejemplo exportado de Excel; separador `,` o `;`, coma decimal aceptada):

```csv
code,name,address,latitude,longitude
T-001,Súper La Sabana,"Mata Redonda, San José",9.9351,-84.1012
T-003,Pulpería Doña Ana,"Desamparados centro, San José",,
```

```bash
python -m scripts.import_stores ruta/tiendas.csv
```

- `code` y `name` son obligatorios; `address`, `latitude` y `longitude` opcionales.
- Una tienda con el mismo `code` se actualiza (nombre y dirección).
- La coordenada del CSV **solo se aplica a tiendas sin registros desde la app**: volver a importar
  el listado nunca pisa una ubicación corregida por un transportista.
- La carga no cuenta como cambio de ubicación.
- Si el archivo tiene un error, no se carga nada.
