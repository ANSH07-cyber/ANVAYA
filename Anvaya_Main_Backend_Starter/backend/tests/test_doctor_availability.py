
from datetime import time, timedelta, datetime
from zoneinfo import ZoneInfo
from uuid import uuid4
import uuid

import pytest

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


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


# =====================================================
# DOCTOR AVAILABILITY LIFECYCLE MANAGEMENT TESTS (Phase 5.6.2)
# =====================================================

MY_AVAILABILITY_ENDPOINT = "/api/v1/doctors/me/availability"


def _create_second_doctor(db_session, weekday):
    user = User(
        full_name="Second Doctor",
        email=f"second.doc.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD Pediatrics",
        license_number=f"TEST-SEC-{uuid4().hex[:6]}",
        years_experience=8,
        clinic_name="Pediatric Care",
        verification_status="approved",
    )
    db_session.add(profile)
    db_session.flush()
    availability = DoctorAvailability(
        doctor_profile_id=profile.id,
        weekday=weekday,
        start_time=time(14, 0),
        end_time=time(17, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    db_session.add(availability)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {
        "user": user,
        "profile": profile,
        "availability": availability,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def test_doctor_can_update_own_availability(
    client,
    doctor_headers,
    approved_doctor,
    future_monday,
):
    avail_id = approved_doctor["availability"].id
    payload = {
        "weekday": future_monday.weekday(),
        "start_time": "09:00:00",
        "end_time": "11:00:00",
        "slot_duration_minutes": 15,
    }
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json=payload,
        headers=doctor_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(avail_id)
    assert data["start_time"] == "09:00:00"
    assert data["end_time"] == "11:00:00"
    assert data["slot_duration_minutes"] == 15
    assert data["is_active"] is True


def test_doctor_can_deactivate_own_availability(
    client,
    doctor_headers,
    approved_doctor,
):
    avail_id = approved_doctor["availability"].id
    response = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}/status",
        json={"is_active": False},
        headers=doctor_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(avail_id)
    assert data["is_active"] is False


def test_doctor_can_reactivate_inactive_availability(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
):
    avail = approved_doctor["availability"]
    avail.is_active = False
    db_session.commit()

    response = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail.id}/status",
        json={"is_active": True},
        headers=doctor_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(avail.id)
    assert data["is_active"] is True


def test_inactive_shift_generates_no_slots(
    client,
    db_session,
    patient_headers,
    approved_doctor,
    future_monday,
):
    avail = approved_doctor["availability"]
    avail.is_active = False
    db_session.commit()

    # Slots query for that doctor on future_monday
    response = client.get(
        f"/api/v1/doctors/{approved_doctor['profile'].id}/availability/slots?appointment_date={future_monday.isoformat()}",
        headers=patient_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert len(data["items"]) == 0


def test_inactive_shift_does_not_block_new_active_shift(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    future_monday,
):
    # Deactivate existing shift (10:00 - 12:00)
    avail = approved_doctor["availability"]
    avail.is_active = False
    db_session.commit()

    # Create new active shift covering overlapping window (10:30 - 12:30)
    # Because the existing shift is inactive, the application-level overlap check ignores it and allows creation.
    new_payload = {
        "weekday": future_monday.weekday(),
        "start_time": "10:30:00",
        "end_time": "12:30:00",
        "slot_duration_minutes": 20,
    }
    response = client.post(
        MY_AVAILABILITY_ENDPOINT,
        json=new_payload,
        headers=doctor_headers,
    )

    assert response.status_code == 201
    assert response.json()["slot_duration_minutes"] == 20


def test_reactivation_rejects_overlapping_active_shift(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    future_monday,
):
    # Doctor has shift 1 (10:00 - 12:00, active).
    # Create shift 2 (11:00 - 13:00, inactive).
    shift2 = DoctorAvailability(
        doctor_profile_id=approved_doctor["profile"].id,
        weekday=future_monday.weekday(),
        start_time=time(11, 0),
        end_time=time(13, 0),
        slot_duration_minutes=30,
        is_active=False,
    )
    db_session.add(shift2)
    db_session.commit()

    # Attempt to reactivate shift 2
    response = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{shift2.id}/status",
        json={"is_active": True},
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "overlaps another active schedule" in response.json()["detail"]


def test_cross_doctor_update_returns_404(
    client,
    db_session,
    approved_doctor,
    future_monday,
):
    doctor_b = _create_second_doctor(db_session, future_monday.weekday())
    doc_a_avail_id = approved_doctor["availability"].id

    payload = {
        "weekday": future_monday.weekday(),
        "start_time": "08:00:00",
        "end_time": "10:00:00",
        "slot_duration_minutes": 30,
    }

    # Doctor B tries to update Doctor A's availability
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{doc_a_avail_id}",
        json=payload,
        headers=doctor_b["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Availability schedule not found."


def test_cross_doctor_status_toggle_returns_404(
    client,
    db_session,
    approved_doctor,
    future_monday,
):
    doctor_b = _create_second_doctor(db_session, future_monday.weekday())
    doc_a_avail_id = approved_doctor["availability"].id

    # Doctor B tries to toggle Doctor A's availability
    response = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{doc_a_avail_id}/status",
        json={"is_active": False},
        headers=doctor_b["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Availability schedule not found."


def test_cross_doctor_delete_returns_404(
    client,
    db_session,
    approved_doctor,
    future_monday,
):
    doctor_b = _create_second_doctor(db_session, future_monday.weekday())
    doc_a_avail_id = approved_doctor["availability"].id

    # Doctor B tries to soft-delete Doctor A's availability
    response = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{doc_a_avail_id}",
        headers=doctor_b["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Availability schedule not found."


@pytest.mark.parametrize("verification_status", ["pending", "rejected"])
def test_unapproved_doctor_cannot_manage_availability(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    future_monday,
    verification_status,
):
    approved_doctor["profile"].verification_status = verification_status
    db_session.commit()
    avail_id = approved_doctor["availability"].id

    # PUT
    res_put = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "08:00:00",
            "end_time": "10:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )
    assert res_put.status_code == 403
    assert res_put.json()["detail"] == "Only approved doctors can manage availability."

    # PATCH
    res_patch = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}/status",
        json={"is_active": False},
        headers=doctor_headers,
    )
    assert res_patch.status_code == 403
    assert res_patch.json()["detail"] == "Only approved doctors can manage availability."

    # DELETE
    res_del = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        headers=doctor_headers,
    )
    assert res_del.status_code == 403
    assert res_del.json()["detail"] == "Only approved doctors can manage availability."


def test_nonexistent_availability_id_returns_404(
    client,
    doctor_headers,
    future_monday,
):
    random_id = uuid4()
    # PUT
    res_put = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{random_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "08:00:00",
            "end_time": "10:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )
    assert res_put.status_code == 404
    assert res_put.json()["detail"] == "Availability schedule not found."

    # PATCH
    res_patch = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{random_id}/status",
        json={"is_active": False},
        headers=doctor_headers,
    )
    assert res_patch.status_code == 404

    # DELETE
    res_del = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{random_id}",
        headers=doctor_headers,
    )
    assert res_del.status_code == 404


def test_malformed_uuid_returns_422(
    client,
    doctor_headers,
):
    malformed_id = "not-a-valid-uuid"
    res_put = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{malformed_id}",
        json={
            "weekday": 0,
            "start_time": "08:00:00",
            "end_time": "10:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )
    assert res_put.status_code == 422

    res_patch = client.patch(
        f"{MY_AVAILABILITY_ENDPOINT}/{malformed_id}/status",
        json={"is_active": False},
        headers=doctor_headers,
    )
    assert res_patch.status_code == 422

    res_del = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{malformed_id}",
        headers=doctor_headers,
    )
    assert res_del.status_code == 422


def test_update_shift_overlapping_existing_active_shift_returns_409(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    future_monday,
):
    # Doctor has shift 1: 10:00 - 12:00
    # Add shift 2: 14:00 - 16:00
    shift2 = DoctorAvailability(
        doctor_profile_id=approved_doctor["profile"].id,
        weekday=future_monday.weekday(),
        start_time=time(14, 0),
        end_time=time(16, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    db_session.add(shift2)
    db_session.commit()

    # Attempt to update shift 2 to 11:00 - 13:00 (which overlaps shift 1 at 11:00 - 12:00)
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{shift2.id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "11:00:00",
            "end_time": "13:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "overlaps an existing active schedule" in response.json()["detail"]


def test_booked_appointments_remain_intact_after_shift_deactivation(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    booked_appointment,
):
    avail_id = approved_doctor["availability"].id

    # Soft-delete the shift via DELETE endpoint
    response = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    # Verify the availability row is preserved in database (not deleted)
    db_session.expire_all()
    avail_in_db = db_session.get(DoctorAvailability, avail_id)
    assert avail_in_db is not None
    assert avail_in_db.is_active is False

    # Verify the appointment is still intact and booked
    apt_in_db = db_session.get(Appointment, booked_appointment.id)
    assert apt_in_db is not None
    assert apt_in_db.status == "booked"


def test_updating_shift_conflicting_with_booked_appointment_returns_409(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    future_monday,
):
    # Booked appointment is 10:00 - 10:30 on future_monday
    # Doctor tries to update shift from 10:00-12:00 to 10:30-12:00 (excluding 10:00-10:30)
    avail_id = approved_doctor["availability"].id
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "10:30:00",
            "end_time": "12:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "future booked appointments would fall outside" in response.json()["detail"]


def test_updating_shift_enclosing_booked_appointment_succeeds(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    future_monday,
):
    # Booked appointment is 10:00 - 10:30 on future_monday
    # Doctor expands shift from 10:00-12:00 to 09:00-13:00 (which encloses the appointment)
    avail_id = approved_doctor["availability"].id
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "09:00:00",
            "end_time": "13:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 200
    assert response.json()["start_time"] == "09:00:00"
    assert response.json()["end_time"] == "13:00:00"


def test_soft_delete_preserves_row_and_marks_inactive(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
):
    avail_id = approved_doctor["availability"].id
    initial_count = db_session.query(DoctorAvailability).count()

    response = client.delete(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    # Row count must NOT decrease (zero hard deletion)
    after_count = db_session.query(DoctorAvailability).count()
    assert after_count == initial_count

    db_session.expire_all()
    avail = db_session.get(DoctorAvailability, avail_id)
    assert avail is not None
    assert avail.is_active is False


def test_updating_shift_weekday_conflicting_with_booked_appointment_returns_409(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    future_monday,
):
    # Booked appointment exists on future_monday
    # Doctor attempts to change shift weekday to Tuesday
    tuesday_weekday = (future_monday.weekday() + 1) % 7
    avail_id = approved_doctor["availability"].id

    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": tuesday_weekday,
            "start_time": "10:00:00",
            "end_time": "12:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "future booked appointments would fall outside" in response.json()["detail"]


def test_updating_shift_end_time_boundary_conflicting_with_booked_appointment_returns_409(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    future_monday,
):
    # Booked appointment is 10:00 - 10:30
    # Doctor attempts to shrink end_time to 10:15:00 (so apt.end_time > payload.end_time)
    avail_id = approved_doctor["availability"].id

    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "10:00:00",
            "end_time": "10:15:00",
            "slot_duration_minutes": 15,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "future booked appointments would fall outside" in response.json()["detail"]


@pytest.mark.parametrize("non_conflict_status", ["cancelled", "completed"])
def test_updating_shift_excluding_cancelled_or_completed_appointment_succeeds(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    patient_account,
    future_monday,
    non_conflict_status,
):
    # Create an appointment in the 10:00 - 10:30 window with status cancelled/completed
    appointment = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=future_monday,
        start_time=time(10, 0),
        end_time=time(10, 30),
        status=non_conflict_status,
        reason="Past or cancelled appointment",
    )
    db_session.add(appointment)
    db_session.commit()

    # Doctor updates shift from 10:00-12:00 to 10:30-12:00 (excluding the 10:00-10:30 slot)
    avail_id = approved_doctor["availability"].id
    response = client.put(
        f"{MY_AVAILABILITY_ENDPOINT}/{avail_id}",
        json={
            "weekday": future_monday.weekday(),
            "start_time": "10:30:00",
            "end_time": "12:00:00",
            "slot_duration_minutes": 30,
        },
        headers=doctor_headers,
    )

    assert response.status_code == 200
    assert response.json()["start_time"] == "10:30:00"
    assert response.json()["end_time"] == "12:00:00"


