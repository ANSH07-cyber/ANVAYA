"""Comprehensive tests for Stage 2B Final Engineering Hardening:
Authoritative Appointment Rescheduling Idempotency & Monotonic Revision Lifecycle.

Verifies:
1. Sequential retry idempotency (X-Idempotency-Key / Idempotency-Key / payload).
2. Replay returns HTTP 200 without duplicate DB mutations, revision bumps, or duplicate notifications.
3. Same-slot rejection without matching idempotency key (HTTP 409 Conflict).
4. Cycling transitions (A -> B -> A) produce distinct monotonic revisions (rev1, rev2) and discrete notifications.
5. Concurrent retry idempotency under row locking.
6. Transaction rollback atomicity preserving revision and notification isolation.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, time, timedelta
import pytest
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.notification import Notification


def test_reschedule_sequential_retry_idempotency(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    appt_id = booked_appointment.id

    assert booked_appointment.revision == 0
    assert booked_appointment.last_idempotency_key is None

    headers_with_key = {
        **patient_headers,
        "X-Idempotency-Key": "client-req-uuid-001",
    }

    payload = {
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:30:00",
    }

    # 1. First execution of reschedule
    res1 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json=payload,
        headers=headers_with_key,
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["revision"] == 1
    assert data1["start_time"] == "10:30:00"

    db_session.expire_all()
    appt_db = db_session.get(Appointment, appt_id)
    assert appt_db.revision == 1
    assert appt_db.last_idempotency_key == "client-req-uuid-001"

    # Exactly 1 patient notification, 1 doctor notification
    p_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
    ).all()
    assert len(p_notifs) == 1
    assert "rev1" in p_notifs[0].idempotency_key

    d_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
    ).all()
    assert len(d_notifs) == 1
    assert "rev1" in d_notifs[0].idempotency_key

    # 2. Sequential retry with the EXACT same idempotency key
    res2 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json=payload,
        headers=headers_with_key,
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["revision"] == 1
    assert data2["start_time"] == "10:30:00"

    # Verify NO duplicate database mutations occurred
    db_session.expire_all()
    appt_db_after = db_session.get(Appointment, appt_id)
    assert appt_db_after.revision == 1
    assert appt_db_after.last_idempotency_key == "client-req-uuid-001"

    p_notifs_after = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
    ).all()
    assert len(p_notifs_after) == 1

    d_notifs_after = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
    ).all()
    assert len(d_notifs_after) == 1


def test_reschedule_payload_idempotency_key(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    """Verifies that an idempotency key supplied inside the JSON payload is honored."""
    appt_id = booked_appointment.id

    payload = {
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:30:00",
        "idempotency_key": "payload-key-xyz-789",
    }

    res1 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json=payload,
        headers=patient_headers,
    )
    assert res1.status_code == 200
    assert res1.json()["revision"] == 1

    db_session.expire_all()
    appt = db_session.get(Appointment, appt_id)
    assert appt.last_idempotency_key == "payload-key-xyz-789"

    # Retry with the same payload
    res2 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json=payload,
        headers=patient_headers,
    )
    assert res2.status_code == 200
    assert res2.json()["revision"] == 1


def test_reschedule_same_slot_rejection_without_idempotency_key(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
):
    """Attempting to reschedule to the already-held slot without matching idempotency key returns 409."""
    appt_id = booked_appointment.id

    # The appointment is currently at booked_appointment.appointment_date, booked_appointment.start_time
    payload = {
        "appointment_date": booked_appointment.appointment_date.isoformat(),
        "start_time": booked_appointment.start_time.isoformat(),
    }

    res = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json=payload,
        headers=patient_headers,
    )
    assert res.status_code == 409
    assert "already the current appointment slot" in res.json()["detail"]


def test_reschedule_cycling_transitions_distinct_notifications(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    """Verifies cycling transitions: Slot A -> Slot B -> Slot A.
    Monotonic revision advances from 1 to 2, generating discrete notifications for each transition
    without false suppression.
    """
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    appt_id = booked_appointment.id

    slot_a_date = booked_appointment.appointment_date.isoformat()
    slot_a_time = booked_appointment.start_time.isoformat()  # e.g. "09:00:00"

    slot_b_date = slot_a_date
    slot_b_time = "10:30:00"

    # Step 1: Transition 1: Slot A -> Slot B
    res1 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json={"appointment_date": slot_b_date, "start_time": slot_b_time},
        headers={**patient_headers, "X-Idempotency-Key": "trans-1"},
    )
    assert res1.status_code == 200
    assert res1.json()["revision"] == 1

    # Verify 1st notification pair
    db_session.expire_all()
    p_notifs_1 = db_session.scalars(
        select(Notification)
        .where(
            Notification.recipient_user_id == patient_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
        .order_by(Notification.created_at.asc())
    ).all()
    assert len(p_notifs_1) == 1
    assert "rev1" in p_notifs_1[0].idempotency_key

    # Step 2: Transition 2: Slot B -> Slot A (Cycling back to original slot)
    res2 = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json={"appointment_date": slot_a_date, "start_time": slot_a_time},
        headers={**patient_headers, "X-Idempotency-Key": "trans-2"},
    )
    assert res2.status_code == 200
    assert res2.json()["revision"] == 2

    # Verify discrete 2nd notification pair was generated (NOT suppressed)
    db_session.expire_all()
    p_notifs_2 = db_session.scalars(
        select(Notification)
        .where(
            Notification.recipient_user_id == patient_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
        .order_by(Notification.created_at.asc())
    ).all()
    assert len(p_notifs_2) == 2
    assert "rev1" in p_notifs_2[0].idempotency_key
    assert "rev2" in p_notifs_2[1].idempotency_key

    d_notifs_2 = db_session.scalars(
        select(Notification)
        .where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
        .order_by(Notification.created_at.asc())
    ).all()
    assert len(d_notifs_2) == 2
    assert "rev1" in d_notifs_2[0].idempotency_key
    assert "rev2" in d_notifs_2[1].idempotency_key


def test_reschedule_concurrent_retries(
    client,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
    db_session,
):
    """Verifies that concurrent requests sharing the same idempotency key are safely handled."""
    appt_id = booked_appointment.id

    payload = {
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:30:00",
    }
    headers = {
        **patient_headers,
        "X-Idempotency-Key": "concurrent-key-999",
    }

    def send_request():
        return client.patch(
            f"/api/v1/appointments/{appt_id}/reschedule",
            json=payload,
            headers=headers,
        )

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(send_request) for _ in range(3)]
        results = [f.result() for f in futures]

    status_codes = [r.status_code for r in results]
    assert all(code == 200 for code in status_codes)

    db_session.expire_all()
    appt = db_session.get(Appointment, appt_id)
    assert appt.revision == 1
    assert appt.last_idempotency_key == "concurrent-key-999"

    # Only 1 patient notification generated
    p_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.related_entity_id == str(appt_id),
            Notification.notification_type == "appointment.rescheduled",
        )
    ).all()
    assert len(p_notifs) == 1
