
from datetime import time

import pytest

from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User


PATIENT_APPOINTMENTS = "/api/v1/appointments/me"
DOCTOR_APPOINTMENTS = "/api/v1/appointments/doctor/me"


def create_extra_appointment(
    db_session,
    *,
    patient_profile_id,
    doctor_profile_id,
    appointment_date,
    start_time,
    end_time,
):
    appointment = Appointment(
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        appointment_date=appointment_date,
        start_time=start_time,
        end_time=end_time,
        status="booked",
        reason="Dashboard test appointment",
    )

    db_session.add(appointment)
    db_session.commit()
    db_session.refresh(appointment)

    return appointment


# =====================================================
# 1. PATIENT CAN ONLY VIEW OWN APPOINTMENTS
# =====================================================

def test_patient_can_only_view_own_appointments(
    client,
    db_session,
    patient_headers,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    # Create another patient's account.
    other_user = User(
        full_name="Other Test Patient",
        email="other.patient@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_profile = PatientProfile(user_id=other_user.id)
    db_session.add(other_profile)
    db_session.commit()

    # Create an appointment belonging to the other patient.
    create_extra_appointment(
        db_session,
        patient_profile_id=other_profile.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
    )

    response = client.get(
        PATIENT_APPOINTMENTS,
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    assert data["items"][0]["id"] == str(booked_appointment.id)

    assert data["items"][0]["patient_profile_id"] == str(
        patient_account["profile"].id
    )


# =====================================================
# 2. DOCTOR CAN VIEW OWN APPOINTMENTS AND PATIENT NAME
# =====================================================

def test_doctor_can_view_own_appointments_and_patient_name(
    client,
    doctor_headers,
    patient_account,
    booked_appointment,
):
    response = client.get(
        DOCTOR_APPOINTMENTS,
        headers=doctor_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    appointment = data["items"][0]

    assert appointment["id"] == str(booked_appointment.id)

    assert appointment["patient_name"] == (
        patient_account["user"].full_name
    )


# =====================================================
# 3. DOCTOR MUST NOT SEE ANOTHER DOCTOR'S APPOINTMENTS
# =====================================================

def test_doctor_can_only_view_own_appointments(
    client,
    db_session,
    doctor_headers,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    other_user = User(
        full_name="Other Test Doctor",
        email="other.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_doctor = DoctorProfile(
        user_id=other_user.id,
        specialization="Cardiology",
        qualification="MBBS, MD",
        license_number="TEST-ONLY-OTHER-DOCTOR-001",
        years_experience=3,
        clinic_name="Other Test Clinic",
        verification_status="approved",
    )

    db_session.add(other_doctor)
    db_session.commit()

    create_extra_appointment(
        db_session,
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=other_doctor.id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
    )

    response = client.get(
        DOCTOR_APPOINTMENTS,
        headers=doctor_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    assert data["items"][0]["id"] == str(booked_appointment.id)


# =====================================================
# 4. PATIENT CANNOT ACCESS DOCTOR DASHBOARD
# =====================================================

def test_patient_cannot_access_doctor_appointment_dashboard(
    client,
    patient_headers,
):
    response = client.get(
        DOCTOR_APPOINTMENTS,
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 5. DOCTOR CANNOT ACCESS PATIENT DASHBOARD
# =====================================================

def test_doctor_cannot_access_patient_appointment_dashboard(
    client,
    doctor_headers,
):
    response = client.get(
        PATIENT_APPOINTMENTS,
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 6. PATIENT APPOINTMENT PAGINATION
# =====================================================

def test_patient_appointment_dashboard_pagination(
    client,
    db_session,
    patient_headers,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    create_extra_appointment(
        db_session,
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
    )

    response = client.get(
        PATIENT_APPOINTMENTS,
        params={
            "limit": 1,
            "offset": 1,
        },
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 2
    assert len(data["items"]) == 1
    assert data["limit"] == 1
    assert data["offset"] == 1

    # The second page contains the earlier appointment.
    assert data["items"][0]["id"] == str(booked_appointment.id)


# =====================================================
# 7. DOCTOR APPOINTMENT PAGINATION
# =====================================================

def test_doctor_appointment_dashboard_pagination(
    client,
    db_session,
    doctor_headers,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    create_extra_appointment(
        db_session,
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
    )

    response = client.get(
        DOCTOR_APPOINTMENTS,
        params={
            "limit": 1,
            "offset": 1,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 2
    assert len(data["items"]) == 1
    assert data["limit"] == 1
    assert data["offset"] == 1

    assert data["items"][0]["id"] == str(booked_appointment.id)
