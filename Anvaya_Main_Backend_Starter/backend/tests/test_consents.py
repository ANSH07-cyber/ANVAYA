
from datetime import datetime, timezone

from app.models.consent_record import ConsentRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User
from sqlalchemy import select

from app.models.audit_log import AuditLog

CONSENT_ENDPOINT = "/api/v1/consents"

CONSENT_PAYLOAD = {
    "doctor_profile_id": None,
    "data_scopes": [
        "diagnosis",
        "symptoms",
        "visit_summary",
    ],
}


def make_consent_payload(doctor_id):
    return {
        **CONSENT_PAYLOAD,
        "doctor_profile_id": str(doctor_id),
    }


# =====================================================
# 1. PATIENT CAN GRANT CONSENT
# =====================================================

def test_patient_can_grant_consent(
    client,
    patient_headers,
    approved_doctor,
):
    response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 201

    data = response.json()

    assert data["doctor_profile_id"] == str(
        approved_doctor["profile"].id
    )
    assert data["data_scopes"] == [
        "diagnosis",
        "symptoms",
        "visit_summary",
    ]
    assert data["is_active"] is True
    assert data["revoked_at"] is None
    assert data["granted_at"] is not None


# =====================================================
# 2. PATIENT CANNOT GRANT DUPLICATE ACTIVE CONSENT
# =====================================================

def test_patient_cannot_grant_duplicate_active_consent(
    client,
    patient_headers,
    approved_doctor,
):
    payload = make_consent_payload(
        approved_doctor["profile"].id
    )

    first_response = client.post(
        CONSENT_ENDPOINT,
        json=payload,
        headers=patient_headers,
    )

    assert first_response.status_code == 201

    second_response = client.post(
        CONSENT_ENDPOINT,
        json=payload,
        headers=patient_headers,
    )

    assert second_response.status_code == 409


# =====================================================
# 3. PATIENT CANNOT GRANT CONSENT TO UNAPPROVED DOCTOR
# =====================================================

def test_patient_cannot_grant_consent_to_unapproved_doctor(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Approved doctor not found."


# =====================================================
# 4. PATIENT CAN VIEW OWN CONSENT HISTORY
# =====================================================

def test_patient_can_view_own_consent_history(
    client,
    patient_headers,
    approved_doctor,
):
    grant_response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert grant_response.status_code == 201

    response = client.get(
        f"{CONSENT_ENDPOINT}/me",
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["is_active"] is True


# =====================================================
# 5. PATIENT CAN REVOKE OWN CONSENT
# =====================================================

def test_patient_can_revoke_own_consent(
    client,
    patient_headers,
    approved_doctor,
):
    grant_response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert grant_response.status_code == 201

    consent_id = grant_response.json()["id"]

    revoke_response = client.patch(
        f"{CONSENT_ENDPOINT}/{consent_id}/revoke",
        headers=patient_headers,
    )

    assert revoke_response.status_code == 200

    data = revoke_response.json()

    assert data["is_active"] is False
    assert data["revoked_at"] is not None


# =====================================================
# 6. REVOKED CONSENT CANNOT BE REVOKED AGAIN
# =====================================================

def test_patient_cannot_revoke_consent_twice(
    client,
    patient_headers,
    approved_doctor,
):
    grant_response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    consent_id = grant_response.json()["id"]

    first_revoke = client.patch(
        f"{CONSENT_ENDPOINT}/{consent_id}/revoke",
        headers=patient_headers,
    )

    assert first_revoke.status_code == 200

    second_revoke = client.patch(
        f"{CONSENT_ENDPOINT}/{consent_id}/revoke",
        headers=patient_headers,
    )

    assert second_revoke.status_code == 409


# =====================================================
# 7. PATIENT CANNOT REVOKE ANOTHER PATIENT'S CONSENT
# =====================================================

def test_patient_cannot_revoke_another_patients_consent(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    other_user = User(
        full_name="Another Patient",
        email="consent.other@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_profile = PatientProfile(
        user_id=other_user.id,
    )

    db_session.add(other_profile)
    db_session.flush()

    other_consent = ConsentRecord(
        patient_profile_id=other_profile.id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
    )

    db_session.add(other_consent)
    db_session.commit()

    response = client.patch(
        f"{CONSENT_ENDPOINT}/{other_consent.id}/revoke",
        headers=patient_headers,
    )

    assert response.status_code == 404


# =====================================================
# 8. DOCTOR CANNOT ACCESS PATIENT CONSENT MANAGEMENT
# =====================================================

def test_doctor_cannot_access_patient_consent_history(
    client,
    doctor_headers,
):
    response = client.get(
        f"{CONSENT_ENDPOINT}/me",
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 9. CONSENT API REQUIRES AUTHENTICATION
# =====================================================

def test_consent_api_requires_authentication(client):
    response = client.get(
        f"{CONSENT_ENDPOINT}/me"
    )

    assert response.status_code == 401


# =====================================================
# 10. DUPLICATE DATA SCOPES ARE REJECTED
# =====================================================

def test_duplicate_data_scopes_are_rejected(
    client,
    patient_headers,
    approved_doctor,
):
    payload = {
        "doctor_profile_id": str(
            approved_doctor["profile"].id
        ),
        "data_scopes": [
            "diagnosis",
            "diagnosis",
        ],
    }

    response = client.post(
        CONSENT_ENDPOINT,
        json=payload,
        headers=patient_headers,
    )

    assert response.status_code == 422

# =====================================================
# 11. CONSENT GRANT CREATES AUDIT LOG
# =====================================================

def test_patient_consent_grant_creates_audit_log(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 201

    consent_id = response.json()["id"]

    # Refresh session state before reading the audit record.
    db_session.expire_all()

    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "consent.granted",
            AuditLog.resource_id == consent_id,
        )
    )

    assert audit_log is not None
    assert audit_log.outcome == "success"
    assert audit_log.resource_type == "consent"
    assert audit_log.doctor_profile_id == approved_doctor["profile"].id
    assert audit_log.details["scope_count"] == 3
    assert set(audit_log.details["scopes"]) == {
        "diagnosis",
        "symptoms",
        "visit_summary",
    }


# =====================================================
# 12. CONSENT REVOCATION CREATES AUDIT LOG
# =====================================================

def test_patient_consent_revocation_creates_audit_log(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    # First grant consent.
    grant_response = client.post(
        CONSENT_ENDPOINT,
        json=make_consent_payload(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert grant_response.status_code == 201

    consent_id = grant_response.json()["id"]

    # Then revoke consent.
    revoke_response = client.patch(
        f"{CONSENT_ENDPOINT}/{consent_id}/revoke",
        headers=patient_headers,
    )

    assert revoke_response.status_code == 200
    assert revoke_response.json()["is_active"] is False

    db_session.expire_all()

    grant_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "consent.granted",
            AuditLog.resource_id == consent_id,
        )
    )

    revoke_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "consent.revoked",
            AuditLog.resource_id == consent_id,
        )
    )

    # Both events must exist.
    assert grant_log is not None
    assert revoke_log is not None

    # Verify revocation audit details.
    assert revoke_log.outcome == "success"
    assert revoke_log.resource_type == "consent"
    assert revoke_log.doctor_profile_id == approved_doctor["profile"].id
    assert revoke_log.details["scope_count"] == 3
