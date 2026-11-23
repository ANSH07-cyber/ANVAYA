
import uuid

from app.core.security import create_access_token
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User


def booking_payload(approved_doctor, start_time="10:00:00"):
    return {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": start_time,
        "reason": "Routine consultation",
    }


# =====================================================
# TEST 1: SUCCESSFUL APPOINTMENT BOOKING
# =====================================================

def test_patient_can_book_available_slot(
    client,
    patient_headers,
    approved_doctor,
):
    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(approved_doctor),
        headers=patient_headers,
    )

    assert response.status_code == 201

    data = response.json()

    assert data["doctor_profile_id"] == str(
        approved_doctor["profile"].id
    )

    assert data["patient_profile_id"] is not None
    assert data["appointment_date"] == (
        approved_doctor["appointment_date"].isoformat()
    )
    assert data["start_time"] == "10:00:00"
    assert data["end_time"] == "10:30:00"
    assert data["status"] == "booked"


# =====================================================
# TEST 2: REJECTED DOCTOR CANNOT BE BOOKED
# =====================================================

def test_patient_cannot_book_rejected_doctor(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(approved_doctor),
        headers=patient_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Approved doctor not found."


# =====================================================
# TEST 3: UNAVAILABLE SLOT CANNOT BE BOOKED
# =====================================================

def test_patient_cannot_book_outside_doctor_schedule(
    client,
    patient_headers,
    approved_doctor,
):
    # Doctor schedule ends at 12:00.
    # Therefore, a 12:00–12:30 appointment is unavailable.

    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(
            approved_doctor,
            start_time="12:00:00",
        ),
        headers=patient_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Selected slot is unavailable."


# =====================================================
# TEST 4: SAME SLOT CANNOT BE BOOKED TWICE
# =====================================================

def test_patient_cannot_book_same_slot_twice(
    client,
    patient_headers,
    approved_doctor,
):
    payload = booking_payload(approved_doctor)

    first_response = client.post(
        "/api/v1/appointments",
        json=payload,
        headers=patient_headers,
    )

    assert first_response.status_code == 201

    second_response = client.post(
        "/api/v1/appointments",
        json=payload,
        headers=patient_headers,
    )

    assert second_response.status_code == 409
    assert second_response.json()["detail"] == (
        "Selected slot is unavailable."
    )


# =====================================================
# HELPERS FOR APPOINTMENT OPTIMIZATION TESTS
# =====================================================

def create_second_doctor(db_session, verification_status="approved"):
    user = User(
        full_name="Dr. Second Doctor",
        email=f"doc2_{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD",
        license_number=f"LIC-SEC-{uuid.uuid4().hex[:6]}",
        years_experience=4,
        clinic_name="Second Test Clinic",
        verification_status=verification_status,
    )
    db_session.add(profile)
    db_session.commit()

    token = create_access_token(str(user.id))
    return {
        "user": user,
        "profile": profile,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def create_second_patient(db_session):
    user = User(
        full_name="Second Patient",
        email=f"pat2_{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = PatientProfile(user_id=user.id)
    db_session.add(profile)
    db_session.commit()

    token = create_access_token(str(user.id))
    return {
        "user": user,
        "profile": profile,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def create_admin_user(db_session):
    user = User(
        full_name="Test Administrator",
        email=f"adm_{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()

    token = create_access_token(str(user.id))
    return {
        "user": user,
        "headers": {"Authorization": f"Bearer {token}"},
    }


# =====================================================
# TEST 5: DOCTOR CAN GET OWN APPOINTMENT
# =====================================================

def test_doctor_can_get_own_appointment(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
):
    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=doctor_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(booked_appointment.id)
    assert data["doctor_profile_id"] == str(approved_doctor["profile"].id)
    assert data["patient_name"] == "Test Patient"
    assert data["status"] == "booked"


# =====================================================
# TEST 6: DOCTOR CANNOT GET ANOTHER DOCTOR'S APPOINTMENT
# =====================================================

def test_doctor_cannot_get_other_doctor_appointment(
    client,
    db_session,
    booked_appointment,
):
    second_doctor = create_second_doctor(db_session)

    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=second_doctor["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# TEST 7: PATIENT CAN GET OWN APPOINTMENT
# =====================================================

def test_patient_can_get_own_appointment(
    client,
    patient_headers,
    patient_account,
    booked_appointment,
):
    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=patient_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(booked_appointment.id)
    assert data["patient_profile_id"] == str(patient_account["profile"].id)
    assert data["patient_name"] == "Test Patient"


# =====================================================
# TEST 8: PATIENT CANNOT GET ANOTHER PATIENT'S APPOINTMENT
# =====================================================

def test_patient_cannot_get_other_patient_appointment(
    client,
    db_session,
    booked_appointment,
):
    second_patient = create_second_patient(db_session)

    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=second_patient["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# TEST 9: UNAPPROVED DOCTOR CANNOT ACCESS APPOINTMENT
# =====================================================

def test_unapproved_doctor_cannot_access_appointment(
    client,
    db_session,
    booked_appointment,
):
    unapproved_doc = create_second_doctor(db_session, verification_status="pending")

    # Associate appointment with this unapproved doctor to ensure status check triggers
    booked_appointment.doctor_profile_id = unapproved_doc["profile"].id
    db_session.commit()

    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=unapproved_doc["headers"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only approved doctors can view appointments."


# =====================================================
# TEST 10: UNAUTHENTICATED REQUEST CANNOT ACCESS APPOINTMENT
# =====================================================

def test_unauthenticated_request_cannot_access_appointment(
    client,
    booked_appointment,
):
    response = client.get(f"/api/v1/appointments/{booked_appointment.id}")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing or invalid authentication token."


# =====================================================
# TEST 11: ADMIN CANNOT ACCESS APPOINTMENT DETAIL (RBAC)
# =====================================================

def test_admin_cannot_access_appointment_detail(
    client,
    db_session,
    booked_appointment,
):
    admin = create_admin_user(db_session)

    response = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=admin["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# TEST 12: NONEXISTENT APPOINTMENT ID RETURNS 404
# =====================================================

def test_nonexistent_appointment_returns_404(
    client,
    doctor_headers,
):
    random_id = uuid.uuid4()
    response = client.get(
        f"/api/v1/appointments/{random_id}",
        headers=doctor_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# TEST 13: INVALID UUID FORMAT RETURNS 422
# =====================================================

def test_invalid_uuid_returns_422(
    client,
    doctor_headers,
):
    response = client.get(
        "/api/v1/appointments/invalid-uuid-format-1234",
        headers=doctor_headers,
    )

    assert response.status_code == 422


# =====================================================
# TEST 14: APPOINTMENT QUEUE REGRESSION
# =====================================================

def test_appointment_queue_endpoints_regression(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
):
    # Verify patient queue endpoint /api/v1/appointments/me continues to work
    pat_resp = client.get("/api/v1/appointments/me", headers=patient_headers)
    assert pat_resp.status_code == 200
    pat_data = pat_resp.json()
    assert pat_data["total"] >= 1
    assert any(a["id"] == str(booked_appointment.id) for a in pat_data["items"])

    # Verify doctor queue endpoint /api/v1/appointments/doctor/me continues to work
    doc_resp = client.get("/api/v1/appointments/doctor/me", headers=doctor_headers)
    assert doc_resp.status_code == 200
    doc_data = doc_resp.json()
    assert doc_data["total"] >= 1
    assert any(a["id"] == str(booked_appointment.id) for a in doc_data["items"])

