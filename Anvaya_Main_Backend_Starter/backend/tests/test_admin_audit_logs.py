
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.audit_log import AuditLog
from app.models.user import User


AUDIT_ENDPOINT = "/api/v1/admin/audit-logs"


# =====================================================
# ADMIN AUTHENTICATION FIXTURE
# =====================================================

@pytest.fixture
def admin_headers(db_session: Session):
    admin_user = User(
        full_name="Test Admin",
        email="audit.admin@example.com",
        password_hash="test-only-password-hash",
        role="admin",
        is_active=True,
    )

    db_session.add(admin_user)
    db_session.commit()
    db_session.refresh(admin_user)

    token = create_access_token(
        subject=str(admin_user.id)
    )

    return {
        "Authorization": f"Bearer {token}"
    }


# =====================================================
# HELPER - CREATE AUDIT RECORD
# =====================================================

def create_audit_record(
    db_session,
    *,
    actor_user_id,
    patient_profile_id,
    doctor_profile_id,
    event_type,
    outcome,
    created_at,
):
    audit_log = AuditLog(
        actor_user_id=actor_user_id,
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        event_type=event_type,
        resource_type="consent",
        resource_id=str(uuid4()),
        outcome=outcome,
        details={
            "test_record": True,
        },
        created_at=created_at,
    )

    db_session.add(audit_log)
    db_session.commit()
    db_session.refresh(audit_log)

    return audit_log


# =====================================================
# 1. ADMIN CAN VIEW AUDIT LOGS
# =====================================================

def test_admin_can_view_audit_logs(
    client: TestClient,
    db_session,
    admin_headers,
    patient_account,
    approved_doctor,
):
    create_audit_record(
        db_session,
        actor_user_id=patient_account["user"].id,
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        event_type="consent.granted",
        outcome="success",
        created_at=datetime.now(timezone.utc),
    )

    response = client.get(
        AUDIT_ENDPOINT,
        headers=admin_headers,
    )

    assert response.status_code == 200, response.text

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    audit = data["items"][0]

    assert audit["event_type"] == "consent.granted"
    assert audit["outcome"] == "success"
    assert audit["resource_type"] == "consent"

    assert data["limit"] == 20
    assert data["offset"] == 0


# =====================================================
# 2. PATIENT CANNOT VIEW AUDIT LOGS
# =====================================================

def test_patient_cannot_view_audit_logs(
    client,
    patient_headers,
):
    response = client.get(
        AUDIT_ENDPOINT,
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 3. DOCTOR CANNOT VIEW AUDIT LOGS
# =====================================================

def test_doctor_cannot_view_audit_logs(
    client,
    doctor_headers,
):
    response = client.get(
        AUDIT_ENDPOINT,
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 4. ADMIN CAN FILTER AUDIT LOGS
# =====================================================

def test_admin_can_filter_audit_logs(
    client,
    db_session,
    admin_headers,
    patient_account,
    approved_doctor,
):
    patient_id = patient_account["profile"].id
    doctor_id = approved_doctor["profile"].id

    # Successful consent event.
    create_audit_record(
        db_session,
        actor_user_id=patient_account["user"].id,
        patient_profile_id=patient_id,
        doctor_profile_id=doctor_id,
        event_type="consent.granted",
        outcome="success",
        created_at=datetime.now(timezone.utc),
    )

    # Denied EHR event.
    ehr_log = AuditLog(
        actor_user_id=approved_doctor["user"].id,
        patient_profile_id=patient_id,
        doctor_profile_id=doctor_id,
        event_type="ehr.records.access_denied",
        resource_type="patient_health_records",
        resource_id=str(patient_id),
        outcome="denied",
        details={"reason": "active_consent_missing"},
        created_at=datetime.now(timezone.utc),
    )

    db_session.add(ehr_log)
    db_session.commit()

    response = client.get(
        AUDIT_ENDPOINT,
        params={
            "event_type": "consent.granted",
            "outcome": "success",
            "patient_profile_id": str(patient_id),
            "doctor_profile_id": str(doctor_id),
        },
        headers=admin_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert data["items"][0]["event_type"] == "consent.granted"


# =====================================================
# 5. ADMIN CAN FILTER BY DATE RANGE
# =====================================================

def test_admin_can_filter_audit_logs_by_date(
    client,
    db_session,
    admin_headers,
    patient_account,
    approved_doctor,
):
    patient_id = patient_account["profile"].id
    doctor_id = approved_doctor["profile"].id

    create_audit_record(
        db_session,
        actor_user_id=patient_account["user"].id,
        patient_profile_id=patient_id,
        doctor_profile_id=doctor_id,
        event_type="consent.granted",
        outcome="success",
        created_at=datetime(
            2026, 11, 12, 10, 0,
            tzinfo=timezone.utc,
        ),
    )

    create_audit_record(
        db_session,
        actor_user_id=patient_account["user"].id,
        patient_profile_id=patient_id,
        doctor_profile_id=doctor_id,
        event_type="consent.revoked",
        outcome="success",
        created_at=datetime(
            2026, 11, 13, 10, 0,
            tzinfo=timezone.utc,
        ),
    )

    response = client.get(
        AUDIT_ENDPOINT,
        params={
            "date_from": "2026-11-13",
            "date_to": "2026-11-13",
        },
        headers=admin_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert data["items"][0]["event_type"] == "consent.revoked"


# =====================================================
# 6. ADMIN AUDIT LOG PAGINATION WORKS
# =====================================================

def test_admin_audit_log_pagination(
    client,
    db_session,
    admin_headers,
    patient_account,
    approved_doctor,
):
    for index in range(3):
        create_audit_record(
            db_session,
            actor_user_id=patient_account["user"].id,
            patient_profile_id=patient_account["profile"].id,
            doctor_profile_id=approved_doctor["profile"].id,
            event_type="consent.granted",
            outcome="success",
            created_at=datetime(
                2026, 11, 13, 10 + index, 0,
                tzinfo=timezone.utc,
            ),
        )

    response = client.get(
        AUDIT_ENDPOINT,
        params={
            "limit": 1,
            "offset": 1,
        },
        headers=admin_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 3
    assert len(data["items"]) == 1
    assert data["limit"] == 1
    assert data["offset"] == 1


# =====================================================
# 7. INVALID DATE RANGE MUST BE REJECTED
# =====================================================

def test_admin_audit_logs_reject_invalid_date_range(
    client,
    admin_headers,
):
    response = client.get(
        AUDIT_ENDPOINT,
        params={
            "date_from": "2026-11-14",
            "date_to": "2026-11-12",
        },
        headers=admin_headers,
    )

    assert response.status_code == 422

    assert response.json()["detail"] == (
        "date_from cannot be after date_to."
    )
