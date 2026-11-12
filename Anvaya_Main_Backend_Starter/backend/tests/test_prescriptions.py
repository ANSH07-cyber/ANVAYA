
from datetime import date, timedelta, time

from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User


PRESCRIPTION_ENDPOINT = "/api/v1/prescriptions"

PRESCRIPTION_PAYLOAD = {
    "notes": "Doctor-recorded prescription for testing.",
    "items": [
        {
            "medicine_name": "Test Medicine A",
            "dosage": "500 mg",
            "route": "Oral",
            "frequency": "Twice daily",
            "duration": "5 days",
            "quantity": "10 tablets",
            "instructions": "Take after food.",
        },
        {
            "medicine_name": "Test Medicine B",
            "dosage": "10 mg",
            "route": "Oral",
            "frequency": "Once daily",
            "duration": "7 days",
            "quantity": "7 tablets",
            "instructions": "Take as directed by the doctor.",
        },
    ],
}


def complete_test_appointment(
    client,
    doctor_headers,
    appointment,
):
    payload = {
        "visit_summary": (
            "Patient consultation completed. "
            "Symptoms assessed and treatment discussed."
        ),
        "chief_complaint": "Routine consultation",
        "symptoms": "Test symptoms",
        "diagnosis": "Test diagnosis",
        "clinical_notes": "Patient examined.",
        "treatment_plan": "Doctor evaluation completed.",
        "follow_up_instructions": "Follow up as advised.",
    }

    response = client.patch(
        f"/api/v1/appointments/{appointment.id}/status",
        json=payload,
        headers=doctor_headers,
    )

    assert response.status_code == 200, response.text


def create_test_prescription(
    client,
    doctor_headers,
    appointment,
):
    return client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(appointment.id),
        },
        headers=doctor_headers,
    )


# =====================================================
# 1. DOCTOR CAN CREATE PRESCRIPTION
# FOR COMPLETED APPOINTMENT
# =====================================================

def test_doctor_can_create_prescription(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert response.status_code == 201, response.text

    data = response.json()

    assert data["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert data["patient_profile_id"] == str(
        past_booked_appointment.patient_profile_id
    )

    assert data["doctor_profile_id"] == str(
        past_booked_appointment.doctor_profile_id
    )

    assert len(data["items"]) == 2

    assert data["items"][0]["medicine_name"] == (
        "Test Medicine A"
    )

    assert data["items"][0]["sort_order"] == 0
    assert data["items"][1]["sort_order"] == 1


# =====================================================
# 2. DOCTOR CANNOT PRESCRIBE
# FOR A NON-COMPLETED APPOINTMENT
# =====================================================

def test_doctor_cannot_prescribe_uncompleted_appointment(
    client,
    doctor_headers,
    booked_appointment,
):
    response = create_test_prescription(
        client,
        doctor_headers,
        booked_appointment,
    )

    assert response.status_code == 409

    assert response.json()["detail"] == (
        "Prescription can only be issued for completed appointments."
    )


# =====================================================
# 3. PATIENT CANNOT CREATE PRESCRIPTION
# =====================================================

def test_patient_cannot_create_prescription(
    client,
    patient_headers,
    past_booked_appointment,
):
    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(
                past_booked_appointment.id
            ),
        },
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 4. DOCTOR CANNOT PRESCRIBE
# FOR ANOTHER DOCTOR'S APPOINTMENT
# =====================================================

def test_doctor_cannot_prescribe_another_doctors_appointment(
    client,
    db_session,
    doctor_headers,
    patient_account,
):
    other_user = User(
        full_name="Another Test Doctor",
        email="another.prescription.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_doctor = DoctorProfile(
        user_id=other_user.id,
        specialization="Dermatology",
        qualification="MBBS, MD Dermatology",
        license_number="PRESCRIPTION-OTHER-DOCTOR-001",
        years_experience=5,
        clinic_name="Another Test Clinic",
        verification_status="approved",
    )

    db_session.add(other_doctor)
    db_session.flush()

    other_appointment = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=other_doctor.id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Another doctor's appointment",
    )

    db_session.add(other_appointment)
    db_session.commit()

    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(other_appointment.id),
        },
        headers=doctor_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# 5. DUPLICATE PRESCRIPTION IS BLOCKED
# =====================================================

def test_duplicate_prescription_is_blocked(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    first_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert first_response.status_code == 201

    second_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert second_response.status_code == 409

    assert second_response.json()["detail"] == (
        "A prescription already exists for this appointment."
    )


# =====================================================
# 6. PATIENT CAN VIEW OWN PRESCRIPTIONS
# =====================================================

def test_patient_can_view_own_prescriptions(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    create_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert create_response.status_code == 201

    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert len(data["items"][0]["items"]) == 2


# =====================================================
# 7. PATIENT CANNOT VIEW ANOTHER
# PATIENT'S PRESCRIPTIONS
# =====================================================

def test_patient_cannot_view_another_patients_prescriptions(
    client,
    db_session,
    patient_headers,
    doctor_headers,
    approved_doctor,
):
    other_user = User(
        full_name="Prescription Owner Two",
        email="prescription.owner.two@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_patient = PatientProfile(
        user_id=other_user.id,
    )

    db_session.add(other_patient)
    db_session.flush()

    other_appointment = Appointment(
        patient_profile_id=other_patient.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Other patient's consultation",
    )

    db_session.add(other_appointment)
    db_session.commit()

    complete_test_appointment(
        client,
        doctor_headers,
        other_appointment,
    )

    create_response = create_test_prescription(
        client,
        doctor_headers,
        other_appointment,
    )

    assert create_response.status_code == 201

    # The original patient must not see the other patient's prescription.
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=patient_headers,
    )

    assert response.status_code == 200

    assert response.json()["total"] == 0
    assert response.json()["items"] == []


# =====================================================
# 8. DOCTOR CANNOT ACCESS PATIENT PRESCRIPTION LIST
# =====================================================

def test_doctor_cannot_access_patient_prescription_list(
    client,
    doctor_headers,
):
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 9. PRESCRIPTION LIST REQUIRES AUTHENTICATION
# =====================================================

def test_prescription_list_requires_authentication(client):
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me"
    )

    assert response.status_code == 401


# =====================================================
# 10. UNAPPROVED DOCTOR CANNOT ISSUE PRESCRIPTION
# =====================================================

def test_unapproved_doctor_cannot_issue_prescription(
    client,
    db_session,
    approved_doctor,
    doctor_headers,
    booked_appointment,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = create_test_prescription(
        client,
        doctor_headers,
        booked_appointment,
    )

    assert response.status_code == 403

    assert response.json()["detail"] == (
        "Only approved doctors can issue prescriptions."
    )


# =====================================================
# 11. PRESCRIPTION REJECTS EMPTY MEDICINE LIST
# =====================================================

def test_prescription_requires_at_least_one_medicine(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            "appointment_id": str(
                past_booked_appointment.id
            ),
            "items": [],
        },
        headers=doctor_headers,
    )

    assert response.status_code == 422
