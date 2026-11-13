
from datetime import time
from uuid import uuid4

import pytest

from app.models.doctor_availability import DoctorAvailability


PUBLIC_AVAILABILITY_ENDPOINT = "/api/v1/doctors/{}/availability"


# =====================================================
# 1. PATIENT CAN VIEW APPROVED DOCTOR AVAILABILITY
# =====================================================

def test_patient_can_view_approved_doctor_availability(
    client,
    patient_headers,
    approved_doctor,
):
    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    schedule = data["items"][0]

    assert schedule["weekday"] == approved_doctor["availability"].weekday
    assert schedule["start_time"] == "10:00:00"
    assert schedule["end_time"] == "12:00:00"
    assert schedule["slot_duration_minutes"] == 30

    # Internal database fields must not be exposed.
    assert "id" not in schedule
    assert "doctor_profile_id" not in schedule
    assert "is_active" not in schedule


# =====================================================
# 2. PENDING / REJECTED DOCTORS MUST NOT BE VISIBLE
# =====================================================

@pytest.mark.parametrize("verification_status", ["pending", "rejected"])
def test_patient_cannot_view_unapproved_doctor_availability(
    client,
    db_session,
    patient_headers,
    approved_doctor,
    verification_status,
):
    approved_doctor["profile"].verification_status = (
        verification_status
    )
    db_session.commit()

    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Approved doctor not found."


# =====================================================
# 3. INACTIVE DOCTOR ACCOUNT MUST NOT BE VISIBLE
# =====================================================

def test_patient_cannot_view_inactive_doctor_availability(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    approved_doctor["user"].is_active = False
    db_session.commit()

    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Approved doctor not found."


# =====================================================
# 4. ONLY ACTIVE SCHEDULES MUST BE RETURNED
# =====================================================

def test_public_availability_returns_only_active_schedules(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    inactive_schedule = DoctorAvailability(
        doctor_profile_id=approved_doctor["profile"].id,
        weekday=approved_doctor["availability"].weekday,
        start_time=time(13, 0),
        end_time=time(14, 0),
        slot_duration_minutes=30,
        is_active=False,
    )

    db_session.add(inactive_schedule)
    db_session.commit()

    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        ),
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1

    assert data["items"][0]["start_time"] == "10:00:00"
    assert data["items"][0]["end_time"] == "12:00:00"


# =====================================================
# 5. UNKNOWN DOCTOR MUST RETURN 404
# =====================================================

def test_patient_gets_404_for_unknown_doctor(
    client,
    patient_headers,
):
    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(uuid4()),
        headers=patient_headers,
    )

    assert response.status_code == 404


# =====================================================
# 6. DOCTOR MUST NOT USE PATIENT PUBLIC ENDPOINT
# =====================================================

def test_doctor_cannot_access_public_patient_availability_endpoint(
    client,
    doctor_headers,
    approved_doctor,
):
    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        ),
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 7. AUTHENTICATION IS REQUIRED
# =====================================================

def test_public_availability_requires_patient_authentication(
    client,
    approved_doctor,
):
    response = client.get(
        PUBLIC_AVAILABILITY_ENDPOINT.format(
            approved_doctor["profile"].id
        )
    )

    assert response.status_code == 401
