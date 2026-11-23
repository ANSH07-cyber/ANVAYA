from uuid import UUID
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.core.config import settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord

from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability


IST = ZoneInfo("Asia/Kolkata")


# =====================================================
# 1. ISOLATED POSTGRESQL TEST ENGINE
# =====================================================

@pytest.fixture
def test_engine():

    engine = create_engine(
        settings.database_url,
        connect_args={
           "options": "-c search_path=anvaya_test",
        },
        poolclass=NullPool,
        pool_pre_ping=True,
    )

    # Verify destination and strict schema isolation before any setup.
    with engine.begin() as connection:
        database_name = connection.scalar(
            text("SELECT current_database()")
        )
        schema_name = connection.scalar(
            text("SELECT current_schema()")
        )
        database_user = connection.scalar(
            text("SELECT current_user")
        )
        search_path = connection.scalar(
            text("SHOW search_path")
        )

        if database_name != "anvaya_db":
            raise RuntimeError(
                "Unexpected database. Refusing test setup."
            )

        if schema_name != "anvaya_test":
            raise RuntimeError(
                "Unexpected schema. Refusing test setup."
            )

        if database_user != "anvaya_app":
            raise RuntimeError(
                "Unexpected database user. Refusing test setup."
            )

        if "public" in [s.strip() for s in search_path.split(",")]:
            raise RuntimeError(
                "CRITICAL SAFETY VIOLATION: 'public' detected in search_path! Refusing test setup."
            )

        # Record public tables snapshot for strict invariant enforcement
        public_tables_before = set(
            connection.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            ).scalars().all()
        )

        # Confine schema reset strictly to anvaya_test
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS anvaya_test;"))
        connection.execute(text("DROP SCHEMA IF EXISTS anvaya_test CASCADE; CREATE SCHEMA anvaya_test;"))

        print(
            f"\nVERIFIED POSTGRES TARGET: "
            f"{database_name}.{schema_name} (search_path={search_path})"
        )

    # Create tables strictly within anvaya_test
    Base.metadata.create_all(bind=engine)

    # Apply PostgreSQL-specific appointment overlap protection
    # to the isolated test schema.
    with engine.begin() as connection:
        connection.execute(text("""
            ALTER TABLE appointments
            ADD CONSTRAINT ex_appointments_doctor_no_booked_overlap
            EXCLUDE USING gist (
                doctor_profile_id WITH =,
                tsrange(
                    appointment_date + start_time,
                    appointment_date + end_time,
                    '[)'
                ) WITH &&
            )
            WHERE (status = 'booked')
        """))

    try:
        yield engine

    finally:
        with engine.begin() as connection:
            # Confine teardown strictly to anvaya_test (never drop_all across search_path)
            connection.execute(text("DROP SCHEMA IF EXISTS anvaya_test CASCADE; CREATE SCHEMA anvaya_test;"))

            # Enforce public schema immutability invariant
            public_tables_after = set(
                connection.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                ).scalars().all()
            )
            if public_tables_after != public_tables_before:
                raise RuntimeError(
                    f"CRITICAL SAFETY VIOLATION: public tables modified during test! "
                    f"Before: {public_tables_before}, After: {public_tables_after}"
                )
        engine.dispose()


# =====================================================
# 2. POSTGRESQL SESSION FACTORY
# =====================================================

@pytest.fixture
def postgres_session_factory(test_engine):

    return sessionmaker(
        bind=test_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


@pytest.fixture
def postgres_session(postgres_session_factory):

    with postgres_session_factory() as session:
        yield session

        if session.in_transaction():
            session.rollback()


# =====================================================
# 3. OVERRIDE FASTAPI DATABASE DEPENDENCY
# WITH POSTGRESQL TEST SESSION
# =====================================================

@pytest.fixture
def postgres_api_override(postgres_session_factory):

    def override_get_db():

        with postgres_session_factory() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)

    app.dependency_overrides[get_db] = override_get_db

    try:
        yield

    finally:

        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override


# =====================================================
# 4. FUTURE MONDAY
# =====================================================

@pytest.fixture
def postgres_future_monday():

    today = datetime.now(IST).date()

    days_until_monday = (7 - today.weekday()) % 7

    if days_until_monday == 0:
        days_until_monday = 7

    return today + timedelta(days=days_until_monday)


# =====================================================
# 5. FIRST PATIENT
# =====================================================

@pytest.fixture
def pg_patient_headers(postgres_session):

    user = User(
        full_name="PostgreSQL Patient One",
        email="pg.patient.one@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    postgres_session.add(user)
    postgres_session.flush()

    profile = PatientProfile(
        user_id=user.id,
    )

    postgres_session.add(profile)
    postgres_session.commit()

    token = create_access_token(str(user.id))

    return {
        "Authorization": f"Bearer {token}"
    }


# =====================================================
# 6. SECOND PATIENT
# =====================================================

@pytest.fixture
def pg_second_patient_headers(postgres_session):

    user = User(
        full_name="PostgreSQL Patient Two",
        email="pg.patient.two@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    postgres_session.add(user)
    postgres_session.flush()

    profile = PatientProfile(
        user_id=user.id,
    )

    postgres_session.add(profile)
    postgres_session.commit()

    token = create_access_token(str(user.id))

    return {
        "Authorization": f"Bearer {token}"
    }


# =====================================================
# 7. APPROVED DOCTOR AND WEEKLY AVAILABILITY
# IN THE POSTGRESQL TEST SCHEMA
# =====================================================

@pytest.fixture
def pg_approved_doctor(
    postgres_session,
    postgres_future_monday,
):

    user = User(
        full_name="PostgreSQL Test Doctor",
        email="pg.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )

    postgres_session.add(user)
    postgres_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Dermatology",
        qualification="MBBS, MD Dermatology",
        license_number="PG-TEST-ANVAYA-001",
        years_experience=5,
        clinic_name="PostgreSQL Test Clinic",
        verification_status="approved",
    )

    postgres_session.add(profile)
    postgres_session.flush()

    availability = DoctorAvailability(
        doctor_profile_id=profile.id,
        weekday=postgres_future_monday.weekday(),
        start_time=time(10, 0),
        end_time=time(12, 0),
        slot_duration_minutes=30,
        is_active=True,
    )

    postgres_session.add(availability)
    postgres_session.commit()

    return {
        "user": user,
        "profile": profile,
        "appointment_date": postgres_future_monday,
    }


# =====================================================
# 8. REAL POSTGRESQL CONCURRENT BOOKING TEST
# =====================================================

def test_concurrent_booking_allows_only_one_patient(
    test_engine,
    postgres_api_override,
    pg_patient_headers,
    pg_second_patient_headers,
    pg_approved_doctor,
):

    barrier = Barrier(2)

    payload = {
        "doctor_profile_id": str(
            pg_approved_doctor["profile"].id
        ),
        "appointment_date": (
            pg_approved_doctor["appointment_date"].isoformat()
        ),
        "start_time": "10:00:00",
        "reason": "PostgreSQL concurrency test",
    }

    def send_booking(headers):

        barrier.wait(timeout=15)

        # Each thread gets its own HTTP client and DB session.
        # The global dependency override points both requests
        # to the PostgreSQL test schema.

        with TestClient(app) as test_client:

            return test_client.post(
                "/api/v1/appointments",
                json=payload,
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:

        first_request = executor.submit(
            send_booking,
            pg_patient_headers,
        )

        second_request = executor.submit(
            send_booking,
            pg_second_patient_headers,
        )

        responses = [
            first_request.result(timeout=30),
            second_request.result(timeout=30),
        ]

    status_codes = sorted(
        response.status_code
        for response in responses
    )

    assert status_codes == [201, 409], [
        {
            "status": response.status_code,
            "body": response.json(),
        }
        for response in responses
    ]

    # Confirm exactly one booked appointment exists
    # in the PostgreSQL test schema.

    with test_engine.connect() as connection:

        booked_count = connection.scalar(
            text("""
                SELECT COUNT(*)
                FROM appointments
                WHERE status = 'booked'
            """)
        )

    assert booked_count == 1

    print("\nPOSTGRESQL CONCURRENCY RESULTS:")
    print("HTTP statuses:", status_codes)
    print("Booked records:", booked_count)
    print("CONCURRENCY TEST: PASSED")

# =========================================================
# 9. CONCURRENT DOCTOR EHR ACCESS AND CONSENT REVOCATION
# REAL POSTGRESQL INTEGRATION TEST
# =========================================================

def test_concurrent_ehr_access_and_consent_revocation(
    test_engine,
    postgres_api_override,
    postgres_session,
    pg_patient_headers,
    pg_approved_doctor,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi.testclient import TestClient

    # Find the patient created by the existing fixture.
    patient_profile = postgres_session.scalar(
        select(PatientProfile)
        .join(User, User.id == PatientProfile.user_id)
        .where(User.email == "pg.patient.one@example.com")
    )

    assert patient_profile is not None

    doctor_profile = pg_approved_doctor["profile"]

    doctor_token = create_access_token(
        str(pg_approved_doctor["user"].id)
    )

    doctor_headers = {
        "Authorization": f"Bearer {doctor_token}"
    }

    # Create a past appointment for the EHR workflow.
    appointment = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        appointment_date=(
            datetime.now(IST).date() - timedelta(days=1)
        ),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Consent concurrency test",
    )

    postgres_session.add(appointment)
    postgres_session.commit()
    postgres_session.refresh(appointment)

    # Doctor completes the consultation and creates an EHR.
    consultation_payload = {
        "visit_summary": (
            "Patient consultation completed. "
            "Symptoms assessed and treatment discussed."
        ),
        "diagnosis": "PostgreSQL concurrency test diagnosis",
        "symptoms": "Test symptoms",
    }

    with TestClient(app) as client:
        completion_response = client.patch(
            f"/api/v1/appointments/{appointment.id}/status",
            json=consultation_payload,
            headers=doctor_headers,
        )

    assert completion_response.status_code == 200, (
        completion_response.text
    )

    # Patient grants access to the diagnosis field.
    with TestClient(app) as client:
        grant_response = client.post(
            "/api/v1/consents",
            json={
                "doctor_profile_id": str(doctor_profile.id),
                "data_scopes": ["diagnosis"],
            },
            headers=pg_patient_headers,
        )

    assert grant_response.status_code == 201, grant_response.text

    consent_id = grant_response.json()["id"]

    # Launch EHR access and consent revocation simultaneously.
    barrier = Barrier(2)

    def request_ehr_access():
        barrier.wait(timeout=15)

        with TestClient(app) as client:
            return client.get(
                f"/api/v1/health-records/patient/{patient_profile.id}",
                params=[("scopes", "diagnosis")],
                headers=doctor_headers,
            )

    def revoke_patient_consent():
        barrier.wait(timeout=15)

        with TestClient(app) as client:
            return client.patch(
                f"/api/v1/consents/{consent_id}/revoke",
                headers=pg_patient_headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:

        access_future = executor.submit(request_ehr_access)
        revoke_future = executor.submit(revoke_patient_consent)

        access_response = access_future.result(timeout=30)
        revoke_response = revoke_future.result(timeout=30)

    # Revocation must always succeed.
    assert revoke_response.status_code == 200, (
        revoke_response.text
    )

    assert revoke_response.json()["is_active"] is False

    # The concurrent access may complete before revocation
    # or be denied after revocation, depending on lock order.
    assert access_response.status_code in (200, 403), (
        access_response.text
    )

    # After both concurrent operations finish, access
    # must be denied because consent is now revoked.
    with TestClient(app) as client:
        final_access_response = client.get(
            f"/api/v1/health-records/patient/{patient_profile.id}",
            params=[("scopes", "diagnosis")],
            headers=doctor_headers,
        )

    assert final_access_response.status_code == 403

    assert final_access_response.json()["detail"] == (
        "Active patient consent is required."
    )

    # Verify the final persisted PostgreSQL consent state.
    postgres_session.expire_all()

    saved_consent = postgres_session.scalar(
        select(ConsentRecord).where(
            ConsentRecord.id == UUID(consent_id)
        )
    )

    assert saved_consent is not None
    assert saved_consent.is_active is False
    assert saved_consent.revoked_at is not None

    print("\nPOSTGRESQL CONSENT CONCURRENCY RESULTS:")
    print("Concurrent EHR access:", access_response.status_code)
    print("Consent revocation:", revoke_response.status_code)
    print("Final EHR access:", final_access_response.status_code)
    print("Persisted consent active:", saved_consent.is_active)
    print("CONSENT CONCURRENCY TEST: PASSED")
def test_doctor_appointment_overlap_exclusion_constraint(
    postgres_session,
    pg_patient_headers,
    pg_approved_doctor,
):
    patient_profile = postgres_session.scalar(
        select(PatientProfile)
        .join(User, User.id == PatientProfile.user_id)
        .where(User.email == "pg.patient.one@example.com")
    )
    assert patient_profile is not None

    doctor = pg_approved_doctor["profile"]
    appointment_date = pg_approved_doctor["appointment_date"]

    # 1. First booked appointment should succeed.
    first = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor.id,
        appointment_date=appointment_date,
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Overlap constraint test",
    )
    postgres_session.add(first)
    postgres_session.commit()

    # 2. Overlapping appointment for the same doctor must fail.
    with pytest.raises(IntegrityError):
        with postgres_session.begin_nested():
            overlapping = Appointment(
                patient_profile_id=patient_profile.id,
                doctor_profile_id=doctor.id,
                appointment_date=appointment_date,
                start_time=time(10, 15),
                end_time=time(10, 45),
                status="booked",
                reason="Should be rejected",
            )
            postgres_session.add(overlapping)
            postgres_session.flush()

    # 3. Adjacent appointment should succeed (10:30 is not an overlap).
    adjacent = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor.id,
        appointment_date=appointment_date,
        start_time=time(10, 30),
        end_time=time(11, 0),
        status="booked",
        reason="Adjacent appointment test",
    )
    postgres_session.add(adjacent)
    postgres_session.flush()

    # 4. Create a second doctor.
    second_user = User(
        full_name="Second PostgreSQL Test Doctor",
        email="pg.doctor.two@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    postgres_session.add(second_user)
    postgres_session.flush()

    second_doctor = DoctorProfile(
        user_id=second_user.id,
        specialization="Dermatology",
        qualification="MBBS, MD Dermatology",
        license_number="PG-TEST-ANVAYA-002",
        years_experience=5,
        clinic_name="Second PostgreSQL Test Clinic",
        verification_status="approved",
    )
    postgres_session.add(second_doctor)
    postgres_session.flush()

    # 5. Same time for a different doctor should succeed.
    other_doctor_appointment = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=second_doctor.id,
        appointment_date=appointment_date,
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Different doctor test",
    )
    postgres_session.add(other_doctor_appointment)
    postgres_session.flush()

    # 6. Cancelled overlapping appointment should be allowed.
    cancelled_overlap = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor.id,
        appointment_date=appointment_date,
        start_time=time(10, 15),
        end_time=time(10, 45),
        status="cancelled",
        reason="Cancelled appointment test",
    )
    postgres_session.add(cancelled_overlap)
    postgres_session.flush()

    postgres_session.commit()

# =========================================================
# 10. CONCURRENT FIREBASE LOGIN
# REAL POSTGRESQL INTEGRATION TEST
# =========================================================

def test_concurrent_firebase_login_does_not_create_duplicates(
    test_engine,
    postgres_api_override,
    monkeypatch,
):
    from app.api.routes import auth

    barrier = Barrier(2)

    firebase_uid = "concurrent-google-test-uid"
    email = "concurrent.google.patient@example.com"

    claims = {
        "uid": firebase_uid,
        "sub": firebase_uid,
        "email": email,
        "email_verified": True,
        "name": "Concurrent Google Patient",
        "firebase": {
            "sign_in_provider": "google.com",
        },
    }

    def mock_firebase_verification(token):
        # Both requests reach Firebase verification
        # before either continues to database operations.
        barrier.wait(timeout=15)
        return claims

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        mock_firebase_verification,
    )

    def send_login():
        with TestClient(app) as client:
            return client.post(
                "/api/v1/auth/firebase",
                json={"id_token": "mock-concurrent-token"},
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(send_login)
        second = executor.submit(send_login)

        responses = [
            first.result(timeout=30),
            second.result(timeout=30),
        ]

    status_codes = sorted(
        response.status_code for response in responses
    )

    # One request must succeed. The other may either
    # reuse the account or receive a conflict response.
    assert status_codes in ([200, 200], [200, 409]), [
        {
            "status": response.status_code,
            "body": response.json(),
        }
        for response in responses
    ]

    with test_engine.connect() as connection:
        user_count = connection.execute(
            text("""
                SELECT COUNT(*)
                FROM users
                WHERE email = :email
                  AND firebase_uid = :firebase_uid
            """),
            {
                "email": email,
                "firebase_uid": firebase_uid,
            },
        ).scalar_one()

    assert user_count == 1

    print("\nFIREBASE CONCURRENCY RESULTS:")
    print("HTTP statuses:", status_codes)
    print("Matching user records:", user_count)
    print("FIREBASE CONCURRENCY TEST: PASSED")


# =====================================================
# 12. DOCTOR AVAILABILITY CONCURRENCY TESTS (Phase 5.6.2 Hardening)
# =====================================================

def test_concurrent_overlapping_shift_creation_allows_only_one(
    test_engine,
    postgres_api_override,
    pg_approved_doctor,
    postgres_future_monday,
):
    token = create_access_token(str(pg_approved_doctor["user"].id))
    headers = {"Authorization": f"Bearer {token}"}
    barrier = Barrier(2)

    weekday = (postgres_future_monday.weekday() + 1) % 7
    # Shift A: 09:00 - 11:00, Shift B: 10:00 - 12:00 (overlapping on Tuesday, different start times)
    payload_a = {
        "weekday": weekday,
        "start_time": "09:00:00",
        "end_time": "11:00:00",
        "slot_duration_minutes": 30,
    }
    payload_b = {
        "weekday": weekday,
        "start_time": "10:00:00",
        "end_time": "12:00:00",
        "slot_duration_minutes": 30,
    }

    def create_shift(payload):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.post("/api/v1/doctors/me/availability", json=payload, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(create_shift, payload_a)
        f2 = executor.submit(create_shift, payload_b)
        responses = [f1.result(timeout=30), f2.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    # With row-level locking on DoctorProfile, exactly one succeeds and one receives 409
    assert status_codes == [201, 409], f"Expected [201, 409], got {status_codes}"

    with test_engine.connect() as conn:
        count = conn.execute(
            text("""
                SELECT COUNT(*) FROM doctor_availabilities
                WHERE doctor_profile_id = :doc_id
                  AND weekday = :weekday
                  AND is_active = true
            """),
            {"doc_id": pg_approved_doctor["profile"].id, "weekday": weekday},
        ).scalar_one()
    assert count == 1


def test_concurrent_overlapping_shift_updates_rejects_conflict(
    test_engine,
    postgres_session,
    postgres_api_override,
    pg_approved_doctor,
    postgres_future_monday,
):
    weekday = (postgres_future_monday.weekday() + 2) % 7
    # Pre-create two non-overlapping active shifts on Wednesday:
    # Shift 1: 08:00 - 10:00, Shift 2: 14:00 - 16:00
    s1 = DoctorAvailability(
        doctor_profile_id=pg_approved_doctor["profile"].id,
        weekday=weekday,
        start_time=time(8, 0),
        end_time=time(10, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    s2 = DoctorAvailability(
        doctor_profile_id=pg_approved_doctor["profile"].id,
        weekday=weekday,
        start_time=time(14, 0),
        end_time=time(16, 0),
        slot_duration_minutes=30,
        is_active=True,
    )
    postgres_session.add_all([s1, s2])
    postgres_session.commit()

    token = create_access_token(str(pg_approved_doctor["user"].id))
    headers = {"Authorization": f"Bearer {token}"}
    barrier = Barrier(2)

    # Concurrently update Shift 1 to 10:00 - 12:00 and Shift 2 to 11:00 - 13:00 (overlapping 11:00-12:00)
    def update_shift(shift_id, start, end):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.put(
                f"/api/v1/doctors/me/availability/{shift_id}",
                json={"weekday": weekday, "start_time": start, "end_time": end, "slot_duration_minutes": 30},
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(update_shift, s1.id, "10:00:00", "12:00:00")
        f2 = executor.submit(update_shift, s2.id, "11:00:00", "13:00:00")
        responses = [f1.result(timeout=30), f2.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    # Conflicting schedules must not both commit
    assert status_codes == [200, 409], f"Expected [200, 409], got {status_codes}"


def test_concurrent_reactivation_against_overlapping_shift_rejects_conflict(
    test_engine,
    postgres_session,
    postgres_api_override,
    pg_approved_doctor,
    postgres_future_monday,
):
    weekday = (postgres_future_monday.weekday() + 3) % 7
    # Pre-create two inactive overlapping shifts on Thursday:
    # Shift 1: 09:00 - 11:00 (inactive), Shift 2: 10:00 - 12:00 (inactive)
    s1 = DoctorAvailability(
        doctor_profile_id=pg_approved_doctor["profile"].id,
        weekday=weekday,
        start_time=time(9, 0),
        end_time=time(11, 0),
        slot_duration_minutes=30,
        is_active=False,
    )
    s2 = DoctorAvailability(
        doctor_profile_id=pg_approved_doctor["profile"].id,
        weekday=weekday,
        start_time=time(10, 0),
        end_time=time(12, 0),
        slot_duration_minutes=30,
        is_active=False,
    )
    postgres_session.add_all([s1, s2])
    postgres_session.commit()

    token = create_access_token(str(pg_approved_doctor["user"].id))
    headers = {"Authorization": f"Bearer {token}"}
    barrier = Barrier(2)

    def reactivate(shift_id):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.patch(
                f"/api/v1/doctors/me/availability/{shift_id}/status",
                json={"is_active": True},
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(reactivate, s1.id)
        f2 = executor.submit(reactivate, s2.id)
        responses = [f1.result(timeout=30), f2.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    assert status_codes == [200, 409], f"Expected [200, 409], got {status_codes}"

    with test_engine.connect() as conn:
        active_count = conn.execute(
            text("""
                SELECT COUNT(*) FROM doctor_availabilities
                WHERE doctor_profile_id = :doc_id
                  AND weekday = :weekday
                  AND is_active = true
            """),
            {"doc_id": pg_approved_doctor["profile"].id, "weekday": weekday},
        ).scalar_one()
    assert active_count == 1


def test_concurrent_non_overlapping_shift_creation_both_succeed(
    test_engine,
    postgres_api_override,
    pg_approved_doctor,
    postgres_future_monday,
):
    weekday = (postgres_future_monday.weekday() + 4) % 7
    token = create_access_token(str(pg_approved_doctor["user"].id))
    headers = {"Authorization": f"Bearer {token}"}
    barrier = Barrier(2)

    # Shift A: 08:00 - 10:00, Shift B: 14:00 - 16:00 (distinct non-overlapping windows)
    payload_a = {
        "weekday": weekday,
        "start_time": "08:00:00",
        "end_time": "10:00:00",
        "slot_duration_minutes": 30,
    }
    payload_b = {
        "weekday": weekday,
        "start_time": "14:00:00",
        "end_time": "16:00:00",
        "slot_duration_minutes": 30,
    }

    def create_shift(payload):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.post("/api/v1/doctors/me/availability", json=payload, headers=headers)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(create_shift, payload_a)
        f2 = executor.submit(create_shift, payload_b)
        responses = [f1.result(timeout=30), f2.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    assert status_codes == [201, 201], f"Expected [201, 201], got {status_codes}"

    with test_engine.connect() as conn:
        count = conn.execute(
            text("""
                SELECT COUNT(*) FROM doctor_availabilities
                WHERE doctor_profile_id = :doc_id
                  AND weekday = :weekday
                  AND is_active = true
            """),
            {"doc_id": pg_approved_doctor["profile"].id, "weekday": weekday},
        ).scalar_one()
    assert count == 2


# =====================================================
# 15. CONCURRENT DOCTOR VERIFICATION ROW-LOCK PROTECTION
# =====================================================

def test_concurrent_doctor_verification_race_condition_rejected(
    test_engine,
    postgres_session,
    postgres_api_override,
):
    admin_user = User(
        full_name="PostgreSQL Admin",
        email="pg.admin.concurrency@example.com",
        password_hash="test-hash",
        role="admin",
        is_active=True,
    )
    postgres_session.add(admin_user)
    postgres_session.flush()

    doc_user = User(
        full_name="Dr. PostgreSQL Concurrent",
        email="pg.doctor.concurrent@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    postgres_session.add(doc_user)
    postgres_session.flush()

    doc_profile = DoctorProfile(
        user_id=doc_user.id,
        specialization="Cardiology",
        qualification="MBBS, MD",
        license_number="LIC-PG-CONCURRENT-001",
        verification_status="pending",
    )
    postgres_session.add(doc_profile)
    postgres_session.commit()

    admin_token = create_access_token(str(admin_user.id))
    headers = {"Authorization": f"Bearer {admin_token}"}
    barrier = Barrier(2)

    def attempt_transition(target_status: str, reason: str):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.patch(
                f"/api/v1/admin/doctors/{doc_profile.id}/verification",
                json={"verification_status": target_status, "reason": reason},
                headers=headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_approve = executor.submit(attempt_transition, "approved", "Approved by Admin A")
        f_reject = executor.submit(attempt_transition, "rejected", "Rejected by Admin B")
        responses = [f_approve.result(timeout=30), f_reject.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    # With row-level locking (FOR UPDATE) in PostgreSQL, one transaction acquires the row lock
    # and commits, while the second transaction waits and then encounters the updated status,
    # returning 409 Conflict.
    assert status_codes == [200, 409], f"Expected [200, 409], got {status_codes}"


# =====================================================
# 16. REAL POSTGRESQL CONCURRENT DUPLICATE CONSENT REQUEST
# =====================================================

def test_concurrent_duplicate_consent_requests_rejected_in_postgres(
    test_engine,
    postgres_session,
    postgres_api_override,
    pg_patient_headers,
    pg_approved_doctor,
):
    """Two concurrent consent requests from the same doctor for the same patient in PostgreSQL.
    With row locking and partial unique index uq_active_consent_request_doctor_patient,
    exactly one succeeds with 201 and the concurrent request is rejected with 409 Conflict.
    Zero deadlocks occur.
    """
    # 1. Establish appointment relationship in isolated test schema
    pat_user = postgres_session.scalar(select(User).where(User.email == "pg.patient.one@example.com"))
    pat_profile = postgres_session.scalar(select(PatientProfile).where(PatientProfile.user_id == pat_user.id))

    appointment = Appointment(
        patient_profile_id=pat_profile.id,
        doctor_profile_id=pg_approved_doctor["profile"].id,
        appointment_date=pg_approved_doctor["appointment_date"],
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
    )
    postgres_session.add(appointment)
    postgres_session.commit()

    doctor_token = create_access_token(str(pg_approved_doctor["user"].id))
    doctor_headers = {"Authorization": f"Bearer {doctor_token}"}

    barrier = Barrier(2)
    payload = {
        "patient_profile_id": str(pat_profile.id),
        "requested_scopes": ["diagnosis", "symptoms"],
        "doctor_message": "PostgreSQL concurrency test request.",
    }

    def submit_request(ident: str):
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.post(
                "/api/v1/consents/requests",
                json={**payload, "idempotency_key": f"pg-conc-req-{ident}"},
                headers=doctor_headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(submit_request, "thread-1")
        f2 = executor.submit(submit_request, "thread-2")
        responses = [f1.result(timeout=30), f2.result(timeout=30)]

    status_codes = sorted(r.status_code for r in responses)
    assert status_codes == [201, 409], f"Expected [201, 409], got {status_codes}"

    # Verify exactly one pending request exists in PostgreSQL
    with test_engine.connect() as conn:
        count = conn.execute(
            text("""
                SELECT COUNT(*) FROM consent_requests
                WHERE doctor_profile_id = :doc_id
                  AND patient_profile_id = :pat_id
                  AND status = 'pending'
            """),
            {"doc_id": pg_approved_doctor["profile"].id, "pat_id": pat_profile.id},
        ).scalar_one()
    assert count == 1


# =====================================================
# 17. CONCURRENT CONSENT APPROVAL AND REVOCATION (ZERO DEADLOCKS)
# =====================================================

def test_concurrent_consent_approval_and_revocation_no_deadlock(
    test_engine,
    postgres_session,
    postgres_api_override,
    pg_patient_headers,
    pg_approved_doctor,
):
    """Patient concurrently revokes existing active consent on Thread 1 and approves a pending
    consent request on Thread 2. With consistent lock ordering (PatientProfile -> ConsentRequest -> ConsentRecord),
    zero PostgreSQL deadlocks occur, and revoked scopes are never restored.
    """
    pat_user = postgres_session.scalar(select(User).where(User.email == "pg.patient.one@example.com"))
    pat_profile = postgres_session.scalar(select(PatientProfile).where(PatientProfile.user_id == pat_user.id))

    # 1. Establish appointment relationship
    appointment = Appointment(
        patient_profile_id=pat_profile.id,
        doctor_profile_id=pg_approved_doctor["profile"].id,
        appointment_date=pg_approved_doctor["appointment_date"],
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="completed",
    )
    postgres_session.add(appointment)

    # 2. Existing active consent record with [diagnosis, symptoms]
    existing_consent = ConsentRecord(
        patient_profile_id=pat_profile.id,
        doctor_profile_id=pg_approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=True,
    )
    postgres_session.add(existing_consent)
    postgres_session.flush()

    # 3. Pending consent request for [clinical_notes]
    from app.models.consent_request import ConsentRequest
    consent_req = ConsentRequest(
        doctor_profile_id=pg_approved_doctor["profile"].id,
        patient_profile_id=pat_profile.id,
        requested_scopes=["clinical_notes"],
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    postgres_session.add(consent_req)
    postgres_session.commit()

    barrier = Barrier(2)

    def do_revoke():
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.patch(
                f"/api/v1/consents/{existing_consent.id}/revoke",
                headers=pg_patient_headers,
            )

    def do_approve():
        barrier.wait(timeout=15)
        with TestClient(app) as client:
            return client.patch(
                f"/api/v1/consents/requests/{consent_req.id}/respond",
                json={"action": "approve", "approved_scopes": ["clinical_notes"]},
                headers=pg_patient_headers,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_rev = executor.submit(do_revoke)
        f_app = executor.submit(do_approve)
        r_rev = f_rev.result(timeout=30)
        r_app = f_app.result(timeout=30)

    # Both must succeed without deadlock (200 OK)
    assert r_rev.status_code == 200, f"Revoke failed with {r_rev.status_code}: {r_rev.text}"
    assert r_app.status_code == 200, f"Approve failed with {r_app.status_code}: {r_app.text}"

    # Verify that the original consent record remains revoked in PostgreSQL
    with test_engine.connect() as conn:
        revoked_row = conn.execute(
            text("SELECT is_active, revoked_at FROM consent_records WHERE id = :id"),
            {"id": existing_consent.id},
        ).fetchone()
        assert revoked_row.is_active is False
        assert revoked_row.revoked_at is not None

        # Verify active consent contains only clinical_notes if created after revoke, or 0 if revoked after approve
        active_scopes = conn.execute(
            text("SELECT data_scopes FROM consent_records WHERE is_active = true AND patient_profile_id = :pat_id AND doctor_profile_id = :doc_id"),
            {"pat_id": pat_profile.id, "doc_id": pg_approved_doctor["profile"].id},
        ).scalars().all()
        # Either 0 active records (Revoke completed after Approve) or 1 active record with clinical_notes
        assert len(active_scopes) in (0, 1)
        if len(active_scopes) == 1:
            assert active_scopes[0] == ["clinical_notes"]



