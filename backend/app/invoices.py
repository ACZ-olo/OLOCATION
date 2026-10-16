"""Guardado en disco de las imágenes de las facturas.

La base de datos solo guarda la ruta relativa, el tipo MIME y el tamaño; el archivo vive en
`config.invoices_dir()` (por defecto `backend/data/invoices/`). Las imágenes se sirven por un
endpoint autenticado, nunca como archivos estáticos públicos.
"""
import secrets
from pathlib import Path

from app import config

# Tipos de imagen aceptados y su extensión. La cámara/galería del teléfono entregan estos.
ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Límite de tamaño de una factura (una foto de teléfono comprimida entra de sobra).
MAX_BYTES = 12 * 1024 * 1024  # 12 MB

# Firmas (magic numbers) para confirmar que el contenido coincide con el MIME declarado.
_SIGNATURES = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/webp": [b"RIFF"],  # RIFF....WEBP
}


class InvoiceImageError(ValueError):
    """Imagen inválida (tipo no permitido, vacía, demasiado grande o contenido que no coincide)."""


def _looks_like(data: bytes, mime: str) -> bool:
    if not any(data.startswith(sig) for sig in _SIGNATURES[mime]):
        return False
    if mime == "image/webp":
        return len(data) >= 12 and data[8:12] == b"WEBP"
    return True


def validate(data: bytes, mime_type: str) -> str:
    """Valida tipo, tamaño y contenido. Devuelve el MIME normalizado."""
    mime = (mime_type or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_MIME:
        raise InvoiceImageError("La factura debe ser una imagen JPEG, PNG o WEBP.")
    if not data:
        raise InvoiceImageError("La imagen está vacía.")
    if len(data) > MAX_BYTES:
        raise InvoiceImageError(f"La imagen supera el máximo de {MAX_BYTES // (1024 * 1024)} MB.")
    if not _looks_like(data, mime):
        raise InvoiceImageError("El archivo no es una imagen válida o no coincide con su tipo.")
    return mime


def save(store_id: int, data: bytes, mime_type: str) -> tuple[str, str, int]:
    """Valida y guarda la imagen. Devuelve (ruta_relativa, mime_normalizado, tamaño_en_bytes)."""
    mime = validate(data, mime_type)
    name = f"{store_id}-{secrets.token_hex(8)}{ALLOWED_MIME[mime]}"
    directory = config.invoices_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(data)
    return name, mime, len(data)


def path_for(image_path: str) -> Path:
    """Ruta absoluta de una imagen guardada (sin permitir salir de la carpeta de facturas)."""
    directory = config.invoices_dir().resolve()
    full = (directory / image_path).resolve()
    if not full.is_relative_to(directory):
        raise InvoiceImageError("Ruta de imagen inválida.")
    return full


def remove(image_path: str) -> None:
    """Borra el archivo de una factura (ignora si ya no existe)."""
    try:
        path_for(image_path).unlink(missing_ok=True)
    except (InvoiceImageError, OSError):
        pass
