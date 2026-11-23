import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def other_approved_doctor(db_session, future_monday):
    """Secondary approved doctor fixture for unauthorized access testing."""
    user = User(
        full_name="Dr. Other Specialist",
        email=f"dr.other.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Cardiology",
        qualification="MBBS, MD Cardiology",
        license_number=f"TEST-OTHER-{uuid.uuid4().hex[:6]}",
        years_experience=10,
        clinic_name="Secondary Clinic",
        verification_status="approved",
    )
    db_session.add(profile)
    db_session.flush()

    availability = DoctorAvailability(
        doctor_profile_id=profile.id,
        weekday=future_monday.weekday(),
        start_time=time(10, 0),
        end_time=time(12, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    db_session.add(availability)
    db_session.commit()

    return {
        "user": user,
        "profile": profile,
        "availability": availability,
        "appointment_date": future_monday,
    }


@pytest.fixture
def other_doctor_headers(other_approved_doctor):
    token = create_access_token(subject=str(other_approved_doctor["user"].id))
    return {"Authorization": f"Bearer {token}"}


# =====================================================================
# 1. AUTHORIZED DOCTOR CANCELLATION
# =====================================================================

def test_authorized_doctor_can_cancel_booked_appointment(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Doctor cancels a future booked appointment with valid clinical reason."""
    reason_text = "Doctor emergency surgery required immediately."
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": reason_text},
        headers=doctor_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(booked_appointment.id)
    assert data["status"] == "cancelled"
    assert data["revision"] == 1
    # Preserves original patient booking reason intact without leaking doctor notes
    assert data["reason"] == "Routine consultation"
    assert data["cancellation_reason"] == reason_text
    assert reason_text not in (data["reason"] or "")

    # Verify notification generated for patient with Zero PHI
    patient_notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    )
    assert patient_notif is not None
    assert "cancelled by the doctor" in patient_notif.message
    # Verify private justification is not exposed in patient notification
    assert reason_text not in patient_notif.message

    # Verify audit log recorded without clinical PHI
    audit_entry = db_session.scalar(
        select(AuditLog).where(
            AuditLog.resource_id == str(booked_appointment.id),
            AuditLog.event_type == "appointment.cancelled_by_doctor",
        )
    )
    assert audit_entry is not None
    assert audit_entry.actor_user_id == approved_doctor["user"].id
    assert audit_entry.outcome == "success"
    # Ensure free-text private medical justification is omitted from audit details
    assert "Doctor emergency surgery" not in str(audit_entry.details)


# =====================================================================
# 2. OTHER DOCTOR FORBIDDEN (403)
# =====================================================================

def test_other_doctor_cannot_cancel_unowned_appointment(
    client,
    other_doctor_headers,
    booked_appointment,
):
    """Doctor B cannot cancel Doctor A's appointment."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Attempting to cancel another doctor appointment"},
        headers=other_doctor_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "You cannot cancel another doctor's appointment."


# =====================================================================
# 3. PATIENT ROLE FORBIDDEN (403)
# =====================================================================

def test_patient_forbidden_from_calling_doctor_cancel(
    client,
    patient_headers,
    booked_appointment,
):
    """Patients cannot access the doctor cancellation route."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Patient trying doctor route"},
        headers=patient_headers,
    )

    assert response.status_code == 403
    assert "permission" in response.json()["detail"].lower()


# =====================================================================
# 4. UNAUTHENTICATED REQUEST (401)
# =====================================================================

def test_unauthenticated_request_rejected(
    client,
    booked_appointment,
):
    """Anonymous calls without credentials must be rejected with 401."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "No auth token provided"},
    )

    assert response.status_code == 401


# =====================================================================
# 5. PENDING OR REJECTED DOCTOR FORBIDDEN (403)
# =====================================================================

def test_pending_doctor_cannot_cancel_appointment(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    db_session,
):
    """Pending doctor cannot execute appointment cancellation."""
    approved_doctor["profile"].verification_status = "pending"
    db_session.commit()

    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Pending doctor attempting cancel"},
        headers=doctor_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only approved doctors can cancel appointments."


def test_rejected_doctor_cannot_cancel_appointment(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    db_session,
):
    """Rejected doctor cannot execute appointment cancellation."""
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Rejected doctor attempting cancel"},
        headers=doctor_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only approved doctors can cancel appointments."


# =====================================================================
# 6. INACTIVE DOCTOR FORBIDDEN (403)
# =====================================================================

def test_inactive_doctor_cannot_cancel_appointment(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    db_session,
):
    """Deactivated doctor account is rejected by authentication with 401."""
    approved_doctor["user"].is_active = False
    db_session.commit()

    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Inactive doctor attempting cancel"},
        headers=doctor_headers,
    )

    assert response.status_code == 401


# =====================================================================
# 7. NON-EXISTENT APPOINTMENT (404)
# =====================================================================

def test_nonexistent_appointment_returns_404(
    client,
    doctor_headers,
):
    """Unknown appointment UUID returns 404."""
    random_id = uuid.uuid4()
    response = client.patch(
        f"/api/v1/appointments/doctor/{random_id}/cancel",
        json={"cancellation_reason": "Valid reason for non-existent appt"},
        headers=doctor_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================================
# 8. MANDATORY & VALIDATED REASON (422)
# =====================================================================

def test_missing_reason_returns_422(
    client,
    doctor_headers,
    booked_appointment,
):
    """Omission of cancellation_reason payload returns 422."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={},
        headers=doctor_headers,
    )

    assert response.status_code == 422


def test_short_reason_returns_422(
    client,
    doctor_headers,
    booked_appointment,
):
    """Cancellation reason under 5 characters returns 422."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "abc"},
        headers=doctor_headers,
    )

    assert response.status_code == 422


def test_whitespace_only_reason_returns_422(
    client,
    doctor_headers,
    booked_appointment,
):
    """Whitespace-only reason returns 422."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "     "},
        headers=doctor_headers,
    )

    assert response.status_code == 422


# =====================================================================
# 9. PAST APPOINTMENT REJECTION (409)
# =====================================================================

def test_past_appointment_cannot_be_cancelled(
    client,
    doctor_headers,
    past_booked_appointment,
):
    """Appointments in the past cannot be cancelled."""
    response = client.patch(
        f"/api/v1/appointments/doctor/{past_booked_appointment.id}/cancel",
        json={"cancellation_reason": "Doctor trying to cancel past visit"},
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Appointments cannot be cancelled after their start time."


# =====================================================================
# 10. ALREADY CANCELLED OR COMPLETED REJECTION (409)
# =====================================================================

def test_cannot_cancel_already_cancelled_appointment_without_idempotency(
    client,
    doctor_headers,
    booked_appointment,
):
    """Once cancelled, subsequent calls without matching idempotency key return 409."""
    # First cancellation succeeds
    first_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Doctor initial emergency cancellation"},
        headers=doctor_headers,
    )
    assert first_res.status_code == 200

    # Second cancellation fails
    second_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Doctor secondary cancellation attempt"},
        headers=doctor_headers,
    )
    assert second_res.status_code == 409
    assert "Only booked appointments can be cancelled" in second_res.json()["detail"]


def test_cannot_cancel_completed_appointment(
    client,
    doctor_headers,
    past_booked_appointment,
    db_session,
):
    """Completed appointments cannot be cancelled."""
    past_booked_appointment.status = "completed"
    db_session.commit()

    response = client.patch(
        f"/api/v1/appointments/doctor/{past_booked_appointment.id}/cancel",
        json={"cancellation_reason": "Cannot cancel completed visit"},
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert "Only booked appointments can be cancelled" in response.json()["detail"]


# =====================================================================
# 11. IDEMPOTENT NETWORK RETRY REPLAY
# =====================================================================

def test_doctor_cancellation_idempotency_key_replay(
    client,
    doctor_headers,
    booked_appointment,
):
    """Network retries with identical idempotency key return 200 without error."""
    idempotency_key = f"retry-key-{uuid.uuid4()}"
    payload = {
        "cancellation_reason": "Doctor urgent hospital conference",
        "idempotency_key": idempotency_key,
    }

    # First attempt
    res1 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json=payload,
        headers=doctor_headers,
    )
    assert res1.status_code == 200
    assert res1.json()["status"] == "cancelled"
    rev1 = res1.json()["revision"]

    # Replay with same idempotency key (header or payload)
    res2 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json=payload,
        headers={**doctor_headers, "X-Idempotency-Key": idempotency_key},
    )
    assert res2.status_code == 200
    assert res2.json()["status"] == "cancelled"
    assert res2.json()["revision"] == rev1


# =====================================================================
# 12. CANCELLED SLOT BECOMES AVAILABLE FOR REBOOKING
# =====================================================================

def test_cancelled_slot_becomes_available_and_rebookable(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    """After doctor cancellation, the time slot returns to available slots and can be rebooked."""
    appt_date = approved_doctor["appointment_date"].isoformat()
    start_t = "10:00:00"

    # Verify slot is currently booked (not available in query)
    slots_res_before = client.get(
        f"/api/v1/doctors/{approved_doctor['profile'].id}/availability/slots",
        params={"appointment_date": appt_date},
        headers=patient_headers,
    )
    available_times_before = [
        s["start_time"] for s in slots_res_before.json()["items"]
    ]
    assert start_t not in available_times_before

    # Doctor cancels appointment
    cancel_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Clinical schedule slot release test"},
        headers=doctor_headers,
    )
    assert cancel_res.status_code == 200

    # Verify slot is now available again
    slots_res_after = client.get(
        f"/api/v1/doctors/{approved_doctor['profile'].id}/availability/slots",
        params={"appointment_date": appt_date},
        headers=patient_headers,
    )
    available_times_after = [
        s["start_time"] for s in slots_res_after.json()["items"]
    ]
    assert start_t in available_times_after

    # Patient rebooks the freed slot
    rebook_res = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "appointment_date": appt_date,
            "start_time": start_t,
            "reason": "Rebooking slot after doctor cancellation",
        },
        headers=patient_headers,
    )
    assert rebook_res.status_code == 201
    assert rebook_res.json()["status"] == "booked"


# =====================================================================
# 13. PRESERVE PATIENT CANCELLATION AND RESCHEDULING
# =====================================================================

def test_patient_cancellation_and_reschedule_remain_unaffected(
    client,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    """Patient-initiated cancellation workflow remains intact."""
    res = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=patient_headers,
    )
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


# =====================================================================
# 14. COOKIE AUTHENTICATION & CSRF PROTECTION
# =====================================================================

def test_doctor_cancellation_cookie_auth_requires_csrf_and_origin(
    client,
    approved_doctor,
    booked_appointment,
):
    """Cookie-authenticated requests enforce strict Origin matching and CSRF validation."""
    token = create_access_token(subject=str(approved_doctor["user"].id))
    csrf_token = generate_csrf_token()

    # 1. Cookie request without CSRF header rejected with 403
    client.cookies.set(settings.access_cookie_name, token)
    res_no_csrf = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "CSRF test missing header"},
        headers={"Origin": settings.cors_origin_list[0]},
    )
    assert res_no_csrf.status_code == 403

    # 2. Cookie request with valid matching CSRF and Origin succeeds
    client.cookies.set(settings.csrf_cookie_name, csrf_token)
    res_with_csrf = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Valid CSRF doctor cancellation"},
        headers={
            "Origin": settings.cors_origin_list[0],
            settings.csrf_header_name: csrf_token,
        },
    )
    assert res_with_csrf.status_code == 200
    assert res_with_csrf.json()["status"] == "cancelled"
    client.cookies.clear()


# =====================================================================
# 18. DEVELOPMENT ORIGIN 5174 ACCEPTED & UNAUTHORIZED ORIGINS REJECTED
# =====================================================================

def test_doctor_cancellation_accepts_authorized_development_origins(
    client,
    approved_doctor,
    booked_appointment,
):
    """Verifies that development origins on port 5174 (127.0.0.1 and localhost) are authorized."""
    token = create_access_token(subject=str(approved_doctor["user"].id))
    csrf_token = generate_csrf_token()

    client.cookies.set(settings.access_cookie_name, token)
    client.cookies.set(settings.csrf_cookie_name, csrf_token)

    # 1. http://127.0.0.1:5174 is accepted
    res_5174 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={
            "cancellation_reason": "Emergency schedule shift 5174",
            "idempotency_key": "origin_test_key_5174",
        },
        headers={
            "Origin": "http://127.0.0.1:5174",
            settings.csrf_header_name: csrf_token,
        },
    )
    assert res_5174.status_code == 200
    assert res_5174.json()["status"] == "cancelled"

    # 2. http://localhost:5174 is accepted for idempotent replay
    res_lh_5174 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={
            "cancellation_reason": "Emergency schedule shift 5174",
            "idempotency_key": "origin_test_key_5174",
        },
        headers={
            "Origin": "http://localhost:5174",
            settings.csrf_header_name: csrf_token,
        },
    )
    assert res_lh_5174.status_code == 200
    client.cookies.clear()


def test_doctor_cancellation_rejects_unauthorized_origins(
    client,
    approved_doctor,
    booked_appointment,
):
    """Verifies strict rejection of unauthorized origins, ports, and domains."""
    token = create_access_token(subject=str(approved_doctor["user"].id))
    csrf_token = generate_csrf_token()

    client.cookies.set(settings.access_cookie_name, token)
    client.cookies.set(settings.csrf_cookie_name, csrf_token)

    # 1. External unauthorized domain rejected with 403
    res_evil = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Malicious cross-origin attack"},
        headers={
            "Origin": "https://evil-attacker.example.com",
            settings.csrf_header_name: csrf_token,
        },
    )
    assert res_evil.status_code == 403
    assert "cross-origin request rejected" in res_evil.json()["detail"].lower()

    # 2. Localhost unauthorized port (e.g. 9999) rejected with 403
    res_bad_port = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Bad port attack"},
        headers={
            "Origin": "http://127.0.0.1:9999",
            settings.csrf_header_name: csrf_token,
        },
    )
    assert res_bad_port.status_code == 403
    assert "cross-origin request rejected" in res_bad_port.json()["detail"].lower()

    # 3. Missing/tampered CSRF token on authorized origin 5174 rejected with 403
    res_bad_csrf = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Tampered CSRF attack"},
        headers={
            "Origin": "http://127.0.0.1:5174",
            settings.csrf_header_name: "tampered_csrf_token",
        },
    )
    assert res_bad_csrf.status_code == 403
    assert "csrf" in res_bad_csrf.json()["detail"].lower()

    client.cookies.clear()
