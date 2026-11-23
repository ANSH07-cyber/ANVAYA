from datetime import date, datetime, time, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User


@pytest.fixture
def admin_headers(db_session: Session):
    admin_user = User(
        full_name="Portal Admin",
        email="portal.admin@example.com",
        password_hash="test-hash",
        role="admin",
        is_active=True,
    )
    db_session.add(admin_user)
    db_session.commit()
    db_session.refresh(admin_user)
    token = create_access_token(subject=str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def patient_headers(db_session: Session):
    user = User(
        full_name="Test Patient",
        email="patient.user@example.com",
        password_hash="test-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def doctor_headers(db_session: Session):
    user = User(
        full_name="Dr. Test User",
        email="doctor.user@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seed_data(db_session: Session):
    # Patient User & Profile
    p_user = User(
        full_name="Rohan Verma",
        email="rohan.verma@example.com",
        password_hash="test-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(p_user)
    db_session.flush()

    p_profile = PatientProfile(
        user_id=p_user.id,
        date_of_birth=date(1992, 8, 20),
        phone_number="+919988776655",
        gender="male",
        blood_group="B+",
        address="104 MG Road, Bengaluru",
    )
    db_session.add(p_profile)

    # Doctor User & Profile
    d_user = User(
        full_name="Dr. Anita Desai",
        email="anita.desai@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(d_user)
    db_session.flush()

    d_profile = DoctorProfile(
        user_id=d_user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD Pediatrics",
        license_number="LIC-ANITA-1234",
        verification_status="approved",
    )
    db_session.add(d_profile)
    db_session.flush()

    # Appointments
    appt1 = Appointment(
        patient_profile_id=p_profile.id,
        doctor_profile_id=d_profile.id,
        appointment_date=date(2026, 11, 25),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Childhood vaccination consultation",
    )
    appt2 = Appointment(
        patient_profile_id=p_profile.id,
        doctor_profile_id=d_profile.id,
        appointment_date=date(2026, 11, 20),
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="completed",
        reason="Fever and rash examination",
    )
    db_session.add_all([appt1, appt2])

    # Audit Logs
    log1 = AuditLog(
        actor_user_id=d_user.id,
        patient_profile_id=p_profile.id,
        doctor_profile_id=d_profile.id,
        event_type="doctor.created",
        resource_type="doctor_profile",
        resource_id=str(d_profile.id),
        outcome="success",
        details={"doctor_name": d_user.full_name},
    )
    log2 = AuditLog(
        actor_user_id=p_user.id,
        patient_profile_id=p_profile.id,
        doctor_profile_id=d_profile.id,
        event_type="consent.granted",
        resource_type="consent",
        resource_id=str(uuid4()),
        outcome="success",
        details={"scopes": ["diagnosis"]},
    )
    log3 = AuditLog(
        actor_user_id=d_user.id,
        patient_profile_id=p_profile.id,
        doctor_profile_id=d_profile.id,
        event_type="ehr.records.access_denied",
        resource_type="patient_health_records",
        resource_id=str(p_profile.id),
        outcome="denied",
        details={"reason": "No active consent"},
    )
    db_session.add_all([log1, log2, log3])
    db_session.commit()

    return {
        "patient_profile": p_profile,
        "patient_user": p_user,
        "doctor_profile": d_profile,
        "doctor_user": d_user,
        "appt1": appt1,
        "appt2": appt2,
    }


# =====================================================
# 1. RBAC SECURITY TESTS
# =====================================================

def test_admin_endpoints_unauthenticated(client: TestClient):
    assert client.get("/api/v1/admin/patients").status_code == 401
    assert client.get("/api/v1/admin/appointments").status_code == 401
    assert client.get("/api/v1/admin/audit-logs").status_code == 401


def test_admin_endpoints_forbidden_for_patient(client: TestClient, patient_headers: dict):
    assert client.get("/api/v1/admin/patients", headers=patient_headers).status_code == 403
    assert client.get("/api/v1/admin/appointments", headers=patient_headers).status_code == 403
    assert client.get("/api/v1/admin/audit-logs", headers=patient_headers).status_code == 403


def test_admin_endpoints_forbidden_for_doctor(client: TestClient, doctor_headers: dict):
    assert client.get("/api/v1/admin/patients", headers=doctor_headers).status_code == 403
    assert client.get("/api/v1/admin/appointments", headers=doctor_headers).status_code == 403
    assert client.get("/api/v1/admin/audit-logs", headers=doctor_headers).status_code == 403


# =====================================================
# 2. PATIENT MANAGEMENT ENDPOINT TESTS
# =====================================================

def test_admin_list_patients(client: TestClient, admin_headers: dict, seed_data: dict):
    resp = client.get("/api/v1/admin/patients", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    found = [p for p in data["items"] if p["email"] == "rohan.verma@example.com"]
    assert len(found) == 1
    patient = found[0]
    assert patient["full_name"] == "Rohan Verma"
    assert patient["gender"] == "male"
    assert patient["blood_group"] == "B+"
    assert patient["phone_number"] == "+919988776655"


def test_admin_search_patients(client: TestClient, admin_headers: dict, seed_data: dict):
    # Search by name
    resp = client.get("/api/v1/admin/patients?search=Rohan", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    # Search by phone
    resp = client.get("/api/v1/admin/patients?search=998877", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    # Search non-matching
    resp = client.get("/api/v1/admin/patients?search=NonExistentPatient", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_admin_filter_patients(client: TestClient, admin_headers: dict, seed_data: dict):
    # Filter by gender
    resp = client.get("/api/v1/admin/patients?gender=male", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    resp = client.get("/api/v1/admin/patients?gender=female", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # Filter by blood group (using params dict so '+' is safely percent-encoded)
    resp = client.get("/api/v1/admin/patients", params={"blood_group": "B+"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    resp = client.get("/api/v1/admin/patients", params={"blood_group": "AB-"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


# =====================================================
# 3. APPOINTMENTS OVERSIGHT ENDPOINT TESTS
# =====================================================

def test_admin_list_appointments(client: TestClient, admin_headers: dict, seed_data: dict):
    resp = client.get("/api/v1/admin/appointments", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    item = data["items"][0]
    assert "doctor_name" in item
    assert "patient_name" in item
    assert "doctor_specialization" in item


def test_admin_filter_appointments_by_status(client: TestClient, admin_headers: dict, seed_data: dict):
    resp_booked = client.get("/api/v1/admin/appointments?status=booked", headers=admin_headers)
    assert resp_booked.status_code == 200
    assert any(a["status"] == "booked" for a in resp_booked.json()["items"])

    resp_completed = client.get("/api/v1/admin/appointments?status=completed", headers=admin_headers)
    assert resp_completed.status_code == 200
    assert any(a["status"] == "completed" for a in resp_completed.json()["items"])


def test_admin_search_appointments(client: TestClient, admin_headers: dict, seed_data: dict):
    # Search by doctor name
    resp = client.get("/api/v1/admin/appointments?search=Anita", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1

    # Search by reason
    resp = client.get("/api/v1/admin/appointments?search=vaccination", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1


def test_admin_appointments_date_validation(client: TestClient, admin_headers: dict):
    resp = client.get("/api/v1/admin/appointments?date_from=2026-12-01&date_to=2026-11-01", headers=admin_headers)
    assert resp.status_code == 422
    assert "date_from cannot be after date_to" in resp.json()["detail"]


# =====================================================
# 4. AUDIT LOGS PREFIX MATCHING TESTS
# =====================================================

def test_admin_audit_logs_prefix_matching(client: TestClient, admin_headers: dict, seed_data: dict):
    # Prefix with dot
    resp = client.get("/api/v1/admin/audit-logs?event_type=doctor.", headers=admin_headers)
    assert resp.status_code == 200
    assert any(l["event_type"] == "doctor.created" for l in resp.json()["items"])

    # Prefix without dot
    resp2 = client.get("/api/v1/admin/audit-logs?event_type=consent", headers=admin_headers)
    assert resp2.status_code == 200
    assert any(l["event_type"] == "consent.granted" for l in resp2.json()["items"])

    # EHR prefix matching ehr.records.access_denied
    resp3 = client.get("/api/v1/admin/audit-logs?event_type=ehr.", headers=admin_headers)
    assert resp3.status_code == 200
    assert any(l["event_type"] == "ehr.records.access_denied" for l in resp3.json()["items"])
