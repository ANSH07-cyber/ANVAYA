"""
ANVAYA — Stage 3 Phase 2B.4: Consent Revocation Semantics & Authorization Integrity Tests
Testing 8 critical authorization scenarios:
1. Revoking the secondary of two overlapping grants
2. Revoking the primary of two overlapping grants
3. Revoking all access to a doctor with duplicate active records
4. Explicit approval of a new scope after earlier revocation
5. Consent grant timestamp integrity
6. Partial approval and least-privilege EHR reads
7. Concurrent approval versus revocation
8. Legacy consent compatibility
"""

import threading
import uuid
from datetime import datetime, timedelta, timezone, time

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.consent_request import ConsentRequest
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User


@pytest.fixture
def consultation_record(db_session, patient_account, approved_doctor, booked_appointment):
    """Seed health record with diagnostic and symptoms data for EHR access testing."""
    hr = HealthRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=booked_appointment.id,
        visit_date=datetime.now(timezone.utc).date(),
        visit_summary="Patient consultation completed successfully.",
        chief_complaint="Migraine with aura",
        symptoms="Severe headache, photophobia",
        diagnosis="Classic Migraine",
        clinical_notes="Patient advised to rest in quiet room.",
        treatment_plan="Sumatriptan 50mg PRN",
        follow_up_instructions="Return in 2 weeks if symptoms persist.",
    )
    db_session.add(hr)
    db_session.commit()
    return hr


# =====================================================================
# 1. REVOKING THE SECONDARY OF TWO OVERLAPPING GRANTS
# =====================================================================
def test_revoking_secondary_of_two_overlapping_grants(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Grant 1 has ['diagnosis'], Grant 2 has ['symptoms'].
    When the patient revokes Grant 2, 'symptoms' is strictly revoked and denied in EHR queries,
    while 'diagnosis' from Grant 1 remains authorized.
    """
    now = datetime.now(timezone.utc)
    g1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=3),
    )
    g2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    db_session.add_all([g1, g2])
    db_session.commit()

    # Pre-revocation check: both scopes work via union
    res1 = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res1.status_code == 200

    res2 = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert res2.status_code == 200

    # Patient revokes Grant 2 (secondary)
    rev_res = client.patch(
        f"/api/v1/consents/{g2.id}/revoke",
        headers=patient_headers,
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["is_active"] is False

    # Doctor queries symptoms -> HTTP 403 Forbidden
    res_symp = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert res_symp.status_code == 403
    assert "Consent does not cover" in res_symp.json()["detail"]

    # Doctor queries diagnosis -> HTTP 200 OK (Grant 1 remains active)
    res_diag = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_diag.status_code == 200


# =====================================================================
# 2. REVOKING THE PRIMARY OF TWO OVERLAPPING GRANTS
# =====================================================================
def test_revoking_primary_of_two_overlapping_grants(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Grant 1 (primary) has ['diagnosis'], Grant 2 (secondary) has ['symptoms'].
    When the patient revokes Grant 1, 'diagnosis' is strictly revoked and denied in EHR queries,
    while 'symptoms' from Grant 2 remains authorized.
    """
    now = datetime.now(timezone.utc)
    g1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=3),
    )
    g2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    db_session.add_all([g1, g2])
    db_session.commit()

    # Patient revokes Grant 1 (primary)
    rev_res = client.patch(
        f"/api/v1/consents/{g1.id}/revoke",
        headers=patient_headers,
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["is_active"] is False

    # Doctor queries diagnosis -> HTTP 403 Forbidden
    res_diag = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_diag.status_code == 403

    # Doctor queries symptoms -> HTTP 200 OK (Grant 2 remains active)
    res_symp = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert res_symp.status_code == 200


# =====================================================================
# 3. REVOKING ALL ACCESS TO A DOCTOR WITH DUPLICATE ACTIVE RECORDS
# =====================================================================
def test_revoking_all_access_to_doctor_with_duplicate_records(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Simulates anvaya_db duplicate state with two active records.
    Using the bulk revocation endpoint PATCH /consents/doctor/{id}/revoke-all,
    both records are atomically deactivated. Subsequent doctor EHR access is completely blocked.
    """
    now = datetime.now(timezone.utc)
    g1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=3),
    )
    g2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "treatment_plan"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    db_session.add_all([g1, g2])
    db_session.commit()

    # Patient invokes revoke-all for this doctor
    rev_all = client.patch(
        f"/api/v1/consents/doctor/{approved_doctor['profile'].id}/revoke-all",
        headers=patient_headers,
    )
    assert rev_all.status_code == 200
    items = rev_all.json()["items"]
    assert len(items) == 2
    for item in items:
        assert item["is_active"] is False
        assert item["revoked_at"] is not None

    # Doctor queries ANY scope -> HTTP 403 (active consent missing)
    for scope in ["diagnosis", "symptoms", "treatment_plan"]:
        res = client.get(
            f"/api/v1/health-records/patient/{patient_account['profile'].id}",
            params=[("scopes", scope)],
            headers=doctor_headers,
        )
        assert res.status_code == 403
        assert "consent" in res.json()["detail"].lower()


# =====================================================================
# 4. EXPLICIT APPROVAL OF A NEW SCOPE AFTER EARLIER REVOCATION
# =====================================================================
def test_explicit_approval_of_new_scope_after_earlier_revocation(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Patient previously revoked Grant 1 containing ['diagnosis', 'symptoms'].
    Doctor creates a new request for ['symptoms']. Patient explicitly approves it.
    Result: 'symptoms' is accessible via the new grant, but previously revoked 'diagnosis' remains denied.
    """
    now = datetime.now(timezone.utc)
    old_grant = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=False,
        granted_at=now - timedelta(days=5),
        revoked_at=now - timedelta(days=2),
    )
    db_session.add(old_grant)
    db_session.commit()

    # Doctor requests only symptoms
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["symptoms"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    req_id = req_res.json()["id"]

    # Patient approves symptoms
    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["symptoms"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200

    # Doctor queries symptoms -> HTTP 200 OK
    res_symp = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert res_symp.status_code == 200

    # Doctor queries diagnosis -> HTTP 403 Forbidden (old revoked scope NOT restored)
    res_diag = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_diag.status_code == 403


# =====================================================================
# 5. CONSENT GRANT TIMESTAMP INTEGRITY
# =====================================================================
def test_consent_grant_timestamp_integrity(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    db_session,
):
    """Grant 1 was created at T0 (2 days ago) with ['diagnosis'].
    Doctor requests ['treatment_plan'] at T1 (now). Patient approves it.
    Result:
    1. Grant 1's granted_at remains strictly T0, and its scopes remain strictly ['diagnosis'].
    2. New Grant 2 is created with granted_at = T1, and scopes = ['treatment_plan'].
    3. Grant 1 is NOT back-dated or mutated with the new scope.
    """
    t0 = datetime.now(timezone.utc) - timedelta(days=2)
    g1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=t0,
    )
    db_session.add(g1)
    db_session.commit()
    g1_id = g1.id

    t_before_approval = datetime.now(timezone.utc)

    # Doctor requests treatment_plan
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["treatment_plan"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201

    resp = client.patch(
        f"/api/v1/consents/requests/{req.json()['id']}/respond",
        json={"action": "approve", "approved_scopes": ["treatment_plan"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    new_grant_id = uuid.UUID(resp.json()["consent_record_id"])

    db_session.expire_all()
    rec1 = db_session.get(ConsentRecord, g1_id)
    rec2 = db_session.get(ConsentRecord, new_grant_id)

    # Verify Grant 1 integrity
    assert rec1.data_scopes == ["diagnosis"]
    t0_norm = t0.astimezone(timezone.utc).replace(tzinfo=None)
    r1_norm = rec1.granted_at.astimezone(timezone.utc).replace(tzinfo=None) if rec1.granted_at.tzinfo else rec1.granted_at
    assert abs((r1_norm - t0_norm).total_seconds()) < 1

    # Verify Grant 2 integrity
    assert rec2.data_scopes == ["treatment_plan"]
    r2_norm = rec2.granted_at.astimezone(timezone.utc).replace(tzinfo=None) if rec2.granted_at.tzinfo else rec2.granted_at
    tb_norm = t_before_approval.astimezone(timezone.utc).replace(tzinfo=None)
    assert (r2_norm - tb_norm).total_seconds() >= -1
    # Grant 2 granted_at is approximately 2 days after Grant 1
    diff_days = (r2_norm - r1_norm).total_seconds() / 86400
    assert 1.9 < diff_days < 2.1


# =====================================================================
# 6. PARTIAL APPROVAL AND LEAST-PRIVILEGE EHR READS
# =====================================================================
def test_partial_approval_and_least_privilege_ehr_reads(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Doctor requests 3 scopes: ['diagnosis', 'treatment_plan', 'clinical_notes'].
    Patient partially approves ONLY ['diagnosis'].
    Doctor reads EHR with 'diagnosis' -> 200 OK.
    Doctor reads EHR with 'treatment_plan' or 'clinical_notes' -> 403 Forbidden.
    """
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "treatment_plan", "clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "partially_approved"
    assert resp.json()["approved_scopes"] == ["diagnosis"]

    # Read allowed scope
    r_diag = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert r_diag.status_code == 200

    # Read unapproved scopes -> 403 Forbidden
    for unapproved in ["treatment_plan", "clinical_notes"]:
        r_denied = client.get(
            f"/api/v1/health-records/patient/{patient_account['profile'].id}",
            params=[("scopes", unapproved)],
            headers=doctor_headers,
        )
        assert r_denied.status_code == 403


# =====================================================================
# 7. CONCURRENT APPROVAL VERSUS REVOCATION
# =====================================================================
def test_concurrent_approval_versus_revocation(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Simulates concurrent threads: one approving a new request for ['treatment_plan'],
    the other revoking an active grant for ['diagnosis'].
    Both complete without deadlock or corruption due to PatientProfile lock hierarchy.
    """
    now = datetime.now(timezone.utc)
    g1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=1),
    )
    db_session.add(g1)
    db_session.commit()
    g1_id = g1.id

    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["treatment_plan"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    results = {}

    def do_approve():
        resp = client.patch(
            f"/api/v1/consents/requests/{req_id}/respond",
            json={"action": "approve", "approved_scopes": ["treatment_plan"]},
            headers=patient_headers,
        )
        results["approve"] = resp.status_code

    def do_revoke():
        resp = client.patch(
            f"/api/v1/consents/{g1_id}/revoke",
            headers=patient_headers,
        )
        results["revoke"] = resp.status_code

    t1 = threading.Thread(target=do_approve)
    t2 = threading.Thread(target=do_revoke)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert results["approve"] == 200
    assert results["revoke"] == 200

    db_session.expire_all()
    rec1 = db_session.get(ConsentRecord, g1_id)
    assert rec1.is_active is False
    assert rec1.revoked_at is not None

    active_records = db_session.scalars(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_account["profile"].id,
            ConsentRecord.doctor_profile_id == approved_doctor["profile"].id,
            ConsentRecord.is_active.is_(True),
        )
    ).all()
    assert len(active_records) == 1
    assert active_records[0].data_scopes == ["treatment_plan"]


# =====================================================================
# 8. LEGACY CONSENT COMPATIBILITY
# =====================================================================
def test_legacy_consent_compatibility(
    client,
    doctor_headers,
    patient_headers,
    approved_doctor,
    patient_account,
    booked_appointment,
    consultation_record,
    db_session,
):
    """Direct patient consent grant via POST /consents creates a single active record.
    GET /consents/me lists the record correctly.
    Doctor EHR access works seamlessly.
    Patient can revoke it via PATCH /consents/{id}/revoke.
    """
    # 1. Direct grant
    grant_res = client.post(
        "/api/v1/consents",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "data_scopes": ["diagnosis", "treatment_plan"],
        },
        headers=patient_headers,
    )
    assert grant_res.status_code == 201
    cid = grant_res.json()["id"]

    # 2. List consents
    list_res = client.get("/api/v1/consents/me", headers=patient_headers)
    assert list_res.status_code == 200
    items = list_res.json()["items"]
    assert any(item["id"] == cid and item["is_active"] is True for item in items)

    # 3. Doctor EHR access
    ehr_res = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_res.status_code == 200

    # 4. Revocation
    rev_res = client.patch(
        f"/api/v1/consents/{cid}/revoke",
        headers=patient_headers,
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["is_active"] is False

    # 5. Access immediately denied
    ehr_denied = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_denied.status_code == 403
