import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.consent_record import ConsentRecord
from app.models.consent_request import ConsentRequest
from app.models.doctor_availability import DoctorAvailability
from app.models.doctor_profile import DoctorProfile
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.user import User

IST = ZoneInfo("Asia/Kolkata")

CONSULTATION_PAYLOAD = {
    "visit_summary": "Patient consultation completed. Symptoms assessed and treatment discussed.",
    "chief_complaint": "Recurring headache",
    "symptoms": "Headache and mild nausea",
    "diagnosis": "Clinical evaluation required",
    "clinical_notes": "Patient examined during consultation.",
    "treatment_plan": "Further evaluation advised.",
    "follow_up_instructions": "Follow up after 7 days.",
}


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
def unrelated_doctor_account(db_session, future_monday):
    user = User(
        full_name="Dr. Unrelated Doctor",
        email=f"dr.unrelated.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Cardiology",
        qualification="MBBS, MD Cardiology",
        license_number=f"TEST-UNREL-{uuid.uuid4().hex[:6]}",
        years_experience=10,
        clinic_name="Unrelated Clinic",
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
    return {"user": user, "profile": profile}


@pytest.fixture
def unrelated_doctor_headers(unrelated_doctor_account):
    token = create_access_token(subject=str(unrelated_doctor_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def pending_doctor_account(db_session):
    user = User(
        full_name="Dr. Pending Doctor",
        email=f"dr.pending.{uuid.uuid4().hex[:6]}@example.com",
        password_hash="test-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    profile = DoctorProfile(
        user_id=user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD Pediatrics",
        license_number=f"TEST-PEND-{uuid.uuid4().hex[:6]}",
        years_experience=3,
        clinic_name="Pending Clinic",
        verification_status="pending",
    )
    db_session.add(profile)
    db_session.commit()
    return {"user": user, "profile": profile}


@pytest.fixture
def pending_doctor_headers(pending_doctor_account):
    token = create_access_token(subject=str(pending_doctor_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


# =====================================================================
# 1. CONSENT STATUS LOOKUP (GET /consents/status/patient/{id})
# =====================================================================

def test_patient_cannot_lookup_doctor_consent_status(
    client,
    patient_headers,
    patient_account,
):
    """Patient cannot access the doctor consent status endpoint (requires doctor role)."""
    response = client.get(
        f"/api/v1/consents/status/patient/{patient_account['profile'].id}",
        headers=patient_headers,
    )
    assert response.status_code == 403


def test_unapproved_doctor_cannot_lookup_consent_status(
    client,
    pending_doctor_headers,
    patient_account,
):
    """Pending/unapproved doctor cannot check patient consent status."""
    response = client.get(
        f"/api/v1/consents/status/patient/{patient_account['profile'].id}",
        headers=pending_doctor_headers,
    )
    assert response.status_code == 403
    assert "approved" in response.json()["detail"].lower()


def test_doctor_without_relationship_status_indicates_cannot_request(
    client,
    unrelated_doctor_headers,
    patient_account,
):
    """Approved doctor without booked or completed appointment relationship gets status with relationship_established=False."""
    response = client.get(
        f"/api/v1/consents/status/patient/{patient_account['profile'].id}",
        headers=unrelated_doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["relationship_established"] is False
    assert data["can_request_consent"] is False
    assert data["has_active_consent"] is False


def test_doctor_with_relationship_can_lookup_consent_status(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
):
    """Approved doctor with booked appointment can check consent status."""
    response = client.get(
        f"/api/v1/consents/status/patient/{patient_account['profile'].id}",
        headers=doctor_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["doctor_profile_id"] == str(approved_doctor["profile"].id)
    assert data["patient_profile_id"] == str(patient_account["profile"].id)
    assert data["relationship_established"] is True
    assert data["has_active_consent"] is False
    assert data["can_request_consent"] is True
    assert data["active_scopes"] == []
    assert data["pending_request"] is None


# =====================================================================
# 2. CREATE CONSENT REQUEST (POST /consents/requests)
# =====================================================================

def test_approved_doctor_can_create_consent_request(
    client,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Approved doctor with appointment creates a pending consent request."""
    payload = {
        "patient_profile_id": str(patient_account["profile"].id),
        "requested_scopes": ["diagnosis", "symptoms", "visit_summary"],
        "doctor_message": "Need diagnostic and symptom history for upcoming consultation.",
    }

    response = client.post(
        "/api/v1/consents/requests",
        json=payload,
        headers=doctor_headers,
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["doctor_profile_id"] == str(approved_doctor["profile"].id)
    assert data["patient_profile_id"] == str(patient_account["profile"].id)
    assert set(data["requested_scopes"]) == {"diagnosis", "symptoms", "visit_summary"}
    assert data["approved_scopes"] is None
    assert data["status"] == "pending"
    assert data["doctor_message"] == payload["doctor_message"]
    assert data["created_at"] is not None
    assert data["expires_at"] is not None

    # Check notification was generated for patient
    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == patient_account["user"].id,
            Notification.notification_type == "consent.requested",
        )
    )
    assert notif is not None
    assert notif.safe_action_path == "/patient/consent"
    assert "EHR Consent Requested" in notif.title
    # Zero PHI check: ensure no specific clinical scopes are leaked in the message
    assert "diagnosis" not in notif.message
    assert "symptoms" not in notif.message

    # Check audit log was generated
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.actor_user_id == approved_doctor["user"].id,
            AuditLog.event_type == "consent.request_created",
        )
    )
    assert audit is not None
    assert audit.resource_type == "consent_request"
    assert audit.details["scope_count"] == 3


def test_doctor_without_relationship_cannot_create_request(
    client,
    unrelated_doctor_headers,
    patient_account,
):
    """Doctor without appointment relationship cannot create a consent request."""
    payload = {
        "patient_profile_id": str(patient_account["profile"].id),
        "requested_scopes": ["diagnosis"],
    }
    response = client.post(
        "/api/v1/consents/requests",
        json=payload,
        headers=unrelated_doctor_headers,
    )
    assert response.status_code == 403
    assert "relationship" in response.json()["detail"].lower()


def test_unapproved_doctor_cannot_create_request(
    client,
    pending_doctor_headers,
    patient_account,
):
    """Pending doctor cannot create a consent request."""
    payload = {
        "patient_profile_id": str(patient_account["profile"].id),
        "requested_scopes": ["diagnosis"],
    }
    response = client.post(
        "/api/v1/consents/requests",
        json=payload,
        headers=pending_doctor_headers,
    )
    assert response.status_code == 403


def test_duplicate_pending_consent_request_rejected(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
):
    """Cannot create a second consent request while one is already pending."""
    payload = {
        "patient_profile_id": str(patient_account["profile"].id),
        "requested_scopes": ["diagnosis"],
    }
    res1 = client.post(
        "/api/v1/consents/requests",
        json=payload,
        headers=doctor_headers,
    )
    assert res1.status_code == 201

    res2 = client.post(
        "/api/v1/consents/requests",
        json=payload,
        headers=doctor_headers,
    )
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"].lower()


def test_cannot_request_consent_if_already_granted_all_requested_scopes(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
):
    """If patient already granted active consent covering all requested scopes, request is rejected."""
    # Patient grants diagnosis and symptoms
    grant_res = client.post(
        "/api/v1/consents",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "data_scopes": ["diagnosis", "symptoms"],
        },
        headers=patient_headers,
    )
    assert grant_res.status_code == 201

    # Doctor requests subset or exact match -> 409 Conflict
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 409
    assert "already exists" in req_res.json()["detail"].lower()


def test_can_request_additional_scopes_when_partial_active_consent_exists(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
):
    """Doctor can request additional scopes if existing active consent does not cover them."""
    # Patient granted only diagnosis
    client.post(
        "/api/v1/consents",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "data_scopes": ["diagnosis"],
        },
        headers=patient_headers,
    )

    # Doctor requests diagnosis AND symptoms -> allowed because symptoms is missing
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "symptoms"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    assert req_res.json()["status"] == "pending"


# =====================================================================
# 3. PATIENT LISTING & ACCESS CONTROL (GET /consents/requests/pending)
# =====================================================================

def test_patient_can_list_pending_requests(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
):
    """Patient retrieves list of their pending consent requests."""
    # Doctor creates request
    create_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert create_res.status_code == 201

    # Patient lists pending requests
    list_res = client.get(
        "/api/v1/consents/requests/pending",
        headers=patient_headers,
    )
    assert list_res.status_code == 200
    data = list_res.json()
    assert data["total"] >= 1
    req = next(r for r in data["items"] if r["id"] == create_res.json()["id"])
    assert req["status"] == "pending"
    assert set(req["requested_scopes"]) == {"diagnosis", "clinical_notes"}
    assert req["doctor_name"] == approved_doctor["user"].full_name


def test_doctor_cannot_access_patient_pending_requests(
    client,
    doctor_headers,
):
    """Doctor role cannot access patient pending requests endpoint."""
    response = client.get(
        "/api/v1/consents/requests/pending",
        headers=doctor_headers,
    )
    assert response.status_code == 403


# =====================================================================
# 4. SHARED REQUEST DETAIL (GET /consents/requests/{id})
# =====================================================================

def test_parties_can_view_request_detail(
    client,
    patient_headers,
    doctor_headers,
    other_patient_headers,
    unrelated_doctor_headers,
    booked_appointment,
    patient_account,
):
    """Only involved doctor and patient can view the request; unrelated parties are denied."""
    create_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert create_res.status_code == 201
    request_id = create_res.json()["id"]

    # Requesting doctor can view
    doc_res = client.get(
        f"/api/v1/consents/requests/{request_id}",
        headers=doctor_headers,
    )
    assert doc_res.status_code == 200

    # Target patient can view
    pat_res = client.get(
        f"/api/v1/consents/requests/{request_id}",
        headers=patient_headers,
    )
    assert pat_res.status_code == 200

    # Unrelated doctor denied (403)
    unrelated_doc_res = client.get(
        f"/api/v1/consents/requests/{request_id}",
        headers=unrelated_doctor_headers,
    )
    assert unrelated_doc_res.status_code == 403

    # Unrelated patient denied (403)
    unrelated_pat_res = client.get(
        f"/api/v1/consents/requests/{request_id}",
        headers=other_patient_headers,
    )
    assert unrelated_pat_res.status_code == 403


# =====================================================================
# 5. PATIENT APPROVAL & PARTIAL APPROVAL (PATCH /consents/requests/{id}/respond)
# =====================================================================

def test_patient_can_approve_full_consent_request(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient approves full requested scopes. Active ConsentRecord is created and EHR access is unlocked."""
    # Complete past appointment to populate consultation records
    complete_res = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )
    assert complete_res.status_code == 200

    # Doctor requests consent
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "symptoms", "visit_summary"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    request_id = req_res.json()["id"]

    # Invariant check: pending request does NOT authorize EHR access
    ehr_check = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_check.status_code == 403
    assert "Active patient consent is required" in ehr_check.json()["detail"]

    # Patient approves all requested scopes
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={
            "action": "approve",
            "approved_scopes": ["diagnosis", "symptoms", "visit_summary"],
        },
        headers=patient_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "approved"
    assert set(data["approved_scopes"]) == {"diagnosis", "symptoms", "visit_summary"}
    assert data["consent_record_id"] is not None
    assert data["resolved_at"] is not None

    # Verify active ConsentRecord created in DB
    consent = db_session.get(ConsentRecord, uuid.UUID(data["consent_record_id"]))
    assert consent is not None
    assert consent.is_active is True
    assert set(consent.data_scopes) == {"diagnosis", "symptoms", "visit_summary"}

    # Verify notification sent to doctor
    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == approved_doctor["user"].id,
            Notification.notification_type == "consent.approved",
        )
    )
    assert notif is not None
    assert notif.safe_action_path == "/doctor/patients"
    assert "EHR Consent Approved" in notif.title

    # Verify audit log
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.actor_user_id == patient_account["user"].id,
            AuditLog.event_type == "consent.request_approved",
        )
    )
    assert audit is not None
    assert audit.resource_type == "consent_request"

    # Verify EHR access is now granted
    ehr_res = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis"), ("scopes", "symptoms")],
        headers=doctor_headers,
    )
    assert ehr_res.status_code == 200
    ehr_data = ehr_res.json()
    assert ehr_data["total"] >= 1
    record_data = ehr_data["items"][0]["data"]
    assert record_data["diagnosis"] == CONSULTATION_PAYLOAD["diagnosis"]


def test_patient_can_partially_approve_scopes(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient approves only a subset of requested scopes.

    Status is 'partially_approved', active consent has only subset, and EHR access
    is granted ONLY for approved scopes while unapproved scopes are denied.
    """
    client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "symptoms", "clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    request_id = req_res.json()["id"]

    # Patient approves ONLY diagnosis and symptoms (declines clinical_notes)
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={
            "action": "approve",
            "approved_scopes": ["diagnosis", "symptoms"],
        },
        headers=patient_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "partially_approved"
    assert set(data["approved_scopes"]) == {"diagnosis", "symptoms"}

    # Verify notification to doctor indicates partial approval
    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == approved_doctor["user"].id,
            Notification.notification_type == "consent.approved",
        )
    )
    assert notif is not None
    assert "Partially Approved" in notif.title

    # EHR access for approved scopes: SUCCEEDS
    ehr_ok = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_ok.status_code == 200

    # EHR access requesting unapproved scope: FAILS with 403
    ehr_denied = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "clinical_notes")],
        headers=doctor_headers,
    )
    assert ehr_denied.status_code == 403
    assert "Consent does not cover" in ehr_denied.json()["detail"]


def test_patient_cannot_approve_unrequested_scopes(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    patient_account,
):
    """Patient cannot approve scopes that were not requested by the doctor (strict subset rule)."""
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    request_id = req_res.json()["id"]

    # Patient attempts to approve "clinical_notes" which was NOT requested -> 422
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={
            "action": "approve",
            "approved_scopes": ["diagnosis", "clinical_notes"],
        },
        headers=patient_headers,
    )
    assert resp.status_code == 422
    assert "subset of requested scopes" in resp.json()["detail"].lower()


# =====================================================================
# 6. PATIENT DECLINES CONSENT REQUEST
# =====================================================================

def test_patient_can_decline_consent_request(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """Patient declines consent request. Zero ConsentRecords created, EHR access remains blocked."""
    client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    request_id = req_res.json()["id"]

    # Count consent records before
    count_before = db_session.scalar(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_account["profile"].id
        )
    )

    # Patient declines
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={"action": "decline"},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "declined"
    assert data["approved_scopes"] is None
    assert data["consent_record_id"] is None

    # Zero consent records created
    count_after = db_session.scalar(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_account["profile"].id
        )
    )
    assert count_after == count_before

    # Doctor notification generated
    notif = db_session.scalar(
        select(Notification).where(
            Notification.recipient_user_id == approved_doctor["user"].id,
            Notification.notification_type == "consent.declined",
        )
    )
    assert notif is not None
    assert "EHR Consent Declined" in notif.title

    # Doctor EHR access still fails (403)
    ehr_res = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_res.status_code == 403


# =====================================================================
# 7. IDEMPOTENCY & REPLAY PROTECTION
# =====================================================================

def test_idempotent_response_replay(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    patient_account,
):
    """Replaying a response with the same idempotency key returns cached result without duplication."""
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    request_id = req_res.json()["id"]

    headers_with_idemp = {
        **patient_headers,
        "X-Idempotency-Key": f"resp-idemp-{uuid.uuid4().hex[:8]}",
    }

    # First approval
    resp1 = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={
            "action": "approve",
            "approved_scopes": ["diagnosis"],
        },
        headers=headers_with_idemp,
    )
    assert resp1.status_code == 200

    # Second approval replay with same key
    resp2 = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={
            "action": "approve",
            "approved_scopes": ["diagnosis"],
        },
        headers=headers_with_idemp,
    )
    assert resp2.status_code == 200
    assert resp2.json()["id"] == resp1.json()["id"]
    assert resp2.json()["status"] == resp1.json()["status"]


def test_cannot_respond_to_already_resolved_request(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    patient_account,
):
    """Subsequent response with different/missing idempotency key is rejected with 409 Conflict."""
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    request_id = req_res.json()["id"]

    # First response: decline
    resp1 = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={"action": "decline"},
        headers=patient_headers,
    )
    assert resp1.status_code == 200

    # Second response attempt without same key -> 409 Conflict
    resp2 = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=patient_headers,
    )
    assert resp2.status_code == 409
    assert "no longer pending" in resp2.json()["detail"].lower()


# =====================================================================
# 8. EXPIRATION BEHAVIOR
# =====================================================================

def test_cannot_respond_to_expired_request(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    patient_account,
    db_session,
):
    """Consent requests past expires_at are rejected upon response attempt."""
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    request_id = req_res.json()["id"]

    # Artificially set created_at and expires_at in the past, satisfying ck_consent_request_expiry
    req_obj = db_session.get(ConsentRequest, uuid.UUID(request_id))
    req_obj.created_at = datetime.now(timezone.utc) - timedelta(days=8)
    req_obj.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    # Attempt to respond -> 409 Conflict
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={"action": "approve", "approved_scopes": ["diagnosis"]},
        headers=patient_headers,
    )
    assert resp.status_code == 409
    assert "expired" in resp.json()["detail"].lower()


# =====================================================================
# 9. SECURITY & SANITIZATION EDGE CASES
# =====================================================================

def test_doctor_message_xss_and_control_chars_rejected(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
):
    """Doctor message cannot contain XSS script markup or non-printable control characters."""
    # Attempt XSS markup
    res_xss = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
            "doctor_message": "<script>alert('xss')</script>",
        },
        headers=doctor_headers,
    )
    assert res_xss.status_code == 422
    assert "html or script markup" in res_xss.json()["detail"][0]["msg"].lower()

    # Attempt non-printable control characters (e.g. \x00, \x07)
    res_ctrl = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
            "doctor_message": "Invalid\x00Message\x07Body",
        },
        headers=doctor_headers,
    )
    assert res_ctrl.status_code == 422
    assert "control characters" in res_ctrl.json()["detail"][0]["msg"].lower()


def test_previously_revoked_consent_not_restored_on_approval(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """If patient had a previously revoked ConsentRecord with scopes [diagnosis, symptoms],
    approving a new request for [clinical_notes] creates a fresh ConsentRecord with ONLY
    [clinical_notes]. The revoked record remains revoked and its scopes are NOT restored.
    """
    # 1. Complete past appointment to populate records
    client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    # 2. Patient directly grants diagnosis + symptoms
    grant_res = client.post(
        "/api/v1/consents",
        json={
            "doctor_profile_id": str(approved_doctor["profile"].id),
            "data_scopes": ["diagnosis", "symptoms"],
        },
        headers=patient_headers,
    )
    assert grant_res.status_code == 201
    old_consent_id = uuid.UUID(grant_res.json()["id"])

    # 3. Patient revokes old consent
    revoke_res = client.patch(
        f"/api/v1/consents/{old_consent_id}/revoke",
        headers=patient_headers,
    )
    assert revoke_res.status_code == 200

    # 4. Doctor requests clinical_notes
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    request_id = req_res.json()["id"]

    # 5. Patient approves clinical_notes
    resp = client.patch(
        f"/api/v1/consents/requests/{request_id}/respond",
        json={"action": "approve", "approved_scopes": ["clinical_notes"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # 6. Verify old record is STILL revoked in DB
    db_session.expire_all()
    old_record = db_session.get(ConsentRecord, old_consent_id)
    assert old_record.is_active is False
    assert old_record.revoked_at is not None

    # 7. Verify new record contains ONLY clinical_notes
    new_record = db_session.get(ConsentRecord, uuid.UUID(data["consent_record_id"]))
    assert new_record.id != old_consent_id
    assert new_record.is_active is True
    assert new_record.data_scopes == ["clinical_notes"]

    # 8. Verify EHR access: clinical_notes works, diagnosis/symptoms are denied
    ehr_ok = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "clinical_notes")],
        headers=doctor_headers,
    )
    assert ehr_ok.status_code == 200

    ehr_denied = client.get(
        f"/api/v1/health-records/patient/{patient_account['profile'].id}",
        params=[("scopes", "diagnosis")],
        headers=doctor_headers,
    )
    assert ehr_denied.status_code == 403
    assert "Consent does not cover" in ehr_denied.json()["detail"]


def test_multiple_active_consents_defensive_merge(
    client,
    patient_headers,
    doctor_headers,
    booked_appointment,
    approved_doctor,
    patient_account,
    db_session,
):
    """If legacy data contains multiple active consent records for the same doctor/patient pair,
    responding to a request merges scopes across all active records into the primary WITHOUT
    mutating, deactivating, or stamping revoked_at on duplicate records.
    """
    now = datetime.now(timezone.utc)
    # Seed 2 active consent records (simulating legacy anvaya_db state)
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

    # Status check shouldn't crash with MultipleResultsFound
    status_res = client.get(
        f"/api/v1/consents/status/patient/{patient_account['profile'].id}",
        headers=doctor_headers,
    )
    assert status_res.status_code == 200
    assert set(status_res.json()["active_scopes"]) == {"diagnosis", "symptoms"}

    # Doctor requests clinical_notes
    req_res = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["clinical_notes"],
        },
        headers=doctor_headers,
    )
    assert req_res.status_code == 201
    req_id = req_res.json()["id"]

    # Patient approves
    resp = client.patch(
        f"/api/v1/consents/requests/{req_id}/respond",
        json={"action": "approve", "approved_scopes": ["clinical_notes"]},
        headers=patient_headers,
    )
    assert resp.status_code == 200

    # Verify that in DB:
    # 1. Discrete grant event created for newly approved scope ('clinical_notes')
    # 2. Both prior records remain active and completely UNTOUCHED (no scope mutation, no false revocation)
    # 3. Neither record has revoked_at set
    # 4. Total active records is now 3, and all scopes ('diagnosis', 'symptoms', 'clinical_notes') are accessible via union
    db_session.expire_all()
    active_records = db_session.scalars(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_account["profile"].id,
            ConsentRecord.doctor_profile_id == approved_doctor["profile"].id,
            ConsentRecord.is_active.is_(True),
        ).order_by(ConsentRecord.granted_at.desc())
    ).all()
    assert len(active_records) == 3
    for r in active_records:
        assert r.is_active is True
        assert r.revoked_at is None
    all_scopes = set().union(*(set(r.data_scopes) for r in active_records))
    assert all_scopes == {"clinical_notes", "diagnosis", "symptoms"}
    # Newest record has exactly the newly approved scope
    assert set(active_records[0].data_scopes) == {"clinical_notes"}
    # Both legacy prior records are completely untouched (zero scope contamination)
    assert set(active_records[1].data_scopes) == {"symptoms"}
    assert set(active_records[2].data_scopes) == {"diagnosis"}


def test_expired_request_does_not_block_new_request(
    client,
    doctor_headers,
    booked_appointment,
    patient_account,
    db_session,
):
    """An expired pending request does not block doctor from submitting a new request."""
    # 1. Doctor creates first request
    req1 = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis"],
        },
        headers=doctor_headers,
    )
    assert req1.status_code == 201
    req1_id = uuid.UUID(req1.json()["id"])

    # 2. Artificially expire req1 in DB
    req1_obj = db_session.get(ConsentRequest, req1_id)
    req1_obj.created_at = datetime.now(timezone.utc) - timedelta(days=8)
    req1_obj.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    # 3. Doctor submits a new request -> succeeds because req1 auto-transitions to expired
    req2 = client.post(
        "/api/v1/consents/requests",
        json={
            "patient_profile_id": str(patient_account["profile"].id),
            "requested_scopes": ["diagnosis", "symptoms"],
        },
        headers=doctor_headers,
    )
    assert req2.status_code == 201
    assert req2.json()["id"] != str(req1_id)
    assert req2.json()["status"] == "pending"

