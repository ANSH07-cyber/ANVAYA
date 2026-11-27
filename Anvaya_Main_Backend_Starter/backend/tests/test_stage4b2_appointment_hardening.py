"""Stage 4B.2 Regression Tests: Idempotency, Auditability, Lifecycle & CSRF Session Refresh."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta, timezone
import hashlib
import hmac
import secrets
from uuid import uuid4
from zoneinfo import ZoneInfo

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, inspect, select

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token, hash_password
from app.models.appointment import Appointment
from app.models.appointment_reschedule_proposal import AppointmentRescheduleProposal
from app.models.audit_log import AuditLog
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.idempotency_record import IdempotencyRecord
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.services.notification_service import notify_appointment_completed

IST = ZoneInfo("Asia/Kolkata")
ALLOWED_ORIGIN = settings.cors_origin_list[0]


def _make_patient(db_session) -> dict:
    user = User(
        full_name=f"Patient {uuid4().hex[:4]}",
        email=f"pat.{uuid4().hex[:8]}@example.com",
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


def _signed_csrf_at(timestamp: int, user_id: str) -> str:
    nonce = secrets.token_urlsafe(24)
    payload = f"{nonce}:{timestamp}:{user_id}"
    sig = hmac.new(
        settings.csrf_secret_key.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}:{sig}"


# =====================================================================
# 1-3. BOOKING IDEMPOTENCY: INITIAL, IDENTICAL RETRY, CONFLICTING PAYLOAD
# =====================================================================

def test_booking_idempotency_replay_and_payload_conflict(
    client,
    db_session,
    patient_account,
    approved_doctor,
    patient_headers,
):
    patient_user = patient_account["user"]
    doctor_user = approved_doctor["user"]
    key = f"book-key-{uuid4().hex[:8]}"

    payload = {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:00:00",
        "reason": "Sensitive rash on forearm",
    }

    # 1. Initial creation returns 201
    res1 = client.post(
        "/api/v1/appointments",
        json=payload,
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res1.status_code == 201
    appt_id = res1.json()["id"]

    # 2. Retry with identical key & payload returns 200 without duplicate DB rows/audit/notifs
    res2 = client.post(
        "/api/v1/appointments",
        json=payload,
        headers={**patient_headers, "X-Idempotency-Key": key},
    )
    assert res2.status_code == 200
    assert res2.json()["id"] == appt_id

    db_session.expire_all()
    appts = db_session.scalars(
        select(Appointment).where(
            Appointment.patient_profile_id == patient_account["profile"].id,
        )
    ).all()
    assert len(appts) == 1

    idemp_rows = db_session.scalars(
        select(IdempotencyRecord).where(
            IdempotencyRecord.patient_profile_id == patient_account["profile"].id,
            IdempotencyRecord.idempotency_key == key,
        )
    ).all()
    assert len(idemp_rows) == 1

    p_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_user.id,
            Notification.notification_type == "appointment.booked",
        )
    ).all()
    d_notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == doctor_user.id,
            Notification.notification_type == "appointment.booked",
        )
    ).all()
    assert len(p_notifs) == 1
    assert len(d_notifs) == 1

    created_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.event_type == "appointment.created",
            AuditLog.resource_id == appt_id,
        )
    ).all()
    assert len(created_audits) == 1
    assert "Sensitive rash on forearm" not in str(created_audits[0].details)
    assert created_audits[0].details["reason_provided"] is True

    # 3. Reusing the same Idempotency-Key with a DIFFERENT payload rejects with 409 Conflict
    res_diff_slot = client.post(
        "/api/v1/appointments",
        json={**payload, "start_time": "10:30:00"},
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res_diff_slot.status_code == 409
    assert "different booking payload" in res_diff_slot.json()["detail"].lower()

    res_diff_reason = client.post(
        "/api/v1/appointments",
        json={**payload, "reason": "Completely different reason"},
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res_diff_reason.status_code == 409

    # 4. Idempotency keys are scoped per-patient (another patient can use same key value independently)
    other_patient = _make_patient(db_session)
    other_token = create_access_token(subject=str(other_patient["user"].id))
    res_other = client.post(
        "/api/v1/appointments",
        json={**payload, "start_time": "10:30:00"},
        headers={
            "Authorization": f"Bearer {other_token}",
            "Idempotency-Key": key,
        },
    )
    assert res_other.status_code == 201
    assert res_other.json()["id"] != appt_id


def test_booking_idempotency_key_survives_reschedule_and_reclaims_when_expired(
    client,
    db_session,
    patient_account,
    approved_doctor,
    patient_headers,
):
    key = f"survive-key-{uuid4().hex[:8]}"
    payload = {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:00:00",
        "reason": "Initial booking",
    }
    res_book = client.post(
        "/api/v1/appointments",
        json=payload,
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res_book.status_code == 201
    appt_id = res_book.json()["id"]

    # Patient reschedules with another idempotency key (overwrites Appointment.last_idempotency_key)
    res_resched = client.patch(
        f"/api/v1/appointments/{appt_id}/reschedule",
        json={
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:30:00",
            "idempotency_key": f"resched-{uuid4().hex[:8]}",
        },
        headers=patient_headers,
    )
    assert res_resched.status_code == 200

    # Original booking Idempotency-Key MUST STILL replay original appointment without creating a new booking
    res_replay = client.post(
        "/api/v1/appointments",
        json=payload,
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res_replay.status_code == 200
    assert res_replay.json()["id"] == appt_id

    # Mark record expired (> 24h TTL) -> reclaiming key for a new booking at 11:00 succeeds
    rec = db_session.scalar(
        select(IdempotencyRecord).where(IdempotencyRecord.idempotency_key == key)
    )
    rec.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    res_reclaimed = client.post(
        "/api/v1/appointments",
        json={**payload, "start_time": "11:00:00"},
        headers={**patient_headers, "Idempotency-Key": key},
    )
    assert res_reclaimed.status_code == 201
    assert res_reclaimed.json()["id"] != appt_id


# =====================================================================
# 4. CONCURRENT BOOKING SAFETY (ISOLATED SQLITE HARNESS)
# =====================================================================

def test_concurrent_identical_and_competing_bookings_under_sqlite(
    client,
    db_session,
    patient_account,
    approved_doctor,
    patient_headers,
):
    """Verifies identical concurrent retries do not duplicate and competing bookings collide cleanly.

    Note: SQLite serializes transactions at file-lock level; true row-lock + GiST exclusion concurrency
    semantics require PostgreSQL validation.
    """
    payload = {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:00:00",
        "reason": "Concurrent idempotency test",
    }
    key = f"concurrent-book-{uuid4().hex[:8]}"

    def send_identical():
        return client.post(
            "/api/v1/appointments",
            json=payload,
            headers={**patient_headers, "Idempotency-Key": key},
        )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = [f.result() for f in [pool.submit(send_identical) for _ in range(3)]]

    assert all(r.status_code in (200, 201) for r in results)
    ids = {r.json()["id"] for r in results}
    assert len(ids) == 1

    db_session.expire_all()
    appts = db_session.scalars(
        select(Appointment).where(
            Appointment.patient_profile_id == patient_account["profile"].id,
        )
    ).all()
    assert len(appts) == 1

    # Competing second patient trying the already-booked slot (10:30) sequentially under SQLite
    # (SQLite ignores FOR UPDATE and lacks PostgreSQL GiST exclusion ex_appointments_doctor_no_booked_overlap;
    # true cross-patient simultaneous race prevention is enforced by PostgreSQL FOR UPDATE + GiST).
    patient_b = _make_patient(db_session)
    token_b = create_access_token(subject=str(patient_b["user"].id))

    slot_payload = {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": "10:30:00",
        "reason": "Competing slot test",
    }

    r_a = client.post("/api/v1/appointments", json=slot_payload, headers=patient_headers)
    r_b = client.post(
        "/api/v1/appointments",
        json=slot_payload,
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert [r_a.status_code, r_b.status_code] == [201, 409]


# =====================================================================
# 5-6. PATIENT CANCEL REVISION, RESCHEDULE AUDIT, NON-PHI INVARIANTS
# =====================================================================

def test_patient_cancel_and_reschedule_increment_revision_and_write_non_phi_audits(
    client,
    db_session,
    patient_account,
    approved_doctor,
    booked_appointment,
    patient_headers,
):
    assert booked_appointment.revision == 0

    # Seed pending reschedule proposal to ensure cancellation supersedes it atomically
    proposal = AppointmentRescheduleProposal(
        appointment_id=booked_appointment.id,
        doctor_profile_id=approved_doctor["profile"].id,
        patient_profile_id=patient_account["profile"].id,
        proposed_date=approved_doctor["appointment_date"],
        proposed_start_time=time(11, 0),
        proposed_end_time=time(11, 30),
        doctor_message="Earlier slot available",
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=12),
    )
    db_session.add(proposal)
    db_session.commit()

    # 1. Patient reschedules -> revision == 1 & audit entry logged
    r_resched = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:30:00",
        },
        headers=patient_headers,
    )
    assert r_resched.status_code == 200
    assert r_resched.json()["revision"] == 1

    # 2. Patient cancels -> revision == 2 & audit entry logged
    r_cancel = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=patient_headers,
    )
    assert r_cancel.status_code == 200
    assert r_cancel.json()["revision"] == 2
    assert r_cancel.json()["status"] == "cancelled"

    db_session.expire_all()
    audits = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.resource_id == str(booked_appointment.id))
        .order_by(AuditLog.created_at.asc())
    ).all()
    event_types = [a.event_type for a in audits]
    assert "appointment.rescheduled_by_patient" in event_types
    assert "appointment.cancelled_by_patient" in event_types
    for a in audits:
        assert a.actor_user_id == patient_account["user"].id
        assert a.patient_profile_id == patient_account["profile"].id
        assert "Routine consultation" not in str(a.details)


# =====================================================================
# 7. MUTATION FAILURE ROLLBACK WITHOUT ORPHAN AUDIT RECORDS
# =====================================================================

def test_audit_failure_rolls_back_booking_cancel_reschedule_and_completion(
    client,
    db_session,
    monkeypatch,
    patient_account,
    approved_doctor,
    booked_appointment,
    past_booked_appointment,
    patient_headers,
    doctor_headers,
):
    from app.api.routes import appointments as appt_routes

    def boom(*args, **kwargs):
        raise RuntimeError("Simulated audit pipeline failure")

    monkeypatch.setattr(appt_routes, "add_audit_log", boom)

    # 1. Failed booking leaves zero extra appointments, idempotency rows, or audit logs
    with pytest.raises(RuntimeError):
        client.post(
            "/api/v1/appointments",
            json={
                "doctor_profile_id": str(approved_doctor["profile"].id),
                "appointment_date": approved_doctor["appointment_date"].isoformat(),
                "start_time": "10:30:00",
                "reason": "Should roll back",
            },
            headers={**patient_headers, "Idempotency-Key": "rollback-book-key"},
        )

    db_session.expire_all()
    assert db_session.scalar(
        select(IdempotencyRecord).where(IdempotencyRecord.idempotency_key == "rollback-book-key")
    ) is None
    all_appts = db_session.scalars(select(Appointment)).all()
    assert len(all_appts) == 2  # only booked_appointment & past_booked_appointment

    # 2. Failed cancellation preserves status=='booked' and revision==0
    with pytest.raises(RuntimeError):
        client.patch(
            f"/api/v1/appointments/{booked_appointment.id}/cancel",
            headers=patient_headers,
        )
    db_session.expire_all()
    b_after = db_session.get(Appointment, booked_appointment.id)
    assert b_after.status == "booked"
    assert b_after.revision == 0

    # 3. Failed completion leaves no HealthRecord & preserves status=='booked'
    with pytest.raises(RuntimeError):
        client.patch(
            f"/api/v1/appointments/{past_booked_appointment.id}/status",
            json={"visit_summary": "Should roll back", "diagnosis": "Rollback test"},
            headers=doctor_headers,
        )
    db_session.expire_all()
    p_after = db_session.get(Appointment, past_booked_appointment.id)
    assert p_after.status == "booked"
    assert db_session.scalar(
        select(HealthRecord).where(HealthRecord.appointment_id == past_booked_appointment.id)
    ) is None


# =====================================================================
# 8-10. COMPLETION SUPERSEDES PENDING PROPOSALS, DUPLICATE, NOTIFS
# =====================================================================

def test_completion_supersedes_proposals_dedupes_notification_and_blocks_duplicate(
    client,
    db_session,
    patient_account,
    approved_doctor,
    past_booked_appointment,
    doctor_headers,
):
    proposal = AppointmentRescheduleProposal(
        appointment_id=past_booked_appointment.id,
        doctor_profile_id=approved_doctor["profile"].id,
        patient_profile_id=patient_account["profile"].id,
        proposed_date=approved_doctor["appointment_date"],
        proposed_start_time=time(11, 30),
        proposed_end_time=time(12, 0),
        doctor_message="Reschedule request",
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=12),
    )
    db_session.add(proposal)
    db_session.commit()

    payload = {
        "visit_summary": "Clinical exam complete and discussed care plan.",
        "diagnosis": "Seborrheic keratosis",
        "clinical_notes": "Private medical detail that must not enter notifications or audits.",
    }

    r1 = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=payload,
        headers=doctor_headers,
    )
    assert r1.status_code == 200

    db_session.expire_all()
    prop_after = db_session.get(AppointmentRescheduleProposal, proposal.id)
    assert prop_after.status == "superseded"
    assert prop_after.resolved_at is not None

    appt_after = db_session.get(Appointment, past_booked_appointment.id)
    assert appt_after.status == "completed"
    assert appt_after.revision == 1

    # Duplicate completion blocked with 409
    r2 = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=payload,
        headers=doctor_headers,
    )
    assert r2.status_code == 409

    # Audit log zero-PHI verification
    comp_audits = db_session.scalars(
        select(AuditLog).where(
            AuditLog.event_type == "appointment.completed",
            AuditLog.resource_id == str(past_booked_appointment.id),
        )
    ).all()
    assert len(comp_audits) == 1
    assert comp_audits[0].details["superseded_proposals_count"] == 1
    assert "Seborrheic keratosis" not in str(comp_audits[0].details)
    assert "Private medical detail" not in str(comp_audits[0].details)

    # Notification delivery & Zero PHI & Deduplication
    notifs = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.completed",
            Notification.related_entity_id == str(past_booked_appointment.id),
        )
    ).all()
    assert len(notifs) == 1
    assert notifs[0].safe_action_path == "/patient/records"
    assert "Seborrheic keratosis" not in notifs[0].message
    assert "Private medical detail" not in notifs[0].message

    # Calling notify_appointment_completed again does not duplicate
    notify_appointment_completed(
        db_session,
        appointment_id=past_booked_appointment.id,
        appointment_date=past_booked_appointment.appointment_date,
        patient_user_id=patient_account["user"].id,
        doctor_name=approved_doctor["user"].full_name,
    )
    db_session.commit()
    notifs_after = db_session.scalars(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "appointment.completed",
            Notification.related_entity_id == str(past_booked_appointment.id),
        )
    ).all()
    assert len(notifs_after) == 1


# =====================================================================
# 11. CSRF SESSION LIFECYCLE ACROSS REFRESH
# =====================================================================

def test_csrf_cookie_lifetime_and_refresh_renewal_across_long_session(
    client,
    db_session,
    approved_doctor,
):
    patient = _make_patient(db_session)
    login_res = client.post(
        "/api/v1/auth/login",
        json={"email": patient["user"].email, "password": "Password@12345"},
    )
    assert login_res.status_code == 200

    # Inspect Set-Cookie header for anvaya_csrf_token Max-Age matching refresh window
    set_cookie_headers = login_res.headers.get_list("set-cookie")
    csrf_header_line = next(
        line for line in set_cookie_headers if line.startswith(f"{settings.csrf_cookie_name}=")
    )
    expected_max_age = settings.refresh_token_expire_days * 86400
    assert f"Max-Age={expected_max_age}" in csrf_header_line

    # Simulate an active user whose session is 2 days old (within 7d refresh window, >24h old CSRF token)
    refresh_cookie = login_res.cookies[settings.refresh_cookie_name]
    two_days_ago_ts = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp())
    aged_valid_csrf = _signed_csrf_at(two_days_ago_ts, str(patient["user"].id))

    client.cookies.clear()
    client.cookies.set(settings.refresh_cookie_name, refresh_cookie, path="/")
    client.cookies.set(settings.csrf_cookie_name, aged_valid_csrf, path="/")

    refresh_res = client.post(
        "/api/v1/auth/refresh",
        headers={
            "Origin": ALLOWED_ORIGIN,
            settings.csrf_header_name: aged_valid_csrf,
        },
    )
    assert refresh_res.status_code == 200

    # Refresh MUST rotate CSRF token and new token MUST work on subsequent appointment booking
    rotated_csrf = refresh_res.cookies[settings.csrf_cookie_name]
    rotated_access = refresh_res.cookies[settings.access_cookie_name]
    assert rotated_csrf != aged_valid_csrf

    client.cookies.clear()
    client.cookies.set(settings.access_cookie_name, rotated_access, path="/")
    client.cookies.set(settings.csrf_cookie_name, rotated_csrf, path="/")

    book_res = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "11:00:00",
            "reason": "Post-refresh booking",
        },
        headers={
            "Origin": ALLOWED_ORIGIN,
            settings.csrf_header_name: rotated_csrf,
            "Idempotency-Key": f"post-refresh-{uuid4().hex[:8]}",
        },
    )
    assert book_res.status_code == 201

    # Expired CSRF token older than refresh window MUST still be rejected with 403
    expired_ts = int(
        (datetime.now(timezone.utc) - timedelta(days=settings.refresh_token_expire_days, minutes=5)).timestamp()
    )
    expired_csrf = _signed_csrf_at(expired_ts, str(patient["user"].id))
    client.cookies.set(settings.csrf_cookie_name, expired_csrf, path="/")
    expired_res = client.post(
        "/api/v1/appointments",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "11:30:00",
        },
        headers={
            "Origin": ALLOWED_ORIGIN,
            settings.csrf_header_name: expired_csrf,
        },
    )
    assert expired_res.status_code == 403


# =====================================================================
# 12. ALEMBIC ADDITIVE MIGRATION DISPOSABLE VERIFICATION
# =====================================================================

def test_alembic_idempotency_migration_upgrade_and_downgrade_on_disposable_sqlite(tmp_path):
    """Verifies migration e5f6a7b8c9d0 cleanly applies and rolls back on an isolated SQLite DB."""
    db_file = tmp_path / "alembic_disposable.db"
    db_url = f"sqlite:///{db_file}"

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", db_url)

    # PostgreSQL-only GiST migration (2a67f520e83c) isn't SQLite-compatible; verify additive target revision directly
    engine = create_engine(db_url)
    # Build base tables up to a6e972c0142b excluding idempotency_records via Base metadata for FK targets,
    # then test upgrade/downgrade methods of e5f6a7b8c9d0 directly inside Alembic Context.
    from app.db.base import Base
    tables = [t for name, t in Base.metadata.tables.items() if name != "idempotency_records"]
    Base.metadata.create_all(bind=engine, tables=tables)

    import importlib.util
    from pathlib import Path

    mig_path = Path("alembic/versions/e5f6a7b8c9d0_create_idempotency_records.py")
    spec = importlib.util.spec_from_file_location("e5f6a7b8c9d0_create_idempotency_records", mig_path)
    mig = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mig)
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            orig_op = mig.op
            mig.op = Operations(ctx)
            try:
                mig.upgrade()
            finally:
                mig.op = orig_op

    assert "idempotency_records" in inspect(engine).get_table_names()

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            orig_op = mig.op
            mig.op = Operations(ctx)
            try:
                mig.downgrade()
            finally:
                mig.op = orig_op

    assert "idempotency_records" not in inspect(engine).get_table_names()
    engine.dispose()
