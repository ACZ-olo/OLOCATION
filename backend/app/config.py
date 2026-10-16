import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BASE_DIR / "db" / "migrations"
# App móvil compilada (`npm run build` en mobile/); si existe, el backend la sirve en "/".
MOBILE_DIST_DIR = BASE_DIR.parent / "mobile" / "dist"

# Orígenes que pueden llamar a la API desde otro dominio: la app Android (Capacitor sirve
# la web desde https://localhost) y el servidor de desarrollo de Vite.
DEFAULT_CORS_ORIGINS = "https://localhost,http://localhost,capacitor://localhost,http://localhost:5173"


def _load_env_file(path: Path) -> None:
    """Carga `backend/.env` (CLAVE=valor) sin pisar variables ya definidas en el entorno."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(BASE_DIR / ".env")


def db_path() -> Path:
    path = Path(os.environ.get("OLOCATION_DB_PATH", "data/olocation-v2.db"))
    return path if path.is_absolute() else BASE_DIR / path


def invoices_dir() -> Path:
    """Carpeta donde se guardan las imágenes de las facturas (junto a la base por defecto)."""
    raw = os.environ.get("OLOCATION_INVOICES_DIR")
    path = Path(raw) if raw else db_path().parent / "invoices"
    return path if path.is_absolute() else BASE_DIR / path


def access_password() -> str | None:
    """Contraseña general de acceso a la app. Sin ella nadie puede entrar."""
    return os.environ.get("OLOCATION_ACCESS_PASSWORD") or None


def token_secret() -> str:
    """Secreto extra para firmar los tokens de acceso (opcional pero recomendado)."""
    return os.environ.get("OLOCATION_TOKEN_SECRET", "")


def cors_origins() -> list[str]:
    raw = os.environ.get("OLOCATION_CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
