import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL = timedelta(days=30)
MAX_FAILED_ATTEMPTS = 5
LOCKOUT = timedelta(minutes=15)


def utcnow() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def to_iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def from_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str | None) -> bool:
    if not stored:
        return False
    _, iterations, salt, expected = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
