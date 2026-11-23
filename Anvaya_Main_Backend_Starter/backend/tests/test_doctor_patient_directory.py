from datetime import date, datetime, time, timezone
from decimal import Decimal
from uuid import uuid4
import pytest
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User

DIRECTORY_ENDPOINT = "/api/v1/doctors/me/patients"


@pytest.fixture
def admin_headers(db_session: Session):
    admin_user = User(
        full_name="Directory Test Admin",
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
def second_approved_doctor(db_session: Session):
    user = User(
        full_name="Dr. Second Specialist",
        email=f"doctor.second.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Cardiology",
        qualification="MBBS, DM Cardiology",
        license_number=f"DOC-SECOND-{uuid4().hex[:6]}",
        years_experience=12,
        clinic_name="Heart Care Institute",
        consultation_fee=Decimal("1200.00"),
        verification_status="approved",
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


def create_patient(
    db_session: Session,
    full_name: str,
    phone_number: str | None = None,
    gender: str | None = None,
) -> dict:
    user = User(
        full_name=full_name,
        email=f"patient.{uuid4().hex[:8]}@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = PatientProfile(
        user_id=user.id,
        phone_number=phone_number,
        gender=gender,
    )
    db_session.add(profile)
    db_session.commit()
    return {"user": user, "profile": profile}


def create_appointment(
    db_session: Session,
    patient_profile_id,
    doctor_profile_id,
    appointment_date: date,
    start_time: time = time(10, 0),
    end_time: time = time(10, 30),
    status: str = "booked",
) -> Appointment:
    appt = Appointment(
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        appointment_date=appointment_date,
        start_time=start_time,
        end_time=end_time,
        status=status,
    )
    db_session.add(appt)
    db_session.commit()
    return appt


def create_consent(
    db_session: Session,
    patient_profile_id,
    doctor_profile_id,
    is_active: bool = True,
) -> ConsentRecord:
    now = datetime.now(timezone.utc)
    consent = ConsentRecord(
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        data_scopes=["visit_summary", "diagnosis"],
        is_active=is_active,
        granted_at=now,
        revoked_at=None if is_active else now,
    )
    db_session.add(consent)
    db_session.commit()
    return consent


# ============================================================================
# 1. DIRECTORY RELATIONSHIP & METRICS TESTS
# ============================================================================

def test_approved_doctor_retrieves_own_directory(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "John Doe", "9876543210", "Male")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 4, 10),
        status="booked",
    )

    response = client.get(DIRECTORY_ENDPOINT, headers=doctor_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert any(i["full_name"] == "John Doe" for i in data["items"])


def test_patient_with_multiple_appointments_appears_once(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Alice Wonder", "9123456780", "Female")
    # 3 qualifying appointments
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 1, 15),
        status="completed",
    )
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 2, 20),
        status="completed",
    )
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 3, 25),
        status="booked",
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Alice%20Wonder",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["full_name"] == "Alice Wonder"


def test_appointment_count_is_correct(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Count Patient", "9000000001", "Other")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 1, 10),
        status="completed",
    )
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 2, 10),
        status="booked",
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Count%20Patient",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["items"][0]["total_appointments"] == 2


def test_latest_appointment_date_and_status_are_correct(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Timeline Patient", "9000000002", "Female")
    # Older completed appointment
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 1, 5),
        status="completed",
    )
    # Newer booked appointment
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 20),
        status="booked",
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Timeline%20Patient",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["last_appointment_date"] == "2026-05-20"
    assert item["last_appointment_status"] == "booked"


def test_cancelled_only_patient_is_excluded(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Never Attended", "9000000003", "Male")
    # Only cancelled appointments
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 2, 1),
        status="cancelled",
    )
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 2, 15),
        status="cancelled",
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Never%20Attended",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert len(data["items"]) == 0


def test_cancelled_appointment_does_not_inflate_metrics(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "One Valid One Cancelled", "9000000004", "Female")
    # 1 completed appointment on Mar 10
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 3, 10),
        status="completed",
    )
    # 1 cancelled appointment on later date Mar 25
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 3, 25),
        status="cancelled",
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=One%20Valid%20One%20Cancelled",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    item = response.json()["items"][0]
    # Metrics must reflect only the completed appointment
    assert item["total_appointments"] == 1
    assert item["last_appointment_date"] == "2026-03-10"
    assert item["last_appointment_status"] == "completed"


# ============================================================================
# 2. CROSS-DOCTOR ISOLATION TESTS
# ============================================================================

def test_doctor_cannot_see_patients_associated_exclusively_with_other_doctor(
    client, doctor_headers, second_approved_doctor, db_session
):
    p_other = create_patient(db_session, "Second Doctor Patient Exclusive")
    create_appointment(
        db_session,
        p_other["profile"].id,
        second_approved_doctor["profile"].id,
        date(2026, 4, 1),
        status="booked",
    )

    # Doctor 1 queries directory
    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Second%20Doctor%20Patient%20Exclusive",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_patient_associated_with_both_doctors_appears_in_each_directory(
    client, doctor_headers, approved_doctor, second_approved_doctor, db_session
):
    p_shared = create_patient(db_session, "Shared Patient Across Doctors")
    # Appointment with Doctor 1
    create_appointment(
        db_session,
        p_shared["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 4, 5),
        status="completed",
    )
    # Appointment with Doctor 2
    create_appointment(
        db_session,
        p_shared["profile"].id,
        second_approved_doctor["profile"].id,
        date(2026, 4, 15),
        status="booked",
    )

    # Doctor 1 query
    res1 = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Shared%20Patient",
        headers=doctor_headers,
    )
    assert res1.status_code == 200
    assert res1.json()["total"] == 1
    assert res1.json()["items"][0]["last_appointment_status"] == "completed"

    # Doctor 2 query
    res2 = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Shared%20Patient",
        headers=second_approved_doctor["headers"],
    )
    assert res2.status_code == 200
    assert res2.json()["total"] == 1
    assert res2.json()["items"][0]["last_appointment_status"] == "booked"


def test_unassociated_patient_is_never_exposed(
    client, doctor_headers, db_session
):
    # Patient with NO appointments at all
    create_patient(db_session, "Completely Unassociated Patient")

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Completely%20Unassociated",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    assert response.json()["total"] == 0


# ============================================================================
# 3. SEARCH & FILTERING TESTS
# ============================================================================

def test_search_by_partial_patient_name(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Benjamin Franklin")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 1),
    )

    res = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Frank",
        headers=doctor_headers,
    )
    assert res.status_code == 200
    assert any(i["full_name"] == "Benjamin Franklin" for i in res.json()["items"])


def test_search_is_case_insensitive(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Eleanor Roosevelt")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 2),
    )

    res_lower = client.get(
        f"{DIRECTORY_ENDPOINT}?search=eleanor",
        headers=doctor_headers,
    )
    assert res_lower.status_code == 200
    assert len(res_lower.json()["items"]) == 1

    res_upper = client.get(
        f"{DIRECTORY_ENDPOINT}?search=ELEANOR",
        headers=doctor_headers,
    )
    assert res_upper.status_code == 200
    assert len(res_upper.json()["items"]) == 1


def test_consent_filter_true(
    client, doctor_headers, approved_doctor, db_session
):
    p_consented = create_patient(db_session, "Consented Patient")
    create_appointment(
        db_session,
        p_consented["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 10),
    )
    create_consent(
        db_session,
        p_consented["profile"].id,
        approved_doctor["profile"].id,
        is_active=True,
    )

    p_unconsented = create_patient(db_session, "Unconsented Patient")
    create_appointment(
        db_session,
        p_unconsented["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 11),
    )

    res = client.get(
        f"{DIRECTORY_ENDPOINT}?has_consent=true",
        headers=doctor_headers,
    )
    assert res.status_code == 200
    for item in res.json()["items"]:
        assert item["has_active_consent"] is True


def test_consent_filter_false(
    client, doctor_headers, approved_doctor, db_session
):
    p_unconsented = create_patient(db_session, "Strictly No Consent Patient")
    create_appointment(
        db_session,
        p_unconsented["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 12),
    )

    res = client.get(
        f"{DIRECTORY_ENDPOINT}?has_consent=false",
        headers=doctor_headers,
    )
    assert res.status_code == 200
    for item in res.json()["items"]:
        assert item["has_active_consent"] is False


def test_revoked_consent_is_not_considered_active(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Revoked Consent Patient")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 15),
    )
    # Revoked consent
    create_consent(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        is_active=False,
    )

    res = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Revoked%20Consent",
        headers=doctor_headers,
    )
    assert res.status_code == 200
    assert res.json()["items"][0]["has_active_consent"] is False


def test_consent_belonging_to_another_doctor_is_not_counted(
    client, doctor_headers, approved_doctor, second_approved_doctor, db_session
):
    p = create_patient(db_session, "Cross Consented Patient")
    # Has appointment with Doctor 1
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 5, 18),
    )
    # But consent was granted to Doctor 2 only!
    create_consent(
        db_session,
        p["profile"].id,
        second_approved_doctor["profile"].id,
        is_active=True,
    )

    # Doctor 1 views directory
    res = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Cross%20Consented",
        headers=doctor_headers,
    )
    assert res.status_code == 200
    assert res.json()["items"][0]["has_active_consent"] is False


# ============================================================================
# 4. PAGINATION & BOUNDS TESTS
# ============================================================================

def test_pagination_and_total_count(
    client, doctor_headers, approved_doctor, db_session
):
    # Create 5 distinct patients with appointments for this doctor
    for i in range(5):
        p = create_patient(db_session, f"Batch Patient {i:02d}")
        create_appointment(
            db_session,
            p["profile"].id,
            approved_doctor["profile"].id,
            date(2026, 6, i + 1),
        )

    # Limit 2, Offset 0
    res_page1 = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Batch%20Patient&limit=2&offset=0",
        headers=doctor_headers,
    )
    assert res_page1.status_code == 200
    d1 = res_page1.json()
    assert d1["total"] == 5
    assert len(d1["items"]) == 2
    assert d1["limit"] == 2
    assert d1["offset"] == 0

    # Limit 2, Offset 2
    res_page2 = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Batch%20Patient&limit=2&offset=2",
        headers=doctor_headers,
    )
    assert res_page2.status_code == 200
    d2 = res_page2.json()
    assert d2["total"] == 5
    assert len(d2["items"]) == 2

    # Verify disjoint patient sets between page 1 and page 2
    pids_1 = {x["patient_profile_id"] for x in d1["items"]}
    pids_2 = {x["patient_profile_id"] for x in d2["items"]}
    assert pids_1.isdisjoint(pids_2)


def test_invalid_limit_and_offset_return_422(client, doctor_headers):
    # limit = 0 (< 1)
    assert client.get(
        f"{DIRECTORY_ENDPOINT}?limit=0",
        headers=doctor_headers,
    ).status_code == 422

    # limit = 101 (> 100)
    assert client.get(
        f"{DIRECTORY_ENDPOINT}?limit=101",
        headers=doctor_headers,
    ).status_code == 422

    # offset = -1 (< 0)
    assert client.get(
        f"{DIRECTORY_ENDPOINT}?offset=-1",
        headers=doctor_headers,
    ).status_code == 422


# ============================================================================
# 5. AUTHORIZATION & RBAC TESTS
# ============================================================================

def test_pending_doctor_receives_403(client, pending_doctor):
    response = client.get(
        DIRECTORY_ENDPOINT,
        headers=pending_doctor["headers"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Only approved doctors can access the patient directory."


def test_rejected_doctor_receives_403(client, rejected_doctor):
    response = client.get(
        DIRECTORY_ENDPOINT,
        headers=rejected_doctor["headers"],
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Only approved doctors can access the patient directory."


def test_patient_token_receives_403(client, patient_headers):
    response = client.get(DIRECTORY_ENDPOINT, headers=patient_headers)
    assert response.status_code == 403


def test_admin_token_receives_403(client, admin_headers):
    response = client.get(DIRECTORY_ENDPOINT, headers=admin_headers)
    assert response.status_code == 403


def test_unauthenticated_request_receives_401(client):
    response = client.get(DIRECTORY_ENDPOINT)
    assert response.status_code == 401


def test_missing_doctor_profile_returns_404(client, doctor_without_profile):
    response = client.get(
        DIRECTORY_ENDPOINT,
        headers=doctor_without_profile["headers"],
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Doctor profile not found."


# ============================================================================
# 6. SENSITIVE EHR PRIVACY TESTS
# ============================================================================

def test_directory_response_contains_no_clinical_ehr_or_prescriptions(
    client, doctor_headers, approved_doctor, db_session
):
    p = create_patient(db_session, "Privacy Guard Patient")
    create_appointment(
        db_session,
        p["profile"].id,
        approved_doctor["profile"].id,
        date(2026, 6, 15),
    )

    response = client.get(
        f"{DIRECTORY_ENDPOINT}?search=Privacy%20Guard",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    item = items[0]

    # Must contain only approved directory metadata
    expected_fields = {
        "patient_profile_id",
        "full_name",
        "phone_number",
        "gender",
        "total_appointments",
        "last_appointment_date",
        "last_appointment_status",
        "has_active_consent",
    }
    assert set(item.keys()) == expected_fields

    # Must NOT contain clinical diagnoses or sensitive EHR fields
    forbidden_keys = [
        "diagnosis",
        "symptoms",
        "chief_complaint",
        "clinical_notes",
        "treatment_plan",
        "prescriptions",
        "medicines",
        "health_records",
    ]
    for key in forbidden_keys:
        assert key not in item

