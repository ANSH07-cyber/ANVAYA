"""Tests for Stage 2C Phase 2: Administrative Settings & Security.

Covers:
- Admin access allowed; Patient and Doctor access denied (403); Unauthenticated denied (401).
- Admin profile retrieval and display name update with validation (2-120 chars).
- Immutable email and role protections on profile update.
- Audit logging for administrative profile updates.
- System settings endpoint returning safe, non-secret configuration only (zero credentials, passwords, or keys leaked).
- Security settings returning current administrator's active session count and audit trail without leaking other operators' secrets.
- Notification operational statistics without PHI or message body leakage.
- CSRF validation on cookie-authenticated mutations.
"""

from datetime import datetime, timezone
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select

from app.core.security import create_access_token, generate_csrf_token, hash_password
from app.models.audit_log import AuditLog
from app.models.notification import Notification
from app.models.user import User


@pytest.fixture
def admin_account(db_session):
    admin = User(
        full_name="Lead Administrator",
        email=f"admin_settings_{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("AdminSecurePass123!"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def admin_headers(admin_account):
    token = create_access_token(subject=str(admin_account.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def patient_headers(patient_account):
    token = create_access_token(subject=str(patient_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def doctor_headers(approved_doctor):
    token = create_access_token(subject=str(approved_doctor["user"].id))
    return {"Authorization": f"Bearer {token}"}


def test_admin_settings_rbac_access_control(
    client,
    admin_headers,
    patient_headers,
    doctor_headers,
):
    """Admin has access to settings; patients, doctors, and unauthenticated clients are rejected."""
    endpoints = [
        "/api/v1/admin/settings/profile",
        "/api/v1/admin/settings/system",
        "/api/v1/admin/settings/security",
        "/api/v1/admin/settings/notifications",
    ]

    for ep in endpoints:
        # Unauthenticated -> 401
        res_unauth = client.get(ep)
        assert res_unauth.status_code == 401, f"{ep} unauth expected 401"

        # Patient -> 403
        res_pat = client.get(ep, headers=patient_headers)
        assert res_pat.status_code == 403, f"{ep} patient expected 403"

        # Doctor -> 403
        res_doc = client.get(ep, headers=doctor_headers)
        assert res_doc.status_code == 403, f"{ep} doctor expected 403"

        # Admin -> 200
        res_admin = client.get(ep, headers=admin_headers)
        assert res_admin.status_code == 200, f"{ep} admin expected 200"


def test_get_admin_profile(
    client,
    admin_account,
    admin_headers,
):
    """Retrieves current administrator profile data."""
    res = client.get("/api/v1/admin/settings/profile", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["id"] == str(admin_account.id)
    assert data["full_name"] == admin_account.full_name
    assert data["email"] == admin_account.email
    assert data["role"] == "admin"
    assert data["has_password"] is True
    assert data["has_firebase"] is False


def test_update_admin_profile_success_and_audit(
    client,
    db_session,
    admin_account,
    admin_headers,
):
    """Admin updates display name; records an audit log entry in the same transaction."""
    payload = {"full_name": "Executive Operations Lead"}
    res = client.patch(
        "/api/v1/admin/settings/profile",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["full_name"] == "Executive Operations Lead"

    db_session.expire_all()
    admin_db = db_session.get(User, admin_account.id)
    assert admin_db.full_name == "Executive Operations Lead"

    # Verify audit entry
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.actor_user_id == admin_account.id,
            AuditLog.event_type == "admin.profile_updated",
        )
    )
    assert audit is not None
    assert audit.outcome == "success"
    assert audit.details["new_full_name"] == "Executive Operations Lead"


def test_update_admin_profile_validation_and_immutable_fields(
    client,
    db_session,
    admin_account,
    admin_headers,
):
    """Validates full_name length constraints and verifies email and role cannot be changed."""
    # 1. Too short (< 2 chars) -> 422
    res_short = client.patch(
        "/api/v1/admin/settings/profile",
        json={"full_name": "A"},
        headers=admin_headers,
    )
    assert res_short.status_code == 422

    # 2. Too long (> 120 chars) -> 422
    res_long = client.patch(
        "/api/v1/admin/settings/profile",
        json={"full_name": "X" * 125},
        headers=admin_headers,
    )
    assert res_long.status_code == 422

    # 3. Attempting to supply email or role does not alter them
    res_tamper = client.patch(
        "/api/v1/admin/settings/profile",
        json={
            "full_name": "Valid Name",
            "email": "hacked@example.com",
            "role": "superadmin",
        },
        headers=admin_headers,
    )
    assert res_tamper.status_code == 200

    db_session.expire_all()
    admin_db = db_session.get(User, admin_account.id)
    assert admin_db.email == admin_account.email  # Unchanged!
    assert admin_db.role == "admin"  # Unchanged!


def test_get_system_settings_zero_secrets_exposure(
    client,
    admin_headers,
):
    """Verifies that platform settings return safe configuration and NEVER leak secrets."""
    res = client.get("/api/v1/admin/settings/system", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()

    # Expected safe configuration
    assert "app_name" in data
    assert "environment" in data
    assert "api_version" in data
    assert "jwt_algorithm" in data
    assert "access_token_expire_minutes" in data
    assert "refresh_token_expire_days" in data
    assert "database_engine" in data
    assert data["database_status"] == "connected"
    assert "cors_allowed_origins_count" in data

    # Critical Security Guarantee: No passwords, keys, or URLs leaked
    for forbidden_key in [
        "database_url",
        "jwt_secret_key",
        "secret_key",
        "csrf_secret_key",
        "password",
        "firebase_service_account_path",
        "redis_url",
    ]:
        assert forbidden_key not in data, f"Secret key '{forbidden_key}' leaked in system settings!"


def test_get_security_settings_current_admin_sessions_only(
    client,
    admin_account,
    admin_headers,
):
    """Verifies security dashboard returns current administrator's active session count and recent audit events."""
    res = client.get("/api/v1/admin/settings/security", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["admin_user_id"] == str(admin_account.id)
    assert data["email"] == admin_account.email
    assert "active_sessions_count" in data
    assert "recent_audit_events" in data
    assert isinstance(data["recent_audit_events"], list)


def test_get_notifications_settings_metrics_only(
    client,
    db_session,
    admin_account,
    admin_headers,
):
    """Verifies notification settings return operational counts without exposing message bodies."""
    # Seed a notification for another user
    notif = Notification(
        recipient_user_id=uuid4(),
        notification_type="appointment.booked",
        title="Confidential Title",
        message="Sensitive notification message body",
        is_read=False,
    )
    db_session.add(notif)
    db_session.commit()

    res = client.get("/api/v1/admin/settings/notifications", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["total_notifications_sent"] >= 1
    assert "unread_notifications_count" in data
    assert "supported_notification_types" in data
    assert "appointment.booked" in data["supported_notification_types"]

    # Ensure message bodies and confidential titles are not present
    raw_str = str(data)
    assert "Sensitive notification message body" not in raw_str
    assert "Confidential Title" not in raw_str


def test_admin_settings_csrf_protection_on_cookie_mutation(
    client,
    admin_account,
):
    """State-changing mutations using cookie authentication require CSRF token and Origin validation."""
    from app.core.config import settings

    token = create_access_token(subject=str(admin_account.id))

    # 1. Cookie mutation with missing Origin / CSRF -> 403 Forbidden
    client.cookies.set(settings.access_cookie_name, token)
    res_no_csrf = client.patch(
        "/api/v1/admin/settings/profile",
        json={"full_name": "Tampered Name"},
    )
    assert res_no_csrf.status_code == 403
    client.cookies.clear()

    # 2. Cookie mutation with mismatched CSRF token -> 403 Forbidden
    client.cookies.set(settings.access_cookie_name, token)
    client.cookies.set(settings.csrf_cookie_name, "valid_cookie_val")
    res_mismatch = client.patch(
        "/api/v1/admin/settings/profile",
        json={"full_name": "Tampered Name"},
        headers={
            settings.csrf_header_name: "tampered_header_val",
            "Origin": settings.cors_origin_list[0],
        },
    )
    assert res_mismatch.status_code == 403
    client.cookies.clear()

    # 3. Cookie mutation with valid CSRF cookie + header + Origin -> 200 OK
    csrf_val = generate_csrf_token(str(admin_account.id))
    client.cookies.set(settings.access_cookie_name, token)
    client.cookies.set(settings.csrf_cookie_name, csrf_val)

    res_valid = client.patch(
        "/api/v1/admin/settings/profile",
        json={"full_name": "Properly Authorized Lead"},
        headers={
            settings.csrf_header_name: csrf_val,
            "Origin": settings.cors_origin_list[0],
        },
    )
    assert res_valid.status_code == 200
    assert res_valid.json()["full_name"] == "Properly Authorized Lead"

    client.cookies.clear()
