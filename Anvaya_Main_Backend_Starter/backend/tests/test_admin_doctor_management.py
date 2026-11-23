from datetime import date, datetime, time, timezone
from uuid import UUID, uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User


# =====================================================
# FIXTURES
# =====================================================

@pytest.fixture
def admin_headers(db_session: Session):
    admin_user = User(
        full_name="Platform Administrator",
        email="admin.security@example.com",
        password_hash="test-only-password-hash",
        role="admin",
        is_active=True,
    )
    db_session.add(admin_user)
    db_session.commit()
    db_session.refresh(admin_user)

    token = create_access_token(subject=str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def pending_doctor(db_session: Session):
    user = User(
        full_name="Dr. Pending Specialist",
        email="pending.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Cardiology",
        qualification="MBBS, MD Cardiology",
        license_number="LIC-PENDING-9901",
        years_experience=7,
        clinic_name="Heart Health Center",
        verification_status="pending",
    )
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    return {"user": user, "profile": profile}


@pytest.fixture
def suspended_doctor(db_session: Session):
    user = User(
        full_name="Dr. Suspended Practitioner",
        email="suspended.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Neurology",
        qualification="MBBS, DM Neurology",
        license_number="LIC-SUSPENDED-8802",
        years_experience=10,
        clinic_name="Brain Wellness Clinic",
        verification_status="suspended",
    )
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(profile)

    token = create_access_token(subject=str(user.id))
    return {
        "user": user,
        "profile": profile,
        "headers": {"Authorization": f"Bearer {token}"},
    }


# =====================================================
# 1. DOCTOR CREATION & DUPLICATE VALIDATION
# =====================================================

def test_admin_can_create_doctor_account_with_atomic_audit(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
):
    payload = {
        "full_name": "Dr. Aarav Patel",
        "email": "aarav.patel@anvaya-clinic.com",
        "password": "SecurePassword123!",
        "specialization": "Pediatrics",
        "qualification": "MBBS, MD Pediatrics",
        "license_number": "MED-REG-PEDI-2026",
        "years_experience": 8,
        "clinic_name": "Sunrise Children's Clinic",
        "consultation_fee": "750.00",
        "bio": "Experienced pediatrician dedicated to child care.",
    }

    response = client.post(
        "/api/v1/admin/doctors",
        json=payload,
        headers=admin_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["license_number"] == "MED-REG-PEDI-2026"
    assert data["verification_status"] == "pending"
    assert data["specialization"] == "Pediatrics"

    # Verify user created in DB with role doctor
    created_user = db_session.scalar(
        select(User).where(User.email == "aarav.patel@anvaya-clinic.com")
    )
    assert created_user is not None
    assert created_user.role == "doctor"
    assert created_user.full_name == "Dr. Aarav Patel"

    # Verify atomic audit log entry
    audit_entry = db_session.scalar(
        select(AuditLog).where(
            AuditLog.doctor_profile_id == UUID(data["id"]),
            AuditLog.event_type == "doctor.created",
        )
    )
    assert audit_entry is not None
    assert audit_entry.outcome == "success"
    assert audit_entry.resource_type == "doctor_profile"
    assert audit_entry.resource_id == data["id"]
    assert audit_entry.details["doctor_email"] == "aarav.patel@anvaya-clinic.com"
    assert audit_entry.details["initial_status"] == "pending"
    # Ensure no passwords or password hashes are leaked into details
    assert "password" not in audit_entry.details
    assert "password_hash" not in audit_entry.details


def test_create_doctor_duplicate_email_rejected(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    payload = {
        "full_name": "Dr. Duplicate Email",
        "email": pending_doctor["user"].email,
        "password": "Password12345!",
        "specialization": "General Medicine",
        "qualification": "MBBS",
        "license_number": "UNIQUE-LIC-99999",
    }

    response = client.post(
        "/api/v1/admin/doctors",
        json=payload,
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"].lower()


def test_create_doctor_duplicate_license_rejected(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    payload = {
        "full_name": "Dr. Duplicate License",
        "email": "unique.doctor.email@example.com",
        "password": "Password12345!",
        "specialization": "General Medicine",
        "qualification": "MBBS",
        "license_number": pending_doctor["profile"].license_number,
    }

    response = client.post(
        "/api/v1/admin/doctors",
        json=payload,
        headers=admin_headers,
    )

    assert response.status_code == 409
    assert "license number is already registered" in response.json()["detail"].lower()


def test_create_doctor_rbac(
    client: TestClient,
    patient_headers: dict[str, str],
    doctor_headers: dict[str, str],
):
    payload = {
        "full_name": "Dr. Unauthorized Attempt",
        "email": "unauth@example.com",
        "password": "Password123!",
        "specialization": "ENT",
        "qualification": "MBBS",
        "license_number": "LIC-UNAUTH-111",
    }

    # Unauthenticated -> 401
    r_unauth = client.post("/api/v1/admin/doctors", json=payload)
    assert r_unauth.status_code == 401

    # Patient -> 403
    r_patient = client.post("/api/v1/admin/doctors", json=payload, headers=patient_headers)
    assert r_patient.status_code == 403

    # Doctor -> 403
    r_doc = client.post("/api/v1/admin/doctors", json=payload, headers=doctor_headers)
    assert r_doc.status_code == 403


# =====================================================
# 2. DOCTOR LISTING & SEARCH
# =====================================================

def test_admin_doctor_listing_and_filtering(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
    approved_doctor: dict,
    suspended_doctor: dict,
):
    # List all
    r_all = client.get("/api/v1/admin/doctors", headers=admin_headers)
    assert r_all.status_code == 200
    data_all = r_all.json()
    assert data_all["total"] >= 3

    # Filter by pending
    r_pending = client.get(
        "/api/v1/admin/doctors?verification_status=pending",
        headers=admin_headers,
    )
    assert r_pending.status_code == 200
    data_pending = r_pending.json()
    assert all(item["verification_status"] == "pending" for item in data_pending["items"])
    assert any(item["id"] == str(pending_doctor["profile"].id) for item in data_pending["items"])

    # Filter by suspended
    r_suspended = client.get(
        "/api/v1/admin/doctors?verification_status=suspended",
        headers=admin_headers,
    )
    assert r_suspended.status_code == 200
    data_suspended = r_suspended.json()
    assert all(item["verification_status"] == "suspended" for item in data_suspended["items"])
    assert any(item["id"] == str(suspended_doctor["profile"].id) for item in data_suspended["items"])


def test_admin_doctor_search_by_name_email_and_license(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
    suspended_doctor: dict,
):
    # Search by full name (case-insensitive substring)
    r_name = client.get(
        "/api/v1/admin/doctors?search=pending%20specialist",
        headers=admin_headers,
    )
    assert r_name.status_code == 200
    items = r_name.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(pending_doctor["profile"].id)

    # Search by email
    r_email = client.get(
        "/api/v1/admin/doctors?search=suspended.doctor",
        headers=admin_headers,
    )
    assert r_email.status_code == 200
    items = r_email.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(suspended_doctor["profile"].id)

    # Search by license number
    r_lic = client.get(
        f"/api/v1/admin/doctors?search={pending_doctor['profile'].license_number}",
        headers=admin_headers,
    )
    assert r_lic.status_code == 200
    items = r_lic.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(pending_doctor["profile"].id)

    # Non-matching search
    r_empty = client.get(
        "/api/v1/admin/doctors?search=nonexistent-query-xyz-99",
        headers=admin_headers,
    )
    assert r_empty.status_code == 200
    assert r_empty.json()["total"] == 0
    assert len(r_empty.json()["items"]) == 0


def test_admin_doctor_pagination(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
    approved_doctor: dict,
    suspended_doctor: dict,
):
    r_p1 = client.get("/api/v1/admin/doctors?limit=1&offset=0", headers=admin_headers)
    assert r_p1.status_code == 200
    data_p1 = r_p1.json()
    assert len(data_p1["items"]) == 1
    assert data_p1["limit"] == 1
    assert data_p1["offset"] == 0
    assert data_p1["total"] >= 3

    r_p2 = client.get("/api/v1/admin/doctors?limit=1&offset=1", headers=admin_headers)
    assert r_p2.status_code == 200
    data_p2 = r_p2.json()
    assert len(data_p2["items"]) == 1
    assert data_p2["items"][0]["id"] != data_p1["items"][0]["id"]


# =====================================================
# 3. DOCTOR VERIFICATION LIFECYCLE & TRANSITIONS
# =====================================================

def test_transition_pending_to_approved(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    doc_id = pending_doctor["profile"].id
    payload = {
        "verification_status": "approved",
        "reason": "Medical Council credentials verified and validated.",
    }

    response = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json=payload,
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["verification_status"] == "approved"

    # Verify audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.doctor_profile_id == doc_id,
            AuditLog.event_type == "doctor.verification.approved",
        )
    )
    assert audit is not None
    assert audit.details["previous_status"] == "pending"
    assert audit.details["new_status"] == "approved"
    assert "Council credentials verified" in audit.details["reason"]


def test_transition_pending_to_rejected_requires_reason(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    doc_id = pending_doctor["profile"].id

    # Missing reason -> 422
    r_no_reason = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "rejected"},
        headers=admin_headers,
    )
    assert r_no_reason.status_code == 422
    assert "reason is required" in r_no_reason.json()["detail"].lower()

    # Empty whitespace reason -> 422
    r_empty_reason = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "rejected", "reason": "   "},
        headers=admin_headers,
    )
    assert r_empty_reason.status_code == 422

    # Valid reason -> 200
    r_valid = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={
            "verification_status": "rejected",
            "reason": "License registration number could not be validated with state registry.",
        },
        headers=admin_headers,
    )
    assert r_valid.status_code == 200
    assert r_valid.json()["verification_status"] == "rejected"


def test_transition_rejected_to_pending_reopening(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    doc_id = pending_doctor["profile"].id

    # 1. Reject first
    client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "rejected", "reason": "Initial rejection"},
        headers=admin_headers,
    )

    # 2. Reopen without reason -> 422
    r_no_reason = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "pending"},
        headers=admin_headers,
    )
    assert r_no_reason.status_code == 422

    # 3. Reopen with valid reason -> 200
    r_reopen = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={
            "verification_status": "pending",
            "reason": "Doctor resubmitted updated certificate of good standing.",
        },
        headers=admin_headers,
    )
    assert r_reopen.status_code == 200
    assert r_reopen.json()["verification_status"] == "pending"

    # Verify audit log recorded for reopening
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.doctor_profile_id == doc_id,
            AuditLog.event_type == "doctor.verification.pending",
        )
    )
    assert audit is not None
    assert audit.details["previous_status"] == "rejected"
    assert audit.details["new_status"] == "pending"


def test_transition_approved_to_suspended(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    approved_doctor: dict,
):
    doc_id = approved_doctor["profile"].id

    # Missing reason -> 422
    r_no_reason = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "suspended"},
        headers=admin_headers,
    )
    assert r_no_reason.status_code == 422

    # Valid suspension -> 200
    r_suspend = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={
            "verification_status": "suspended",
            "reason": "Administrative suspension pending investigation of patient complaint.",
        },
        headers=admin_headers,
    )
    assert r_suspend.status_code == 200
    assert r_suspend.json()["verification_status"] == "suspended"

    # Verify audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.doctor_profile_id == doc_id,
            AuditLog.event_type == "doctor.verification.suspended",
        )
    )
    assert audit is not None
    assert audit.details["previous_status"] == "approved"
    assert audit.details["new_status"] == "suspended"


def test_transition_suspended_to_pending_reopening(
    client: TestClient,
    admin_headers: dict[str, str],
    suspended_doctor: dict,
):
    doc_id = suspended_doctor["profile"].id

    r_reopen = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={
            "verification_status": "pending",
            "reason": "Investigation completed, clearance issued, reopening for peer review.",
        },
        headers=admin_headers,
    )
    assert r_reopen.status_code == 200
    assert r_reopen.json()["verification_status"] == "pending"


@pytest.mark.parametrize(
    "initial_status,forbidden_target",
    [
        ("pending", "suspended"),
        ("pending", "pending"),
        ("approved", "pending"),
        ("approved", "rejected"),
        ("approved", "approved"),
        ("rejected", "approved"),
        ("rejected", "suspended"),
        ("rejected", "rejected"),
        ("suspended", "approved"),
        ("suspended", "rejected"),
        ("suspended", "suspended"),
    ],
)
def test_forbidden_verification_transitions_return_409(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    initial_status: str,
    forbidden_target: str,
):
    # Create doctor in initial_status
    user = User(
        full_name=f"Dr. Status {initial_status}",
        email=f"doc.{initial_status}.{uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pathology",
        qualification="MBBS, MD",
        license_number=f"LIC-{uuid4().hex[:8]}",
        verification_status=initial_status,
    )
    db_session.add(profile)
    db_session.commit()

    response = client.patch(
        f"/api/v1/admin/doctors/{profile.id}/verification",
        json={"verification_status": forbidden_target, "reason": "Test reason"},
        headers=admin_headers,
    )
    assert response.status_code == 409
    assert f"cannot transition doctor verification status from '{initial_status}' to '{forbidden_target}'" in response.json()["detail"].lower()


def test_verification_nonexistent_doctor_returns_404(
    client: TestClient,
    admin_headers: dict[str, str],
):
    response = client.patch(
        f"/api/v1/admin/doctors/{uuid4()}/verification",
        json={"verification_status": "approved"},
        headers=admin_headers,
    )
    assert response.status_code == 404


# =====================================================
# 4. ADMIN DASHBOARD STATISTICS
# =====================================================

def test_admin_dashboard_stats(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
    approved_doctor: dict,
    suspended_doctor: dict,
    patient_account: dict,
    booked_appointment: Appointment,
):
    response = client.get("/api/v1/admin/dashboard/stats", headers=admin_headers)
    assert response.status_code == 200
    stats = response.json()

    assert stats["total_doctors"] >= 3
    assert stats["pending_doctors"] >= 1
    assert stats["approved_doctors"] >= 1
    assert stats["suspended_doctors"] >= 1
    assert stats["total_patients"] >= 1
    assert stats["total_appointments"] >= 1
    assert stats["booked_appointments"] >= 1

    # Security check: verify no sensitive or clinical fields in response
    assert "diagnosis" not in stats
    assert "notes" not in stats
    assert "prescriptions" not in stats
    assert "file_url" not in stats


def test_admin_dashboard_stats_rbac(
    client: TestClient,
    patient_headers: dict[str, str],
    doctor_headers: dict[str, str],
):
    # Unauthenticated
    assert client.get("/api/v1/admin/dashboard/stats").status_code == 401

    # Patient
    assert client.get("/api/v1/admin/dashboard/stats", headers=patient_headers).status_code == 403

    # Doctor
    assert client.get("/api/v1/admin/dashboard/stats", headers=doctor_headers).status_code == 403


# =====================================================
# 5. SUSPENDED DOCTOR ACCESS DENIAL
# =====================================================

def test_suspended_doctor_blocked_from_clinical_workflows(
    client: TestClient,
    suspended_doctor: dict,
    patient_account: dict,
):
    headers = suspended_doctor["headers"]

    # 1. Patient Directory
    r_dir = client.get("/api/v1/doctors/me/patients", headers=headers)
    assert r_dir.status_code == 403

    # 2. Availability Management
    r_avail = client.post(
        "/api/v1/doctors/me/availability",
        json={
            "weekday": 1,
            "start_time": "10:00:00",
            "end_time": "12:00:00",
            "slot_duration_minutes": 30,
        },
        headers=headers,
    )
    assert r_avail.status_code == 403

    # 3. Prescription Writing
    r_rx = client.post(
        "/api/v1/prescriptions",
        json={
            "appointment_id": str(uuid4()),
            "items": [
                {
                    "medicine_name": "Amoxicillin",
                    "dosage": "500mg",
                    "frequency": "Three times daily",
                    "duration": "7 days",
                }
            ],
        },
        headers=headers,
    )
    assert r_rx.status_code == 403

    # 4. Patient EHR Inspection
    r_ehr = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=diagnosis",
        headers=headers,
    )
    assert r_ehr.status_code == 403


# =====================================================
# 6. ATOMIC AUDIT LOGGING & ROLLBACK VERIFICATION
# =====================================================

def test_create_doctor_audit_failure_rolls_back_atomically(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    monkeypatch,
):
    target_email = "rollback.doctor@example.com"
    target_license = "LIC-ROLLBACK-999"

    original_audit_init = AuditLog.__init__

    def failing_audit_init(self, *args, **kwargs):
        if kwargs.get("event_type") == "doctor.created":
            raise RuntimeError("Simulated Audit Logging Database Failure")
        return original_audit_init(self, *args, **kwargs)

    monkeypatch.setattr(AuditLog, "__init__", failing_audit_init)

    payload = {
        "full_name": "Dr. Rollback Target",
        "email": target_email,
        "password": "Password123!",
        "specialization": "Oncology",
        "qualification": "MBBS, MD",
        "license_number": target_license,
    }

    response = client.post(
        "/api/v1/admin/doctors",
        json=payload,
        headers=admin_headers,
    )

    assert response.status_code == 500
    assert "Failed to create doctor account and audit log" in response.json()["detail"]

    # Invariant: Neither User nor DoctorProfile should exist in DB!
    user_in_db = db_session.scalar(select(User).where(User.email == target_email))
    assert user_in_db is None

    profile_in_db = db_session.scalar(
        select(DoctorProfile).where(DoctorProfile.license_number == target_license)
    )
    assert profile_in_db is None


def test_verification_audit_failure_rolls_back_atomically(
    client: TestClient,
    db_session: Session,
    admin_headers: dict[str, str],
    pending_doctor: dict,
    monkeypatch,
):
    doc_id = pending_doctor["profile"].id

    original_audit_init = AuditLog.__init__

    def failing_audit_init(self, *args, **kwargs):
        if kwargs.get("resource_type") == "doctor_profile":
            raise RuntimeError("Simulated Audit Log Failure on Verification")
        return original_audit_init(self, *args, **kwargs)

    monkeypatch.setattr(AuditLog, "__init__", failing_audit_init)

    response = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "approved"},
        headers=admin_headers,
    )

    assert response.status_code == 500

    # Invariant: Status must remain 'pending' in DB!
    db_session.expire_all()
    refreshed_profile = db_session.get(DoctorProfile, doc_id)
    assert refreshed_profile.verification_status == "pending"


# =====================================================
# 7. CONFLICTING STATUS TRANSITIONS PREVENTION
# =====================================================

def test_conflicting_doctor_verification_transitions_prevented(
    client: TestClient,
    admin_headers: dict[str, str],
    pending_doctor: dict,
):
    doc_id = pending_doctor["profile"].id

    # First admin approves
    r1 = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "approved", "reason": "Approved by Admin A"},
        headers=admin_headers,
    )
    assert r1.status_code == 200
    assert r1.json()["verification_status"] == "approved"

    # Second admin attempts to reject the now-approved doctor -> 409 Conflict
    r2 = client.patch(
        f"/api/v1/admin/doctors/{doc_id}/verification",
        json={"verification_status": "rejected", "reason": "Rejected by Admin B"},
        headers=admin_headers,
    )
    assert r2.status_code == 409
    assert "cannot transition doctor verification status from 'approved' to 'rejected'" in r2.json()["detail"].lower()



