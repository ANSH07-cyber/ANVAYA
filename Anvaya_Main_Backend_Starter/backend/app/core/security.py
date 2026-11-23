from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


def create_access_token(subject: str) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {"sub": subject, "exp": expires_at, "iat": now}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def generate_refresh_token() -> str:
    """Generates a cryptographically secure opaque refresh token (64 bytes entropy)."""
    return secrets.token_urlsafe(64)


def hash_token(raw_token: str) -> str:
    """Computes SHA-256 hex digest of a raw token. Only hashes are stored in the database."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_csrf_token(user_id: str | None = None) -> str:
    """Generates a cryptographically signed, session-bound anti-CSRF token."""
    nonce = secrets.token_urlsafe(32)
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    payload = f"{nonce}:{timestamp}:{user_id or ''}"
    signature = hmac.new(
        settings.csrf_secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}:{signature}"


def verify_csrf_token(
    token: str,
    expected_user_id: str | None = None,
    max_age_seconds: int = 86400,
) -> bool:
    """Verifies HMAC signature, timestamp freshness, and optional user binding of a CSRF token."""
    if not token or not isinstance(token, str):
        return False

    parts = token.split(":")
    if len(parts) != 4:
        return False

    nonce, ts_str, bound_user_id, signature = parts
    payload = f"{nonce}:{ts_str}:{bound_user_id}"

    expected_signature = hmac.new(
        settings.csrf_secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_signature):
        return False

    try:
        ts = int(ts_str)
        now = int(datetime.now(timezone.utc).timestamp())
        if now - ts > max_age_seconds or ts > now + 300:  # Allow 5min clock skew into future
            return False
    except (ValueError, TypeError):
        return False

    if expected_user_id and bound_user_id and bound_user_id != expected_user_id:
        return False

    return True

