from decimal import Decimal
from uuid import uuid4
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.audit_log import AuditLog
from app.models.doctor_profile import DoctorProfile
from app.models.user import User

DOCTOR_ME_ENDPOINT = "/api/v1/doctors/me"


@pytest.fixture
def admin_headers(db_session: Session):
    admin_user = User(
        full_name="Test Admin",
        email=f"admin.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="admin",
        is_active=True,
    )
    db_session.add(admin_user)
    db_session.commit()
    token = create_access_token(subject=str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def pending_doctor(db_session: Session):
    user = User(
        full_name="Pending Doctor",
        email=f"doctor.pending.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pediatrics",
        qualification="MBBS, DCH",
        license_number=f"TEST-PENDING-{uuid4().hex[:6]}",
        years_experience=3,
        clinic_name="Pending Clinic",
        consultation_fee=Decimal("500.00"),
        bio="Pediatrician in training.",
        verification_status="pending",
    )
    db_session.add(profile)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {
        "user": user,
        "profile": profile,
        "headers": {"Authorization": f"Bearer {token}"},
    }


@pytest.fixture
def rejected_doctor(db_session: Session):
    user = User(
        full_name="Rejected Doctor",
        email=f"doctor.rejected.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="General Medicine",
        qualification="MBBS",
        license_number=f"TEST-REJECTED-{uuid4().hex[:6]}",
        years_experience=1,
        clinic_name="Rejected Clinic",
        consultation_fee=Decimal("300.00"),
        bio="General physician.",
        verification_status="rejected",
    )
    db_session.add(profile)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {
        "user": user,
        "profile": profile,
        "headers": {"Authorization": f"Bearer {token}"},
    }


@pytest.fixture
def doctor_without_profile(db_session: Session):
    user = User(
        full_name="Doctor Without Profile",
        email=f"doctor.noprofile.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(subject=str(user.id))
    return {
        "user": user,
        "headers": {"Authorization": f"Bearer {token}"},
    }


# ============================================================================
# 1. GET /api/v1/doctors/me TESTS
# ============================================================================

def test_approved_doctor_retrieves_own_profile(client, doctor_headers):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=doctor_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["verification_status"] == "approved"
    assert data["specialization"] == "Dermatology"


def test_pending_doctor_retrieves_own_profile(client, pending_doctor):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=pending_doctor["headers"])
    assert response.status_code == 200
    data = response.json()
    assert data["verification_status"] == "pending"
    assert data["specialization"] == "Pediatrics"
    assert data["full_name"] == "Pending Doctor"


def test_rejected_doctor_retrieves_own_profile(client, rejected_doctor):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=rejected_doctor["headers"])
    assert response.status_code == 200
    data = response.json()
    assert data["verification_status"] == "rejected"
    assert data["specialization"] == "General Medicine"


def test_get_profile_merged_fields(client, approved_doctor, doctor_headers):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=doctor_headers)
    assert response.status_code == 200
    data = response.json()

    user = approved_doctor["user"]
    profile = approved_doctor["profile"]

    assert data["id"] == str(profile.id)
    assert data["user_id"] == str(user.id)
    assert data["full_name"] == user.full_name
    assert data["email"] == user.email
    assert data["specialization"] == profile.specialization
    assert data["qualification"] == profile.qualification
    assert data["license_number"] == profile.license_number
    assert data["years_experience"] == profile.years_experience
    assert data["clinic_name"] == profile.clinic_name
    assert Decimal(str(data["consultation_fee"])) == profile.consultation_fee if profile.consultation_fee else data["consultation_fee"] is None
    assert data["verification_status"] == profile.verification_status
    assert "created_at" in data
    assert "updated_at" in data


def test_get_profile_missing_doctor_profile_returns_404(client, doctor_without_profile):
    response = client.get(
        DOCTOR_ME_ENDPOINT,
        headers=doctor_without_profile["headers"],
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Doctor profile not found."


def test_get_profile_patient_token_returns_403(client, patient_headers):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=patient_headers)
    assert response.status_code == 403


def test_get_profile_admin_token_returns_403(client, admin_headers):
    response = client.get(DOCTOR_ME_ENDPOINT, headers=admin_headers)
    assert response.status_code == 403


def test_get_profile_unauthenticated_returns_401(client):
    response = client.get(DOCTOR_ME_ENDPOINT)
    assert response.status_code == 401


# ============================================================================
# 2. PATCH /api/v1/doctors/me TESTS
# ============================================================================

def test_approved_doctor_updates_permitted_fields(
    client, doctor_headers, approved_doctor, db_session
):
    payload = {
        "specialization": "Clinical Dermatology",
        "years_experience": 10,
        "clinic_name": "Metro Skin Care",
        "consultation_fee": "750.50",
        "bio": "Experienced consultant in clinical dermatology.",
    }
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json=payload,
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()

    assert data["specialization"] == "Clinical Dermatology"
    assert data["years_experience"] == 10
    assert data["clinic_name"] == "Metro Skin Care"
    assert Decimal(str(data["consultation_fee"])) == Decimal("750.50")
    assert data["bio"] == "Experienced consultant in clinical dermatology."

    # Verify DB persistence
    db_session.expire_all()
    updated_profile = db_session.get(DoctorProfile, approved_doctor["profile"].id)
    assert updated_profile.specialization == "Clinical Dermatology"
    assert updated_profile.years_experience == 10
    assert updated_profile.clinic_name == "Metro Skin Care"


def test_pending_doctor_updates_permitted_fields(client, pending_doctor, db_session):
    payload = {
        "qualification": "MBBS, MD Pediatrics",
        "clinic_name": "City Child Hospital",
    }
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json=payload,
        headers=pending_doctor["headers"],
    )
    assert response.status_code == 200
    data = response.json()

    assert data["qualification"] == "MBBS, MD Pediatrics"
    assert data["clinic_name"] == "City Child Hospital"
    assert data["verification_status"] == "pending"


def test_rejected_doctor_updates_permitted_fields(client, rejected_doctor, db_session):
    payload = {
        "bio": "Corrected biography for clinical board re-evaluation.",
    }
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json=payload,
        headers=rejected_doctor["headers"],
    )
    assert response.status_code == 200
    data = response.json()

    assert data["bio"] == "Corrected biography for clinical board re-evaluation."
    assert data["verification_status"] == "rejected"


def test_partial_update_preserves_unspecified_fields(
    client, doctor_headers, approved_doctor
):
    original_spec = approved_doctor["profile"].specialization
    original_qual = approved_doctor["profile"].qualification

    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"clinic_name": "New Solely Updated Clinic"},
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()

    assert data["clinic_name"] == "New Solely Updated Clinic"
    assert data["specialization"] == original_spec
    assert data["qualification"] == original_qual


def test_full_name_updates_user_correctly(
    client, doctor_headers, approved_doctor, db_session
):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"full_name": "Dr. Alexander Fleming"},
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["full_name"] == "Dr. Alexander Fleming"

    db_session.expire_all()
    user = db_session.get(User, approved_doctor["user"].id)
    assert user.full_name == "Dr. Alexander Fleming"


def test_email_remains_unchanged_and_forbidden_in_payload(
    client, doctor_headers, approved_doctor, db_session
):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"email": "new.email@example.com"},
        headers=doctor_headers,
    )
    assert response.status_code == 422

    db_session.expire_all()
    user = db_session.get(User, approved_doctor["user"].id)
    assert user.email == approved_doctor["user"].email


def test_license_number_modification_attempt_returns_422(client, doctor_headers):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"license_number": "FORGED-LICENSE-999"},
        headers=doctor_headers,
    )
    assert response.status_code == 422


def test_verification_status_modification_attempt_returns_422(client, pending_doctor):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"verification_status": "approved"},
        headers=pending_doctor["headers"],
    )
    assert response.status_code == 422


def test_id_and_user_id_modification_attempts_return_422(client, doctor_headers):
    fake_uuid = str(uuid4())
    res1 = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"id": fake_uuid},
        headers=doctor_headers,
    )
    assert res1.status_code == 422

    res2 = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"user_id": fake_uuid},
        headers=doctor_headers,
    )
    assert res2.status_code == 422


def test_negative_consultation_fee_returns_422(client, doctor_headers):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"consultation_fee": "-150.00"},
        headers=doctor_headers,
    )
    assert response.status_code == 422


def test_invalid_experience_values_return_422(client, doctor_headers):
    res_neg = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"years_experience": -1},
        headers=doctor_headers,
    )
    assert res_neg.status_code == 422

    res_excess = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"years_experience": 85},
        headers=doctor_headers,
    )
    assert res_excess.status_code == 422


def test_invalid_text_lengths_and_whitespace_return_422(client, doctor_headers):
    # Whitespace only full_name
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"full_name": "   "},
        headers=doctor_headers,
    ).status_code == 422

    # Empty specialization
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": ""},
        headers=doctor_headers,
    ).status_code == 422

    # Excessive specialization length (>100 chars)
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": "A" * 101},
        headers=doctor_headers,
    ).status_code == 422

    # Empty qualification
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"qualification": "  "},
        headers=doctor_headers,
    ).status_code == 422

    # Excessive qualification length (>255 chars)
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"qualification": "A" * 256},
        headers=doctor_headers,
    ).status_code == 422

    # Excessive clinic_name length (>200 chars)
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"clinic_name": "A" * 201},
        headers=doctor_headers,
    ).status_code == 422

    # Excessive bio length (>5000 chars)
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"bio": "A" * 5001},
        headers=doctor_headers,
    ).status_code == 422


def test_prevent_null_for_required_fields(client, doctor_headers):
    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"full_name": None},
        headers=doctor_headers,
    ).status_code == 422

    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": None},
        headers=doctor_headers,
    ).status_code == 422

    assert client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"qualification": None},
        headers=doctor_headers,
    ).status_code == 422


def test_explicit_none_clears_nullable_fields(
    client, doctor_headers, approved_doctor, db_session
):
    # Set initial values
    client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"clinic_name": "Active Clinic", "years_experience": 5, "bio": "Some bio"},
        headers=doctor_headers,
    )

    # Clear them with explicit null
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"clinic_name": None, "years_experience": None, "bio": None},
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["clinic_name"] is None
    assert data["years_experience"] is None
    assert data["bio"] is None

    db_session.expire_all()
    profile = db_session.get(DoctorProfile, approved_doctor["profile"].id)
    assert profile.clinic_name is None
    assert profile.years_experience is None
    assert profile.bio is None


def test_patch_profile_patient_token_returns_403(client, patient_headers):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": "Neurology"},
        headers=patient_headers,
    )
    assert response.status_code == 403


def test_patch_profile_admin_token_returns_403(client, admin_headers):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": "Neurology"},
        headers=admin_headers,
    )
    assert response.status_code == 403


def test_patch_profile_unauthenticated_returns_401(client):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": "Neurology"},
    )
    assert response.status_code == 401


def test_patch_profile_missing_doctor_profile_returns_404(
    client, doctor_without_profile
):
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": "Neurology"},
        headers=doctor_without_profile["headers"],
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Doctor profile not found."


def test_successful_update_creates_correct_audit_event(
    client, doctor_headers, approved_doctor, db_session
):
    payload = {
        "specialization": "Immunology",
        "consultation_fee": "850.00",
    }
    response = client.patch(
        DOCTOR_ME_ENDPOINT,
        json=payload,
        headers=doctor_headers,
    )
    assert response.status_code == 200

    # Query audit log
    audit_entry = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.actor_user_id == approved_doctor["user"].id,
            AuditLog.event_type == "doctor.profile.updated",
        )
        .order_by(AuditLog.created_at.desc())
    )

    assert audit_entry is not None
    assert audit_entry.resource_type == "doctor_profile"
    assert audit_entry.resource_id == str(approved_doctor["profile"].id)
    assert audit_entry.doctor_profile_id == approved_doctor["profile"].id
    assert audit_entry.outcome == "success"
    assert "specialization" in audit_entry.details["changed_fields"]
    assert "consultation_fee" in audit_entry.details["changed_fields"]
    assert audit_entry.details["changes"]["specialization"]["new"] == "Immunology"


def test_noop_update_does_not_create_unnecessary_audit_event(
    client, doctor_headers, approved_doctor, db_session
):
    # Baseline audit count
    initial_count = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.actor_user_id == approved_doctor["user"].id,
            AuditLog.event_type == "doctor.profile.updated",
        )
    ) or 0

    # 1. Empty body
    res_empty = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={},
        headers=doctor_headers,
    )
    assert res_empty.status_code == 200

    # 2. Same values as existing
    res_same = client.patch(
        DOCTOR_ME_ENDPOINT,
        json={"specialization": approved_doctor["profile"].specialization},
        headers=doctor_headers,
    )
    assert res_same.status_code == 200

    final_count = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.actor_user_id == approved_doctor["user"].id,
            AuditLog.event_type == "doctor.profile.updated",
        )
    ) or 0

    assert final_count == initial_count


def test_audit_failure_rolls_back_profile_modifications(
    client, doctor_headers, approved_doctor, db_session, monkeypatch
):
    original_spec = approved_doctor["profile"].specialization
    original_name = approved_doctor["user"].full_name

    def mock_add_audit_log(*args, **kwargs):
        raise RuntimeError("Simulated audit subsystem failure")

    monkeypatch.setattr("app.api.routes.doctors.add_audit_log", mock_add_audit_log)

    with pytest.raises(RuntimeError, match="Simulated audit subsystem failure"):
        client.patch(
            DOCTOR_ME_ENDPOINT,
            json={
                "specialization": "Should Rollback",
                "full_name": "Dr. Rollback Test",
            },
            headers=doctor_headers,
        )

    # Verify atomic rollback
    db_session.expire_all()
    profile = db_session.get(DoctorProfile, approved_doctor["profile"].id)
    user = db_session.get(User, approved_doctor["user"].id)

    assert profile.specialization == original_spec
    assert user.full_name == original_name

