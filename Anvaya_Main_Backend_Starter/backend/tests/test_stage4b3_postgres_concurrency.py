"""Stage 4B.3 Isolated PostgreSQL Concurrency, Idempotency, Lifecycle & Security Tests.

Strictly confined to disposable schema anvaya_db.anvaya_test with public schema immutability checks.
Never accesses or mutates anvaya_db.public or production data.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timedelta
from threading import Barrier
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.security import create_access_token, generate_csrf_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.idempotency_record import IdempotencyRecord
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")
ALLOWED_ORIGIN = settings.cors_origin_list[0]


@pytest.fixture
def pg_engine():
    engine = create_engine(
        settings.database_url,
        connect_args={"options": "-c search_path=anvaya_test"},
        poolclass=NullPool,
        pool_pre_ping=True,
    )

    with engine.begin() as conn:
        db_name = conn.scalar(text("SELECT current_database()"))
        schema_name = conn.scalar(text("SELECT current_schema()"))
        db_user = conn.scalar(text("SELECT current_user"))
        search_path = conn.scalar(text("SHOW search_path"))

        if db_name != "anvaya_db" or schema_name != "anvaya_test" or db_user != "anvaya_app":
            raise RuntimeError("Unexpected PostgreSQL target; refusing Stage 4B.3 test setup.")
        if "public" in [s.strip() for s in search_path.split(",")]:
            raise RuntimeError("CRITICAL SAFETY VIOLATION: 'public' detected in search_path.")

        public_tables_before = set(
            conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars().all()
        )
        conn.execute(text("DROP SCHEMA IF EXISTS anvaya_test CASCADE; CREATE SCHEMA anvaya_test;"))

    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE appointments
            ADD CONSTRAINT ex_appointments_doctor_no_booked_overlap
            EXCLUDE USING gist (
                doctor_profile_id WITH =,
                tsrange(appointment_date + start_time, appointment_date + end_time, '[)') WITH &&
            )
            WHERE (status = 'booked')
        """))

    try:
        yield engine
    finally:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA IF EXISTS anvaya_test CASCADE; CREATE SCHEMA anvaya_test;"))
            public_tables_after = set(
                conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).scalars().all()
            )
            if public_tables_after != public_tables_before:
                raise RuntimeError("CRITICAL SAFETY VIOLATION: public schema modified!")
        engine.dispose()


@pytest.fixture
def pg_session_factory(pg_engine):
    return sessionmaker(bind=pg_engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture
def pg_session(pg_session_factory):
    with pg_session_factory() as session:
        yield session
        if session.in_transaction():
            session.rollback()


@pytest.fixture
def pg_api(pg_session_factory):
    def override_get_db():
        with pg_session_factory() as session:
            yield session

    prev = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    try:
        yield
    finally:
        if prev is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = prev


def _next_monday():
    today = datetime.now(IST).date()
    days = (7 - today.weekday()) % 7
    return today + timedelta(days=days or 7)


def _seed_patient(session, suffix: str) -> dict:
    user = User(
        full_name=f"PG Patient {suffix}",
        email=f"pg4b3.pat.{suffix}.{uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="patient",
        is_active=True,
    )
    session.add(user)
    session.flush()
    prof = PatientProfile(user_id=user.id)
    session.add(prof)
    session.commit()
    return {"user": user, "profile": prof, "headers": {"Authorization": f"Bearer {create_access_token(str(user.id))}"}}


def _seed_doctor(session, suffix: str, *, verification_status: str = "approved") -> dict:
    appt_date = _next_monday()
    user = User(
        full_name=f"PG Doctor {suffix}",
        email=f"pg4b3.doc.{suffix}.{uuid4().hex[:6]}@example.com",
        password_hash="test-only-hash",
        role="doctor",
        is_active=True,
    )
    session.add(user)
    session.flush()
    prof = DoctorProfile(
        user_id=user.id,
        specialization="Dermatology",
        qualification="MD",
        license_number=f"PG4B3-{uuid4().hex[:10].upper()}",
        years_experience=6,
        clinic_name="PG Test Clinic",
        verification_status=verification_status,
    )
    session.add(prof)
    session.flush()
    avail = DoctorAvailability(
        doctor_profile_id=prof.id,
        weekday=appt_date.weekday(),
        start_time=time(10, 0),
        end_time=time(13, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    session.add(avail)
    session.commit()
    return {
        "user": user,
        "profile": prof,
        "appointment_date": appt_date,
        "headers": {"Authorization": f"Bearer {create_access_token(str(user.id))}"},
    }


def test_pg_concurrent_identical_retries_and_conflicting_payload(pg_engine, pg_api, pg_session):
    """Scenario 1 & 2: Concurrent identical retries return single booking; conflicting payload fails 409."""
    p1 = _seed_patient(pg_session, "p1")
    doc = _seed_doctor(pg_session, "d1")
    key = f"pg-idemp-{uuid4().hex[:8]}"
    payload = {
        "doctor_profile_id": str(doc["profile"].id),
        "appointment_date": doc["appointment_date"].isoformat(),
        "start_time": "10:00:00",
        "reason": "PG idempotency test",
    }

    barrier = Barrier(3)

    def send_retry():
        barrier.wait(timeout=15)
        with TestClient(app) as tc:
            return tc.post(
                "/api/v1/appointments",
                json=payload,
                headers={**p1["headers"], "Idempotency-Key": key},
            )

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = [f.result(timeout=30) for f in [pool.submit(send_retry) for _ in range(3)]]

    assert all(r.status_code in (200, 201) for r in results)
    assert len({r.json()["id"] for r in results}) == 1
    assert sorted(r.status_code for r in results).count(201) == 1

    pg_session.expire_all()
    assert len(pg_session.scalars(select(Appointment)).all()) == 1
    assert len(pg_session.scalars(select(IdempotencyRecord)).all()) == 1
    assert len(pg_session.scalars(select(AuditLog).where(AuditLog.event_type == "appointment.created")).all()) == 1
    assert len(pg_session.scalars(select(Notification).where(Notification.notification_type == "appointment.booked")).all()) == 2

    # Conflicting payload with same key -> 409
    with TestClient(app) as tc:
        r_conflict = tc.post(
            "/api/v1/appointments",
            json={**payload, "start_time": "10:30:00"},
            headers={**p1["headers"], "Idempotency-Key": key},
        )
    assert r_conflict.status_code == 409
    assert "different booking payload" in r_conflict.json()["detail"].lower()


def test_pg_competing_race_adjacent_slots_cancel_release_and_isolation(pg_engine, pg_api, pg_session):
    """Scenarios 3, 4, 5, 7, 8: Racing same slot vs adjacent slots, cancel releasing slot, isolation & no deadlocks."""
    p1 = _seed_patient(pg_session, "p1")
    p2 = _seed_patient(pg_session, "p2")
    p3 = _seed_patient(pg_session, "p3")
    doc = _seed_doctor(pg_session, "d2")

    base = {
        "doctor_profile_id": str(doc["profile"].id),
        "appointment_date": doc["appointment_date"].isoformat(),
    }

    # Scenario 3: P1 and P2 race for 10:00 simultaneously
    barrier_race = Barrier(2)

    def race_1000(headers):
        barrier_race.wait(timeout=15)
        with TestClient(app) as tc:
            return tc.post(
                "/api/v1/appointments",
                json={**base, "start_time": "10:00:00", "reason": "Race 10:00"},
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(race_1000, p1["headers"])
        f2 = pool.submit(race_1000, p2["headers"])
        r1, r2 = f1.result(timeout=30), f2.result(timeout=30)

    assert sorted([r1.status_code, r2.status_code]) == [201, 409]
    winner_res = r1 if r1.status_code == 201 else r2
    winner_headers = p1["headers"] if r1.status_code == 201 else p2["headers"]
    loser_headers = p2["headers"] if r1.status_code == 201 else p1["headers"]
    appt_1000_id = winner_res.json()["id"]

    # Scenario 4 & 7: P2 and P3 book adjacent non-overlapping slots concurrently (10:30, 11:00) without deadlock
    barrier_adj = Barrier(2)

    def book_slot(headers, start):
        barrier_adj.wait(timeout=15)
        with TestClient(app) as tc:
            return tc.post(
                "/api/v1/appointments",
                json={**base, "start_time": start, "reason": f"Adjacent {start}"},
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        fa = pool.submit(book_slot, loser_headers, "10:30:00")
        fb = pool.submit(book_slot, p3["headers"], "11:00:00")
        ra, rb = fa.result(timeout=30), fb.result(timeout=30)

    assert [ra.status_code, rb.status_code] == [201, 201]

    # Scenario 8: Cross-patient isolation (loser cannot see/cancel winner's appointment)
    with TestClient(app) as tc:
        assert tc.get(f"/api/v1/appointments/{appt_1000_id}", headers=loser_headers).status_code == 404
        assert tc.patch(f"/api/v1/appointments/{appt_1000_id}/cancel", headers=loser_headers).status_code == 404

    # Scenario 5: Winner cancels 10:00 (revision -> 1), releasing slot for P3
    with TestClient(app) as tc:
        r_cancel = tc.patch(f"/api/v1/appointments/{appt_1000_id}/cancel", headers=winner_headers)
        assert r_cancel.status_code == 200
        assert r_cancel.json()["status"] == "cancelled"
        assert r_cancel.json()["revision"] == 1

        r_rebook = tc.post(
            "/api/v1/appointments",
            json={**base, "start_time": "10:00:00", "reason": "Rebook released slot"},
            headers=p3["headers"],
        )
        assert r_rebook.status_code == 201


def test_pg_rollback_and_stage4b1_csrf_and_doctor_rbac(pg_engine, pg_api, pg_session, monkeypatch):
    """Scenarios 6 & Phase 4: PG rollback atomicity + Stage 4B.1 CSRF/Origin & Doctor Queue RBAC."""
    p1 = _seed_patient(pg_session, "rb")
    doc_approved = _seed_doctor(pg_session, "appr", verification_status="approved")
    doc_pending = _seed_doctor(pg_session, "pend", verification_status="pending")
    doc_suspended = _seed_doctor(pg_session, "susp", verification_status="suspended")

    # 1. Stage 4B.1 Doctor RBAC on PG
    with TestClient(app) as tc:
        assert tc.get("/api/v1/appointments/doctor/me", headers=doc_pending["headers"]).status_code == 403
        assert tc.get("/api/v1/appointments/doctor/me", headers=doc_suspended["headers"]).status_code == 403
        assert tc.get("/api/v1/appointments/doctor/me", headers=doc_approved["headers"]).status_code == 200

        # Cookie mutation without CSRF -> 403
        cookie_token = create_access_token(str(p1["user"].id))
        tc.cookies.set(settings.access_cookie_name, cookie_token)
        res_no_csrf = tc.post(
            "/api/v1/appointments",
            json={
                "doctor_profile_id": str(doc_approved["profile"].id),
                "appointment_date": doc_approved["appointment_date"].isoformat(),
                "start_time": "10:00:00",
            },
            headers={"Origin": ALLOWED_ORIGIN},
        )
        assert res_no_csrf.status_code == 403

        # Valid Cookie + CSRF + Origin -> 201
        csrf = generate_csrf_token(str(p1["user"].id))
        tc.cookies.set(settings.csrf_cookie_name, csrf)
        res_ok = tc.post(
            "/api/v1/appointments",
            json={
                "doctor_profile_id": str(doc_approved["profile"].id),
                "appointment_date": doc_approved["appointment_date"].isoformat(),
                "start_time": "10:00:00",
                "reason": "PG CSRF valid booking",
            },
            headers={
                "Origin": ALLOWED_ORIGIN,
                settings.csrf_header_name: csrf,
                "Idempotency-Key": "pg-csrf-ok-key",
            },
        )
        assert res_ok.status_code == 201

    # 2. Failed transaction rollback in PG (zero orphan audit/notification/idempotency rows)
    from app.api.routes import appointments as appt_routes

    def fail_audit(*args, **kwargs):
        raise RuntimeError("Simulated PG audit failure")

    monkeypatch.setattr(appt_routes, "add_audit_log", fail_audit)
    with TestClient(app) as tc:
        with pytest.raises(RuntimeError):
            tc.post(
                "/api/v1/appointments",
                json={
                    "doctor_profile_id": str(doc_approved["profile"].id),
                    "appointment_date": doc_approved["appointment_date"].isoformat(),
                    "start_time": "10:30:00",
                    "reason": "PG rollback booking",
                },
                headers={**p1["headers"], "Idempotency-Key": "pg-rollback-key"},
            )

    pg_session.expire_all()
    assert pg_session.scalar(
        select(IdempotencyRecord).where(IdempotencyRecord.idempotency_key == "pg-rollback-key")
    ) is None
    assert len(pg_session.scalars(select(Appointment)).all()) == 1
    assert len(pg_session.scalars(select(AuditLog).where(AuditLog.event_type == "appointment.created")).all()) == 1
