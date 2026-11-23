import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.appointment_reschedule_proposal import AppointmentRescheduleProposal
from app.models.audit_log import AuditLog
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def other_patient_account(db_session):
    user = User(
        full_name="Other Patient",
        email=f"other.patient.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = PatientProfile(user_id=user.id)
    db_session.add(profile)
    db_session.commit()
    return {"user": user, "profile": profile}


@pytest.fixture
def other_patient_headers(other_patient_account):
    token = create_access_token(subject=str(other_patient_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def other_doctor_account(db_session, future_monday):
    user = User(
        full_name="Dr. Unrelated Doctor",
        email=f"dr.unrelated.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD Pediatrics",
        license_number=f"TEST-UNRELATED-{uuid.uuid4().hex[:6]}",
        years_experience=8,
        clinic_name="Unrelated Clinic",
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
    return {"user": user, "profile": profile}


@pytest.fixture
def other_doctor_headers(other_doctor_account):
    token = create_access_token(subject=str(other_doctor_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


# =====================================================================
# 1. DOCTOR RESCHEDULE PROPOSAL CREATION
# =====================================================================

def test_approved_doctor_can_propose_reschedule(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Doctor proposes rescheduling to 10:30. Original booking remains unchanged."""
    payload = {
        "proposed_date": str(approved_doctor["appointment_date"]),
        "proposed_start_time": "10:30:00",
        "doctor_message": "Doctor has emergency ward rounds; proposing 30-min shift.",
    }

    response = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json=payload,
        headers=doctor_headers,
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["appointment_id"] == str(booked_appointment.id)
    assert data["status"] == "pending"
    assert data["proposed_date"] == str(approved_doctor["appointment_date"])
    assert data["proposed_start_time"] == "10:30:00"
    assert data["proposed_end_time"] == "11:00:00"
    assert data["doctor_message"] == payload["doctor_message"]

    # Verify original appointment is COMPLETELY UNCHANGED
    db_session.expire_all()
    appt = db_session.get(Appointment, booked_appointment.id)
    assert appt.status == "booked"
    assert appt.start_time == time(10, 0)
    assert appt.end_time == time(10, 30)
    assert appt.revision == 0

    # Verify notification created for patient
    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.reschedule_proposed",
        )
    )
    assert notif is not None
    assert "Reschedule Proposed" in notif.title
    assert "10:30 AM" in notif.message
    assert notif.safe_action_path == "/patient/appointments"

    # Verify audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "appointment.reschedule_proposed",
            AuditLog.resource_id == data["id"],
        )
    )
    assert audit is not None
    assert audit.outcome == "success"
    # Free-text clinical messages must NOT be in audit details
    assert "emergency ward rounds" not in str(audit.details)


def test_pending_or_rejected_doctor_cannot_propose(
    client,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """Pending or rejected doctors cannot propose rescheduling."""
    approved_doctor["profile"].verification_status = "pending"
    db_session.commit()

    token = create_access_token(subject=str(approved_doctor["user"].id))
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "proposed_date": str(approved_doctor["appointment_date"]),
        "proposed_start_time": "10:30:00",
    }
    response = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json=payload,
        headers=headers,
    )
    assert response.status_code == 403
    assert "Only approved doctors" in response.json()["detail"]


def test_unrelated_doctor_cannot_propose_reschedule(
    client,
    other_doctor_headers,
    booked_appointment,
    approved_doctor,
):
    """A doctor cannot propose rescheduling another doctor's appointment."""
    payload = {
        "proposed_date": str(approved_doctor["appointment_date"]),
        "proposed_start_time": "10:30:00",
    }
    response = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json=payload,
        headers=other_doctor_headers,
    )
    assert response.status_code == 403
    assert "cannot propose rescheduling another doctor's appointment" in response.json()["detail"]


def test_cannot_propose_same_slot_or_unavailable_slot(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
):
    """Proposing current slot or a slot outside availability must return 409."""
    # 1. Propose identical slot (10:00)
    response = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:00:00",
        },
        headers=doctor_headers,
    )
    assert response.status_code == 409
    assert "identical" in response.json()["detail"].lower()

    # 2. Propose slot outside availability (e.g. 15:00)
    response2 = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "15:00:00",
        },
        headers=doctor_headers,
    )
    assert response2.status_code == 409
    assert "unavailable" in response2.json()["detail"].lower()


def test_duplicate_pending_proposal_rejected(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
):
    """Cannot create a second proposal when one is already pending."""
    payload = {
        "proposed_date": str(approved_doctor["appointment_date"]),
        "proposed_start_time": "10:30:00",
        "idempotency_key": "test_idem_prop_1",
    }
    res1 = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json=payload,
        headers=doctor_headers,
    )
    assert res1.status_code == 201

    # Retry with exact same idempotency key -> idempotent 201 replay
    res_replay = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json=payload,
        headers=doctor_headers,
    )
    assert res_replay.status_code == 201
    assert res_replay.json()["id"] == res1.json()["id"]

    # Different proposal attempt -> 409 Conflict
    res2 = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "11:00:00",
        },
        headers=doctor_headers,
    )
    assert res2.status_code == 409
    assert "already pending" in res2.json()["detail"].lower()


# =====================================================================
# 2. PATIENT REVIEW & ACCEPTANCE WORKFLOW
# =====================================================================

def test_patient_can_list_pending_proposals(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    """Patient can query their pending proposals."""
    client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )

    response = client.get(
        "/api/v1/appointments/proposals/pending",
        headers=patient_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    item = data["items"][0]
    assert item["appointment_id"] == str(booked_appointment.id)
    assert item["proposed_start_time"] == "10:30:00"
    assert item["doctor_name"] == "Test Doctor"
    assert item["doctor_specialization"] == "Dermatology"


def test_patient_can_accept_reschedule_proposal(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient accepts proposed reschedule. Appointment slot is atomically updated."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # Patient accepts
    resp_accept = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept", "idempotency_key": "pat_accept_1"},
        headers=patient_headers,
    )
    assert resp_accept.status_code == 200, resp_accept.text
    data = resp_accept.json()
    assert data["status"] == "accepted"
    assert data["resolved_at"] is not None

    # Check appointment updated
    db_session.expire_all()
    appt = db_session.get(Appointment, booked_appointment.id)
    assert appt.start_time == time(10, 30)
    assert appt.end_time == time(11, 0)
    assert appt.revision == 1

    # Check dual notifications
    doc_notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == approved_doctor["user"].id,
            Notification.notification_type == "appointment.rescheduled",
        )
    )
    assert doc_notif is not None
    assert "Reschedule Accepted" in doc_notif.title
    assert "10:30 AM" in doc_notif.message

    pat_notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.rescheduled",
        )
    )
    assert pat_notif is not None
    assert "10:30 AM" in pat_notif.message

    # Idempotent replay of accept
    replay = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept", "idempotency_key": "pat_accept_1"},
        headers=patient_headers,
    )
    assert replay.status_code == 200
    assert replay.json()["status"] == "accepted"


def test_patient_can_decline_reschedule_proposal(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """Patient declines proposed reschedule. Original booking remains strictly untouched."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # Patient declines
    resp_decline = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "decline"},
        headers=patient_headers,
    )
    assert resp_decline.status_code == 200
    assert resp_decline.json()["status"] == "declined"

    # Verify original appointment is untouched
    db_session.expire_all()
    appt = db_session.get(Appointment, booked_appointment.id)
    assert appt.start_time == time(10, 0)
    assert appt.end_time == time(10, 30)
    assert appt.revision == 0

    # Verify doctor notified of decline
    doc_notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == approved_doctor["user"].id,
            Notification.notification_type == "appointment.reschedule_declined",
        )
    )
    assert doc_notif is not None
    assert "Reschedule Declined" in doc_notif.title
    assert "10:00 AM" in doc_notif.message


def test_other_patient_cannot_respond_to_proposal(
    client,
    doctor_headers,
    other_patient_headers,
    booked_appointment,
    approved_doctor,
):
    """A patient cannot respond to another patient's proposal."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    res = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept"},
        headers=other_patient_headers,
    )
    assert res.status_code == 403


# =====================================================================
# 3. EXPIRATION & INVALIDATION SAFEGUARDS
# =====================================================================

def test_expired_proposal_cannot_be_accepted(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """Expired proposal cannot be accepted and automatically sets status='expired'."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # Artificially set expires_at in the past
    prop = db_session.get(AppointmentRescheduleProposal, uuid.UUID(proposal_id))
    prop.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.commit()

    # Attempt to accept
    res = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept"},
        headers=patient_headers,
    )
    assert res.status_code == 409
    assert "expired" in res.json()["detail"].lower()

    # Confirm status is now expired in DB
    db_session.expire_all()
    prop_after = db_session.get(AppointmentRescheduleProposal, uuid.UUID(proposal_id))
    assert prop_after.status == "expired"

    # Now doctor can submit a new proposal without conflict
    new_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "11:00:00",
        },
        headers=doctor_headers,
    )
    assert new_res.status_code == 201


def test_appointment_cancellation_supersedes_pending_proposal(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """Doctor cancels the appointment while proposal is pending -> proposal becomes superseded."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # Doctor cancels appointment
    cancel_res = client.patch(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/cancel",
        json={"cancellation_reason": "Emergency surgery"},
        headers=doctor_headers,
    )
    assert cancel_res.status_code == 200

    # Verify proposal status was updated to superseded
    db_session.expire_all()
    prop = db_session.get(AppointmentRescheduleProposal, uuid.UUID(proposal_id))
    assert prop.status == "superseded"

    # Attempt to accept superseded proposal -> 409
    res = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept"},
        headers=patient_headers,
    )
    assert res.status_code == 409
    assert "no longer pending" in res.json()["detail"].lower()


def test_doctor_and_patient_can_view_appointment_proposals_history(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    """Both doctor and patient can inspect proposals history for their appointment."""
    client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )

    # Doctor view
    doc_res = client.get(
        f"/api/v1/appointments/{booked_appointment.id}/proposals",
        headers=doctor_headers,
    )
    assert doc_res.status_code == 200
    assert doc_res.json()["total"] == 1

    # Patient view
    pat_res = client.get(
        f"/api/v1/appointments/{booked_appointment.id}/proposals",
        headers=patient_headers,
    )
    assert pat_res.status_code == 200
    assert pat_res.json()["total"] == 1


def test_concurrent_booking_blocks_proposal_acceptance(
    client,
    doctor_headers,
    patient_headers,
    other_patient_account,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """If another patient books the proposed slot in the interim, acceptance is blocked."""
    # Doctor proposes 10:30
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # In the interim, another patient books the 10:30 slot!
    competing_booking = Appointment(
        patient_profile_id=other_patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 30),
        end_time=time(11, 0),
        status="booked",
        reason="Competing booking",
    )
    db_session.add(competing_booking)
    db_session.commit()

    # Original patient attempts to accept
    res = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept"},
        headers=patient_headers,
    )
    assert res.status_code == 409
    assert "no longer available" in res.json()["detail"].lower()


def test_patient_direct_reschedule_supersedes_pending_proposal(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """If patient reschedules directly, existing doctor proposals are superseded."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    proposal_id = prop_res.json()["id"]

    # Patient reschedules directly to 11:00
    resched_res = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={
            "appointment_date": str(approved_doctor["appointment_date"]),
            "start_time": "11:00:00",
        },
        headers=patient_headers,
    )
    assert resched_res.status_code == 200

    # Verify doctor proposal is superseded
    db_session.expire_all()
    prop = db_session.get(AppointmentRescheduleProposal, uuid.UUID(proposal_id))
    assert prop.status == "superseded"


def test_cannot_propose_reschedule_for_past_appointment(
    client,
    doctor_headers,
    past_booked_appointment,
    approved_doctor,
):
    """Cannot propose rescheduling for a past appointment."""
    res = client.post(
        f"/api/v1/appointments/doctor/{past_booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    assert res.status_code == 409
    assert "past or started" in res.json()["detail"].lower()


# =====================================================================
# 5. PRE-MIGRATION HARDENING: 3-HOUR LEAD TIME & LOCK ORDERING REGRESSION
# =====================================================================

def test_appointment_starting_in_1_5_hours_proposal_rejected(
    client,
    doctor_headers,
    approved_doctor,
    patient_account,
    db_session,
):
    """Appointments starting in less than 3 hours (e.g. 1.5h) cannot be rescheduled via proposal."""
    now_ist = datetime.now(IST)
    appt_dt = now_ist + timedelta(hours=1, minutes=30)

    appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=appt_dt.date(),
        start_time=appt_dt.time(),
        end_time=(appt_dt + timedelta(minutes=30)).time(),
        status="booked",
        reason="Short lead appointment 1.5h",
    )
    db_session.add(appt)
    db_session.commit()

    res = client.post(
        f"/api/v1/appointments/doctor/{appt.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    assert res.status_code == 409
    assert "less than 3 hours" in res.json()["detail"].lower()


def test_appointment_starting_in_2_5_hours_proposal_rejected(
    client,
    doctor_headers,
    approved_doctor,
    patient_account,
    db_session,
):
    """Appointments starting in less than 3 hours (e.g. 2.5h) cannot be rescheduled via proposal."""
    now_ist = datetime.now(IST)
    appt_dt = now_ist + timedelta(hours=2, minutes=30)

    appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=appt_dt.date(),
        start_time=appt_dt.time(),
        end_time=(appt_dt + timedelta(minutes=30)).time(),
        status="booked",
        reason="Short lead appointment 2.5h",
    )
    db_session.add(appt)
    db_session.commit()

    res = client.post(
        f"/api/v1/appointments/doctor/{appt.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    assert res.status_code == 409
    assert "less than 3 hours" in res.json()["detail"].lower()


def test_appointment_starting_in_3_plus_hours_valid_proposal_window(
    client,
    doctor_headers,
    approved_doctor,
    booked_appointment,
    db_session,
):
    """Appointment in 3+ hours allows proposal creation and sets expires_at strictly before appointment start."""
    res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    assert res.status_code == 201
    data = res.json()
    expires_at_dt = datetime.fromisoformat(data["expires_at"])
    if expires_at_dt.tzinfo is None:
        expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)

    appt_start_utc = datetime.combine(
        booked_appointment.appointment_date,
        booked_appointment.start_time,
    ).replace(tzinfo=IST).astimezone(timezone.utc)

    # Proposal expires strictly before original appointment start
    assert expires_at_dt < appt_start_utc


def test_proposal_acceptance_rejected_if_original_appointment_already_started(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    db_session,
):
    """If original appointment start time passes before patient responds, acceptance is rejected and proposal superseded."""
    prop_res = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(approved_doctor["appointment_date"]),
            "proposed_start_time": "10:30:00",
        },
        headers=doctor_headers,
    )
    assert prop_res.status_code == 201
    proposal_id = prop_res.json()["id"]

    # Simulate appointment start passing
    now_ist = datetime.now(IST)
    booked_appointment.appointment_date = now_ist.date()
    booked_appointment.start_time = (now_ist - timedelta(minutes=10)).time()
    booked_appointment.end_time = (now_ist + timedelta(minutes=20)).time()
    db_session.commit()

    # Patient attempts to accept
    accept_res = client.patch(
        f"/api/v1/appointments/proposals/{proposal_id}/respond",
        json={"action": "accept"},
        headers=patient_headers,
    )
    assert accept_res.status_code == 409
    assert "already started or passed" in accept_res.json()["detail"].lower()

    # Verify proposal was marked superseded
    db_session.expire_all()
    prop = db_session.get(AppointmentRescheduleProposal, uuid.UUID(proposal_id))
    assert prop.status == "superseded"


def test_proposal_rejected_if_proposed_slot_is_in_the_past(
    client,
    doctor_headers,
    booked_appointment,
    db_session,
):
    """Doctor cannot propose a slot that is in the past."""
    # 1. Past date is rejected by schema validator with 422
    yesterday = date.today() - timedelta(days=1)
    res_date = client.post(
        f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
        json={
            "proposed_date": str(yesterday),
            "proposed_start_time": "10:00:00",
        },
        headers=doctor_headers,
    )
    assert res_date.status_code == 422

    # 2. Today with past start time is rejected by endpoint logic with 409
    now_ist = datetime.now(IST)
    if now_ist.hour > 0:
        past_time = time(now_ist.hour - 1, 0)
        res_time = client.post(
            f"/api/v1/appointments/doctor/{booked_appointment.id}/propose-reschedule",
            json={
                "proposed_date": str(now_ist.date()),
                "proposed_start_time": str(past_time),
            },
            headers=doctor_headers,
        )
        assert res_time.status_code == 409
        assert "must be in the future" in res_time.json()["detail"].lower()


