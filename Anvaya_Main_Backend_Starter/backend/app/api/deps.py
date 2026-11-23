import hmac
from urllib.parse import urlparse
import uuid
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token, verify_csrf_token
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Authenticates the user via either HttpOnly access cookie or Bearer token header.

    If both are supplied with conflicting identities, rejects with HTTP 400 Bad Request
    to prevent identity spoofing / token smuggling.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid authentication token.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    cookie_token = request.cookies.get(settings.access_cookie_name)
    bearer_token = credentials.credentials if credentials else None

    if not cookie_token and not bearer_token:
        raise unauthorized

    cookie_sub: str | None = None
    bearer_sub: str | None = None

    if cookie_token:
        try:
            cookie_payload = decode_access_token(cookie_token)
            cookie_sub = cookie_payload.get("sub")
            if not cookie_sub:
                raise unauthorized
        except (jwt.InvalidTokenError, TypeError):
            if not bearer_token:
                raise unauthorized
            # If bearer is present but cookie is invalid, reject due to ambiguous/tampered credentials
            raise unauthorized

    if bearer_token:
        try:
            bearer_payload = decode_access_token(bearer_token)
            bearer_sub = bearer_payload.get("sub")
            if not bearer_sub:
                raise unauthorized
        except (jwt.InvalidTokenError, TypeError):
            if not cookie_token:
                raise unauthorized
            raise unauthorized

    # Ambiguity and conflict check
    if cookie_sub and bearer_sub:
        if cookie_sub != bearer_sub:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ambiguous or conflicting authentication credentials.",
            )
        subject = cookie_sub
        request.state.auth_transport = "cookie"
    elif cookie_sub:
        subject = cookie_sub
        request.state.auth_transport = "cookie"
    else:
        subject = bearer_sub
        request.state.auth_transport = "bearer"

    try:
        user_id = UUID(subject)
    except (ValueError, TypeError):
        raise unauthorized

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized

    request.state.current_user = user
    return user


def require_roles(*allowed_roles: str):
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource.",
            )
        return current_user

    return role_checker


def verify_csrf_and_origin(request: Request) -> None:
    """Enforces strict Origin/Referer verification and Double-Submit CSRF token validation

    for state-changing requests authenticated via cookies.
    Bearer-only requests and safe HTTP methods (GET, HEAD, OPTIONS) are exempt.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return

    cookie_token = request.cookies.get(settings.access_cookie_name)
    refresh_cookie = request.cookies.get(settings.refresh_cookie_name)

    # Pure Bearer requests without cookies do not require CSRF protection
    if not cookie_token and not refresh_cookie:
        return

    # 1. Strict Origin / Referer validation
    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")

    request_origin = None
    if origin:
        request_origin = origin.rstrip("/")
    elif referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            request_origin = f"{parsed.scheme}://{parsed.netloc}"

    allowed_origins = {o.rstrip("/") for o in settings.cors_origin_list}

    if not request_origin or request_origin not in allowed_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-origin request rejected: invalid or missing Origin.",
        )

    # 2. CSRF Token validation
    csrf_cookie = request.cookies.get(settings.csrf_cookie_name)
    csrf_header = request.headers.get(settings.csrf_header_name)

    if not csrf_cookie or not csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing CSRF token in request cookie or header.",
        )

    if not hmac.compare_digest(csrf_cookie, csrf_header):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token mismatch between cookie and header.",
        )

    if not verify_csrf_token(csrf_cookie):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired CSRF token signature.",
        )
