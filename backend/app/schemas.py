import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


class Client(BaseModel):
    id: int
    code: str
    name: str


class ClientList(BaseModel):
    items: list[Client]


class Location(BaseModel):
    id: int
    clientId: int
    carrierId: int | None
    label: str | None
    latitude: float
    longitude: float
    createdAt: str


class LocationList(BaseModel):
    items: list[Location]


class CarrierLocation(Location):
    """Ubicación con los datos del cliente, para el historial del transportista."""

    clientCode: str
    clientName: str


class CarrierLocationList(BaseModel):
    items: list[CarrierLocation]


Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class SeedLocation(BaseModel):
    # strict: rechaza coordenadas enviadas como texto ("9.93") o booleanos.
    model_config = ConfigDict(strict=True, extra="forbid")

    latitude: Latitude
    longitude: Longitude
    label: Label | None = None


class LocationCreate(SeedLocation):
    """El transportista se toma del token de sesión, no del cuerpo."""


def _normalize_code(value: str) -> str:
    """Cédula/placa: sin espacios ni guiones y en mayúsculas ("1-2345-6789" → "123456789")."""
    value = re.sub(r"[\s-]", "", value).upper()
    if not value:
        raise ValueError("No puede estar vacío.")
    if not value.isalnum():
        raise ValueError("Solo puede contener letras, números, espacios o guiones.")
    return value


IdNumber = Annotated[str, StringConstraints(max_length=30), AfterValidator(_normalize_code)]
Plate = Annotated[str, StringConstraints(max_length=15), AfterValidator(_normalize_code)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]


Pin = Annotated[str, StringConstraints(pattern=r"^[0-9]{4,8}$")]


class LoginRequest(BaseModel):
    """Cédula + PIN; nombre, placa y teléfono, si se envían, actualizan los datos del transportista."""

    model_config = ConfigDict(strict=True, extra="forbid")

    idNumber: IdNumber
    pin: Pin
    name: Label | None = None
    plate: Plate | None = None
    phone: Phone | None = None


class Carrier(BaseModel):
    id: int
    name: str
    idNumber: str
    plate: str
    phone: str | None
    createdAt: str


class LoginResponse(BaseModel):
    token: str
    expiresAt: str
    carrier: Carrier


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(BaseModel):
    error: ErrorBody
