import uuid
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
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
    user = User(
        full_name="Dr. Privacy Specialist",
        email=f"dr.privacy.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Internal Medicine",
        qualification="MBBS, MD",
        license_number=f"TEST-PRIV-{uuid.uuid4().hex[:6]}",
        years_experience=8,
        clinic_name="Confidentiality Test Clinic",
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
# 1. PATIENT LIST ENDPOINT NEVER EXPOSES DOCTOR CANCELLATION REASON
# =====================================================================

def test_patient_list_endpoint_never_exposes_doctor_cancellation_reason(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
):
    """Doctor private cancellation justification must NEVER appear in patient's list response."""
    confidential_doctor_reason = (
        "CONFIDENTIAL: Physician acute medical illness - admitted to ICU"
    )

    # Doctor cancels appointment with sensitive justification
    cancel_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": confidential_doctor_reason},
        headers=doctor_headers,
    )
    assert cancel_res.status_code == 200

    # Patient fetches their appointment list
    list_res = client.get(
        "/api/v1/appointments/me",
        headers=patient_headers,
    )
    assert list_res.status_code == 200
    list_data = list_res.json()

    # Find the cancelled appointment
    target_appt = next(
        (a for a in list_data["items"] if a["id"] == str(booked_appointment.id)),
        None,
    )
    assert target_appt is not None
    assert target_appt["status"] == "cancelled"

    # Preserves patient's original consultation reason
    assert target_appt["reason"] == "Routine consultation"

    # Entire response body must NOT contain the sensitive doctor justification
    assert confidential_doctor_reason not in list_res.text
    assert "ICU" not in list_res.text
    assert "CONFIDENTIAL" not in list_res.text


# =====================================================================
# 2. PATIENT DETAIL ENDPOINT NEVER EXPOSES DOCTOR CANCELLATION REASON
# =====================================================================

def test_patient_detail_endpoint_never_exposes_doctor_cancellation_reason(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
):
    """Doctor private cancellation justification must NEVER appear in patient's detail response."""
    confidential_reason = "CONFIDENTIAL: Internal clinic emergency staffing shortage"

    cancel_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": confidential_reason},
        headers=doctor_headers,
    )
    assert cancel_res.status_code == 200

    # Patient inspects the appointment
    detail_res = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=patient_headers,
    )
    assert detail_res.status_code == 200
    detail_data = detail_res.json()

    assert detail_data["status"] == "cancelled"
    assert detail_data["reason"] == "Routine consultation"
    assert confidential_reason not in detail_res.text


# =====================================================================
# 3. PATIENT NOTIFICATION IS NEUTRAL AND CONTAINS ZERO DOCTOR NOTES
# =====================================================================

def test_patient_notification_is_neutral_and_contains_zero_doctor_notes(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
    db_session,
):
    """Patient in-app notification must be strictly neutral and contain zero doctor notes."""
    sensitive_reason = "Physician urgent family emergency out of town"

    client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": sensitive_reason},
        headers=doctor_headers,
    )

    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    )
    assert notif is not None
    assert notif.title == "Appointment Cancelled"
    assert "has been cancelled by the doctor." in notif.message
    # Critical Non-Disclosure: doctor's private reason is absent
    assert sensitive_reason not in notif.message
    assert sensitive_reason not in notif.title
    assert sensitive_reason not in (notif.safe_action_path or "")


# =====================================================================
# 4. DEFENSE-IN-DEPTH: SANITIZATION OF LEGACY APPENDED DOCTOR REASONS
# =====================================================================

def test_legacy_appended_doctor_reason_sanitization(
    client,
    patient_headers,
    booked_appointment,
    db_session,
):
    """Existing records in DB with legacy appended doctor reasons are safely sanitized for patients."""
    # Simulate legacy database row where doctor note was previously appended
    booked_appointment.status = "cancelled"
    booked_appointment.reason = (
        "Severe migraine | [Doctor Cancelled: Physician acute stress leave]"
    )
    db_session.commit()

    # 1. Patient list query
    list_res = client.get("/api/v1/appointments/me", headers=patient_headers)
    assert list_res.status_code == 200
    target = next(
        a for a in list_res.json()["items"] if a["id"] == str(booked_appointment.id)
    )
    assert target["reason"] == "Severe migraine"
    assert "Doctor Cancelled" not in list_res.text
    assert "stress leave" not in list_res.text

    # 2. Patient detail query
    detail_res = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=patient_headers,
    )
    assert detail_res.status_code == 200
    assert detail_res.json()["reason"] == "Severe migraine"
    assert "Doctor Cancelled" not in detail_res.text
    assert "stress leave" not in detail_res.text


def test_legacy_only_doctor_reason_sanitization(
    client,
    patient_headers,
    booked_appointment,
    db_session,
):
    """Legacy rows containing only doctor cancellation reason sanitize to None for patients."""
    booked_appointment.status = "cancelled"
    booked_appointment.reason = "[Doctor Cancelled: Clinic administrative shutdown]"
    db_session.commit()

    detail_res = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers=patient_headers,
    )
    assert detail_res.status_code == 200
    assert detail_res.json()["reason"] is None
    assert "Clinic administrative shutdown" not in detail_res.text


# =====================================================================
# 5. AUDIT LOG PRESERVES CANCELLATION REASON FOR ADMINS ONLY
# =====================================================================

def test_audit_log_preserves_cancellation_reason_for_admins_only(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """Audit log records cancellation reason for compliance; patients are strictly forbidden from audit logs."""
    admin_auditable_reason = "Doctor mandatory hospital emergency duty"

    cancel_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": admin_auditable_reason},
        headers=doctor_headers,
    )
    assert cancel_res.status_code == 200

    # Verify audit log in database
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.resource_id == str(booked_appointment.id),
            AuditLog.event_type == "appointment.cancelled_by_doctor",
        )
    )
    assert audit is not None
    assert audit.actor_user_id == approved_doctor["user"].id
    assert audit.details.get("action") == "doctor_cancellation"
    assert audit.details.get("cancellation_reason_provided") is True
    # Clinical/free-text information must NOT be leaked into audit metadata details
    assert admin_auditable_reason not in str(audit.details)

    # Patient is forbidden from querying audit logs endpoint
    audit_res = client.get("/api/v1/admin/audit-logs", headers=patient_headers)
    assert audit_res.status_code == 403


# =====================================================================
# 6. IDEMPOTENCY KEY BOUND TO SPECIFIC APPOINTMENT & DOCTOR
# =====================================================================

def test_idempotency_key_cannot_replay_across_different_appointments(
    client,
    doctor_headers,
    patient_account,
    approved_doctor,
    db_session,
):
    """An idempotency key used for Appointment 1 cannot replay cancellation for Appointment 2."""
    # Create two distinct future booked appointments for the same doctor
    appt1 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Consultation 1",
    )
    appt2 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
        status="booked",
        reason="Consultation 2",
    )
    db_session.add_all([appt1, appt2])
    db_session.commit()
    db_session.refresh(appt1)
    db_session.refresh(appt2)

    shared_key = f"cross-appt-key-{uuid.uuid4()}"

    # 1. Cancel Appointment 1 with shared_key
    res1 = client.patch(
        f"/api/v1/appointments/doctor/{appt1.id}/cancel",
        json={"cancellation_reason": "Cancelling visit 1", "idempotency_key": shared_key},
        headers=doctor_headers,
    )
    assert res1.status_code == 200
    assert res1.json()["id"] == str(appt1.id)
    assert res1.json()["status"] == "cancelled"

    # 2. Attempting to use shared_key on Appointment 2 does NOT replay Appt 1's record;
    # it executes a distinct cancellation for Appt 2
    res2 = client.patch(
        f"/api/v1/appointments/doctor/{appt2.id}/cancel",
        json={"cancellation_reason": "Cancelling visit 2", "idempotency_key": shared_key},
        headers=doctor_headers,
    )
    assert res2.status_code == 200
    assert res2.json()["id"] == str(appt2.id)
    assert res2.json()["status"] == "cancelled"


def test_idempotency_key_cannot_replay_across_unrelated_doctors(
    client,
    other_doctor_headers,
    booked_appointment,
):
    """Doctor B cannot use an idempotency key to replay or access Doctor A's appointment."""
    key = f"stolen-key-{uuid.uuid4()}"

    res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Attempting cross-doctor replay", "idempotency_key": key},
        headers={**other_doctor_headers, "X-Idempotency-Key": key},
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "You cannot cancel another doctor's appointment."


# =====================================================================
# 7. DUPLICATE REQUESTS DO NOT GENERATE DUPLICATE NOTIFICATIONS
# =====================================================================

def test_duplicate_requests_do_not_generate_duplicate_notifications(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
    db_session,
):
    """Network retries and duplicate cancellations never create duplicate notifications."""
    idempotency_key = f"notif-dedup-{uuid.uuid4()}"

    # First request
    res1 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Clinical schedule override", "idempotency_key": idempotency_key},
        headers=doctor_headers,
    )
    assert res1.status_code == 200

    count_after_first = db_session.scalar(
        select(select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        ).exists())
    )
    assert count_after_first is True

    # Replay identical request
    res2 = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Clinical schedule override", "idempotency_key": idempotency_key},
        headers={**doctor_headers, "X-Idempotency-Key": idempotency_key},
    )
    assert res2.status_code == 200

    # Total matching notifications must still be exactly 1
    total_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(total_notifs) == 1
