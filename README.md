# OLOCATION

App Android de **OLO Soluciones Logísticas** para que los transportistas corrijan la coordenada de
las tiendas a las que entregan. En la tienda, el transportista la busca en la app (o escanea la
factura) y guarda la ubicación actual del teléfono por GPS. Cada tienda lleva el conteo y el
historial de sus cambios de ubicación.

## Qué hace la app

| Pantalla | Qué se puede hacer |
|---|---|
| **Acceso** | Dos contraseñas: **admin** y **empleados** (transportistas). Opción de recordar el dispositivo. |
| **Transportista: Tiendas** | Botón grande **Escanear factura** y la lista de tiendas del registro nuevo (sin buscador ni filtros). Al escanear se muestra la tienda de la factura (registrándola si era nueva); se toca → ficha → **Guardar ubicación** → vuelve al inicio. No borra historial. |
| **Admin: Registro viejo** | El listado original, con buscador y filtros. Solo consulta y borrado de historial: ya no se registran ubicaciones. |
| **Admin: Registro nuevo** | Los clientes registrados al escanear facturas, con código, nombre, dirección y observaciones tal cual la factura. Coordenada e historial propios. |
| **Escanear factura** | Foto de la factura → lee el texto (OCR). Si el código no está en el registro nuevo, lo registra (sin código o nombre legibles no registra). Admin: desde el registro viejo muestra las coincidencias; desde el nuevo abre el registro. No guarda la foto. |
| **Tienda** | Datos, coordenada vigente, conteo e historial de cambios y el botón **Guardar ubicación** (solo en el registro nuevo). |
| **Guardar ubicación** | Mide el GPS del teléfono (hasta ~12 s, se queda con la lectura más precisa) y la guarda. No se puede elegir un punto a mano. |
| **Respaldo** (solo admin) | Descargar / restaurar un respaldo completo (JSON) y descargar las tiendas en CSV. |

### Cómo elige la tienda el escaneo de factura

1. Lee los campos **CODIGO**, **NOMBRE**, **DIRECCION** y **Observaciones** ("ENTREGAR EN …").
   En Android usa ML Kit (funciona sin internet); en el navegador, Tesseract.js.
2. **Código exacto** (sin contar ceros a la izquierda: `020210215` = `20210215`): se muestra solo
   esa tienda. Si varias sucursales comparten el código, primero la del lugar de entrega.
3. **Sin código exacto**: primero las tiendas cuyo código difiere en un solo dígito (por si el OCR
   leyó mal un número) y después las que coinciden por nombre, con un aviso para comparar.

La lógica está en `mobile/src/lib/invoice.js` (lectura de campos) y `mobile/src/lib/match.js`
(búsqueda de la tienda).

## Estructura del repositorio

| Carpeta | Contenido |
|---|---|
| [`mobile/`](mobile/README.md) | La app: Vite + JavaScript + Capacitor 8 → proyecto Android / APK. |
| [`supabase/`](docs/SUPABASE.md) | Base de datos **en uso**: migraciones SQL (tablas + funciones RPC). |
| [`backend/`](backend/README.md) | API REST (FastAPI + SQLite) con la misma interfaz: alternativa local y pruebas. |
| `docs/` | [`API_CONTRACT.md`](docs/API_CONTRACT.md) y [`openapi.json`](docs/openapi.json) (contrato de la API), [`SUPABASE.md`](docs/SUPABASE.md). |
| `coordination/` | Mensajes entre Claude y Kiro de la primera versión (histórico). |

**De dónde salen los datos:** la app tiene una capa de datos intercambiable (`mobile/src/data/`).
Hoy usa **Supabase**; se elige con `VITE_DATA_PROVIDER` en `mobile/.env` (`supabase` o `api`).

## Arranque rápido

Requisitos: Node.js 20+ y, para el APK, Android Studio.

```powershell
cd mobile
npm install
copy .env.example .env    # completar VITE_DATA_PROVIDER=supabase, VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

### Generar el APK

```powershell
cd mobile
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
npm run android:apk
```

El APK queda en **`mobile/android/app/build/outputs/apk/debug/olocation.apk`**. Para instalarlo,
pasarlo al teléfono y permitir "instalar apps de origen desconocido". Requiere Android 7.0 o
superior.

Cada cambio en `mobile/src/` o en `mobile/.env` necesita un APK nuevo.

## Más información

- App, requisitos de Android, ícono y notas (GPS, respaldo, mapa): [`mobile/README.md`](mobile/README.md)
- Supabase (seguridad, cambiar la contraseña, aplicar migraciones, consultas útiles): [`docs/SUPABASE.md`](docs/SUPABASE.md)
- Backend local y carga de tiendas desde CSV: [`backend/README.md`](backend/README.md)
