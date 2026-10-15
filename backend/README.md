# OLOCATION — Backend

API REST para que la app Android de transportistas inicie sesión (cédula + PIN), liste sus
clientes asignados y guarde la ubicación (coordenada) seleccionada para cada uno.

- **Stack:** Python 3.12+ · FastAPI · SQLite (módulo estándar `sqlite3`)
- **Contrato de API:** [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) · OpenAPI: [`../docs/openapi.json`](../docs/openapi.json)

```
backend/
├── app/
│   ├── main.py         # rutas y manejo de errores
│   ├── schemas.py      # modelos de entrada/salida y validaciones
│   ├── repository.py   # consultas SQL
│   ├── db.py           # conexión y aplicador de migraciones
│   ├── config.py       # OLOCATION_DB_PATH
│   └── web/            # web de prueba (HTML + Leaflet) servida en /
├── migrations/         # NNN_descripcion.sql, se aplican en orden
├── scripts/
│   ├── migrate.py      # crea la BD y aplica migraciones
│   └── seed.py         # carga clientes, ubicaciones, transportistas y asignaciones desde JSON
├── seed/clients.example.json
└── tests/
```

## Modelo de datos

```
carriers                        carrier_clients              clients
──────────────────────          ─────────────────            ───────────────────
id         INTEGER PK  1───*    carrier_id  FK     *───1     id         INTEGER PK
id_number  TEXT UNIQUE          client_id   FK               code       TEXT UNIQUE
name       TEXT                 PK(carrier_id, client_id)    name       TEXT
plate      TEXT                                              created_at TEXT (UTC)
phone      TEXT NULL                                              │ 1
pin_hash   TEXT NULL  (PBKDF2)                                    │
failed_attempts, locked_until                                     │
created_at TEXT (UTC)                                             │
     │ 1                                                          │ *
     │                          client_locations
     └──────────────────── *    ─────────────────────────────────────────
                                id          INTEGER PK
                                client_id   INTEGER FK → clients.id
                                carrier_id  INTEGER FK → carriers.id  NULL
                                label       TEXT NULL
                                latitude    REAL  CHECK −90..90
                                longitude   REAL  CHECK −180..180
                                created_at  TEXT (UTC)

carrier_tokens:  token_hash TEXT PK (SHA-256) · carrier_id FK · created_at · expires_at
```

- Un cliente puede tener varias ubicaciones; cada una registra qué transportista la guardó
  (`carrier_id` es `NULL` en las de la carga inicial).
- Cada transportista ve solo los clientes asignados en `carrier_clients`.
- `id_number` (cédula) y `plate` se guardan normalizados: sin espacios ni guiones, en mayúsculas.
- El PIN se guarda solo como hash PBKDF2‑SHA256 con sal; los tokens de sesión, como SHA‑256.
  Ni el PIN ni el token en claro se guardan en la base.
- La tabla `schema_migrations` registra qué migraciones ya se aplicaron.

## Puesta en marcha

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate      Linux/macOS:  source .venv/bin/activate
pip install -r requirements.txt

python -m scripts.migrate                          # crea data/olocation.db
python -m scripts.seed seed/demo.json              # datos de prueba (ver abajo)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- La API también aplica las migraciones pendientes al arrancar.
- Web para ver avances: <http://localhost:8000/> (ver *Web de prueba* más abajo).
- Documentación interactiva: <http://localhost:8000/docs>
- Para usar otra ruta de base de datos: variable `OLOCATION_DB_PATH` (ver `.env.example`).

### Pruebas

```bash
pip install -r requirements-dev.txt
pytest
```

## Datos de prueba

`seed/demo.json` trae **datos ficticios** para probar el flujo completo: 8 clientes en distintas
zonas de Costa Rica (algunos con ubicaciones ya guardadas) y 4 transportistas, cada uno pensado
para un escenario:

| Transportista | Cédula | PIN | Placa | Clientes asignados | Para probar |
|---|---|---|---|---|---|
| Carlos Jiménez Rojas | `1-1111-1111` | `1234` | ABC-123 | CLI-001, 002, 003, 004 (GAM) | Flujo normal; CLI-003 no tiene ubicaciones aún |
| María Fernández Solís | `2-2222-2222` | `5678` | CRT-456 | CLI-001, 005, 006 (Pacífico) | CLI-001 compartido con Carlos: ve los puntos que guardó él |
| José Vargas Mora | `3-3333-3333` | `2468` | LMN-789 | CLI-007, 008 (Caribe / Zona Norte) | Sin teléfono registrado |
| Laura Castro Quesada | `4-4444-4444` | `1357` | SJB-321 | *(ninguno)* | Estado vacío "sin clientes asignados" |

| Cliente | Código | Ubicaciones precargadas |
|---|---|---|
| Distribuidora La Sabana | CLI-001 | Bodega principal, Andén de carga |
| Ferretería El Roble | CLI-002 | Tienda |
| Supermercado Monteverde | CLI-003 | — |
| Panadería Don Tomás | CLI-004 | Entrada trasera |
| Abastecedor Puerto Azul | CLI-005 | Muelle |
| Farmacia Central Liberia | CLI-006 | — |
| Bodega Caribe Sur | CLI-007 | Portón 2 |
| Agroinsumos San Carlos | CLI-008 | — |

Otros casos para probar con cualquiera de ellos:

- **PIN incorrecto** → `401 INVALID_CREDENTIALS`. Con **5 seguidos** la cuenta queda bloqueada
  15 minutos (`429 TOO_MANY_ATTEMPTS`). Para desbloquear antes, volver a cargar `seed/demo.json`
  (reasigna el PIN y reinicia el contador).
- **Cédula inexistente** (p. ej. `9-9999-9999`) → mismo `401` que un PIN incorrecto.
- **Cliente ajeno**: con el token de Carlos, `GET /clients/7/locations` → `403 CLIENT_NOT_ASSIGNED`.
- **Sin token** o token inventado → `401 UNAUTHORIZED`.

Los **ID numéricos** dependen del orden de carga; la app debe usar el `carrier.id` que devuelve el
login, no suponerlos. Para empezar con una base limpia (detener antes el servidor):

```bash
rm data/olocation.db            # Windows PowerShell: Remove-Item data\olocation.db
python -m scripts.seed seed/demo.json
```

## Carga inicial de clientes, transportistas y asignaciones

No se asume ninguna fuente externa: todo se carga desde un archivo JSON con este formato
(copiar `seed/clients.example.json` y reemplazar con los datos reales):

```json
{
  "clients": [
    {
      "code": "CLI-001",
      "name": "Nombre del cliente",
      "locations": [
        { "label": "Bodega principal", "latitude": 9.9325, "longitude": -84.0796 }
      ]
    }
  ],
  "carriers": [
    {
      "idNumber": "1-1111-1111",
      "name": "Nombre del transportista",
      "plate": "ABC-123",
      "phone": "8888-8888",
      "pin": "1234",
      "clients": ["CLI-001"]
    }
  ]
}
```

```bash
python -m scripts.seed ruta/a/datos.json
```

- `code` identifica al cliente: si ya existe, se actualiza su nombre; si no, se crea.
- `locations` es opcional; una ubicación con la misma latitud/longitud que una ya
  existente del cliente no se duplica.
- `idNumber` (cédula) identifica al transportista; `phone` es opcional. Su lista `clients`
  (códigos) **reemplaza** sus asignaciones: para desasignar un cliente, quitarlo de la lista
  y volver a cargar. Los códigos deben existir (en el archivo o ya en la base).
- `pin` (texto, 4 a 8 dígitos) es **obligatorio para un transportista nuevo**: sin él no podría
  iniciar sesión. En uno existente es opcional; si se envía, **reemplaza** su PIN y lo desbloquea.
  Solo se guarda el hash. Comunicar el PIN a cada transportista por un medio privado y no dejar
  archivos con PIN reales en el repositorio.
- Solo los transportistas cargados aquí pueden entrar a la app (no hay auto-registro).
- Se puede ejecutar varias veces sin problema. El archivo se valida completo antes de
  escribir (rangos, campos obligatorios, códigos/cédulas repetidos, clientes inexistentes);
  si hay un error no se carga nada.

Si los clientes vienen de una hoja de cálculo, basta con exportarla a este JSON.

## Web de prueba (ver avances en un link)

El mismo backend sirve una web ligera (HTML + [Leaflet](https://leafletjs.com/)) para ir
viendo el desarrollo desde el navegador, sin instalar nada. Es un *preview* del flujo que
tendrá la app Android; más adelante se reemplaza por la app nativa reusando el mismo
contrato de API. Los archivos están en `app/web/` (`index.html`, `app.js`, `styles.css`).

Está al día con el contrato **v1.2** (login con cédula + PIN y token Bearer). El flujo son
cuatro pantallas, una por paso:

1. **Iniciar sesión** con cédula + PIN (`POST /auth/login`). Opcionalmente se pueden actualizar
   nombre, placa y teléfono. La web guarda el `token` y el `carrier` en `localStorage` (nunca el
   PIN) y lo reusa en el siguiente arranque hasta que vence. Probá con los datos de arriba, p. ej.
   cédula `1-1111-1111`, PIN `1234`.
2. **Clientes asignados** al transportista (`GET /carriers/{carrierId}/clients`). Si no tiene
   ninguno, muestra el estado vacío.
3. **Mapa** para marcar el punto, tocando el mapa o con **Usar mi GPS**.
4. **Revisar y guardar**: muestra las coordenadas y un campo de etiqueta opcional; **Guardar**
   envía todo en un único `POST /clients/{clientId}/locations` (el transportista sale del token,
   no se manda `carrierId`), **Descartar** no envía nada.

Todas las llamadas salvo el login mandan el header `Authorization: Bearer <token>`. Si el token
falta o vence (`401 UNAUTHORIZED`), la web borra la sesión y vuelve al login. El botón **Salir**
(arriba a la derecha en la lista de clientes) cierra la sesión.

### Abrirla

```bash
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

| Dónde la abrís | Link |
|---|---|
| En el mismo PC | `http://localhost:8000/` |
| Desde el celular (misma Wi‑Fi) | `http://<IP-del-PC>:8000/` (p. ej. `http://192.168.1.50:8000/`) |

- La IP del PC se obtiene con `ipconfig` (Windows) o `ip addr` / `ifconfig` (Linux/macOS):
  es la de la red local, normalmente `192.168.x.x`.
- Hay que arrancar `uvicorn` con `--host 0.0.0.0` y permitir el puerto 8000 en el firewall
  del PC para que el celular pueda entrar.
- La web usa rutas relativas (`api/v1/...`), así que funciona igual en `localhost` o por IP
  sin configurar nada.
- El **GPS del navegador** solo funciona en `localhost` o por HTTPS. Al abrir por IP con
  `http://` el navegador puede bloquear la geolocalización; en ese caso elegí el punto
  tocando el mapa. (En desarrollo es suficiente; para GPS por IP haría falta HTTPS.)
- El mapa carga teselas de OpenStreetMap y la librería Leaflet desde internet (CDN), así que
  el PC que sirve la web necesita conexión. No requiere API key.

> Nota: esta web es solo para seguir el avance. La app final de Android se construye aparte
> (ver abajo) consumiendo exactamente el mismo contrato de API.

## Conexión desde Android (para Kiro)

### URL base

| Dónde corre la app | URL base |
|---|---|
| Emulador de Android Studio (API en el mismo PC) | `http://10.0.2.2:8000/api/v1/` |
| Teléfono físico en la misma red Wi‑Fi | `http://<IP-del-PC>:8000/api/v1/` (arrancar uvicorn con `--host 0.0.0.0` y permitir el puerto 8000 en el firewall) |
| Servidor desplegado | `https://<dominio>/api/v1/` |

Recomendado: definir la URL como `buildConfigField` por *build type* en lugar de fijarla en
el código.

### Permisos y HTTP sin TLS (solo desarrollo)

`AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ... >
```

`res/xml/network_security_config.xml` (debug), para permitir `http://` hacia el PC local:

```xml
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <!-- Agregar la IP del PC si se prueba con un teléfono físico -->
    </domain-config>
</network-security-config>
```

En producción usar HTTPS y no permitir tráfico sin cifrar.

### Ejemplo de cliente (Retrofit + kotlinx.serialization)

Solo como referencia del contrato; la implementación es de Kiro.

```kotlin
@Serializable data class LoginRequest(
    val idNumber: String, val pin: String,  // pin como String: "0123" es válido
    val name: String? = null, val plate: String? = null, val phone: String? = null,
)
@Serializable data class LoginResponse(val token: String, val expiresAt: String, val carrier: Carrier)
@Serializable data class Carrier(
    val id: Long, val name: String, val idNumber: String, val plate: String,
    val phone: String? = null, val createdAt: String,
)
@Serializable data class Client(val id: Long, val code: String, val name: String)
@Serializable data class Location(
    val id: Long, val clientId: Long, val carrierId: Long? = null, val label: String? = null,
    val latitude: Double, val longitude: Double, val createdAt: String,
)
@Serializable data class CarrierLocation(
    val id: Long, val clientId: Long, val clientCode: String, val clientName: String,
    val carrierId: Long? = null, val label: String? = null,
    val latitude: Double, val longitude: Double, val createdAt: String,
)
@Serializable data class NewLocation(
    val latitude: Double, val longitude: Double, val label: String? = null,  // sin carrierId: sale del token
)
@Serializable data class Items<T>(val items: List<T>)
@Serializable data class ApiError(val error: Body) {
    @Serializable data class Body(val code: String, val message: String, val details: List<Detail> = emptyList())
    @Serializable data class Detail(val field: String, val message: String)
}

interface OlocationApi {
    @POST("auth/login") suspend fun login(@Body body: LoginRequest): LoginResponse
    @GET("carriers/{id}/clients") suspend fun carrierClients(@Path("id") carrierId: Long): Items<Client>
    // Pantalla "Registros": historial del transportista, con datos del cliente
    @GET("carriers/{id}/locations") suspend fun carrierLocations(@Path("id") carrierId: Long): Items<CarrierLocation>
    @GET("clients/{id}/locations") suspend fun locations(@Path("id") clientId: Long): Items<Location>
    @POST("clients/{id}/locations") suspend fun saveLocation(
        @Path("id") clientId: Long, @Body body: NewLocation,
    ): Location
}

// Agrega el token a todas las peticiones salvo el login.
class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.token() ?: return chain.proceed(chain.request())
        return chain.proceed(
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        )
    }
}
```

- Si `label` es `null`, puede omitirse (con `explicitNulls = false`) o enviarse como `null`;
  ambas formas son válidas.
- Ante una respuesta no exitosa, leer `errorBody()` como `ApiError` y decidir por
  `error.code`. **`UNAUTHORIZED` en cualquier ruta → borrar el token y volver al login.**
  La tabla completa de errores y qué hacer con cada uno está en `docs/API_CONTRACT.md`.
- Guardar `token` y `carrier.id` en almacenamiento cifrado (`EncryptedSharedPreferences` o
  DataStore + Tink). Nunca guardar el PIN.
- Prueba rápida desde el PC (con `seed/demo.json` cargado; en Git Bash):

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"idNumber": "1-1111-1111", "pin": "1234"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl http://localhost:8000/api/v1/carriers/1/clients -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:8000/api/v1/clients/1/locations \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"latitude": 9.9325, "longitude": -84.0796, "label": "Bodega"}'
```

También se puede probar desde <http://localhost:8000/docs>: ejecutar `POST /auth/login`, copiar
el `token` y pegarlo en el botón **Authorize**.
