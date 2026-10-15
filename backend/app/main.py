import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path as FsPath
from typing import Annotated

from fastapi import Depends, FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import repository, security
from app.db import connect, get_connection, migrate
from app.schemas import (
    CarrierLocationList,
    ClientList,
    ErrorResponse,
    Location,
    LocationCreate,
    LocationList,
    LoginRequest,
    LoginResponse,
)

WEB_DIR = FsPath(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(_: FastAPI):
    conn = connect()
    try:
        migrate(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="OLOCATION API", version="1.3.0", lifespan=lifespan)

Conn = Annotated[sqlite3.Connection, Depends(get_connection)]
ClientId = Annotated[int, Path(alias="clientId", ge=1, description="ID del cliente")]
CarrierId = Annotated[int, Path(alias="carrierId", ge=1, description="ID del transportista")]

ERRORS = {
    400: {"model": ErrorResponse, "description": "Datos inválidos"},
    404: {"model": ErrorResponse, "description": "Cliente no encontrado"},
}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def _error(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details or []}},
        headers={"WWW-Authenticate": "Bearer"} if status == 401 else None,
    )


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message)


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
        "greater_than_equal": f"Debe ser mayor o igual que {ctx.get('ge')}.",
        "less_than_equal": f"Debe ser menor o igual que {ctx.get('le')}.",
        "string_too_short": "No puede estar vacío.",
        "string_too_long": f"Debe tener como máximo {ctx.get('max_length')} caracteres.",
        "string_pattern_mismatch": "Debe tener de 4 a 8 dígitos.",
        "json_invalid": "El cuerpo no es un JSON válido.",
        "model_attributes_type": "El cuerpo debe ser un objeto JSON.",
        "dict_type": "El cuerpo debe ser un objeto JSON.",
    }
    if err["type"] == "value_error":  # mensajes propios de schemas.py, ya en español
        return str(ctx.get("error", err["msg"]))
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


def _require_client(conn: sqlite3.Connection, client_id: int) -> None:
    if not repository.client_exists(conn, client_id):
        raise ApiError(404, "CLIENT_NOT_FOUND", f"No existe un cliente con id {client_id}.")


def _require_assigned(conn: sqlite3.Connection, carrier_id: int, client_id: int) -> None:
    _require_client(conn, client_id)
    if not repository.is_client_assigned(conn, carrier_id, client_id):
        raise ApiError(
            403, "CLIENT_NOT_ASSIGNED", f"El cliente {client_id} no está asignado a este transportista."
        )


bearer = HTTPBearer(auto_error=False, description="Token devuelto por POST /api/v1/auth/login")


def current_carrier(
    conn: Conn, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
) -> int:
    """ID del transportista dueño del token `Authorization: Bearer <token>`."""
    if credentials is None:
        raise ApiError(401, "UNAUTHORIZED", "Falta el token de sesión. Iniciá sesión.")
    carrier_id = repository.carrier_id_for_token(
        conn, security.hash_token(credentials.credentials), security.to_iso(security.utcnow())
    )
    if carrier_id is None:
        raise ApiError(401, "UNAUTHORIZED", "La sesión no es válida o expiró. Iniciá sesión de nuevo.")
    return carrier_id


CurrentCarrier = Annotated[int, Depends(current_carrier)]

AUTH_ERRORS = {
    401: {"model": ErrorResponse, "description": "Sin token o token inválido/expirado"},
    403: {"model": ErrorResponse, "description": "Cliente no asignado / acceso a otro transportista"},
}

# Hash calculado una vez para gastar el mismo tiempo cuando la cédula no existe.
_DUMMY_PIN_HASH = security.hash_pin("0000")


@app.post(
    "/api/v1/auth/login",
    response_model=LoginResponse,
    responses={
        400: ERRORS[400],
        401: {"model": ErrorResponse, "description": "Cédula o PIN incorrectos"},
        429: {"model": ErrorResponse, "description": "Bloqueado por demasiados intentos"},
    },
)
def login(body: LoginRequest, conn: Conn):
    now = security.utcnow()
    row = repository.get_carrier_credentials(conn, body.idNumber)
    if row is None or row["pin_hash"] is None:
        security.verify_pin(body.pin, _DUMMY_PIN_HASH)
        raise ApiError(401, "INVALID_CREDENTIALS", "Cédula o PIN incorrectos.")

    if row["locked_until"] and security.from_iso(row["locked_until"]) > now:
        raise _locked_error(security.from_iso(row["locked_until"]), now)

    if not security.verify_pin(body.pin, row["pin_hash"]):
        attempts = row["failed_attempts"] + 1
        if attempts >= security.MAX_FAILED_ATTEMPTS:
            locked_until = now + security.LOCKOUT
            repository.record_failed_login(conn, row["id"], 0, security.to_iso(locked_until))
            raise _locked_error(locked_until, now)
        repository.record_failed_login(conn, row["id"], attempts, None)
        raise ApiError(401, "INVALID_CREDENTIALS", "Cédula o PIN incorrectos.")

    token = security.new_token()
    expires_at = security.to_iso(now + security.TOKEN_TTL)
    profile = body.model_dump(include={"name", "plate", "phone"}, exclude_none=True)
    repository.record_successful_login(
        conn, row["id"], profile, security.hash_token(token), expires_at, security.to_iso(now)
    )
    return {"token": token, "expiresAt": expires_at, "carrier": repository.get_carrier(conn, row["id"])}


def _locked_error(locked_until, now) -> ApiError:
    minutes = max(1, -(-int((locked_until - now).total_seconds()) // 60))
    return ApiError(
        429,
        "TOO_MANY_ATTEMPTS",
        f"Demasiados intentos fallidos. Intentá de nuevo en {minutes} minuto(s).",
    )


@app.get(
    "/api/v1/carriers/{carrierId}/clients",
    response_model=ClientList,
    responses={400: ERRORS[400], **AUTH_ERRORS},
)
def list_carrier_clients(carrier_id: CarrierId, me: CurrentCarrier, conn: Conn):
    if carrier_id != me:
        raise ApiError(403, "FORBIDDEN", "Solo podés consultar tus propios clientes.")
    return {"items": repository.list_carrier_clients(conn, carrier_id)}


@app.get(
    "/api/v1/carriers/{carrierId}/locations",
    response_model=CarrierLocationList,
    responses={400: ERRORS[400], **AUTH_ERRORS},
)
def list_carrier_locations(carrier_id: CarrierId, me: CurrentCarrier, conn: Conn):
    if carrier_id != me:
        raise ApiError(403, "FORBIDDEN", "Solo podés consultar tus propios registros.")
    return {"items": repository.list_carrier_locations(conn, carrier_id)}


@app.get(
    "/api/v1/clients/{clientId}/locations",
    response_model=LocationList,
    responses={**ERRORS, **AUTH_ERRORS},
)
def list_locations(client_id: ClientId, me: CurrentCarrier, conn: Conn):
    _require_assigned(conn, me, client_id)
    return {"items": repository.list_locations(conn, client_id)}


@app.post(
    "/api/v1/clients/{clientId}/locations",
    response_model=Location,
    status_code=201,
    responses={**ERRORS, **AUTH_ERRORS},
)
def create_location(client_id: ClientId, body: LocationCreate, me: CurrentCarrier, conn: Conn):
    _require_assigned(conn, me, client_id)
    return repository.create_location(
        conn, client_id, me, body.latitude, body.longitude, body.label
    )


# Web app (HTML + Leaflet) servida en la raíz. Se monta al final para que las rutas
# /api/v1/*, /docs y /openapi.json tengan prioridad. html=True sirve index.html en "/".
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
