from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import uuid

import pytest
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models.appointment import Appointment
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.prescription import Prescription
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def admin_account(db_session):
    admin_user = User(
        full_name="Admin Notification Tester",
        email=f"admin.notif.{uuid.uuid4().hex[:6]}@example.com",
        password_hash=hash_password("AdminPassword@123"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin_user)
    db_session.commit()
    token = create_access_token(subject=str(admin_user.id))
    return {"user": admin_user, "headers": {"Authorization": f"Bearer {token}"}}


# =====================================================================
# 1. APPOINTMENT BOOKING EVENT NOTIFICATIONS
# =====================================================================

def test_appointment_booking_creates_dual_notifications(
    client,
    patient_account,
    approved_doctor,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    doctor_profile = approved_doctor["profile"]
    appointment_date = approved_doctor["appointment_date"]

    payload = {
        "doctor_profile_id": str(doctor_profile.id),
        "appointment_date": appointment_date.isoformat(),
        "start_time": "10:00:00",
        "reason": "General checkup consultation",
    }

    response = client.post("/api/v1/appointments", json=payload, headers=patient_headers)
    assert response.status_code == 201
    appt_id = response.json()["id"]

    # 1. Verify Patient Notification
    patient_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.related_entity_id == appt_id,
        )
    ).all()
    assert len(patient_notifs) == 1
    p_notif = patient_notifs[0]
    assert p_notif.notification_type == "appointment.booked"
    assert p_notif.title == "Consultation Confirmed"
    assert "confirmed" in p_notif.message.lower()
    assert p_notif.safe_action_path == "/patient/appointments"
    assert p_notif.is_read is False

    # 2. Verify Doctor Notification
    doctor_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.related_entity_id == appt_id,
        )
    ).all()
    assert len(doctor_notifs) == 1
    d_notif = doctor_notifs[0]
    assert d_notif.notification_type == "appointment.booked"
    assert d_notif.title == "New Appointment Scheduled"
    assert "scheduled a consultation" in d_notif.message
    assert d_notif.safe_action_path == "/doctor/appointments"

    # 3. Privacy / Zero-PHI Check: Ensure reason is not leaked in notifications
    assert "General checkup" not in p_notif.message
    assert "General checkup" not in d_notif.message


# =====================================================================
# 2. APPOINTMENT CANCELLATION EVENT NOTIFICATIONS
# =====================================================================

def test_appointment_cancellation_creates_dual_notifications(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]

    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=patient_headers,
    )
    assert response.status_code == 200

    # 1. Verify Patient Cancellation Notification
    p_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(p_notifs) == 1
    assert p_notifs[0].title == "Appointment Cancelled"
    assert "cancelled" in p_notifs[0].message.lower()
    assert p_notifs[0].safe_action_path == "/patient/appointments"

    # 2. Verify Doctor Cancellation Notification
    d_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.notification_type == "appointment.cancelled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(d_notifs) == 1
    assert d_notifs[0].title == "Appointment Cancelled"
    assert "cancelled by the patient" in d_notifs[0].message
    assert d_notifs[0].safe_action_path == "/doctor/appointments"


# =====================================================================
# 3. APPOINTMENT RESCHEDULING EVENT NOTIFICATIONS
# =====================================================================

def test_appointment_rescheduling_creates_dual_notifications(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]

    reschedule_payload = {
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:30:00",
    }

    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json=reschedule_payload,
        headers=patient_headers,
    )
    assert response.status_code == 200

    # 1. Patient Reschedule Notification
    p_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.rescheduled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(p_notifs) == 1
    assert p_notifs[0].title == "Appointment Rescheduled"
    assert "rescheduled to" in p_notifs[0].message
    assert p_notifs[0].safe_action_path == "/patient/appointments"

    # 2. Doctor Reschedule Notification
    d_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.notification_type == "appointment.rescheduled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(d_notifs) == 1
    assert d_notifs[0].title == "Appointment Rescheduled"
    assert "rescheduled to" in d_notifs[0].message
    assert d_notifs[0].safe_action_path == "/doctor/appointments"


# =====================================================================
# 4. PRESCRIPTION CREATION EVENT NOTIFICATIONS (ZERO PHI)
# =====================================================================

def test_prescription_creation_creates_patient_notification(
    client,
    patient_account,
    approved_doctor,
    past_booked_appointment,
    doctor_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    doctor_profile = approved_doctor["profile"]

    # 1. Complete consultation and create health record
    past_booked_appointment.status = "completed"
    health_record = HealthRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doctor_profile.id,
        appointment_id=past_booked_appointment.id,
        visit_date=past_booked_appointment.appointment_date,
        visit_summary="Consultation completed successfully.",
        chief_complaint="Dermatological evaluation",
        symptoms="Mild eczema rash",
        diagnosis="Atopic dermatitis",
        clinical_notes="Prescribed topical medication.",
        treatment_plan="Apply ointment twice daily.",
        follow_up_instructions="Review in 10 days.",
    )
    db_session.add(health_record)
    db_session.commit()

    # 2. Issue digital prescription
    rx_payload = {
        "appointment_id": str(past_booked_appointment.id),
        "notes": "Follow regimen strictly.",
        "items": [
            {
                "medicine_name": "Hydrocortisone 1% Cream",
                "dosage": "Thin layer twice daily",
                "frequency": "Twice daily",
                "duration": "7 days",
                "instructions": "For topical application only",
            }
        ],
    }

    rx_res = client.post("/api/v1/prescriptions", json=rx_payload, headers=doctor_headers)
    assert rx_res.status_code == 201
    rx_id = rx_res.json()["id"]

    # 3. Verify Patient Notification
    rx_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "prescription.issued",
            Notification.related_entity_id == rx_id,
        )
    ).all()
    assert len(rx_notifs) == 1
    p_rx = rx_notifs[0]
    assert p_rx.title == "New Prescription Available"
    assert "digital prescription" in p_rx.message
    assert p_rx.safe_action_path == "/patient/prescriptions"

    # 4. Strict Zero-PHI Check: Medication name and dosage must NOT appear in notification
    assert "Hydrocortisone" not in p_rx.message
    assert "Atopic dermatitis" not in p_rx.message
    assert "eczema" not in p_rx.message


# =====================================================================
# 5. DOCTOR ONBOARDING & VERIFICATION LIFECYCLE NOTIFICATIONS
# =====================================================================

def test_doctor_onboarding_and_verification_notifications(
    client,
    admin_account,
    db_session,
):
    admin_user = admin_account["user"]
    admin_headers = admin_account["headers"]

    unique_suffix = uuid.uuid4().hex[:6]
    doc_payload = {
        "full_name": f"Dr. Event Tester {unique_suffix}",
        "email": f"dr.event.{unique_suffix}@example.com",
        "password": "DoctorSecure@123",
        "specialization": "Cardiology",
        "qualification": "MBBS, MD Cardiology",
        "license_number": f"LIC-EVENT-{unique_suffix}",
        "years_experience": 10,
        "clinic_name": "Cardio Health Center",
        "consultation_fee": 1500,
        "bio": "Experienced cardiologist.",
    }

    # 1. Admin creates doctor
    create_res = client.post("/api/v1/admin/doctors", json=doc_payload, headers=admin_headers)
    assert create_res.status_code == 201
    created_profile_id = create_res.json()["id"]
    created_user_id = uuid.UUID(create_res.json()["user_id"])

    # Verify Doctor received application received notification
    doc_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == created_user_id,
            Notification.notification_type == "doctor.application.received",
        )
    ).all()
    assert len(doc_notifs) == 1
    assert doc_notifs[0].title == "Doctor Profile Created"
    assert doc_notifs[0].safe_action_path == "/doctor/profile"

    # Verify Admin received onboarding alert
    admin_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == admin_user.id,
            Notification.notification_type == "doctor.onboarded",
        )
    ).all()
    assert len(admin_notifs) == 1
    assert admin_notifs[0].title == "Practitioner Pending Verification"
    assert admin_notifs[0].safe_action_path == "/admin/doctors"

    # 2. Admin reviews and approves doctor
    review_payload = {
        "verification_status": "approved",
    }
    review_res = client.patch(
        f"/api/v1/admin/doctors/{created_profile_id}/verification",
        json=review_payload,
        headers=admin_headers,
    )
    assert review_res.status_code == 200

    # Verify Doctor received approval notification
    approval_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == created_user_id,
            Notification.notification_type == "doctor.verification.approved",
        )
    ).all()
    assert len(approval_notifs) == 1
    assert approval_notifs[0].title == "Practice Verification Approved"
    assert approval_notifs[0].safe_action_path == "/doctor/availability"


# =====================================================================
# 6. ATOMIC TRANSACTION ROLLBACK TEST
# =====================================================================

def test_failed_appointment_booking_does_not_persist_notifications(
    client,
    patient_account,
    approved_doctor,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_profile = approved_doctor["profile"]
    appointment_date = approved_doctor["appointment_date"]

    # Book slot once
    client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(doctor_profile.id),
            "appointment_date": appointment_date.isoformat(),
            "start_time": "10:00:00",
            "reason": "Initial booking",
        },
        headers=patient_headers,
    )

    count_before = db_session.scalar(
        select(Notification).where(Notification.recipient_user_id == patient_user.id)
    )

    # Attempt to book exact same slot again -> conflict 409
    fail_res = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(doctor_profile.id),
            "appointment_date": appointment_date.isoformat(),
            "start_time": "10:00:00",
            "reason": "Duplicate booking attempt",
        },
        headers=patient_headers,
    )
    assert fail_res.status_code == 409

    # Verify no additional notification was created on failure
    count_after = db_session.scalar(
        select(Notification).where(Notification.recipient_user_id == patient_user.id)
    )
    assert count_before == count_after


# =====================================================================
# 7. PRIVACY REGRESSION: DOCTOR REJECTION/SUSPENSION ZERO PHI / SENSITIVE REASONS
# =====================================================================

def test_doctor_rejection_does_not_leak_confidential_reason(
    client,
    admin_account,
    db_session,
):
    admin_headers = admin_account["headers"]

    unique_suffix = uuid.uuid4().hex[:6]
    doc_payload = {
        "full_name": f"Dr. Reject Tester {unique_suffix}",
        "email": f"dr.reject.{unique_suffix}@example.com",
        "password": "DoctorSecure@123",
        "specialization": "Neurology",
        "qualification": "MBBS, MD Neurology",
        "license_number": f"LIC-REJ-{unique_suffix}",
        "years_experience": 8,
        "clinic_name": "Neuro Health Center",
        "consultation_fee": 1200,
        "bio": "Neurologist.",
    }

    create_res = client.post("/api/v1/admin/doctors", json=doc_payload, headers=admin_headers)
    assert create_res.status_code == 201
    created_profile_id = create_res.json()["id"]
    created_user_id = uuid.UUID(create_res.json()["user_id"])

    # Admin rejects with confidential disciplinary sanction reason
    confidential_reason = "CONFIDENTIAL: Disciplinary sanctions found on state licensing board."
    review_res = client.patch(
        f"/api/v1/admin/doctors/{created_profile_id}/verification",
        json={
            "verification_status": "rejected",
            "reason": confidential_reason,
        },
        headers=admin_headers,
    )
    assert review_res.status_code == 200

    notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == created_user_id,
            Notification.notification_type == "doctor.verification.rejected",
        )
    ).all()
    assert len(notifs) == 1
    rejection_notif = notifs[0]
    assert rejection_notif.title == "Verification Status Update"

    # Strict Privacy Check: The confidential reason MUST NOT be present in notification message
    assert confidential_reason not in rejection_notif.message
    assert "Disciplinary sanctions" not in rejection_notif.message
    assert "could not be approved at this time" in rejection_notif.message


# =====================================================================
# 8. RESCHEDULING TO PREVIOUSLY USED SLOT DOES NOT SUPPRESS NOTIFICATION
# =====================================================================

def test_rescheduling_to_previously_used_slot_creates_distinct_notification(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    appt_date = approved_doctor["appointment_date"].isoformat()

    # Reschedule to Slot B (10:30)
    res_b = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={"appointment_date": appt_date, "start_time": "10:30:00"},
        headers=patient_headers,
    )
    assert res_b.status_code == 200

    # Reschedule back to Slot A (10:00)
    res_a = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={"appointment_date": appt_date, "start_time": "10:00:00"},
        headers=patient_headers,
    )
    assert res_a.status_code == 200

    # Patient should have TWO distinct reschedule notifications (one for Slot B, one for Slot A)
    patient_resched_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.rescheduled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(patient_resched_notifs) == 2
    assert any("10:30" in n.message for n in patient_resched_notifs)
    assert any("10:00" in n.message for n in patient_resched_notifs)


def test_rescheduling_retry_does_not_create_duplicate_notification(
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    from app.services.notification_service import notify_appointment_rescheduled

    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    appt_date = approved_doctor["appointment_date"]
    new_time = time(11, 0)

    # First attempt: generates notifications
    p_notif1, d_notif1 = notify_appointment_rescheduled(
        db_session,
        appointment_id=booked_appointment.id,
        new_date=appt_date,
        new_start_time=new_time,
        patient_user_id=patient_user.id,
        doctor_user_id=doctor_user.id,
    )
    db_session.commit()

    assert p_notif1 is not None
    assert d_notif1 is not None
    assert "rev1" in p_notif1.idempotency_key

    # Second attempt (idempotent retry with identical transition parameters):
    p_notif2, d_notif2 = notify_appointment_rescheduled(
        db_session,
        appointment_id=booked_appointment.id,
        new_date=appt_date,
        new_start_time=new_time,
        patient_user_id=patient_user.id,
        doctor_user_id=doctor_user.id,
    )
    db_session.commit()

    # Must return identical notification entities with same ID, NO new duplicate created
    assert p_notif2.id == p_notif1.id
    assert d_notif2.id == d_notif1.id

    total_patient_resched = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.rescheduled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(total_patient_resched) == 1


def test_genuinely_new_rescheduling_event_creates_new_notification(
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    from app.services.notification_service import notify_appointment_rescheduled

    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    appt_date = approved_doctor["appointment_date"]

    # Transition 1: Reschedule to 10:30
    p1, d1 = notify_appointment_rescheduled(
        db_session,
        appointment_id=booked_appointment.id,
        new_date=appt_date,
        new_start_time=time(10, 30),
        patient_user_id=patient_user.id,
        doctor_user_id=doctor_user.id,
    )
    db_session.commit()

    # Transition 2: Genuinely new transition to 11:00
    p2, d2 = notify_appointment_rescheduled(
        db_session,
        appointment_id=booked_appointment.id,
        new_date=appt_date,
        new_start_time=time(11, 0),
        patient_user_id=patient_user.id,
        doctor_user_id=doctor_user.id,
    )
    db_session.commit()

    assert p1.id != p2.id
    assert "rev1" in p1.idempotency_key
    assert "rev2" in p2.idempotency_key

    total_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.rescheduled",
            Notification.related_entity_id == str(booked_appointment.id),
        )
    ).all()
    assert len(total_notifs) == 2


