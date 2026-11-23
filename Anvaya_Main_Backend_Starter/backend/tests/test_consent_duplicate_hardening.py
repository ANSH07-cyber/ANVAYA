import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.consent_record import ConsentRecord
from app.models.consent_request import ConsentRequest
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def other_patient_account(db_session):
    user = User(
        full_name="Other Patient",
        email=f"other.patient.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
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
def other_patient_headers(other_patient_account):
    token = create_access_token(subject=str(other_patient_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


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
# 1. TWO ACTIVE RECORDS WITH IDENTICAL SCOPES
# =====================================================================
def test_two_active_records_with_identical_scopes(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
    consultation_record,
):
    """Two active records with identical scopes (simulating anvaya_db legacy state)
    provide seamless access, status lookup, and approval without deleting or revoking either record.
    """
    now = datetime.now(timezone.utc)
    c1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    c2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=1),
    )
    db_session.add_all([c1, c2])
    db_session.commit()
    c1_id, c2_id = c1.id, c2.id

    # EHR access succeeds for approved scopes
    res = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res.status_code == 200

    # Doctor requests clinical_notes
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    # Patient approves
    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["clinical_notes"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200

    # Both prior records remain active and completely UNTOUCHED; new grant is distinct
    db_session.expire_all()
    rec1 = db_session.get(ConsentRecord, c1_id)
    rec2 = db_session.get(ConsentRecord, c2_id)
    assert rec1.is_active is True and rec1.revoked_at is None
    assert rec2.is_active is True and rec2.revoked_at is None
    assert rec1.data_scopes == ["diagnosis", "symptoms"]
    assert rec2.data_scopes == ["diagnosis", "symptoms"]
    new_rec = db_session.get(ConsentRecord, uuid.UUID(resp.json()["consent_record_id"]))
    assert new_rec.is_active is True and new_rec.revoked_at is None
    assert new_rec.data_scopes == ["clinical_notes"]


# =====================================================================
# 2. TWO ACTIVE RECORDS WITH DIFFERENT SCOPES
# =====================================================================
def test_two_active_records_with_different_scopes(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
    consultation_record,
):
    """EHR access queries union across both active records with disjoint scopes."""
    now = datetime.now(timezone.utc)
    c1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    c2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=1),
    )
    db_session.add_all([c1, c2])
    db_session.commit()

    # Both diagnosis and symptoms are accessible via union
    res_diag = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_diag.status_code == 200

    res_symp = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert res_symp.status_code == 200


# =====================================================================
# 3. PARTIAL APPROVAL INTRODUCING ONE NEW SCOPE
# =====================================================================
def test_partial_approval_introducing_one_new_scope(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Doctor requests 3 scopes; patient partially approves 1 scope."""
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


# =====================================================================
# 4. FULL APPROVAL
# =====================================================================
def test_full_approval(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient approves all requested scopes."""
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "symptoms"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis", "symptoms"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    assert set(resp.json()["approved_scopes"]) == {"diagnosis", "symptoms"}


# =====================================================================
# 5. PATIENT DECLINE
# =====================================================================
def test_patient_decline_creates_no_consent(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Declining a request creates zero consent records and status is 'declined'."""
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "decline"},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "declined"
    assert resp.json()["consent_record_id"] is None

    # Verify zero active consent records in DB
    active = db_session.scalars(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_account["profile"].id,
            ConsentRecord.is_active.is_(True),
        )
    ).all()
    assert len(active) == 0


# =====================================================================
# 6. PREVIOUSLY REVOKED CONSENT
# =====================================================================
def test_previously_revoked_consent_remains_denied(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
    consultation_record,
):
    """Revoked record grants zero EHR access."""
    now = datetime.now(timezone.utc)
    c = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=False,
        granted_at=now - timedelta(days=2),
        revoked_at=now - timedelta(days=1),
    )
    db_session.add(c)
    db_session.commit()

    res = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res.status_code == 403


# =====================================================================
# 7. EXPLICIT NEW APPROVAL AFTER HISTORICAL REVOCATION
# =====================================================================
def test_new_approval_after_historical_revocation_creates_distinct_event(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Approving after previous revocation creates a NEW record and does not restore old scopes."""
    now = datetime.now(timezone.utc)
    old_c = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis", "symptoms"],
        is_active=False,
        granted_at=now - timedelta(days=2),
        revoked_at=now - timedelta(days=1),
    )
    db_session.add(old_c)
    db_session.commit()
    old_id = old_c.id

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
    req_id = req.json()["id"]

    # Patient approves treatment_plan
    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["treatment_plan"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    new_id = uuid.UUID(resp.json()["consent_record_id"])
    assert new_id != old_id

    # Verify old record is still revoked and new record has ONLY treatment_plan
    db_session.expire_all()
    old_rec = db_session.get(ConsentRecord, old_id)
    new_rec = db_session.get(ConsentRecord, new_id)
    assert old_rec.is_active is False
    assert new_rec.is_active is True
    assert new_rec.data_scopes == ["treatment_plan"]


# =====================================================================
# 8. IDEMPOTENT APPROVAL RETRY
# =====================================================================
def test_idempotent_approval_retry_no_duplicate_records(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Replaying approval with the same idempotency key returns identical result without new records."""
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    idemp_headers = {**patient_headers, "X-Idempotency-Key": "test-idemp-key-123"}
    resp1 = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=idemp_headers,
    )
    assert resp1.status_code == 200

    resp2 = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=idemp_headers,
    )
    assert resp2.status_code == 200
    assert resp2.json()["id"] == resp1.json()["id"]


# =====================================================================
# 9. CONCURRENT APPROVAL AND REVOCATION LOCK ORDERING
# =====================================================================
def test_concurrent_approval_and_revocation_lock_ordering(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Approval and revocation maintain consistent lock ordering and zero deadlocks."""
    c = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
    )
    db_session.add(c)
    req = ConsentRequest(
        doctor_profile_id=approved_doctor["profile"].id,
        patient_profile_id=patient_account["profile"].id,
        requested_scopes=["symptoms"],
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db_session.add(req)
    db_session.commit()

    barrier = threading.Barrier(2)

    def do_revoke():
        barrier.wait(timeout=10)
        return client.patch(f"/api/v1/consents/{c.id}/revoke", headers=patient_headers)

    def do_approve():
        barrier.wait(timeout=10)
        return client.patch(
            f"/api/v1/consents/requests/{req.id}/respond",
            json={"action": "approve", "approved_scopes": ["symptoms"]},
            headers=patient_headers,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_revoke)
        f2 = executor.submit(do_approve)
        r1 = f1.result(timeout=15)
        r2 = f2.result(timeout=15)

    assert r1.status_code == 200
    assert r2.status_code == 200


# =====================================================================
# 10. CROSS-PATIENT AUTHORIZATION DENIAL
# =====================================================================
def test_cross_patient_authorization_denial(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
    other_patient_headers,
):
    """Patient B cannot inspect or respond to Patient A's consent request."""
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    # Other patient tries to view
    view_res = client.get(
        f"/api/v1/consents/requests/{req_id}",
        headers=other_patient_headers,
    )
    assert view_res.status_code == 403

    # Other patient tries to respond
    resp_res = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=other_patient_headers,
    )
    assert resp_res.status_code == 404


# =====================================================================
# 11. EHR ACCESS AFTER CONSENT REVOCATION
# =====================================================================
def test_ehr_access_denied_after_consent_revocation(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
    consultation_record,
):
    """Explicit revocation immediately blocks doctor EHR queries."""
    c = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
    )
    db_session.add(c)
    db_session.commit()

    # Pre-revocation: access works
    res_before = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_before.status_code == 200

    # Revoke
    rev = client.patch(f"/api/v1/consents/{c.id}/revoke", headers=patient_headers)
    assert rev.status_code == 200

    # Post-revocation: 403 denied
    res_after = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert res_after.status_code == 403


# =====================================================================
# 12. HISTORICAL CONSENT IDS AND TIMESTAMPS UNCHANGED
# =====================================================================
def test_historical_consent_ids_and_timestamps_unchanged(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Existing duplicate record IDs and granted_at timestamps remain identical across approvals."""
    t1 = datetime.now(timezone.utc) - timedelta(hours=3)
    t2 = datetime.now(timezone.utc) - timedelta(hours=2)
    c1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=t1,
    )
    c2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=t2,
    )
    db_session.add_all([c1, c2])
    db_session.commit()
    c1_id, c2_id = c1.id, c2.id

    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201
    req_id = req.json()["id"]

    client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["clinical_notes"]},
        headers=patient_headers,
    )

    db_session.expire_all()
    rec1 = db_session.get(ConsentRecord, c1_id)
    rec2 = db_session.get(ConsentRecord, c2_id)
    assert rec1.id == c1_id
    assert rec2.id == c2_id
    # SQLite stores naive datetime; normalize for timezone-resilient comparison
    t1_norm = t1 if t1.tzinfo is None else t1.astimezone(timezone.utc).replace(tzinfo=None)
    t2_norm = t2 if t2.tzinfo is None else t2.astimezone(timezone.utc).replace(tzinfo=None)
    r1_norm = rec1.granted_at if rec1.granted_at.tzinfo is None else rec1.granted_at.astimezone(timezone.utc).replace(tzinfo=None)
    r2_norm = rec2.granted_at if rec2.granted_at.tzinfo is None else rec2.granted_at.astimezone(timezone.utc).replace(tzinfo=None)
    assert abs((r1_norm - t1_norm).total_seconds()) < 1
    assert abs((r2_norm - t2_norm).total_seconds()) < 1


# =====================================================================
# 13. NO FALSE REVOKED_AT MUTATION ON DUPLICATES
# =====================================================================
def test_no_false_revoked_at_mutation_on_duplicates(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Approval does NOT set revoked_at on any secondary active records."""
    now = datetime.now(timezone.utc)
    c1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    c2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=1),
    )
    db_session.add_all([c1, c2])
    db_session.commit()

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

    db_session.expire_all()
    assert c1.revoked_at is None
    assert c2.revoked_at is None


# =====================================================================
# 14. NO UNAUTHORIZED SCOPE EXPANSION
# =====================================================================
def test_no_unauthorized_scope_expansion(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient cannot approve unrequested scopes; only approved subset is activated."""
    req = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req.status_code == 201

    # Attempt to approve 'treatment_plan' which doctor did not request -> rejected 422
    bad_resp = client.patch(
        f"/api/v1/consents/requests/{req.json()['id']}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis", "treatment_plan"]},
        headers=patient_headers,
    )
    assert bad_resp.status_code == 422


# =====================================================================
# 15. NO SCOPE LOSS DURING APPROVAL
# =====================================================================
def test_no_scope_loss_during_approval(
    client,
    doctor_headers,
    patient_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
    consultation_record,
):
    """Approval of a new scope retains all scopes from existing active records."""
    now = datetime.now(timezone.utc)
    c1 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["diagnosis"],
        is_active=True,
        granted_at=now - timedelta(hours=2),
    )
    c2 = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["symptoms"],
        is_active=True,
        granted_at=now - timedelta(hours=1),
    )
    db_session.add_all([c1, c2])
    db_session.commit()

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

    client.patch(
        f"/api/v1/consents/requests/{req.json()['id']}/respond",
        json={"action": "approve", "approved_scopes": ["treatment_plan"]},
        headers=patient_headers,
    )

    # Doctor accesses EHR: diagnosis, symptoms, and treatment_plan MUST ALL BE ACCESSIBLE
    for scope in ["diagnosis", "symptoms", "treatment_plan"]:
        r = client.get(
            f"/api/v1/health-records/patient/{patient_account['profile'].id}",
            params=[("scopes", scope)],
            headers=doctor_headers,
        )
        assert r.status_code == 200, f"Scope {scope} was lost!"
