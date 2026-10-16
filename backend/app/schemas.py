from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

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


class Invoice(BaseModel):
    id: int
    storeId: int
    mimeType: str = Field(description="Tipo de la imagen: image/jpeg, image/png o image/webp")
    byteSize: int | None = Field(description="Tamaño de la imagen en bytes")
    imageUrl: str = Field(description="Ruta para descargar la imagen (relativa a la API)")
    createdAt: str = Field(description="Fecha y hora en que se registró la factura (UTC)")


class InvoiceList(BaseModel):
    items: list[Invoice]


class Store(BaseModel):
    id: int
    code: str
    name: str
    address: str | None
    latitude: float | None
    longitude: float | None
    locationUpdatedAt: str | None = Field(description="Fecha del último registro desde la app (UTC)")
    changeCount: int = Field(description="Veces que se registró su ubicación desde la app")
    invoiceCount: int = Field(default=0, description="Cantidad de facturas registradas")
    latestInvoice: Invoice | None = Field(default=None, description="La factura más reciente, o null")


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
    # Solo se registra la ubicación actual del teléfono. "map" queda en registros anteriores.
    source: Literal["gps"] = Field(description="Siempre gps: la ubicación actual del teléfono")
    accuracyM: Accuracy | None = Field(default=None, description="Precisión del GPS en metros")


class LocationChangeResult(BaseModel):
    store: Store
    change: LocationChange


class InvoiceCreateResult(BaseModel):
    store: Store
    invoice: Invoice


class InvoiceDeleteResult(BaseModel):
    store: Store = Field(description="La tienda después de borrar la factura")


class LocationChangeDeleteResult(BaseModel):
    store: Store = Field(description="La tienda después de borrar el registro")


def _utc_iso(value: str) -> str:
    """Fecha ISO‑8601 (con Z u offset) → "AAAA-MM-DDTHH:MM:SSZ" en UTC, como las guarda la base."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Debe ser una fecha ISO-8601, p. ej. 2026-10-15T14:49:46Z.") from None
    if parsed.tzinfo is None:
        raise ValueError("La fecha debe indicar la zona horaria (p. ej. terminar en Z).")
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


IsoDate = Annotated[str, StringConstraints(max_length=40), AfterValidator(_utc_iso)]
Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Address = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class BackupChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: Latitude
    longitude: Longitude
    accuracyM: Accuracy | None = None
    source: Source
    previousLatitude: Latitude | None = None
    previousLongitude: Longitude | None = None
    createdAt: IsoDate


class BackupStore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Code
    name: Name
    address: Address | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    locationUpdatedAt: IsoDate | None = None
    createdAt: IsoDate | None = None
    changes: list[BackupChange] = Field(default_factory=list, description="Más reciente primero")

    @model_validator(mode="after")
    def _coords_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude y longitude van juntas (las dos o ninguna).")
        return self


BACKUP_FORMAT = "olocation-backup"
BACKUP_VERSION = 1


class Backup(BaseModel):
    """Respaldo completo: todas las tiendas con su historial. Se identifica a cada tienda por `code`."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["olocation-backup"]
    version: Literal[1]
    exportedAt: IsoDate | None = None
    stores: list[BackupStore]

    @model_validator(mode="after")
    def _unique_codes(self):
        seen, repeated = set(), set()
        for store in self.stores:
            (repeated if store.code in seen else seen).add(store.code)
        if repeated:
            raise ValueError(f"Códigos de tienda repetidos: {', '.join(sorted(repeated))}.")
        return self


class RestoreResult(BaseModel):
    stores: int
    changes: int


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(BaseModel):
    error: ErrorBody
