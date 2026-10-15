import sqlite3
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config, repository, security
from app.db import connect, get_connection, migrate
from app.schemas import (
    AccessRequest,
    AccessResponse,
    ErrorResponse,
    LocationChangeCreate,
    LocationChangeList,
    LocationChangeResult,
    Store,
    StoreList,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    conn = connect()
    try:
        migrate(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="OLOCATION API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

Conn = Annotated[sqlite3.Connection, Depends(get_connection)]
StoreId = Annotated[int, Path(alias="storeId", ge=1, description="ID de la tienda")]

failed_attempts = security.FailedAttempts()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers


def _error(
    status: int, code: str, message: str, details: list | None = None, headers: dict | None = None
) -> JSONResponse:
    headers = dict(headers or {})
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details or []}},
        headers=headers or None,
    )


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message, headers=exc.headers)


def _validation_message(err: dict) -> str:
    ctx = err.get("ctx", {})
    messages = {
        "missing": "Campo obligatorio.",
        "extra_forbidden": "Campo no permitido.",
        "float_type": "Debe ser un número.",
        "float_parsing": "Debe ser un número.",
        "finite_number": "Debe ser un número finito.",
        "int_type": "Debe ser un número entero.",
        "int_parsing": "Debe ser un número entero.",
        "string_type": "Debe ser un texto.",
        "literal_error": f"Debe ser uno de: {ctx.get('expected')}.",
        "greater_than_equal": f"Debe ser mayor o igual que {ctx.get('ge')}.",
        "less_than_equal": f"Debe ser menor o igual que {ctx.get('le')}.",
        "string_too_short": "No puede estar vacío.",
        "string_too_long": f"Debe tener como máximo {ctx.get('max_length')} caracteres.",
        "json_invalid": "El cuerpo no es un JSON válido.",
        "model_attributes_type": "El cuerpo debe ser un objeto JSON.",
        "dict_type": "El cuerpo debe ser un objeto JSON.",
    }
    return messages.get(err["type"], err["msg"])


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    details = []
    for err in exc.errors():
        loc = [str(part) for part in err["loc"] if part not in ("body", "path", "query")]
        details.append({"field": ".".join(loc) or "body", "message": _validation_message(err)})
    return _error(400, "VALIDATION_ERROR", "Los datos enviados no son válidos.", details)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return _error(404, "NOT_FOUND", "Recurso no encontrado.")
    if exc.status_code == 405:
        return _error(405, "METHOD_NOT_ALLOWED", "Método no permitido para esta ruta.")
    return _error(exc.status_code, "HTTP_ERROR", str(exc.detail))


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, __: Exception):
    return _error(500, "INTERNAL_ERROR", "Error interno del servidor.")


def _configured_password() -> str:
    password = config.access_password()
    if password is None:
        raise ApiError(
            503,
            "ACCESS_NOT_CONFIGURED",
            "El servidor no tiene contraseña de acceso configurada (OLOCATION_ACCESS_PASSWORD).",
        )
    return password


bearer = HTTPBearer(auto_error=False, description="Token devuelto por POST /api/v2/access")


def require_access(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    """Exige `Authorization: Bearer <token>` válido (obtenido con la contraseña general)."""
    password = _configured_password()
    if credentials is None:
        raise ApiError(401, "UNAUTHORIZED", "Falta el token de acceso. Ingresá la contraseña.")
    if not security.verify_token(
        credentials.credentials, password, config.token_secret(), security.utcnow()
    ):
        raise ApiError(
            401, "UNAUTHORIZED", "El acceso venció o la contraseña cambió. Ingresala de nuevo."
        )


Access = Depends(require_access)

AUTH_ERRORS = {401: {"model": ErrorResponse, "description": "Sin token o token inválido/vencido"}}
NOT_FOUND = {404: {"model": ErrorResponse, "description": "La tienda no existe"}}
BAD_REQUEST = {400: {"model": ErrorResponse, "description": "Datos inválidos"}}


def _require_store(conn: sqlite3.Connection, store_id: int) -> dict:
    store = repository.get_store(conn, store_id)
    if store is None:
        raise ApiError(404, "STORE_NOT_FOUND", f"No existe una tienda con id {store_id}.")
    return store


@app.post(
    "/api/v2/access",
    response_model=AccessResponse,
    responses={
        **BAD_REQUEST,
        401: {"model": ErrorResponse, "description": "Contraseña incorrecta"},
        429: {"model": ErrorResponse, "description": "Demasiados intentos fallidos"},
        503: {"model": ErrorResponse, "description": "Contraseña no configurada en el servidor"},
    },
)
def access(body: AccessRequest, request: Request):
    password = _configured_password()
    client_key = request.client.host if request.client else "?"
    if wait := failed_attempts.retry_after(client_key):
        minutes = -(-wait // 60)
        raise ApiError(
            429,
            "TOO_MANY_ATTEMPTS",
            f"Demasiados intentos fallidos. Intentá de nuevo en {minutes} minuto(s).",
            headers={"Retry-After": str(wait)},
        )
    if not security.check_password(body.password, password):
        failed_attempts.record_failure(client_key)
        raise ApiError(401, "INVALID_PASSWORD", "Contraseña incorrecta.")
    failed_attempts.reset(client_key)
    token, expires_at = security.issue_token(password, config.token_secret(), security.utcnow())
    return {"token": token, "expiresAt": security.to_iso(expires_at)}


@app.get("/api/v2/stores", response_model=StoreList, responses=AUTH_ERRORS, dependencies=[Access])
def list_stores(conn: Conn):
    return {"items": repository.list_stores(conn)}


@app.get(
    "/api/v2/stores/{storeId}",
    response_model=Store,
    responses={**BAD_REQUEST, **AUTH_ERRORS, **NOT_FOUND},
    dependencies=[Access],
)
def get_store(store_id: StoreId, conn: Conn):
    return _require_store(conn, store_id)


@app.get(
    "/api/v2/stores/{storeId}/location-changes",
    response_model=LocationChangeList,
    responses={**BAD_REQUEST, **AUTH_ERRORS, **NOT_FOUND},
    dependencies=[Access],
)
def list_location_changes(store_id: StoreId, conn: Conn):
    _require_store(conn, store_id)
    return {"items": repository.list_location_changes(conn, store_id)}


@app.post(
    "/api/v2/stores/{storeId}/location-changes",
    response_model=LocationChangeResult,
    status_code=201,
    responses={**BAD_REQUEST, **AUTH_ERRORS, **NOT_FOUND},
    dependencies=[Access],
)
def create_location_change(store_id: StoreId, body: LocationChangeCreate, conn: Conn):
    _require_store(conn, store_id)
    change = repository.create_location_change(
        conn, store_id, body.latitude, body.longitude, body.source, body.accuracyM
    )
    return {"store": repository.get_store(conn, store_id), "change": change}


# App móvil compilada (mobile/dist) servida en la raíz, para probarla desde el navegador.
# Se monta al final para que /api/v2/*, /docs y /openapi.json tengan prioridad.
if config.MOBILE_DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.MOBILE_DIST_DIR, html=True), name="mobile")
