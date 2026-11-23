from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token, hash_password, hash_token
from app.models.refresh_token import RefreshToken, RefreshTokenFamily
from app.models.user import User


@pytest.fixture
def auth_user(db_session):
    user = User(
        full_name="Cookie Auth User",
        email="cookie.auth@example.com",
        password_hash=hash_password("Password@12345"),
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def other_user(db_session):
    user = User(
        full_name="Other User",
        email="other.user@example.com",
        password_hash=hash_password("Password@12345"),
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


# =====================================================================
# 1. LOGIN SETS HTTPONLY COOKIES & RETURNS TOKEN RESPONSE
# =====================================================================

def test_login_sets_cookies_and_tokens(client, auth_user, db_session):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    assert response.status_code == 200
    data = response.json()

    # Bearer response contract preserved for existing clients
    assert "access_token" in data
    assert data["token_type"].lower() == "bearer"
    assert data["user"]["email"] == auth_user.email

    # Cookies must be present
    assert settings.access_cookie_name in response.cookies
    assert settings.refresh_cookie_name in response.cookies
    assert settings.csrf_cookie_name in response.cookies

    # Refresh token in DB must ONLY be stored as a SHA-256 hash (64 hex characters)
    raw_refresh = response.cookies[settings.refresh_cookie_name]
    expected_hash = hash_token(raw_refresh)

    token_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == expected_hash)
    )
    assert token_record is not None
    assert token_record.token_hash != raw_refresh
    assert len(token_record.token_hash) == 64
    assert token_record.is_revoked is False


# =====================================================================
# 2. REFRESH TOKEN ROTATION SUCCESS
# =====================================================================

def test_refresh_rotation_success(client, auth_user, db_session):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    assert login_res.status_code == 200
    initial_refresh = login_res.cookies[settings.refresh_cookie_name]
    initial_csrf = login_res.cookies[settings.csrf_cookie_name]
    initial_hash = hash_token(initial_refresh)

    # Perform refresh
    refresh_res = client.post(
        "/api/v1/auth/refresh",
        cookies={
            settings.refresh_cookie_name: initial_refresh,
            settings.csrf_cookie_name: initial_csrf,
        },
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": initial_csrf,
        },
    )
    assert refresh_res.status_code == 200
    refresh_data = refresh_res.json()
    assert "access_token" in refresh_data

    # Old token must be marked rotated with replaced_by_id
    old_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == initial_hash)
    )
    assert old_record.is_revoked is True
    assert old_record.revocation_reason == "rotated"
    assert old_record.replaced_by_id is not None

    # New token must be active in the same family
    new_refresh = refresh_res.cookies[settings.refresh_cookie_name]
    assert new_refresh != initial_refresh
    new_hash = hash_token(new_refresh)

    new_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == new_hash)
    )
    assert new_record is not None
    assert new_record.id == old_record.replaced_by_id
    assert new_record.family_id == old_record.family_id
    assert new_record.is_revoked is False


# =====================================================================
# 3. CONCURRENT REFRESH HANDLING (DOES NOT ACCIDENTALLY REVOKE SESSIONS)
# =====================================================================

def test_concurrent_refresh_handling_does_not_revoke_family(client, auth_user, db_session):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    initial_refresh = login_res.cookies[settings.refresh_cookie_name]
    initial_csrf = login_res.cookies[settings.csrf_cookie_name]

    # First request: rotates token A -> token B
    res1 = client.post(
        "/api/v1/auth/refresh",
        cookies={
            settings.refresh_cookie_name: initial_refresh,
            settings.csrf_cookie_name: initial_csrf,
        },
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": initial_csrf,
        },
    )
    assert res1.status_code == 200
    token_b_refresh = res1.cookies[settings.refresh_cookie_name]
    token_b_csrf = res1.cookies[settings.csrf_cookie_name]

    # Second concurrent in-flight request presenting token A:
    # Clear and set client cookies to simulate what Tab B sent before Tab A's response arrived
    client.cookies.clear()
    client.cookies.set(settings.refresh_cookie_name, initial_refresh, path="/")
    client.cookies.set(settings.csrf_cookie_name, initial_csrf, path="/")

    res2 = client.post(
        "/api/v1/auth/refresh",
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": initial_csrf,
        },
    )
    assert res2.status_code == 409
    assert "concurrent request" in res2.json()["detail"].lower()

    # Verify family is STILL active and NOT revoked!
    token_b_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(token_b_refresh))
    )
    assert token_b_record is not None
    assert token_b_record.is_revoked is False

    family = db_session.get(RefreshTokenFamily, token_b_record.family_id)
    assert family.is_revoked is False

    # Legitimate token B can now be rotated to token C smoothly
    client.cookies.clear()
    client.cookies.set(settings.refresh_cookie_name, token_b_refresh, path="/")
    client.cookies.set(settings.csrf_cookie_name, token_b_csrf, path="/")

    res3 = client.post(
        "/api/v1/auth/refresh",
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": token_b_csrf,
        },
    )
    assert res3.status_code == 200


# =====================================================================
# 4. REPLAY THEFT DETECTION (REVOKES ENTIRE TOKEN FAMILY)
# =====================================================================

def test_replay_attack_revokes_entire_family(client, auth_user, db_session):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    token_a = login_res.cookies[settings.refresh_cookie_name]
    csrf_a = login_res.cookies[settings.csrf_cookie_name]

    # Rotate Token A -> Token B
    res1 = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: token_a, settings.csrf_cookie_name: csrf_a},
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": csrf_a},
    )
    assert res1.status_code == 200
    token_b = res1.cookies[settings.refresh_cookie_name]
    csrf_b = res1.cookies[settings.csrf_cookie_name]

    # Rotate Token B -> Token C
    res2 = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: token_b, settings.csrf_cookie_name: csrf_b},
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": csrf_b},
    )
    assert res2.status_code == 200
    token_c = res2.cookies[settings.refresh_cookie_name]
    csrf_c = res2.cookies[settings.csrf_cookie_name]

    # At this point, Token A's replacement (Token B) has ALREADY been rotated and revoked!
    # If an attacker replays Token A now, it is definitively a replay theft attack!
    client.cookies.set(settings.refresh_cookie_name, token_a)
    client.cookies.set(settings.csrf_cookie_name, csrf_c)

    replay_res = client.post(
        "/api/v1/auth/refresh",
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": csrf_c},
    )
    assert replay_res.status_code == 401
    assert "replay" in replay_res.json()["detail"].lower()

    # The entire family must now be revoked
    token_c_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(token_c))
    )
    family = db_session.get(RefreshTokenFamily, token_c_record.family_id)
    assert family.is_revoked is True
    assert family.revocation_reason == "replay_detected"

    # Token C can no longer be refreshed because the whole session is terminated
    res4 = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: token_c, settings.csrf_cookie_name: csrf_c},
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": csrf_c},
    )
    assert res4.status_code == 401


# =====================================================================
# 5. LOGOUT REVOKES FAMILY & CLEARS COOKIES
# =====================================================================

def test_logout_revokes_family_and_clears_cookies(client, auth_user, db_session):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    refresh_token = login_res.cookies[settings.refresh_cookie_name]
    csrf_token = login_res.cookies[settings.csrf_cookie_name]

    logout_res = client.post(
        "/api/v1/auth/logout",
        cookies={
            settings.refresh_cookie_name: refresh_token,
            settings.csrf_cookie_name: csrf_token,
        },
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": csrf_token,
        },
    )
    assert logout_res.status_code == 200

    # Family must be revoked with reason 'logout'
    token_record = db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
    )
    family = db_session.get(RefreshTokenFamily, token_record.family_id)
    assert family.is_revoked is True
    assert family.revocation_reason == "logout"

    # Subsequent refresh with that token must be rejected
    res_after = client.post(
        "/api/v1/auth/refresh",
        cookies={
            settings.refresh_cookie_name: refresh_token,
            settings.csrf_cookie_name: csrf_token,
        },
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": csrf_token,
        },
    )
    assert res_after.status_code == 401


# =====================================================================
# 6. REVOKE ALL SESSIONS
# =====================================================================

def test_revoke_all_sessions(client, auth_user, db_session):
    # Session 1
    res1 = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    # Session 2
    res2 = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )

    token1 = res1.cookies[settings.refresh_cookie_name]
    token2 = res2.cookies[settings.refresh_cookie_name]
    access2 = res2.cookies[settings.access_cookie_name]
    csrf2 = res2.cookies[settings.csrf_cookie_name]

    # Call revoke-all
    revoke_res = client.post(
        "/api/v1/auth/revoke-all",
        cookies={
            settings.access_cookie_name: access2,
            settings.csrf_cookie_name: csrf2,
        },
        headers={
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": csrf2,
        },
    )
    assert revoke_res.status_code == 200

    # Both families must be marked revoked
    rec1 = db_session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token1)))
    rec2 = db_session.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(token2)))

    fam1 = db_session.get(RefreshTokenFamily, rec1.family_id)
    fam2 = db_session.get(RefreshTokenFamily, rec2.family_id)
    assert fam1.is_revoked is True
    assert fam2.is_revoked is True


# =====================================================================
# 7. CSRF & ORIGIN PROTECTION
# =====================================================================

def test_cookie_mutations_require_valid_csrf_and_origin(client, auth_user):
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": auth_user.email, "password": "Password@12345"},
    )
    refresh_token = login_res.cookies[settings.refresh_cookie_name]
    csrf_token = login_res.cookies[settings.csrf_cookie_name]

    # Missing X-CSRF-Token header -> 403 Forbidden
    res_no_header = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: refresh_token, settings.csrf_cookie_name: csrf_token},
        headers={"Origin": "http://localhost:5173"},
    )
    assert res_no_header.status_code == 403
    assert "missing csrf token" in res_no_header.json()["detail"].lower()

    # Mismatched X-CSRF-Token header -> 403 Forbidden
    res_mismatch = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: refresh_token, settings.csrf_cookie_name: csrf_token},
        headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "tampered-csrf-token"},
    )
    assert res_mismatch.status_code == 403

    # Disallowed untrusted Origin -> 403 Forbidden
    res_evil_origin = client.post(
        "/api/v1/auth/refresh",
        cookies={settings.refresh_cookie_name: refresh_token, settings.csrf_cookie_name: csrf_token},
        headers={"Origin": "https://evil-attacker.example.com", "X-CSRF-Token": csrf_token},
    )
    assert res_evil_origin.status_code == 403
    assert "cross-origin" in res_evil_origin.json()["detail"].lower()


# =====================================================================
# 8. BEARER AUTHENTICATION PRESERVED (EXEMPT FROM CSRF)
# =====================================================================

def test_bearer_authentication_preserved_without_csrf(client, auth_user):
    token = create_access_token(str(auth_user.id))

    # Pure Bearer request to protected endpoint without cookies succeeds with 200
    res = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == auth_user.email


# =====================================================================
# 9. CONFLICTING COOKIE AND BEARER IDENTITIES REJECTED (HTTP 400)
# =====================================================================

def test_conflicting_cookie_and_bearer_identities_rejected(client, auth_user, other_user):
    user1_access = create_access_token(str(auth_user.id))
    user2_access = create_access_token(str(other_user.id))

    # Request with Cookie for User 1 and Bearer for User 2 -> 400 Bad Request
    res = client.get(
        "/api/v1/auth/me",
        cookies={settings.access_cookie_name: user1_access},
        headers={"Authorization": f"Bearer {user2_access}"},
    )
    assert res.status_code == 400
    assert "ambiguous or conflicting" in res.json()["detail"].lower()


# =====================================================================
# 10. MATCHING COOKIE AND BEARER IDENTITIES ACCEPTED
# =====================================================================

def test_matching_cookie_and_bearer_identities_accepted(client, auth_user):
    user_access = create_access_token(str(auth_user.id))

    res = client.get(
        "/api/v1/auth/me",
        cookies={settings.access_cookie_name: user_access},
        headers={"Authorization": f"Bearer {user_access}"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == auth_user.email
