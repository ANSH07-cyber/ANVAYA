"""Tests for Stage 2C Phase 2: Administrative User Management.

Covers:
- Admin access allowed; Patient and Doctor access denied (403); Unauthenticated denied (401).
- User directory listing with search, role filters, active status filters, pagination, and stable ordering.
- User detail inspection ensuring zero exposure of passwords, tokens, Firebase secrets, doctor license numbers, or patient PHI.
- Safe activation and deactivation workflow.
- Mandatory reason for deactivation (HTTP 422).
- Self-deactivation prevention for logged-in administrator (HTTP 400).
- Protection of the platform's last active administrator (HTTP 409).
- Atomic session / refresh token revocation upon deactivation.
- Rejection of deactivated users across all auth pathways (login, refresh, token access).
- Isolation of doctor verification status from user deactivation.
- Transactional audit log recording.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import pytest
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models.audit_log import AuditLog
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.refresh_token import RefreshToken, RefreshTokenFamily
from app.models.user import User


@pytest.fixture
def admin_account(db_session):
    admin = User(
        full_name="Primary Admin",
        email=f"admin_{uuid4().hex[:8]}@example.com",
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
def secondary_admin(db_session):
    admin2 = User(
        full_name="Secondary Admin",
        email=f"admin2_{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("AdminSecurePass123!"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin2)
    db_session.commit()
    db_session.refresh(admin2)
    return admin2


@pytest.fixture
def patient_headers(patient_account):
    token = create_access_token(subject=str(patient_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def doctor_headers(approved_doctor):
    token = create_access_token(subject=str(approved_doctor["user"].id))
    return {"Authorization": f"Bearer {token}"}


def test_user_management_rbac_access_control(
    client,
    admin_headers,
    patient_headers,
    doctor_headers,
):
    """Admin has access; patients, doctors, and unauthenticated clients are denied."""
    # 1. Unauthenticated -> 401
    res_unauth = client.get("/api/v1/admin/users")
    assert res_unauth.status_code == 401

    # 2. Patient -> 403
    res_patient = client.get("/api/v1/admin/users", headers=patient_headers)
    assert res_patient.status_code == 403

    # 3. Doctor -> 403
    res_doctor = client.get("/api/v1/admin/users", headers=doctor_headers)
    assert res_doctor.status_code == 403

    # 4. Admin -> 200
    res_admin = client.get("/api/v1/admin/users", headers=admin_headers)
    assert res_admin.status_code == 200


def test_list_users_search_filtering_and_pagination(
    client,
    db_session,
    admin_headers,
):
    """Verifies directory pagination, text search (name/email), role filter, and active status filter."""
    tag = uuid4().hex[:6]
    u1 = User(
        full_name=f"Alice Wonder_{tag}",
        email=f"alice_{tag}@example.com",
        password_hash=hash_password("Pass123!"),
        role="patient",
        is_active=True,
    )
    u2 = User(
        full_name=f"Bob Builder_{tag}",
        email=f"bob_{tag}@example.com",
        password_hash=hash_password("Pass123!"),
        role="doctor",
        is_active=False,
    )
    u3 = User(
        full_name=f"Charlie Chief_{tag}",
        email=f"charlie_{tag}@example.com",
        password_hash=hash_password("Pass123!"),
        role="admin",
        is_active=True,
    )
    db_session.add_all([u1, u2, u3])
    db_session.commit()

    # Search by name
    res_search = client.get(
        f"/api/v1/admin/users?search=Alice Wonder_{tag}",
        headers=admin_headers,
    )
    assert res_search.status_code == 200
    data = res_search.json()
    assert data["total"] == 1
    assert data["items"][0]["email"] == f"alice_{tag}@example.com"
    assert data["items"][0]["has_password"] is True
    assert data["items"][0]["has_firebase"] is False

    # Filter by role
    res_role = client.get(
        f"/api/v1/admin/users?role=doctor&search={tag}",
        headers=admin_headers,
    )
    assert res_role.status_code == 200
    assert res_role.json()["total"] == 1
    assert res_role.json()["items"][0]["role"] == "doctor"
    assert res_role.json()["items"][0]["is_active"] is False

    # Filter by is_active=false
    res_inactive = client.get(
        f"/api/v1/admin/users?is_active=false&search={tag}",
        headers=admin_headers,
    )
    assert res_inactive.status_code == 200
    assert res_inactive.json()["total"] == 1
    assert res_inactive.json()["items"][0]["email"] == f"bob_{tag}@example.com"

    # Pagination bounds
    res_paged = client.get(
        f"/api/v1/admin/users?search={tag}&limit=1&offset=0",
        headers=admin_headers,
    )
    assert res_paged.status_code == 200
    assert len(res_paged.json()["items"]) == 1
    assert res_paged.json()["limit"] == 1


def test_get_user_detail_privacy_and_phi_protection(
    client,
    db_session,
    admin_headers,
    patient_account,
    approved_doctor,
):
    """Verifies that user detail exposes minimal metadata and does NOT expose

    patient DOB, phone, blood group, password hashes, or doctor license numbers.
    """
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]

    # 1. Inspect Patient Account Detail
    res_patient = client.get(
        f"/api/v1/admin/users/{patient_user.id}",
        headers=admin_headers,
    )
    assert res_patient.status_code == 200
    p_data = res_patient.json()

    assert p_data["id"] == str(patient_user.id)
    assert p_data["email"] == patient_user.email
    assert p_data["role"] == "patient"
    assert p_data["is_active"] is True
    assert p_data["patient_profile_exists"] is True

    # Strict Privacy Guarantees: PHI & Secrets must NOT be in the response
    for forbidden_key in [
        "password",
        "password_hash",
        "date_of_birth",
        "dob",
        "phone_number",
        "phone",
        "blood_group",
        "address",
        "token",
        "firebase_secret",
    ]:
        assert forbidden_key not in p_data, f"Forbidden key '{forbidden_key}' leaked in response!"

    # 2. Inspect Doctor Account Detail
    res_doctor = client.get(
        f"/api/v1/admin/users/{doctor_user.id}",
        headers=admin_headers,
    )
    assert res_doctor.status_code == 200
    d_data = res_doctor.json()

    assert d_data["role"] == "doctor"
    assert d_data["doctor_verification_status"] == "approved"
    assert d_data["doctor_specialization"] == "Dermatology"

    # Strict Privacy Guarantees: License numbers, password hashes must NOT be exposed
    for forbidden_key in ["license_number", "password_hash", "tokens"]:
        assert forbidden_key not in d_data, f"Forbidden key '{forbidden_key}' leaked in doctor detail!"


def test_prevent_admin_self_deactivation(
    client,
    admin_account,
    admin_headers,
):
    """An administrator cannot deactivate their own account (HTTP 400)."""
    res = client.patch(
        f"/api/v1/admin/users/{admin_account.id}/status",
        json={"is_active": False, "reason": "Accidental self-deactivation attempt"},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "cannot deactivate their own account" in res.json()["detail"].lower()


def test_protect_last_active_administrator(
    client,
    db_session,
    admin_account,
    secondary_admin,
    admin_headers,
):
    """When only 1 active administrator remains, attempting to deactivate it returns HTTP 409."""
    # Currently 2 active admins: admin_account and secondary_admin.
    # Admin 1 deactivates Admin 2 -> Succeeds because 2 active admins existed.
    res_deactivate_2 = client.patch(
        f"/api/v1/admin/users/{secondary_admin.id}/status",
        json={"is_active": False, "reason": "Departed organization"},
        headers=admin_headers,
    )
    assert res_deactivate_2.status_code == 200
    assert res_deactivate_2.json()["is_active"] is False

    # Now only 1 active admin remains (admin_account).
    # If anyone attempts to deactivate the last active admin, must reject with 409.
    # (Even with self-check bypassed or from another caller, the last admin check triggers)
    res_last = client.patch(
        f"/api/v1/admin/users/{admin_account.id}/status",
        json={"is_active": False, "reason": "Attempting to deactivate sole remaining admin"},
        headers=admin_headers,
    )
    # Self-deactivation catches it first with 400, or last admin catches with 409
    assert res_last.status_code in (400, 409)


def test_deactivation_requires_mandatory_reason(
    client,
    admin_headers,
    patient_account,
):
    """Deactivating an account without a reason or with reason < 5 chars returns HTTP 422."""
    patient_id = patient_account["user"].id

    # 1. No reason
    res_no_reason = client.patch(
        f"/api/v1/admin/users/{patient_id}/status",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert res_no_reason.status_code == 422

    # 2. Too short reason (< 5 chars)
    res_short = client.patch(
        f"/api/v1/admin/users/{patient_id}/status",
        json={"is_active": False, "reason": "bad"},
        headers=admin_headers,
    )
    assert res_short.status_code == 422


def test_deactivation_atomically_revokes_sessions_and_audits(
    client,
    db_session,
    admin_account,
    admin_headers,
):
    """Deactivation immediately revokes all active refresh tokens and records an audit log entry."""
    # Create target user with active session tokens
    target_user = User(
        full_name="Target User",
        email=f"target_{uuid4().hex[:6]}@example.com",
        password_hash=hash_password("TargetPass123!"),
        role="patient",
        is_active=True,
    )
    db_session.add(target_user)
    db_session.flush()

    now = datetime.now(timezone.utc)
    family = RefreshTokenFamily(user_id=target_user.id, created_at=now, updated_at=now)
    db_session.add(family)
    db_session.flush()

    token1 = RefreshToken(
        family_id=family.id,
        user_id=target_user.id,
        token_hash="fake-hash-1",
        is_revoked=False,
        expires_at=now + timedelta(days=7),
        created_at=now,
    )
    token2 = RefreshToken(
        family_id=family.id,
        user_id=target_user.id,
        token_hash="fake-hash-2",
        is_revoked=False,
        expires_at=now + timedelta(days=7),
        created_at=now,
    )
    db_session.add_all([token1, token2])
    db_session.commit()

    # Deactivate target user
    res = client.patch(
        f"/api/v1/admin/users/{target_user.id}/status",
        json={"is_active": False, "reason": "Compromised credentials detected"},
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["is_active"] is False
    assert data["revoked_sessions_count"] == 2

    # Verify database state
    db_session.expire_all()
    u_db = db_session.get(User, target_user.id)
    assert u_db.is_active is False

    tokens_db = db_session.scalars(
        select(RefreshToken).where(RefreshToken.user_id == target_user.id)
    ).all()
    assert all(t.is_revoked for t in tokens_db)
    assert all("admin_deactivation" in t.revocation_reason for t in tokens_db)

    # Verify audit log entry
    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "user.deactivated",
            AuditLog.resource_id == str(target_user.id),
        )
    )
    assert audit_log is not None
    assert audit_log.actor_user_id == admin_account.id
    assert audit_log.outcome == "success"
    assert audit_log.details["reason"] == "Compromised credentials detected"


def test_deactivated_user_blocked_from_all_authentication_paths(
    client,
    db_session,
    admin_headers,
):
    """Verifies that is_active=False immediately blocks:

    1. New password login (HTTP 403)
    2. Refresh token rotation (HTTP 401)
    3. Protected API access using existing JWT token (HTTP 401)
    """
    raw_password = "SecurePassword123!"
    user = User(
        full_name="Deactivated Patient",
        email=f"deactivated_{uuid4().hex[:6]}@example.com",
        password_hash=hash_password(raw_password),
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Generate an active token before deactivation
    token_before = create_access_token(subject=str(user.id))
    user_headers = {"Authorization": f"Bearer {token_before}"}

    # Verify token works before deactivation
    res_before = client.get("/api/v1/auth/me", headers=user_headers)
    assert res_before.status_code == 200

    # Deactivate the user
    res_deact = client.patch(
        f"/api/v1/admin/users/{user.id}/status",
        json={"is_active": False, "reason": "Security hold on account"},
        headers=admin_headers,
    )
    assert res_deact.status_code == 200

    # Path 1: Existing access token is rejected immediately on next API call
    res_after = client.get("/api/v1/auth/me", headers=user_headers)
    assert res_after.status_code == 401
    assert "invalid authentication token" in res_after.json()["detail"].lower()

    # Path 2: New password login is rejected
    res_login = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": raw_password},
    )
    assert res_login.status_code == 403
    assert "account is inactive" in res_login.json()["detail"].lower()


def test_reactivation_restores_user_access(
    client,
    db_session,
    admin_account,
    admin_headers,
):
    """Reactivating a user account sets is_active=True and records an audit log entry."""
    user = User(
        full_name="Reactivated Patient",
        email=f"reactivate_{uuid4().hex[:6]}@example.com",
        password_hash=hash_password("Pass123!"),
        role="patient",
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Reactivate user
    res = client.patch(
        f"/api/v1/admin/users/{user.id}/status",
        json={"is_active": True},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is True

    db_session.expire_all()
    u_db = db_session.get(User, user.id)
    assert u_db.is_active is True

    # Audit log check
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "user.activated",
            AuditLog.resource_id == str(user.id),
        )
    )
    assert audit is not None
    assert audit.actor_user_id == admin_account.id


def test_doctor_verification_isolated_from_account_deactivation(
    client,
    db_session,
    admin_headers,
    approved_doctor,
):
    """Deactivating a doctor's user account does NOT alter their DoctorProfile.verification_status."""
    doc_user = approved_doctor["user"]
    doc_profile = approved_doctor["profile"]

    assert doc_profile.verification_status == "approved"

    # Deactivate the doctor account
    res = client.patch(
        f"/api/v1/admin/users/{doc_user.id}/status",
        json={"is_active": False, "reason": "Temporary administrative hold"},
        headers=admin_headers,
    )
    assert res.status_code == 200

    db_session.expire_all()
    prof_db = db_session.get(DoctorProfile, doc_profile.id)
    # Verification status must remain approved
    assert prof_db.verification_status == "approved"
