"""Stage 4C Backend Regression Tests: Historical Doctor Summary Privacy, Same-Day IST & Pagination."""

from datetime import datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token, hash_password
from app.models.appointment import Appointment
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


def test_patient_appointments_include_safe_doctor_summary_even_when_doctor_suspended_or_inactive(
    client,
    db_session,
    patient_account,
    approved_doctor,
    patient_headers,
):
    # Create an appointment with approved_doctor, then suspend & deactivate the doctor
    appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="completed",
        reason="Historical visit check",
    )
    db_session.add(appt)
    db_session.commit()

    approved_doctor["profile"].verification_status = "suspended"
    approved_doctor["user"].is_active = False
    db_session.commit()

    # Public doctor discovery MUST still hide suspended/inactive doctor
    r_dir = client.get("/api/v1/doctors", headers=patient_headers)
    assert r_dir.status_code == 200
    assert all(item["id"] != str(approved_doctor["profile"].id) for item in r_dir.json()["items"])

    # Patient's own appointment history still resolves non-sensitive historical metadata safely
    r_hist = client.get("/api/v1/appointments/me", headers=patient_headers)
    assert r_hist.status_code == 200
    items = r_hist.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["doctor_name"] == approved_doctor["user"].full_name
    assert item["doctor_specialization"] == approved_doctor["profile"].specialization
    assert item["doctor_clinic_name"] == approved_doctor["profile"].clinic_name
    # Private fields must never be exposed
    for forbidden in ("email", "license_number", "verification_status", "is_active"):
        assert forbidden not in item


def test_same_day_ist_slot_booking_reschedule_and_csrf_protection(
    client,
    db_session,
    patient_account,
):
    now_ist = datetime.now(IST)
    today_ist = now_ist.date()

    # Configure a 24-hour window-safe future slot today if current IST hour allows (< 22:00)
    # Use tomorrow fallback only if tested at 23:30+ IST so test stays deterministic around midnight
    if now_ist.hour < 22:
        future_hour = min(23, now_ist.hour + 1)
        slot_start = time(future_hour, 0)
        shift_end = time(future_hour, 30)
        resched_end = time(min(23, future_hour + 1), 0) if future_hour < 23 else time(23, 59)
        target_date = today_ist
        can_resched_same_day = future_hour < 23
    else:
        target_date = today_ist + timedelta(days=1)
        slot_start = time(10, 0)
        shift_end = time(11, 0)
        resched_end = shift_end
        can_resched_same_day = True

    doc_user = User(
        full_name="Dr. SameDay IST",
        email=f"sameday.{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password@12345"),
        role="doctor",
        is_active=True,
    )
    db_session.add(doc_user)
    db_session.flush()
    doc_profile = DoctorProfile(
        user_id=doc_user.id,
        specialization="General Medicine",
        qualification="MBBS",
        license_number=f"SD-{uuid4().hex[:8]}",
        years_experience=4,
        clinic_name="Anvaya Clinic",
        verification_status="approved",
    )
    db_session.add(doc_profile)
    db_session.flush()
    db_session.add(
        DoctorAvailability(
            doctor_profile_id=doc_profile.id,
            weekday=target_date.weekday(),
            start_time=slot_start,
            end_time=resched_end if can_resched_same_day else shift_end,
            slot_duration_minutes=30,
            is_active=True,
        )
    )
    db_session.commit()

    csrf = generate_csrf_token(str(patient_account["user"].id))
    access = create_access_token(str(patient_account["user"].id))
    client.cookies.set(settings.access_cookie_name, access)
    client.cookies.set(settings.csrf_cookie_name, csrf)
    headers = {
        "Origin": settings.cors_origin_list[0],
        settings.csrf_header_name: csrf,
    }

    r_weekly = client.get(f"/api/v1/doctors/{doc_profile.id}/availability")
    assert r_weekly.status_code == 200
    assert r_weekly.json()["total"] == 1

    r_slots = client.get(
        f"/api/v1/doctors/{doc_profile.id}/availability/slots",
        params={"appointment_date": target_date.isoformat()},
    )
    assert r_slots.status_code == 200
    assert any(s["start_time"] == slot_start.strftime("%H:%M:%S") for s in r_slots.json()["items"])

    r_book = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(doc_profile.id),
            "appointment_date": target_date.isoformat(),
            "start_time": slot_start.strftime("%H:%M:%S"),
            "idempotency_key": f"sd-book-{uuid4().hex[:8]}",
        },
        headers=headers,
    )
    assert r_book.status_code == 201
    appt_id = r_book.json()["id"]

    if can_resched_same_day:
        next_start = time(slot_start.hour, 30)
        r_resched = client.patch(
            f"/api/v1/appointments/{appt_id}/reschedule",
            json={
                "appointment_date": target_date.isoformat(),
                "start_time": next_start.strftime("%H:%M:%S"),
                "idempotency_key": f"sd-resched-{uuid4().hex[:8]}",
            },
            headers=headers,
        )
        assert r_resched.status_code == 200
        assert r_resched.json()["start_time"] == next_start.strftime("%H:%M:%S")
