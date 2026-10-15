from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Accuracy = Annotated[float, Field(ge=0, le=100_000, allow_inf_nan=False)]
Source = Literal["gps", "map"]


class AccessRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    password: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class AccessResponse(BaseModel):
    token: str
    expiresAt: str


class Store(BaseModel):
    id: int
    code: str
    name: str
    address: str | None
    latitude: float | None
    longitude: float | None
    locationUpdatedAt: str | None = Field(description="Fecha del último registro desde la app (UTC)")
    changeCount: int = Field(description="Veces que se registró su ubicación desde la app")


class StoreList(BaseModel):
    items: list[Store]


class LocationChange(BaseModel):
    id: int
    storeId: int
    latitude: float
    longitude: float
    accuracyM: float | None
    source: Source
    previousLatitude: float | None
    previousLongitude: float | None
    createdAt: str


class LocationChangeList(BaseModel):
    items: list[LocationChange]


class LocationChangeCreate(BaseModel):
    # strict: rechaza coordenadas enviadas como texto ("9.93") o booleanos.
    model_config = ConfigDict(strict=True, extra="forbid")

    latitude: Latitude
    longitude: Longitude
    source: Source = Field(description="gps = ubicación actual del teléfono; map = punto elegido en el mapa")
    accuracyM: Accuracy | None = Field(default=None, description="Precisión del GPS en metros")


class LocationChangeResult(BaseModel):
    store: Store
    change: LocationChange


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(BaseModel):
    error: ErrorBody
