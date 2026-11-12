
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.core.config import settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db

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

    # Verify destination before any table creation or deletion.

    with engine.connect() as connection:

        database_name = connection.scalar(
            text("SELECT current_database()")
        )

        schema_name = connection.scalar(
            text("SELECT current_schema()")
        )

        database_user = connection.scalar(
            text("SELECT current_user")
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

        existing_tables = set(
            connection.execute(
                text("""
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'anvaya_test'
                """)
            ).scalars().all()
        )

        expected_tables = set(Base.metadata.tables.keys())

        unexpected_tables = existing_tables - expected_tables

        if unexpected_tables:
            raise RuntimeError(
                f"Unexpected tables in test schema: {unexpected_tables}"
            )

        print(
            f"\nVERIFIED POSTGRES TARGET: "
            f"{database_name}.{schema_name}"
        )

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    try:
        yield engine

    finally:
        Base.metadata.drop_all(bind=engine)
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
