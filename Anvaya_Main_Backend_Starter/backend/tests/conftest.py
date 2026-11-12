
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.db.base import Base
from app.db.session import get_db
from app.core.security import create_access_token

from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.models.appointment import Appointment


IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def test_engine(tmp_path):
    database_url = URL.create(
        drivername="sqlite+pysqlite",
        database=str(tmp_path / "anvaya_test.db"),
    )

    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False},
    )

    Base.metadata.create_all(bind=engine)

    yield engine

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
    TestingSessionLocal = sessionmaker(
        bind=test_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    with TestingSessionLocal() as session:
        yield session
        session.rollback()


@pytest.fixture
def client(test_engine):
    TestingSessionLocal = sessionmaker(
        bind=test_engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    def override_get_db():
        with TestingSessionLocal() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override


@pytest.fixture
def future_monday():
    today = datetime.now(IST).date()
    days_until_monday = (7 - today.weekday()) % 7

    if days_until_monday == 0:
        days_until_monday = 7

    return today + timedelta(days=days_until_monday)


@pytest.fixture
def patient_account(db_session):
    user = User(
        full_name="Test Patient",
        email="patient.test@example.com",
        password_hash="test-only-password-hash",
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
def approved_doctor(db_session, future_monday):
    user = User(
        full_name="Test Doctor",
        email="doctor.test@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )

    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Dermatology",
        qualification="MBBS, MD Dermatology",
        license_number="TEST-ONLY-ANVAYA-001",
        years_experience=5,
        clinic_name="Isolated Test Clinic",
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

    return {
        "user": user,
        "profile": profile,
        "availability": availability,
        "appointment_date": future_monday,
    }


@pytest.fixture
def patient_headers(patient_account):
    token = create_access_token(
        subject=str(patient_account["user"].id)
    )

    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def doctor_headers(approved_doctor):
    token = create_access_token(
        subject=str(approved_doctor["user"].id)
    )

    return {"Authorization": f"Bearer {token}"}


# =====================================================
# BOOKED APPOINTMENT FOR LIFECYCLE TESTS
# =====================================================

@pytest.fixture
def booked_appointment(
    db_session,
    patient_account,
    approved_doctor,
):
    appointment = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=approved_doctor["appointment_date"],
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Routine consultation",
    )

    db_session.add(appointment)
    db_session.commit()
    db_session.refresh(appointment)

    return appointment


# =====================================================
# PAST APPOINTMENT FOR COMPLETION TESTS
# =====================================================

@pytest.fixture
def past_booked_appointment(
    db_session,
    patient_account,
    approved_doctor,
):
    yesterday = datetime.now(IST).date() - timedelta(days=1)

    appointment = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=yesterday,
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Past consultation",
    )

    db_session.add(appointment)
    db_session.commit()
    db_session.refresh(appointment)

    return appointment
