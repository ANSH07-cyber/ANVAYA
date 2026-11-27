"""Stage 4B.1 Security Regression Tests: CSRF/Origin & Doctor Queue RBAC."""

from datetime import datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token, hash_password
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")
ALLOWED_ORIGIN = settings.cors_origin_list[0]


def _cookie_and_csrf_for(user: User, *, origin: str = ALLOWED_ORIGIN) -> tuple[dict[str, str], dict[str, str]]:
    access = create_access_token(subject=str(user.id))
    csrf = generate_csrf_token(str(user.id))
    cookies = {
        settings.access_cookie_name: access,
        settings.csrf_cookie_name: csrf,
    }
    headers = {
        "Origin": origin,
        settings.csrf_header_name: csrf,
    }
    return cookies, headers


def _make_admin(db_session) -> User:
    admin = User(
        full_name="Security Audit Admin",
        email=f"sec.admin.{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password@12345"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


def _make_doctor(db_session, *, verification_status: str = "approved", is_active: bool = True) -> dict:
    user = User(
        full_name=f"Dr. {verification_status.title()} {uuid4().hex[:4]}",
        email=f"doc.{verification_status}.{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password@12345"),
        role="doctor",
        is_active=is_active,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Dermatology",
        license_number=f"MED-{uuid4().hex[:10].upper()}",
        qualification="MD",
        years_experience=7,
        clinic_name="Anvaya Clinic",
        consultation_fee=700,
        verification_status=verification_status,
    )
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(profile)
    return {"user": user, "profile": profile}


def _make_patient(db_session) -> dict:
    user = User(
        full_name=f"Other Patient {uuid4().hex[:4]}",
        email=f"patient.{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password@12345"),
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    profile = PatientProfile(user_id=user.id)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(user)
    db_session.refresh(profile)
    return {"user": user, "profile": profile}


def _next_tuesday() -> datetime.date:
    today = datetime.now(IST).date()
    days_ahead = (1 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return today + timedelta(days=days_ahead)


# =====================================================================
# 1. VALID PATIENT COOKIE + VALID CSRF + VALID ORIGIN
# =====================================================================

def test_valid_patient_cookie_and_csrf_can_book_reschedule_cancel_and_update_profile(
    client,
    patient_account,
    approved_doctor,
):
    cookies, headers = _cookie_and_csrf_for(patient_account["user"])
    client.cookies.update(cookies)

    # Book 10:00 slot
    res_book = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:00:00",
            "reason": "Cookie CSRF test booking",
        },
        headers=headers,
    )
    assert res_book.status_code == 201
    appt_id = res_book.json()["id"]

    # Reschedule to 10:30 slot
    res_resched = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json={
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:30:00",
            "idempotency_key": f"csrf-resched-{uuid4().hex[:8]}",
        },
        headers=headers,
    )
    assert res_resched.status_code == 200
    assert res_resched.json()["start_time"] == "10:30:00"

    # Update patient profile
    res_profile = client.put(
        "/api/v1/patients/me",
        json={"phone": "+919876543210"},
        headers=headers,
    )
    assert res_profile.status_code == 200

    # Cancel appointment
    res_cancel = client.patch(
        f"/api/v1/appointments/{appt_id}/cancel",
        headers=headers,
    )
    assert res_cancel.status_code == 200
    assert res_cancel.json()["status"] == "cancelled"


# =====================================================================
# 2-4. COOKIE MUTATIONS REJECT MISSING/INCORRECT CSRF & INVALID ORIGIN
# =====================================================================

def _mutation_cases(
    *,
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
    past_booked_appointment,
    admin_user,
) -> list[tuple[str, str, dict | None, User]]:
    # Extra completed appointment + health record for prescription mutation check
    completed_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=past_booked_appointment.appointment_date - timedelta(days=1),
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="completed",
        reason="Completed for Rx CSRF test",
    )
    db_session.add(completed_appt)
    db_session.flush()

    hr = HealthRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=completed_appt.id,
        visit_date=completed_appt.appointment_date,
        visit_summary="Consultation completed for CSRF verification.",
        diagnosis="Contact dermatitis",
        clinical_notes="Topical care advised.",
    )
    db_session.add(hr)

    pending_doc = _make_doctor(db_session, verification_status="pending")
    consent = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["appointments"],
        is_active=True,
    )
    db_session.add(consent)
    db_session.commit()

    avail_id = approved_doctor["availability"].id
    return [
        (
            "POST",
            "/api/v1/appointments",
            {
                "doctor_profile_id": str(approved_doctor["profile"].id),
                "appointment_date": approved_doctor["appointment_date"].isoformat(),
                "start_time": "11:00:00",
                "reason": "CSRF rejection test",
            },
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/appointments/{booked_appointment.id}/cancel",
            None,
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/appointments/{booked_appointment.id}/reschedule",
            {
                "appointment_date": approved_doctor["appointment_date"].isoformat(),
                "start_time": "11:30:00",
            },
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/appointments/{past_booked_appointment.id}/status",
            {
                "visit_summary": "Consultation completed safely.",
                "diagnosis": "Mild eczema",
            },
            approved_doctor["user"],
        ),
        (
            "POST",
            "/api/v1/doctors/me/availability",
            {
                "weekday": 2,
                "start_time": "14:00:00",
                "end_time": "16:00:00",
                "slot_duration_minutes": 30,
            },
            approved_doctor["user"],
        ),
        (
            "PUT",
            f"/api/v1/doctors/me/availability/{avail_id}",
            {
                "weekday": 0,
                "start_time": "10:00:00",
                "end_time": "12:00:00",
                "slot_duration_minutes": 30,
            },
            approved_doctor["user"],
        ),
        (
            "PATCH",
            f"/api/v1/doctors/me/availability/{avail_id}/status",
            {"is_active": True},
            approved_doctor["user"],
        ),
        (
            "DELETE",
            f"/api/v1/doctors/me/availability/{avail_id}",
            None,
            approved_doctor["user"],
        ),
        (
            "POST",
            "/api/v1/prescriptions",
            {
                "appointment_id": str(completed_appt.id),
                "items": [
                    {
                        "medicine_name": "Cetirizine",
                        "dosage": "10mg",
                        "frequency": "Once daily",
                        "duration": "5 days",
                    }
                ],
            },
            approved_doctor["user"],
        ),
        (
            "PUT",
            "/api/v1/patients/me",
            {"phone": "+919999999999"},
            patient_account["user"],
        ),
        (
            "PATCH",
            "/api/v1/doctors/me",
            {"clinic_name": "Updated Clinic"},
            approved_doctor["user"],
        ),
        (
            "POST",
            "/api/v1/admin/doctors",
            {
                "full_name": "Dr. CSRF Admin Test",
                "email": f"doc.csrf.{uuid4().hex[:8]}@example.com",
                "password": "Password@12345",
                "specialization": "Dermatology",
                "license_number": f"LIC-{uuid4().hex[:8]}",
                "qualification": "MD",
                "years_experience": 5,
            },
            admin_user,
        ),
        (
            "PATCH",
            f"/api/v1/admin/doctors/{pending_doc['profile'].id}/verification",
            {"verification_status": "approved"},
            admin_user,
        ),
        (
            "POST",
            "/api/v1/consents",
            {
                "doctor_profile_id": str(approved_doctor["profile"].id),
                "data_scopes": ["appointments"],
            },
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/consents/{consent.id}/revoke",
            None,
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/consents/doctor/{approved_doctor['profile'].id}/revoke-all",
            None,
            patient_account["user"],
        ),
        (
            "POST",
            "/api/v1/ai/skin-lesion/analyze",
            None,
            patient_account["user"],
        ),
        (
            "PATCH",
            f"/api/v1/ai/skin-lesion/{uuid4()}/review",
            {"review_notes": "CSRF verification note"},
            approved_doctor["user"],
        ),
    ]


def test_cookie_mutations_reject_missing_csrf_invalid_csrf_and_bad_origin(
    client,
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
    past_booked_appointment,
):
    admin_user = _make_admin(db_session)
    other_user = _make_patient(db_session)["user"]
    cases = _mutation_cases(
        db_session=db_session,
        patient_account=patient_account,
        approved_doctor=approved_doctor,
        booked_appointment=booked_appointment,
        past_booked_appointment=past_booked_appointment,
        admin_user=admin_user,
    )

    for method, url, payload, actor in cases:
        access = create_access_token(subject=str(actor.id))
        valid_csrf = generate_csrf_token(str(actor.id))
        wrong_user_csrf = generate_csrf_token(str(other_user.id))
        req_kwargs = (
            {"files": {"file": ("lesion.png", b"x", "image/png")}}
            if url.endswith("/analyze")
            else {"json": payload}
        )

        # 2a. Missing CSRF header & cookie (valid Origin) -> 403
        client.cookies.clear()
        client.cookies.set(settings.access_cookie_name, access)
        res_no_csrf = client.request(
            method,
            url,
            headers={"Origin": ALLOWED_ORIGIN},
            **req_kwargs,
        )
        assert res_no_csrf.status_code == 403, f"Expected 403 (missing CSRF) for {method} {url}"
        assert "csrf" in res_no_csrf.json()["detail"].lower()

        # 3a. Incorrect / mismatched CSRF header -> 403
        client.cookies.clear()
        client.cookies.set(settings.access_cookie_name, access)
        client.cookies.set(settings.csrf_cookie_name, valid_csrf)
        res_mismatch = client.request(
            method,
            url,
            headers={
                "Origin": ALLOWED_ORIGIN,
                settings.csrf_header_name: "tampered-csrf-token",
            },
            **req_kwargs,
        )
        assert res_mismatch.status_code == 403, f"Expected 403 (mismatch CSRF) for {method} {url}"

        # 3b. Cross-user CSRF token fixation attempt -> 403
        client.cookies.clear()
        client.cookies.set(settings.access_cookie_name, access)
        client.cookies.set(settings.csrf_cookie_name, wrong_user_csrf)
        res_wrong_user_csrf = client.request(
            method,
            url,
            headers={
                "Origin": ALLOWED_ORIGIN,
                settings.csrf_header_name: wrong_user_csrf,
            },
            **req_kwargs,
        )
        assert res_wrong_user_csrf.status_code == 403, f"Expected 403 (wrong-user CSRF) for {method} {url}"

        # 4a. Disallowed untrusted Origin -> 403
        client.cookies.clear()
        client.cookies.set(settings.access_cookie_name, access)
        client.cookies.set(settings.csrf_cookie_name, valid_csrf)
        res_bad_origin = client.request(
            method,
            url,
            headers={
                "Origin": "https://attacker.example.com",
                settings.csrf_header_name: valid_csrf,
            },
            **req_kwargs,
        )
        assert res_bad_origin.status_code == 403, f"Expected 403 (bad Origin) for {method} {url}"
        assert "cross-origin" in res_bad_origin.json()["detail"].lower()

        # 4b. Missing both Origin and Referer -> 403
        res_missing_origin = client.request(
            method,
            url,
            headers={settings.csrf_header_name: valid_csrf},
            **req_kwargs,
        )
        assert res_missing_origin.status_code == 403, f"Expected 403 (missing Origin/Referer) for {method} {url}"

        # 4c. Empty Origin header with allowed Referer must NOT silently pass -> 403
        res_empty_origin = client.request(
            method,
            url,
            headers={
                "Origin": "",
                "Referer": f"{ALLOWED_ORIGIN}/patient/appointments",
                settings.csrf_header_name: valid_csrf,
            },
            **req_kwargs,
        )
        assert res_empty_origin.status_code == 403, f"Expected 403 (empty Origin fallback bypass) for {method} {url}"


# =====================================================================
# 5. BEARER-ONLY WORKFLOWS PRESERVED & COOKIE+BEARER CANNOT BYPASS CSRF
# =====================================================================

def test_bearer_only_requests_work_without_csrf_while_cookie_plus_bearer_still_requires_csrf(
    client,
    patient_account,
    approved_doctor,
):
    patient_bearer = create_access_token(subject=str(patient_account["user"].id))

    # Pure Bearer without cookies succeeds without CSRF
    client.cookies.clear()
    res_bearer = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:00:00",
            "reason": "Bearer-only API test",
        },
        headers={"Authorization": f"Bearer {patient_bearer}"},
    )
    assert res_bearer.status_code == 201
    appt_id = res_bearer.json()["id"]

    # Adding a matching access cookie WITH Bearer MUST NOT bypass CSRF checks
    client.cookies.set(settings.access_cookie_name, patient_bearer)
    res_bypass_attempt = client.patch(
        f"/api/v1/appointments/{appt_id}/cancel",
        headers={"Authorization": f"Bearer {patient_bearer}"},
    )
    assert res_bypass_attempt.status_code == 403


# =====================================================================
# 6. COOKIE / BEARER IDENTITY CONFLICT REJECTED
# =====================================================================

def test_cookie_and_bearer_identity_conflict_rejected_on_appointment_endpoints(
    client,
    patient_account,
    approved_doctor,
):
    patient_token = create_access_token(subject=str(patient_account["user"].id))
    doctor_token = create_access_token(subject=str(approved_doctor["user"].id))

    client.cookies.clear()
    client.cookies.set(settings.access_cookie_name, patient_token)

    res = client.get(
        "/api/v1/appointments/doctor/me",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert res.status_code == 400
    assert "conflicting" in res.json()["detail"].lower()


# =====================================================================
# 7. PATIENT ATTEMPTING DOCTOR-ONLY ACTIONS
# =====================================================================

def test_patient_cannot_access_doctor_only_endpoints(
    client,
    patient_account,
    booked_appointment,
):
    cookies, headers = _cookie_and_csrf_for(patient_account["user"])
    client.cookies.update(cookies)

    assert client.get("/api/v1/appointments/doctor/me").status_code == 403
    assert client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/status",
        json={"visit_summary": "Unauthorized completion", "diagnosis": "None"},
        headers=headers,
    ).status_code == 403
    assert client.post(
        "/api/v1/doctors/me/availability",
        json={
            "weekday": 1,
            "start_time": "09:00:00",
            "end_time": "11:00:00",
            "slot_duration_minutes": 30,
        },
        headers=headers,
    ).status_code == 403
    assert client.post(
        "/api/v1/prescriptions",
        json={
            "appointment_id": str(booked_appointment.id),
            "items": [
                {
                    "medicine_name": "Med",
                    "dosage": "10mg",
                    "frequency": "Daily",
                    "duration": "3 days",
                }
            ],
        },
        headers=headers,
    ).status_code == 403
    assert client.patch(
        "/api/v1/doctors/me",
        json={"clinic_name": "Should Fail"},
        headers=headers,
    ).status_code == 403


# =====================================================================
# 8-11. DOCTOR QUEUE AUTHORIZATION (PENDING / REJECTED / SUSPENDED / APPROVED)
# =====================================================================

@pytest.mark.parametrize("bad_status", ["pending", "rejected", "suspended"])
def test_unapproved_doctor_cannot_view_doctor_appointment_queue(
    client,
    db_session,
    patient_account,
    bad_status,
):
    doctor = _make_doctor(db_session, verification_status=bad_status)
    # Seed an appointment attached to this doctor's profile (e.g., pre-suspension booking)
    appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doctor["profile"].id,
        appointment_date=_next_tuesday(),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Should not be readable while unapproved",
    )
    db_session.add(appt)
    db_session.commit()

    # Check both Bearer and Cookie transports
    bearer = create_access_token(subject=str(doctor["user"].id))
    res_bearer = client.get(
        "/api/v1/appointments/doctor/me",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert res_bearer.status_code == 403
    assert res_bearer.json()["detail"] == "Only approved doctors can view appointments."

    client.cookies.clear()
    client.cookies.set(settings.access_cookie_name, bearer)
    res_cookie = client.get("/api/v1/appointments/doctor/me")
    assert res_cookie.status_code == 403
    assert "items" not in res_cookie.json()


def test_inactive_or_profileless_doctor_blocked_from_queue(
    client,
    db_session,
):
    inactive_doc = _make_doctor(db_session, verification_status="approved", is_active=False)
    token_inactive = create_access_token(subject=str(inactive_doc["user"].id))
    res_inactive = client.get(
        "/api/v1/appointments/doctor/me",
        headers={"Authorization": f"Bearer {token_inactive}"},
    )
    assert res_inactive.status_code == 401

    no_profile_doc = User(
        full_name="Dr. No Profile",
        email=f"noprof.{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password@12345"),
        role="doctor",
        is_active=True,
    )
    db_session.add(no_profile_doc)
    db_session.commit()
    token_no_prof = create_access_token(subject=str(no_profile_doc.id))
    res_no_prof = client.get(
        "/api/v1/appointments/doctor/me",
        headers={"Authorization": f"Bearer {token_no_prof}"},
    )
    assert res_no_prof.status_code == 404


def test_approved_active_doctor_can_view_own_queue(
    client,
    approved_doctor,
    booked_appointment,
):
    cookies, _ = _cookie_and_csrf_for(approved_doctor["user"])
    client.cookies.update(cookies)

    res = client.get("/api/v1/appointments/doctor/me")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == str(booked_appointment.id)


# =====================================================================
# 12. CROSS-DOCTOR AND CROSS-PATIENT DATA ISOLATION
# =====================================================================

def test_cross_doctor_and_cross_patient_appointment_isolation(
    client,
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
):
    doctor_b = _make_doctor(db_session, verification_status="approved")
    patient_b = _make_patient(db_session)

    # Seed appointment for Doctor B & Patient B
    appt_b = Appointment(
        patient_profile_id=patient_b["profile"].id,
        doctor_profile_id=doctor_b["profile"].id,
        appointment_date=_next_tuesday(),
        start_time=time(14, 0),
        end_time=time(14, 30),
        status="booked",
        reason="Doctor B private visit",
    )
    db_session.add(appt_b)
    db_session.commit()
    db_session.refresh(appt_b)

    # Doctor A sees only booked_appointment, never appt_b
    doc_a_token = create_access_token(subject=str(approved_doctor["user"].id))
    r_doc_a = client.get(
        "/api/v1/appointments/doctor/me",
        headers={"Authorization": f"Bearer {doc_a_token}"},
    )
    assert r_doc_a.status_code == 200
    doc_a_ids = {item["id"] for item in r_doc_a.json()["items"]}
    assert str(booked_appointment.id) in doc_a_ids
    assert str(appt_b.id) not in doc_a_ids

    # Doctor B cannot inspect Doctor A's appointment detail
    doc_b_token = create_access_token(subject=str(doctor_b["user"].id))
    r_doc_b_detail = client.get(
        f"/api/v1/appointments/{booked_appointment.id}",
        headers={"Authorization": f"Bearer {doc_b_token}"},
    )
    assert r_doc_b_detail.status_code == 404

    # Patient B sees only appt_b and cannot cancel Doctor A's patient appointment
    pat_b_cookies, pat_b_headers = _cookie_and_csrf_for(patient_b["user"])
    client.cookies.clear()
    client.cookies.update(pat_b_cookies)

    r_pat_b_list = client.get("/api/v1/appointments/me")
    assert r_pat_b_list.status_code == 200
    pat_b_ids = {item["id"] for item in r_pat_b_list.json()["items"]}
    assert str(appt_b.id) in pat_b_ids
    assert str(booked_appointment.id) not in pat_b_ids

    r_pat_b_cancel = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=pat_b_headers,
    )
    assert r_pat_b_cancel.status_code == 404
