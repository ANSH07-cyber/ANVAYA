
from datetime import date, datetime, timedelta, timezone, time
from uuid import uuid4

from app.models.appointment import Appointment
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User


CONSULTATION_PAYLOAD = {
    "visit_summary": (
        "Patient consultation completed. "
        "Symptoms assessed and treatment discussed."
    ),
    "chief_complaint": "Recurring headache",
    "symptoms": "Headache and mild nausea",
    "diagnosis": "Clinical evaluation required",
    "clinical_notes": "Patient examined during consultation.",
    "treatment_plan": "Further evaluation advised.",
    "follow_up_instructions": "Follow up after 7 days.",
}


EHR_ENDPOINT = "/api/v1/health-records/me"


# =====================================================
# 1. PATIENT CAN VIEW OWN HEALTH RECORDS
# =====================================================

def test_patient_can_view_own_health_records(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
):
    # Doctor completes consultation and creates EHR.
    completion_response = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    assert completion_response.status_code == 200

    # Patient retrieves own EHR.
    response = client.get(
        EHR_ENDPOINT,
        params={"limit": 1, "offset": 0},
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["limit"] == 1
    assert data["offset"] == 0

    record = data["items"][0]

    assert record["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert record["visit_summary"] == (
        CONSULTATION_PAYLOAD["visit_summary"]
    )

    assert record["diagnosis"] == (
        CONSULTATION_PAYLOAD["diagnosis"]
    )


# =====================================================
# 2. PATIENT CANNOT VIEW ANOTHER PATIENT'S RECORDS
# =====================================================

def test_patient_cannot_view_another_patients_records(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    # Create a second patient.
    other_user = User(
        full_name="Another Test Patient",
        email="another.patient@example.com",
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

    # Create an appointment belonging to the second patient.
    other_appointment = Appointment(
        patient_profile_id=other_profile.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(9, 0),
        end_time=time(9, 30),
        status="completed",
        reason="Private test consultation",
    )

    db_session.add(other_appointment)
    db_session.flush()

    # Add a health record belonging to the second patient.
    now = datetime.now(timezone.utc)

    other_record = HealthRecord(
        id=uuid4(),
        patient_profile_id=other_profile.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=other_appointment.id,
        visit_date=other_appointment.appointment_date,
        visit_summary="Private health information.",
        diagnosis="Private test diagnosis",
        created_at=now,
        updated_at=now,
    )

    db_session.add(other_record)
    db_session.commit()

    # First patient tries to retrieve records.
    response = client.get(
        EHR_ENDPOINT,
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 0
    assert data["items"] == []


# =====================================================
# 3. DOCTOR CANNOT ACCESS PATIENT EHR ENDPOINT
# =====================================================

def test_doctor_cannot_access_patient_health_records(
    client,
    doctor_headers,
):
    response = client.get(
        EHR_ENDPOINT,
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 4. EHR ENDPOINT REJECTS MISSING JWT
# =====================================================

def test_health_records_requires_authentication(client):
    response = client.get(EHR_ENDPOINT)

    assert response.status_code == 401
