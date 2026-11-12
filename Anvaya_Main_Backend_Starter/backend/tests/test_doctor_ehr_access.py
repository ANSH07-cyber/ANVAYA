from sqlalchemy import select

from app.models.audit_log import AuditLog
CONSULTATION_PAYLOAD = {
    "visit_summary": "Patient consultation completed. Symptoms assessed and treatment discussed.",
    "chief_complaint": "Recurring headache",
    "symptoms": "Headache and mild nausea",
    "diagnosis": "Clinical evaluation required",
    "clinical_notes": "Patient examined during consultation.",
    "treatment_plan": "Further evaluation advised.",
    "follow_up_instructions": "Follow up after 7 days.",
}


def complete_test_appointment(
    client,
    doctor_headers,
    appointment,
):
    response = client.patch(
        f"/api/v1/appointments/{appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    assert response.status_code == 200, response.text


def grant_test_consent(
    client,
    patient_headers,
    doctor_profile_id,
    scopes,
):
    response = client.post(
        "/api/v1/consents",
        json={
            "doctor_profile_id": str(doctor_profile_id),
            "data_scopes": scopes,
        },
        headers=patient_headers,
    )

    assert response.status_code == 201, response.text
    return response.json()


def request_doctor_ehr(
    client,
    doctor_headers,
    patient_profile_id,
    scopes,
):
    return client.get(
        f"/api/v1/health-records/patient/{patient_profile_id}",
        params=[("scopes", scope) for scope in scopes],
        headers=doctor_headers,
    )


# =====================================================
# 1. DOCTOR CANNOT ACCESS EHR WITHOUT CONSENT
# =====================================================

def test_doctor_cannot_access_ehr_without_consent(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Active patient consent is required."
    )


# =====================================================
# 2. DOCTOR CAN ACCESS CONSENTED INFORMATION
# =====================================================

def test_doctor_can_access_consented_health_fields(
    client,
    patient_headers,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    grant_test_consent(
        client,
        patient_headers,
        approved_doctor["profile"].id,
        ["diagnosis", "symptoms"],
    )

    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis", "symptoms"],
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert data["requested_scopes"] == [
        "diagnosis",
        "symptoms",
    ]

    record_data = data["items"][0]["data"]

    assert set(record_data.keys()) == {
        "diagnosis",
        "symptoms",
    }

    assert record_data["diagnosis"] == (
        CONSULTATION_PAYLOAD["diagnosis"]
    )

    assert record_data["symptoms"] == (
        CONSULTATION_PAYLOAD["symptoms"]
    )

    assert "clinical_notes" not in record_data
    assert "treatment_plan" not in record_data


# =====================================================
# 3. DOCTOR CANNOT REQUEST UNCONSENTED FIELDS
# =====================================================

def test_doctor_cannot_request_unconsented_fields(
    client,
    patient_headers,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    grant_test_consent(
        client,
        patient_headers,
        approved_doctor["profile"].id,
        ["diagnosis"],
    )

    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis", "clinical_notes"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Consent does not cover all requested information."
    )


# =====================================================
# 4. REVOKED CONSENT BLOCKS DOCTOR ACCESS
# =====================================================

def test_revoked_consent_blocks_doctor_ehr_access(
    client,
    patient_headers,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    consent = grant_test_consent(
        client,
        patient_headers,
        approved_doctor["profile"].id,
        ["diagnosis"],
    )

    revoke_response = client.patch(
        f"/api/v1/consents/{consent['id']}/revoke",
        headers=patient_headers,
    )

    assert revoke_response.status_code == 200
    assert revoke_response.json()["is_active"] is False

    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Active patient consent is required."
    )


# =====================================================
# 5. PATIENT CANNOT ACCESS DOCTOR PROTECTED ENDPOINT
# =====================================================

def test_patient_cannot_access_doctor_protected_ehr_endpoint(
    client,
    patient_headers,
    past_booked_appointment,
):
    response = client.get(
        f"/api/v1/health-records/patient/"
        f"{past_booked_appointment.patient_profile_id}",
        params={"scopes": "diagnosis"},
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 6. DOCTOR CANNOT ACCESS ANOTHER PATIENT'S EHR
# =====================================================

def test_doctor_cannot_access_patient_without_their_consent(
    client,
    patient_headers,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
    db_session,
):
    from app.models.patient_profile import PatientProfile
    from app.models.user import User

    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    # Create another patient.
    other_user = User(
        full_name="Another Patient",
        email="another.ehr.patient@example.com",
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
    db_session.commit()

    # Consent exists only for the original patient.
    grant_test_consent(
        client,
        patient_headers,
        approved_doctor["profile"].id,
        ["diagnosis"],
    )

    response = request_doctor_ehr(
        client,
        doctor_headers,
        other_profile.id,
        ["diagnosis"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == (
        "Active patient consent is required."
    )

# =====================================================
# 7. SUCCESSFUL DOCTOR EHR ACCESS CREATES AUDIT LOG
# =====================================================

def test_successful_doctor_ehr_access_creates_audit_log(
    client,
    db_session,
    patient_headers,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    # Complete the consultation.
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    # Patient grants access to diagnosis.
    grant_test_consent(
        client,
        patient_headers,
        approved_doctor["profile"].id,
        ["diagnosis"],
    )

    # Doctor accesses the authorized EHR information.
    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis"],
    )

    assert response.status_code == 200

    db_session.expire_all()

    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "ehr.records.accessed",
            AuditLog.resource_id == str(
                past_booked_appointment.patient_profile_id
            ),
            AuditLog.actor_user_id == approved_doctor["profile"].user_id,
        )
    )

    assert audit_log is not None
    assert audit_log.outcome == "success"
    assert audit_log.resource_type == "patient_health_records"
    assert audit_log.patient_profile_id == (
        past_booked_appointment.patient_profile_id
    )
    assert audit_log.doctor_profile_id == approved_doctor["profile"].id

    assert audit_log.details["reason"] == "consent_verified"
    assert audit_log.details["requested_scopes"] == ["diagnosis"]
    assert audit_log.details["total_record_count"] == 1
    assert audit_log.details["returned_record_count"] == 1


# =====================================================
# 8. DENIED DOCTOR EHR ACCESS CREATES AUDIT LOG
# =====================================================

def test_denied_doctor_ehr_access_creates_audit_log(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    # Complete the consultation.
    # No consent will be granted to the doctor.
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = request_doctor_ehr(
        client,
        doctor_headers,
        past_booked_appointment.patient_profile_id,
        ["diagnosis"],
    )

    assert response.status_code == 403

    db_session.expire_all()

    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "ehr.records.access_denied",
            AuditLog.resource_id == str(
                past_booked_appointment.patient_profile_id
            ),
            AuditLog.actor_user_id == approved_doctor["profile"].user_id,
        )
    )

    assert audit_log is not None
    assert audit_log.outcome == "denied"
    assert audit_log.resource_type == "patient_health_records"
    assert audit_log.patient_profile_id == (
        past_booked_appointment.patient_profile_id
    )
    assert audit_log.doctor_profile_id == approved_doctor["profile"].id

    assert audit_log.details["reason"] == "active_consent_missing"
    assert audit_log.details["requested_scopes"] == ["diagnosis"]
