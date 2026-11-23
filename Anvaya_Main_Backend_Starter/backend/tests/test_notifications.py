from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token, hash_password
from app.models.notification import Notification
from app.models.user import User
from app.services.notification_service import (
    create_notification,
    get_unread_count,
    is_safe_role_path,
    mark_all_notifications_as_read,
    mark_notification_as_read,
)


@pytest.fixture
def patient_user(db_session):
    user = User(
        full_name="Notification Patient",
        email="patient.notification@example.com",
        password_hash=hash_password("Password@12345"),
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def doctor_user(db_session):
    user = User(
        full_name="Notification Doctor",
        email="doctor.notification@example.com",
        password_hash=hash_password("Password@12345"),
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def admin_user(db_session):
    user = User(
        full_name="Notification Admin",
        email="admin.notification@example.com",
        password_hash=hash_password("Password@12345"),
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def other_user(db_session):
    user = User(
        full_name="Other User",
        email="other.notification@example.com",
        password_hash=hash_password("Password@12345"),
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}


def _auth_cookie_and_csrf(user: User) -> tuple[dict[str, str], dict[str, str]]:
    token = create_access_token(str(user.id))
    csrf = generate_csrf_token(str(user.id))
    cookies = {
        settings.access_cookie_name: token,
        settings.csrf_cookie_name: csrf,
    }
    headers = {
        settings.csrf_header_name: csrf,
        "Origin": settings.cors_origin_list[0],
    }
    return cookies, headers


# =====================================================================
# 1. AUTHENTICATED NOTIFICATION LISTING & ROLE COVERAGE
# =====================================================================

def test_authenticated_notification_listing_patient(client, patient_user, db_session):
    # Create test notifications
    n1 = Notification(
        recipient_user_id=patient_user.id,
        notification_type="appointment.booked",
        title="Appointment Confirmed",
        message="Your consultation is scheduled.",
        is_read=False,
        safe_action_path="/patient/appointments",
    )
    n2 = Notification(
        recipient_user_id=patient_user.id,
        notification_type="prescription.issued",
        title="Prescription Available",
        message="A new prescription has been issued.",
        is_read=True,
        safe_action_path="/patient/prescriptions",
    )
    db_session.add_all([n1, n2])
    db_session.commit()

    headers = _auth_headers(patient_user)
    response = client.get("/api/v1/notifications/me", headers=headers)
    assert response.status_code == 200
    data = response.json()

    assert data["total"] == 2
    assert data["unread_count"] == 1
    assert len(data["items"]) == 2
    assert data["items"][0]["title"] == "Prescription Available" or data["items"][0]["title"] == "Appointment Confirmed"


def test_authenticated_notification_listing_doctor_and_admin(client, doctor_user, admin_user, db_session):
    # Doctor notification
    db_session.add(
        Notification(
            recipient_user_id=doctor_user.id,
            notification_type="appointment.booked",
            title="New Patient Booking",
            message="A patient booked an appointment.",
            safe_action_path="/doctor/appointments",
        )
    )
    # Admin notification
    db_session.add(
        Notification(
            recipient_user_id=admin_user.id,
            notification_type="doctor.onboarded",
            title="New Doctor Application",
            message="A doctor application is pending review.",
            safe_action_path="/admin/doctors",
        )
    )
    db_session.commit()

    # Doctor check
    res_doc = client.get("/api/v1/notifications/me", headers=_auth_headers(doctor_user))
    assert res_doc.status_code == 200
    doc_data = res_doc.json()
    assert doc_data["total"] == 1
    assert doc_data["items"][0]["title"] == "New Patient Booking"
    assert doc_data["items"][0]["safe_action_path"] == "/doctor/appointments"

    # Admin check
    res_adm = client.get("/api/v1/notifications/me", headers=_auth_headers(admin_user))
    assert res_adm.status_code == 200
    adm_data = res_adm.json()
    assert adm_data["total"] == 1
    assert adm_data["items"][0]["title"] == "New Doctor Application"
    assert adm_data["items"][0]["safe_action_path"] == "/admin/doctors"


# =====================================================================
# 2. PAGINATION & BOUNDARY CHECKS
# =====================================================================

def test_notification_pagination_and_bounds(client, patient_user, db_session):
    # Create 5 notifications
    for i in range(5):
        db_session.add(
            Notification(
                recipient_user_id=patient_user.id,
                notification_type=f"system.notice.{i}",
                title=f"Notice #{i}",
                message="Operational message.",
                is_read=False,
            )
        )
    db_session.commit()

    headers = _auth_headers(patient_user)

    # Page 1: limit 2, offset 0
    res1 = client.get("/api/v1/notifications/me?limit=2&offset=0", headers=headers)
    assert res1.status_code == 200
    d1 = res1.json()
    assert len(d1["items"]) == 2
    assert d1["total"] == 5
    assert d1["limit"] == 2
    assert d1["offset"] == 0

    # Page 2: limit 2, offset 2
    res2 = client.get("/api/v1/notifications/me?limit=2&offset=2", headers=headers)
    assert res2.status_code == 200
    d2 = res2.json()
    assert len(d2["items"]) == 2
    assert d2["offset"] == 2

    # Filter unread=false vs unread=true
    res_unread = client.get("/api/v1/notifications/me?is_read=false", headers=headers)
    assert res_unread.status_code == 200
    assert res_unread.json()["total"] == 5

    res_read = client.get("/api/v1/notifications/me?is_read=true", headers=headers)
    assert res_read.status_code == 200
    assert res_read.json()["total"] == 0

    # Boundary validation: limit=0 or limit > 100 must fail with 422
    assert client.get("/api/v1/notifications/me?limit=0", headers=headers).status_code == 422
    assert client.get("/api/v1/notifications/me?limit=101", headers=headers).status_code == 422
    assert client.get("/api/v1/notifications/me?offset=-1", headers=headers).status_code == 422


# =====================================================================
# 3. UNREAD COUNTS ISOLATED PER USER
# =====================================================================

def test_unread_counts_isolated_per_user(client, patient_user, other_user, db_session):
    # Patient has 2 unread, 1 read
    db_session.add_all([
        Notification(recipient_user_id=patient_user.id, notification_type="test", title="U1", message="M", is_read=False),
        Notification(recipient_user_id=patient_user.id, notification_type="test", title="U2", message="M", is_read=False),
        Notification(recipient_user_id=patient_user.id, notification_type="test", title="R1", message="M", is_read=True),
    ])
    # Other user has 1 unread
    db_session.add(
        Notification(recipient_user_id=other_user.id, notification_type="test", title="Other U", message="M", is_read=False)
    )
    db_session.commit()

    res_p = client.get("/api/v1/notifications/unread-count", headers=_auth_headers(patient_user))
    assert res_p.status_code == 200
    assert res_p.json()["unread_count"] == 2

    res_o = client.get("/api/v1/notifications/unread-count", headers=_auth_headers(other_user))
    assert res_o.status_code == 200
    assert res_o.json()["unread_count"] == 1


# =====================================================================
# 4. MARK SINGLE NOTIFICATION AS READ & IDEMPOTENCY
# =====================================================================

def test_mark_single_notification_read(client, patient_user, db_session):
    n = Notification(
        recipient_user_id=patient_user.id,
        notification_type="appointment.reminder",
        title="Upcoming Visit",
        message="Your appointment is tomorrow.",
        is_read=False,
    )
    db_session.add(n)
    db_session.commit()

    headers = _auth_headers(patient_user)
    response = client.patch(f"/api/v1/notifications/{n.id}/read", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["is_read"] is True
    assert data["read_at"] is not None

    # Verify second call is idempotent
    res2 = client.patch(f"/api/v1/notifications/{n.id}/read", headers=headers)
    assert res2.status_code == 200
    assert res2.json()["is_read"] is True


# =====================================================================
# 5. MARK ALL NOTIFICATIONS AS READ
# =====================================================================

def test_mark_all_notifications_read(client, patient_user, other_user, db_session):
    db_session.add_all([
        Notification(recipient_user_id=patient_user.id, notification_type="t", title="1", message="m", is_read=False),
        Notification(recipient_user_id=patient_user.id, notification_type="t", title="2", message="m", is_read=False),
        Notification(recipient_user_id=other_user.id, notification_type="t", title="3", message="m", is_read=False),
    ])
    db_session.commit()

    headers = _auth_headers(patient_user)
    response = client.patch("/api/v1/notifications/read-all", headers=headers)
    assert response.status_code == 200
    assert response.json()["marked_count"] == 2

    # Verify patient's unread count is now 0
    res_count = client.get("/api/v1/notifications/unread-count", headers=headers)
    assert res_count.json()["unread_count"] == 0

    # Other user still has 1 unread
    res_other = client.get("/api/v1/notifications/unread-count", headers=_auth_headers(other_user))
    assert res_other.json()["unread_count"] == 1


# =====================================================================
# 6. CROSS-USER ACCESS REJECTION (RETURNS 404 NOT FOUND)
# =====================================================================

def test_cross_user_access_returns_404(client, patient_user, other_user, db_session):
    patient_notif = Notification(
        recipient_user_id=patient_user.id,
        notification_type="private.notice",
        title="Private Notice",
        message="Confidential content.",
        is_read=False,
    )
    db_session.add(patient_notif)
    db_session.commit()

    # other_user attempts to mark patient's notification as read
    other_headers = _auth_headers(other_user)
    response = client.patch(f"/api/v1/notifications/{patient_notif.id}/read", headers=other_headers)
    assert response.status_code == 404
    assert response.json()["detail"] == "Notification not found."

    # other_user listing must NOT include patient's notification
    list_res = client.get("/api/v1/notifications/me", headers=other_headers)
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 0


# =====================================================================
# 7. UNAUTHENTICATED ACCESS REJECTION (RETURNS 401)
# =====================================================================

def test_unauthenticated_access_rejected(client):
    fake_id = uuid.uuid4()
    assert client.get("/api/v1/notifications/me").status_code == 401
    assert client.get("/api/v1/notifications/unread-count").status_code == 401
    assert client.patch(f"/api/v1/notifications/{fake_id}/read").status_code == 401
    assert client.patch("/api/v1/notifications/read-all").status_code == 401


# =====================================================================
# 8. CSRF PROTECTION FOR COOKIE-AUTHENTICATED MUTATIONS
# =====================================================================

def test_csrf_protection_on_cookie_mutations(client, patient_user, db_session):
    n = Notification(
        recipient_user_id=patient_user.id,
        notification_type="notice",
        title="Notice",
        message="Msg",
        is_read=False,
    )
    db_session.add(n)
    db_session.commit()

    token = create_access_token(str(patient_user.id))

    # 1. Cookie-authenticated mutation WITHOUT CSRF header/cookie -> 403 Forbidden
    client.cookies.set(settings.access_cookie_name, token)
    res_no_csrf = client.patch(f"/api/v1/notifications/{n.id}/read")
    assert res_no_csrf.status_code == 403
    client.cookies.clear()

    # 2. Cookie-authenticated mutation with MISMATCHED CSRF token -> 403 Forbidden
    client.cookies.set(settings.access_cookie_name, token)
    client.cookies.set(settings.csrf_cookie_name, "valid_cookie_value")
    res_mismatch = client.patch(
        f"/api/v1/notifications/{n.id}/read",
        headers={
            settings.csrf_header_name: "tampered_header_value",
            "Origin": settings.cors_origin_list[0],
        },
    )
    assert res_mismatch.status_code == 403
    client.cookies.clear()

    # 3. Cookie-authenticated mutation with VALID CSRF cookie + header -> 200 OK
    cookies, headers = _auth_cookie_and_csrf(patient_user)
    for k, v in cookies.items():
        client.cookies.set(k, v)
    res_valid = client.patch(f"/api/v1/notifications/{n.id}/read", headers=headers)
    assert res_valid.status_code == 200
    client.cookies.clear()


# =====================================================================
# 9. DUPLICATE IDEMPOTENCY KEY & SAVEPOINT TRANSACTION SAFETY
# =====================================================================

def test_duplicate_idempotency_key_savepoint_safety(db_session, patient_user):
    idempotency_key = f"appt_booked_{uuid.uuid4()}"

    # First call creates the notification
    n1 = create_notification(
        db_session,
        recipient_user_id=patient_user.id,
        notification_type="appointment.booked",
        title="Appointment Booked",
        message="First notification",
        idempotency_key=idempotency_key,
    )
    assert n1 is not None
    assert n1.title == "Appointment Booked"

    # Second call with the same idempotency_key must return existing without failing
    n2 = create_notification(
        db_session,
        recipient_user_id=patient_user.id,
        notification_type="appointment.booked",
        title="Appointment Booked Duplicate",
        message="Duplicate attempt",
        idempotency_key=idempotency_key,
    )
    assert n2 is not None
    assert n2.id == n1.id

    # Crucial test: Outer transaction is NOT aborted! We can continue database operations.
    patient_user.full_name = "Updated Safe Name"
    db_session.commit()

    db_session.refresh(patient_user)
    assert patient_user.full_name == "Updated Safe Name"


# =====================================================================
# 10. ROLE-SPECIFIC SAFE NAVIGATION PATHS
# =====================================================================

def test_role_specific_safe_navigation_paths(client, patient_user, db_session):
    # Patient with forbidden /admin route
    n_admin_path = Notification(
        recipient_user_id=patient_user.id,
        notification_type="warning",
        title="Privilege Test",
        message="Testing path restriction.",
        safe_action_path="/admin/doctors",
    )
    # Patient with valid /patient route
    n_patient_path = Notification(
        recipient_user_id=patient_user.id,
        notification_type="info",
        title="Valid Path",
        message="Testing valid path.",
        safe_action_path="/patient/appointments",
    )
    # Patient with open redirect / malicious route
    n_evil_path = Notification(
        recipient_user_id=patient_user.id,
        notification_type="warning",
        title="Open Redirect Test",
        message="Testing open redirect.",
        safe_action_path="//evil.com/phishing",
    )
    db_session.add_all([n_admin_path, n_patient_path, n_evil_path])
    db_session.commit()

    headers = _auth_headers(patient_user)
    response = client.get("/api/v1/notifications/me", headers=headers)
    assert response.status_code == 200
    items = {item["title"]: item["safe_action_path"] for item in response.json()["items"]}

    # /admin/doctors must be sanitized to None for patient
    assert items["Privilege Test"] is None
    # /patient/appointments must be preserved
    assert items["Valid Path"] == "/patient/appointments"
    # //evil.com must be sanitized to None
    assert items["Open Redirect Test"] is None


# =====================================================================
# 11. SCHEMA & MODEL INTEGRITY TEST
# =====================================================================

def test_notification_schema_and_model_integrity(test_engine):
    from sqlalchemy import inspect
    inspector = inspect(test_engine)
    columns = {col["name"]: col for col in inspector.get_columns("notifications")}

    required_columns = [
        "id",
        "recipient_user_id",
        "notification_type",
        "title",
        "message",
        "is_read",
        "created_at",
        "read_at",
        "related_entity_type",
        "related_entity_id",
        "safe_action_path",
        "idempotency_key",
    ]
    for col_name in required_columns:
        assert col_name in columns, f"Missing required column {col_name} in notifications table"

    # Verify not null constraints
    assert columns["recipient_user_id"]["nullable"] is False
    assert columns["notification_type"]["nullable"] is False
    assert columns["title"]["nullable"] is False
    assert columns["message"]["nullable"] is False
    assert columns["is_read"]["nullable"] is False
    assert columns["created_at"]["nullable"] is False

    # Verify nullable optional fields
    assert columns["read_at"]["nullable"] is True
    assert columns["related_entity_type"]["nullable"] is True
    assert columns["related_entity_id"]["nullable"] is True
    assert columns["safe_action_path"]["nullable"] is True
    assert columns["idempotency_key"]["nullable"] is True

