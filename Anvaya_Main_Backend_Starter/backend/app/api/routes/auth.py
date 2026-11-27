from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from firebase_admin import auth as firebase_auth
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, verify_csrf_and_origin
from app.core.config import settings
from app.core.firebase import verify_firebase_id_token
from app.core.rate_limit import LoginRateLimiter, RateLimiter
from app.core.security import (
    create_access_token,
    generate_csrf_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.session import get_db
from app.models.refresh_token import RefreshToken, RefreshTokenFamily
from app.models.user import User
from app.schemas.auth import (
    FirebaseLoginRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    csrf_token: str,
) -> None:
    """Sets secure authentication cookies on the outgoing response.

    - anvaya_access_token: short-lived, HttpOnly, path="/"
    - anvaya_refresh_token: long-lived, HttpOnly, path="/api/v1/auth"
    - anvaya_csrf_token: readable by frontend (non-HttpOnly), path="/"
    """
    secure = settings.is_cookie_secure
    samesite = settings.cookie_samesite

    response.set_cookie(
        key=settings.access_cookie_name,
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
    )
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/api/v1/auth",
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=False,
        secure=secure,
        samesite=samesite,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Deletes authentication cookies with exact matching path and security attributes."""
    secure = settings.is_cookie_secure
    samesite = settings.cookie_samesite

    response.delete_cookie(
        key=settings.access_cookie_name,
        path="/",
        secure=secure,
        httponly=True,
        samesite=samesite,
    )
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/api/v1/auth",
        secure=secure,
        httponly=True,
        samesite=samesite,
    )
    response.delete_cookie(
        key=settings.csrf_cookie_name,
        path="/",
        secure=secure,
        httponly=False,
        samesite=samesite,
    )


def _create_session_tokens(
    user: User,
    response: Response,
    db: Session,
    request: Request | None = None,
) -> tuple[str, str, str]:
    """Creates a new RefreshTokenFamily, initial RefreshToken, JWT access token,

    and signed CSRF token, storing only the token hash in the database and setting cookies.
    """
    now = datetime.now(timezone.utc)
    family = RefreshTokenFamily(user_id=user.id, created_at=now, updated_at=now)
    db.add(family)
    db.flush()

    raw_refresh_token = generate_refresh_token()
    token_hash = hash_token(raw_refresh_token)
    expires_at = now + timedelta(days=settings.refresh_token_expire_days)

    client_ip = request.client.host if request and request.client else None
    user_agent = request.headers.get("user-agent", "")[:500] if request else None

    token_record = RefreshToken(
        family_id=family.id,
        user_id=user.id,
        token_hash=token_hash,
        is_revoked=False,
        expires_at=expires_at,
        created_at=now,
        created_ip=client_ip,
        user_agent=user_agent,
    )
    db.add(token_record)
    db.commit()

    access_token = create_access_token(str(user.id))
    csrf_token = generate_csrf_token(str(user.id))

    set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=raw_refresh_token,
        csrf_token=csrf_token,
    )

    return access_token, raw_refresh_token, csrf_token


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    normalized_email = str(payload.email).strip().lower()
    existing_user = db.scalar(select(User).where(User.email == normalized_email))

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    # Public self-registration always creates a patient account.
    user = User(
        full_name=payload.full_name.strip(),
        email=normalized_email,
        password_hash=hash_password(payload.password),
        role="patient",
    )

    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    access_token, _, _ = _create_session_tokens(user, response, db, request)

    return TokenResponse(
        access_token=access_token,
        user=UserPublic.model_validate(
            {**user.__dict__, "id": str(user.id)}
        ),
    )


login_rate_limiter = LoginRateLimiter(
    ip_limit=60,
    account_limit=15,
    pair_limit=10,
    window_seconds=60,
)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    login_rate_limiter.check(request, response, payload.email)
    normalized_email = str(payload.email).strip().lower()
    user = db.scalar(select(User).where(User.email == normalized_email))

    if (
        user is None
        or user.password_hash is None
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive.",
        )

    access_token, _, _ = _create_session_tokens(user, response, db, request)

    public_user = UserPublic.model_validate(
        {**user.__dict__, "id": str(user.id)}
    )

    return TokenResponse(
        access_token=access_token,
        user=public_user,
    )


@router.get("/me", response_model=UserPublic)
def read_current_user(
    current_user: User = Depends(get_current_user),
) -> UserPublic:
    return UserPublic.model_validate(
        {**current_user.__dict__, "id": str(current_user.id)}
    )


@router.post("/firebase", response_model=TokenResponse)
def firebase_login(
    payload: FirebaseLoginRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    try:
        claims = verify_firebase_id_token(payload.id_token)
    except (
        ValueError,
        firebase_auth.InvalidIdTokenError,
        firebase_auth.UserDisabledError,
        firebase_auth.UserNotFoundError,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google sign-in. Please try again.",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google authentication is temporarily unavailable.",
        )

    firebase_uid = claims.get("uid") or claims.get("sub")
    email = claims.get("email")
    email_verified = claims.get("email_verified") is True

    firebase_claims = claims.get("firebase") or {}
    sign_in_provider = firebase_claims.get("sign_in_provider")

    if (
        not isinstance(firebase_uid, str)
        or not firebase_uid
        or len(firebase_uid) > 128
        or not isinstance(email, str)
        or not email.strip()
        or not email_verified
        or sign_in_provider != "google.com"
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A verified Google account is required.",
        )

    normalized_email = email.strip().lower()

    user = db.scalar(
        select(User).where(User.firebase_uid == firebase_uid)
    )

    if user is not None:
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is inactive.",
            )

        email_owner = db.scalar(
            select(User).where(User.email == normalized_email)
        )

        if email_owner is not None and email_owner.id != user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already associated with another account.",
            )

        user.email = normalized_email

    else:
        user = db.scalar(
            select(User).where(User.email == normalized_email)
        )

        if user is not None:
            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This account is inactive.",
                )

            if user.firebase_uid and user.firebase_uid != firebase_uid:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This account is linked to a different Google identity.",
                )

            user.firebase_uid = firebase_uid

        else:
            display_name = claims.get("name")
            if not isinstance(display_name, str) or not display_name.strip():
                display_name = "Google User"

            user = User(
                full_name=display_name.strip()[:120],
                email=normalized_email,
                firebase_uid=firebase_uid,
                password_hash=None,
                role="patient",
            )
            db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        concurrent_user = db.scalar(
            select(User).where(User.firebase_uid == firebase_uid)
        )
        if (
            concurrent_user is not None
            and concurrent_user.email == normalized_email
        ):
            if not concurrent_user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This account is inactive.",
                )
            user = concurrent_user
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This account could not be linked. Please try signing in again.",
            )

    access_token, _, _ = _create_session_tokens(user, response, db, request)

    public_user = UserPublic.model_validate(
        {**user.__dict__, "id": str(user.id)}
    )

    return TokenResponse(
        access_token=access_token,
        user=public_user,
    )


def _ensure_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> TokenResponse:
    """Rotates an existing refresh token with transaction-level locking and replay detection.

    - Verifies cryptographic hash of the presented refresh token.
    - If valid, rotates to a new refresh token and issues a fresh access token.
    - If already rotated: checks whether replacement is still active (concurrent race).
      If so, rejects with HTTP 409 without destroying the legitimate session.
    - If actual replay theft detected: revokes the entire token family and forces logout.
    """
    raw_refresh_token = request.cookies.get(settings.refresh_cookie_name)
    if not raw_refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token cookie.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_hash = hash_token(raw_refresh_token)
    now = datetime.now(timezone.utc)

    # 1. Look up token record and serialize on family lock
    token_record = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == token_hash)
        .first()
    )

    if token_record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Acquire pessimistic row lock on family to serialize concurrent requests
    family = (
        db.query(RefreshTokenFamily)
        .filter(RefreshTokenFamily.id == token_record.family_id)
        .with_for_update()
        .first()
    )

    if family is None or family.is_revoked:
        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Re-read token record under family lock
    token_record = (
        db.query(RefreshToken)
        .filter(RefreshToken.id == token_record.id)
        .with_for_update()
        .first()
    )

    # Check expiration
    if _ensure_utc(token_record.expires_at) < now:
        token_record.is_revoked = True
        token_record.revoked_at = now
        token_record.revocation_reason = "expired"
        db.commit()
        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Check if token was already revoked
    if token_record.is_revoked:
        # Check if this is an in-flight concurrent race or true replay theft:
        if token_record.replaced_by_id is not None:
            replacement = (
                db.query(RefreshToken)
                .filter(RefreshToken.id == token_record.replaced_by_id)
                .first()
            )
            # If replacement exists and is NOT revoked, this token was the immediate parent
            # of the currently active session. A concurrent tab sent this request before
            # receiving the new cookie.
            if replacement is not None and not replacement.is_revoked:
                # Do NOT revoke the family! Fail closed for this request without damaging the session.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Refresh token was already rotated by a concurrent request.",
                )

        # Older ancestor or explicit logout replay: genuine replay theft attack!
        family.is_revoked = True
        family.revoked_at = now
        family.revocation_reason = "replay_detected"

        db.query(RefreshToken).filter(
            RefreshToken.family_id == family.id
        ).update(
            {
                "is_revoked": True,
                "revoked_at": now,
                "revocation_reason": "replay_detected",
            }
        )
        db.commit()

        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Replay of revoked token detected. Session terminated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Valid active token: perform rotation
    user = db.get(User, token_record.user_id)
    if user is None or not user.is_active:
        clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    new_raw_refresh_token = generate_refresh_token()
    new_token_hash = hash_token(new_raw_refresh_token)
    new_expires_at = now + timedelta(days=settings.refresh_token_expire_days)

    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")[:500]

    new_token_record = RefreshToken(
        family_id=family.id,
        user_id=user.id,
        token_hash=new_token_hash,
        is_revoked=False,
        expires_at=new_expires_at,
        created_at=now,
        created_ip=client_ip,
        user_agent=user_agent,
    )
    db.add(new_token_record)
    db.flush()

    token_record.is_revoked = True
    token_record.revoked_at = now
    token_record.revocation_reason = "rotated"
    token_record.replaced_by_id = new_token_record.id

    family.updated_at = now
    db.commit()

    # 4. Issue fresh access token and CSRF token
    new_access_token = create_access_token(str(user.id))
    new_csrf_token = generate_csrf_token(str(user.id))

    set_auth_cookies(
        response=response,
        access_token=new_access_token,
        refresh_token=new_raw_refresh_token,
        csrf_token=new_csrf_token,
    )

    public_user = UserPublic.model_validate(
        {**user.__dict__, "id": str(user.id)}
    )

    return TokenResponse(
        access_token=new_access_token,
        user=public_user,
    )


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> dict[str, str]:
    """Logs out the user, revoking the current refresh token family and clearing all auth cookies."""
    raw_refresh_token = request.cookies.get(settings.refresh_cookie_name)
    now = datetime.now(timezone.utc)

    if raw_refresh_token:
        token_hash = hash_token(raw_refresh_token)
        token_record = (
            db.query(RefreshToken)
            .filter(RefreshToken.token_hash == token_hash)
            .first()
        )
        if token_record:
            family = db.get(RefreshTokenFamily, token_record.family_id)
            if family:
                family.is_revoked = True
                family.revoked_at = now
                family.revocation_reason = "logout"

            db.query(RefreshToken).filter(
                RefreshToken.family_id == token_record.family_id
            ).update(
                {
                    "is_revoked": True,
                    "revoked_at": now,
                    "revocation_reason": "logout",
                }
            )
            db.commit()

    clear_auth_cookies(response)
    return {"detail": "Logged out successfully."}


@router.post("/revoke-all")
def revoke_all_sessions(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> dict[str, str]:
    """Revokes all active sessions and refresh token families for the authenticated user."""
    now = datetime.now(timezone.utc)

    db.query(RefreshTokenFamily).filter(
        RefreshTokenFamily.user_id == current_user.id
    ).update(
        {
            "is_revoked": True,
            "revoked_at": now,
            "revocation_reason": "revoked_all",
        }
    )

    db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id
    ).update(
        {
            "is_revoked": True,
            "revoked_at": now,
            "revocation_reason": "revoked_all",
        }
    )
    db.commit()

    clear_auth_cookies(response)
    return {"detail": "All sessions have been revoked."}
