"""Acceso con contraseña general (sin usuarios).

Quien conoce la contraseña recibe un token firmado (HMAC‑SHA256) que vale TOKEN_TTL. La llave de
firma se deriva de la contraseña y de OLOCATION_TOKEN_SECRET: al cambiar cualquiera de las dos,
todos los dispositivos recordados quedan fuera y tienen que volver a ingresar la contraseña.
"""
import hashlib
import hmac
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

TOKEN_TTL = timedelta(days=365)
TOKEN_PREFIX = "v2"
MAX_FAILED_ATTEMPTS = 10  # por IP, dentro de FAILED_WINDOW
FAILED_WINDOW = timedelta(minutes=15)


def utcnow() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def to_iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def _signing_key(password: str, secret: str) -> bytes:
    return hashlib.sha256(f"olocation-v2\0{password}\0{secret}".encode()).digest()


def _signature(key: bytes, expires: int) -> str:
    return hmac.new(key, f"{TOKEN_PREFIX}.{expires}".encode(), hashlib.sha256).hexdigest()


def check_password(candidate: str, password: str) -> bool:
    return hmac.compare_digest(candidate.encode(), password.encode())


def issue_token(password: str, secret: str, now: datetime) -> tuple[str, datetime]:
    expires_at = now + TOKEN_TTL
    expires = int(expires_at.timestamp())
    return f"{TOKEN_PREFIX}.{expires}.{_signature(_signing_key(password, secret), expires)}", expires_at


def verify_token(token: str, password: str, secret: str, now: datetime) -> bool:
    try:
        prefix, expires_raw, signature = token.split(".")
        expires = int(expires_raw)
    except ValueError:
        return False
    if prefix != TOKEN_PREFIX or expires <= now.timestamp():
        return False
    return hmac.compare_digest(signature, _signature(_signing_key(password, secret), expires))


class FailedAttempts:
    """Cuenta contraseñas incorrectas por IP en una ventana móvil (en memoria del proceso)."""

    def __init__(self, limit: int = MAX_FAILED_ATTEMPTS, window: timedelta = FAILED_WINDOW):
        self.limit = limit
        self.window = window.total_seconds()
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._attempts[key]
        while attempts and attempts[0] <= now - self.window:
            attempts.popleft()
        return attempts

    def retry_after(self, key: str, now: float | None = None) -> int:
        """Segundos que faltan para poder volver a intentar (0 si no está bloqueado)."""
        now = time.monotonic() if now is None else now
        attempts = self._prune(key, now)
        if len(attempts) < self.limit:
            return 0
        return max(1, int(attempts[0] + self.window - now))

    def record_failure(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        self._prune(key, now).append(now)

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._attempts.clear()
        else:
            self._attempts.pop(key, None)
