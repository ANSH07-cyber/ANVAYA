"""Stage 4D Backend Verification Tests: Doctor Appointment Summary, Queue Hardening,
Doctor Verification Access Rules & Clinical Safety Isolation.
"""

from datetime import date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.security import create_access_token, hash_password
from app.models.appointment import Appointment
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


def test_doctor_profile_accessible_to_all_verification_statuses(client, db_session):
    """GET /doctors/me must allow doctors in pending, rejected, suspended, and approved states

    to inspect their own status so the frontend can render informative guidance rather than crashing with 403.
    """
    statuses = ["pending", "rejected", "suspended", "approved"]

    for st in statuses:
        doc_user = User(
            full_name=f"Dr. Test {st.capitalize()}",
            email=f"doc.{st}.{uuid4().hex[:6]}@example.com",
            password_hash=hash_password("Password@123"),
            role="doctor",
            is_active=True,
        )
        db_session.add(doc_user)
        db_session.flush()

        doc_profile = DoctorProfile(
            user_id=doc_user.id,
            specialization="General Medicine",
            qualification="MBBS",
            license_number=f"LIC-{st[:3].upper()}-{uuid4().hex[:6]}",
            years_experience=3,
            clinic_name="Test Clinic",
            verification_status=st,
        )
        db_session.add(doc_profile)
        db_session.commit()

        token = create_access_token(subject=str(doc_user.id))
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Profile must succeed with 200
        r_prof = client.get("/api/v1/doctors/me", headers=headers)
        assert r_prof.status_code == 200, f"Expected 200 for {st} doctor /doctors/me, got {r_prof.status_code}"
        data = r_prof.json()
        assert data["verification_status"] == st
        assert data["license_number"] == doc_profile.license_number

        # 2. Availability & Appointments endpoints MUST return 403 for non-approved
        r_avail = client.get("/api/v1/doctors/me/availability", headers=headers)
        r_appt = client.get("/api/v1/appointments/doctor/me", headers=headers)
        r_sum = client.get("/api/v1/appointments/doctor/me/summary", headers=headers)

        if st == "approved":
            assert r_avail.status_code == 200
            assert r_appt.status_code == 200
            assert r_sum.status_code == 200
        else:
            assert r_avail.status_code == 403, f"Expected 403 for {st} doctor /availability"
            assert r_appt.status_code == 403, f"Expected 403 for {st} doctor /appointments"
            assert r_sum.status_code == 403, f"Expected 403 for {st} doctor /appointments summary"


def test_doctor_appointment_summary_and_queue_tabs(client, db_session, patient_account):
    """Doctor appointments summary computes accurate server-backed counts for today, upcoming,

    past_due, completed, and cancelled appointments without being capped by client pagination.
    """
    now_ist = datetime.now(IST)
    today = now_ist.date()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    doc_user = User(
        full_name="Dr. Queue Test",
        email=f"doc.queue.{uuid4().hex[:6]}@example.com",
        password_hash=hash_password("Password@123"),
        role="doctor",
        is_active=True,
    )
    db_session.add(doc_user)
    db_session.flush()

    doc_profile = DoctorProfile(
        user_id=doc_user.id,
        specialization="Dermatology",
        qualification="MBBS, MD",
        license_number=f"LIC-Q-{uuid4().hex[:6]}",
        years_experience=6,
        clinic_name="Clinic Queue",
        verification_status="approved",
    )
    db_session.add(doc_profile)
    db_session.commit()

    token = create_access_token(subject=str(doc_user.id))
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Past-due booked appointment (date in past, status=booked)
    past_due_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc_profile.id,
        appointment_date=yesterday,
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Overdue check",
    )
    # 2. Today booked appointment
    today_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc_profile.id,
        appointment_date=today,
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="booked",
        reason="Today visit",
    )
    # 3. Upcoming booked appointment
    upcoming_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc_profile.id,
        appointment_date=tomorrow,
        start_time=time(14, 0),
        end_time=time(14, 30),
        status="booked",
        reason="Future visit",
    )
    # 4. Completed appointment
    completed_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc_profile.id,
        appointment_date=yesterday,
        start_time=time(15, 0),
        end_time=time(15, 30),
        status="completed",
        reason="Finished visit",
    )
    # 5. Cancelled appointment
    cancelled_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc_profile.id,
        appointment_date=today,
        start_time=time(16, 0),
        end_time=time(16, 30),
        status="cancelled",
        reason="Schedule conflict",
    )

    db_session.add_all([past_due_appt, today_appt, upcoming_appt, completed_appt, cancelled_appt])
    db_session.commit()

    # Query summary endpoint
    r_sum = client.get("/api/v1/appointments/doctor/me/summary", headers=headers)
    assert r_sum.status_code == 200
    sum_data = r_sum.json()
    assert sum_data["total"] == 5
    assert sum_data["today_count"] == 1
    assert sum_data["upcoming_count"] == 1
    assert sum_data["past_due_count"] == 1
    assert sum_data["completed_count"] == 1
    assert sum_data["cancelled_count"] == 1

    # Test tab-based queue filtering
    r_tab_today = client.get("/api/v1/appointments/doctor/me?tab=today", headers=headers)
    assert r_tab_today.status_code == 200
    assert r_tab_today.json()["total"] == 1
    assert r_tab_today.json()["items"][0]["id"] == str(today_appt.id)

    r_tab_past_due = client.get("/api/v1/appointments/doctor/me?tab=past_due", headers=headers)
    assert r_tab_past_due.status_code == 200
    assert r_tab_past_due.json()["total"] == 1
    assert r_tab_past_due.json()["items"][0]["id"] == str(past_due_appt.id)

    r_tab_upcoming = client.get("/api/v1/appointments/doctor/me?tab=upcoming", headers=headers)
    assert r_tab_upcoming.status_code == 200
    assert r_tab_upcoming.json()["total"] == 1
    assert r_tab_upcoming.json()["items"][0]["id"] == str(upcoming_appt.id)

    r_tab_completed = client.get("/api/v1/appointments/doctor/me?tab=completed", headers=headers)
    assert r_tab_completed.status_code == 200
    assert r_tab_completed.json()["total"] == 1
    assert r_tab_completed.json()["items"][0]["id"] == str(completed_appt.id)

    r_tab_cancelled = client.get("/api/v1/appointments/doctor/me?tab=cancelled", headers=headers)
    assert r_tab_cancelled.status_code == 200
    assert r_tab_cancelled.json()["total"] == 1
    assert r_tab_cancelled.json()["items"][0]["id"] == str(cancelled_appt.id)


def test_doctor_consultation_completion_safety_and_cross_doctor_isolation(
    client, db_session, patient_account, approved_doctor, doctor_headers
):
    """Consultation completion requires appointment ownership, booked status, and permitted start time."""
    now_ist = datetime.now(IST)
    tomorrow = now_ist.date() + timedelta(days=1)

    # 1. Future appointment cannot be completed before start time
    future_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=tomorrow,
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="booked",
        reason="Future checkup",
    )
    db_session.add(future_appt)
    db_session.commit()

    payload = {"visit_summary": "Comprehensive clinical assessment done."}
    r_future = client.patch(
        f"/api/v1/appointments/{future_appt.id}/status",
        json=payload,
        headers=doctor_headers,
    )
    assert r_future.status_code == 409
    assert "A future appointment cannot be completed" in r_future.json()["detail"]

    # 2. Cancelled appointment cannot be completed
    cancelled_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=now_ist.date(),
        start_time=time(9, 0),
        end_time=time(9, 30),
        status="cancelled",
        reason="Cancelled booking",
    )
    db_session.add(cancelled_appt)
    db_session.commit()

    r_cancelled = client.patch(
        f"/api/v1/appointments/{cancelled_appt.id}/status",
        json=payload,
        headers=doctor_headers,
    )
    assert r_cancelled.status_code == 409
    assert "Only booked appointments can be completed" in r_cancelled.json()["detail"]

    # 3. Cross-doctor isolation: Doctor B cannot complete Doctor A's appointment
    doc_b_user = User(
        full_name="Dr. Doctor B",
        email=f"doc.b.{uuid4().hex[:6]}@example.com",
        password_hash=hash_password("Password@123"),
        role="doctor",
        is_active=True,
    )
    db_session.add(doc_b_user)
    db_session.flush()

    doc_b_profile = DoctorProfile(
        user_id=doc_b_user.id,
        specialization="Pediatrics",
        qualification="MBBS, DCH",
        license_number=f"LIC-B-{uuid4().hex[:6]}",
        years_experience=4,
        clinic_name="Pediatric Clinic",
        verification_status="approved",
    )
    db_session.add(doc_b_profile)
    db_session.commit()

    doc_b_token = create_access_token(subject=str(doc_b_user.id))
    doc_b_headers = {"Authorization": f"Bearer {doc_b_token}"}

    r_cross = client.patch(
        f"/api/v1/appointments/{future_appt.id}/status",
        json=payload,
        headers=doc_b_headers,
    )
    assert r_cross.status_code == 404
    assert "Appointment not found" in r_cross.json()["detail"]
