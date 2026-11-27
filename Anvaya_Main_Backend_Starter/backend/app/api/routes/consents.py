
from uuid import UUID
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles, verify_csrf_and_origin
from app.db.session import get_db
from app.services.audit_service import add_audit_log
from app.services.notification_service import (
    notify_consent_requested,
    notify_consent_response,
)

from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.consent_request import ConsentRequest
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User

from app.schemas.consent import (
    ConsentGrantRequest,
    ConsentRead,
    ConsentListResponse,
)
from app.schemas.consent_request import (
    ConsentRequestCreate,
    ConsentRequestRespond,
    ConsentRequestRead,
    ConsentRequestListResponse,
    DoctorPatientConsentStatus,
)


def _to_utc(dt: datetime) -> datetime:
    """Ensures a datetime is timezone-aware in UTC across SQLite and PostgreSQL engines."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_request_read(
    db: Session,
    request: ConsentRequest,
) -> ConsentRequestRead:
    doctor_profile = db.get(DoctorProfile, request.doctor_profile_id)
    doctor_user = db.get(User, doctor_profile.user_id) if doctor_profile else None

    patient_profile = db.get(PatientProfile, request.patient_profile_id)
    patient_user = db.get(User, patient_profile.user_id) if patient_profile else None

    return ConsentRequestRead(
        id=request.id,
        doctor_profile_id=request.doctor_profile_id,
        patient_profile_id=request.patient_profile_id,
        requested_scopes=list(request.requested_scopes),
        approved_scopes=list(request.approved_scopes) if request.approved_scopes is not None else None,
        doctor_message=request.doctor_message,
        status=request.status,
        created_at=request.created_at,
        expires_at=request.expires_at,
        resolved_at=request.resolved_at,
        consent_record_id=request.consent_record_id,
        doctor_name=doctor_user.full_name if doctor_user else None,
        doctor_specialization=doctor_profile.specialization if doctor_profile else None,
        clinic_name=doctor_profile.clinic_name if doctor_profile else None,
        patient_name=patient_user.full_name if patient_user else None,
    )


router = APIRouter(
    prefix="/consents",
    tags=["Patient Consent"],
)


# =========================================================
# 1. GRANT CONSENT - PATIENT
# =========================================================

@router.post(
    "",
    response_model=ConsentRead,
    status_code=status.HTTP_201_CREATED,
)
def grant_consent(
    payload: ConsentGrantRequest,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> ConsentRead:

    # Find and lock the authenticated patient's profile.

    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.user_id == current_user.id)
        .with_for_update()
    )

    if patient_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found.",
        )

    # Only active, approved doctor accounts are eligible.

    doctor_profile = db.scalar(
        select(DoctorProfile)
        .join(User, User.id == DoctorProfile.user_id)
        .where(
            DoctorProfile.id == payload.doctor_profile_id,
            User.role == "doctor",
            User.is_active.is_(True),
            DoctorProfile.verification_status == "approved",
        )
        .with_for_update(of=DoctorProfile)
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Approved doctor not found.",
        )

    # Prevent multiple active consent records
    # for the same patient-doctor pair.

    existing_consent = db.scalar(
        select(ConsentRecord)
        .where(
            ConsentRecord.patient_profile_id == patient_profile.id,
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.is_active.is_(True),
        )
        .with_for_update()
    )

    if existing_consent is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Active consent already exists for this doctor. "
                "Revoke it before creating new consent."
            ),
        )

    consent = ConsentRecord(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=list(payload.data_scopes),
        is_active=True,
    )

    try:
        db.add(consent)

        # Insert consent and generate its UUID.
        db.flush()

        # Create audit event for successful consent grant.
        # Consent and audit event share the same transaction.

        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=patient_profile.id,
            doctor_profile_id=doctor_profile.id,
            event_type="consent.granted",
            resource_type="consent",
            resource_id=consent.id,
            outcome="success",
            details={
                "scopes": list(payload.data_scopes),
                "scope_count": len(payload.data_scopes),
            },
        )

        db.commit()
        db.refresh(consent)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Consent could not be created.",
        )

    return consent


# =========================================================
# 2. GET MY CONSENT HISTORY - PATIENT
# =========================================================

@router.get(
    "/me",
    response_model=ConsentListResponse,
)
def get_my_consents(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> ConsentListResponse:

    patient_profile = db.scalar(
        select(PatientProfile).where(
            PatientProfile.user_id == current_user.id
        )
    )

    if patient_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found.",
        )

    consent_filter = (
        ConsentRecord.patient_profile_id == patient_profile.id
    )

    total = db.scalar(
        select(func.count(ConsentRecord.id)).where(consent_filter)
    ) or 0

    consents = db.scalars(
        select(ConsentRecord)
        .where(consent_filter)
        .order_by(
            ConsentRecord.granted_at.desc(),
            ConsentRecord.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    return ConsentListResponse(
        items=consents,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 3. REVOKE CONSENT - PATIENT
# =========================================================

@router.patch(
    "/{consent_id}/revoke",
    response_model=ConsentRead,
)
def revoke_consent(
    consent_id: UUID,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> ConsentRead:

    # Find and lock the authenticated patient's profile.

    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.user_id == current_user.id)
        .with_for_update()
    )

    if patient_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found.",
        )

    # Fetch only the consent record belonging to this patient.

    consent = db.scalar(
        select(ConsentRecord)
        .where(
            ConsentRecord.id == consent_id,
            ConsentRecord.patient_profile_id == patient_profile.id,
        )
        .with_for_update()
    )

    if consent is None:
        raise HTTPException(
            status_code=404,
            detail="Consent record not found.",
        )

    if not consent.is_active:
        raise HTTPException(
            status_code=409,
            detail="Consent has already been revoked.",
        )

    # Revoke consent.

    consent.is_active = False
    consent.revoked_at = datetime.now(timezone.utc)

    try:
        # Create audit event for successful consent revocation.
        # Both changes are committed in the same transaction.

        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=patient_profile.id,
            doctor_profile_id=consent.doctor_profile_id,
            event_type="consent.revoked",
            resource_type="consent",
            resource_id=consent.id,
            outcome="success",
            details={
                "scopes": list(consent.data_scopes),
                "scope_count": len(consent.data_scopes),
            },
        )

        db.commit()
        db.refresh(consent)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Consent revocation could not be completed.",
        )

    return consent


# =========================================================
# 3b. REVOKE ALL CONSENTS FOR DOCTOR - PATIENT
# =========================================================

@router.patch(
    "/doctor/{doctor_profile_id}/revoke-all",
    response_model=ConsentListResponse,
)
def revoke_all_consents_for_doctor(
    doctor_profile_id: UUID,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> ConsentListResponse:
    """Atomically revoke all active consent records between the authenticated patient and a specific doctor."""
    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.user_id == current_user.id)
        .with_for_update()
    )
    if patient_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Patient profile not found.",
        )

    active_consents = db.scalars(
        select(ConsentRecord)
        .where(
            ConsentRecord.patient_profile_id == patient_profile.id,
            ConsentRecord.doctor_profile_id == doctor_profile_id,
            ConsentRecord.is_active.is_(True),
        )
        .order_by(ConsentRecord.id)
        .with_for_update()
    ).all()

    if not active_consents:
        raise HTTPException(
            status_code=404,
            detail="No active consent records found for this doctor.",
        )

    now_utc = datetime.now(timezone.utc)
    for consent in active_consents:
        consent.is_active = False
        consent.revoked_at = now_utc
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=patient_profile.id,
            doctor_profile_id=doctor_profile_id,
            event_type="consent.revoked",
            resource_type="consent",
            resource_id=consent.id,
            outcome="success",
            details={
                "scopes": list(consent.data_scopes),
                "scope_count": len(consent.data_scopes),
                "reason": "revoke_all_for_doctor",
            },
        )

    db.commit()
    for consent in active_consents:
        db.refresh(consent)

    return ConsentListResponse(
        items=active_consents,
        total=len(active_consents),
        limit=len(active_consents),
        offset=0,
    )


# =========================================================
# 4. GET DOCTOR-PATIENT CONSENT STATUS - DOCTOR
# =========================================================

@router.get(
    "/status/patient/{patient_profile_id}",
    response_model=DoctorPatientConsentStatus,
    tags=["Doctor Consent Request"],
)
def get_doctor_patient_consent_status(
    patient_profile_id: UUID,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorPatientConsentStatus:
    """Lookup active consent status and pending requests between the authenticated doctor and a patient."""
    doctor_profile = db.scalar(
        select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
    )
    if doctor_profile is None:
        raise HTTPException(status_code=404, detail="Doctor profile not found.")

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can view patient consent status.",
        )

    patient_profile = db.get(PatientProfile, patient_profile_id)
    if patient_profile is None:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    # Check for established appointment relationship (booked or completed)
    has_relationship = (
        db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.doctor_profile_id == doctor_profile.id,
                Appointment.patient_profile_id == patient_profile_id,
                Appointment.status.in_(["booked", "completed"]),
            )
        )
        or 0
    ) > 0

    # Query active consent (handling potential multiple active records defensively)
    active_consents = db.scalars(
        select(ConsentRecord).where(
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.patient_profile_id == patient_profile_id,
            ConsentRecord.is_active.is_(True),
        ).order_by(ConsentRecord.granted_at.desc())
    ).all()

    active_consent = active_consents[0] if active_consents else None
    active_scopes = (
        sorted(list(set().union(*(set(c.data_scopes) for c in active_consents))))
        if active_consents
        else []
    )

    # Query pending request
    pending_request = db.scalar(
        select(ConsentRequest).where(
            ConsentRequest.doctor_profile_id == doctor_profile.id,
            ConsentRequest.patient_profile_id == patient_profile_id,
            ConsentRequest.status == "pending",
        )
    )

    now_utc = datetime.now(timezone.utc)
    if pending_request and _to_utc(pending_request.expires_at) <= now_utc:
        pending_request.status = "expired"
        pending_request.resolved_at = now_utc
        db.commit()
        db.refresh(pending_request)
        pending_request = None

    all_possible_scopes = {
        "visit_summary",
        "chief_complaint",
        "symptoms",
        "diagnosis",
        "clinical_notes",
        "treatment_plan",
        "follow_up_instructions",
    }
    has_all_scopes = (
        set(active_scopes) == all_possible_scopes
        if active_scopes
        else False
    )

    can_request = (
        has_relationship
        and (pending_request is None)
        and (not has_all_scopes)
    )

    return DoctorPatientConsentStatus(
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=patient_profile_id,
        has_active_consent=bool(active_consent),
        active_consent_id=active_consent.id if active_consent else None,
        active_scopes=active_scopes,
        pending_request=_build_request_read(db, pending_request) if pending_request else None,
        can_request_consent=can_request,
        relationship_established=has_relationship,
    )


# =========================================================
# 5. CREATE CONSENT REQUEST - DOCTOR
# =========================================================

@router.post(
    "/requests",
    response_model=ConsentRequestRead,
    status_code=status.HTTP_201_CREATED,
    tags=["Doctor Consent Request"],
)
def create_consent_request(
    payload: ConsentRequestCreate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> ConsentRequestRead:
    """Doctor creates an explicit request for patient EHR data access."""
    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    doctor_profile = db.scalar(
        select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
    )
    if doctor_profile is None:
        raise HTTPException(status_code=404, detail="Doctor profile not found.")

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can request patient consent.",
        )

    # Lock patient profile for consistent lock ordering across consent workflows
    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.id == payload.patient_profile_id)
        .with_for_update()
    )
    if patient_profile is None:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    # 1. Validate legitimate doctor-patient appointment relationship
    has_relationship = (
        db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.doctor_profile_id == doctor_profile.id,
                Appointment.patient_profile_id == payload.patient_profile_id,
                Appointment.status.in_(["booked", "completed"]),
            )
        )
        or 0
    ) > 0

    if not has_relationship:
        raise HTTPException(
            status_code=403,
            detail="Consent can only be requested for patients with whom you have an established appointment relationship (booked or completed).",
        )

    # 2. Check for existing pending request FIRST to maintain consistent lock ordering:
    # Lock Order: PatientProfile -> ConsentRequest -> ConsentRecord
    existing_request = db.scalar(
        select(ConsentRequest)
        .where(
            ConsentRequest.doctor_profile_id == doctor_profile.id,
            ConsentRequest.patient_profile_id == payload.patient_profile_id,
            ConsentRequest.status == "pending",
        )
        .with_for_update()
    )
    now_utc = datetime.now(timezone.utc)
    if existing_request:
        if _to_utc(existing_request.expires_at) <= now_utc:
            existing_request.status = "expired"
            existing_request.resolved_at = now_utc
            db.flush()
        else:
            raise HTTPException(
                status_code=409,
                detail="A pending consent request already exists for this patient. Please wait for their response or expiration.",
            )

    # 3. Check active consent: does patient ALREADY grant all requested scopes?
    # Uses .scalars().all() to handle potential legacy duplicate records gracefully
    active_consents = db.scalars(
        select(ConsentRecord)
        .where(
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.patient_profile_id == payload.patient_profile_id,
            ConsentRecord.is_active.is_(True),
        )
        .with_for_update()
    ).all()
    if active_consents:
        all_active_scopes = set().union(*(set(c.data_scopes) for c in active_consents))
        requested_scopes = set(payload.requested_scopes)
        if requested_scopes.issubset(all_active_scopes):
            raise HTTPException(
                status_code=409,
                detail="Active consent covering all requested scopes already exists for this patient.",
            )

    # Expiry: 7 days default
    expires_at = now_utc + timedelta(days=7)

    consent_request = ConsentRequest(
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=payload.patient_profile_id,
        requested_scopes=list(payload.requested_scopes),
        approved_scopes=None,
        doctor_message=payload.doctor_message.strip() if payload.doctor_message else None,
        status="pending",
        consent_record_id=None,
        created_at=now_utc,
        expires_at=expires_at,
        resolved_at=None,
        resolution_idempotency_key=None,
    )

    try:
        db.add(consent_request)
        db.flush()

        # Send notification to patient
        patient_user = db.get(User, patient_profile.user_id)
        if patient_user:
            notify_consent_requested(
                db,
                request_id=consent_request.id,
                patient_user_id=patient_user.id,
                doctor_name=current_user.full_name,
            )

        # Audit log event: metadata only, zero clinical free text
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=payload.patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            event_type="consent.request_created",
            resource_type="consent_request",
            resource_id=consent_request.id,
            outcome="success",
            details={
                "requested_scopes": list(payload.requested_scopes),
                "scope_count": len(payload.requested_scopes),
                "expires_at": expires_at.isoformat(),
            },
        )

        db.commit()
        db.refresh(consent_request)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A pending consent request already exists for this patient.",
        )

    return _build_request_read(db, consent_request)


# =========================================================
# 6. LIST PENDING CONSENT REQUESTS - PATIENT
# =========================================================

@router.get(
    "/requests/pending",
    response_model=ConsentRequestListResponse,
    tags=["Patient Consent Request"],
)
def get_my_pending_consent_requests(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> ConsentRequestListResponse:
    """Patient retrieves their active pending consent requests."""
    patient_profile = db.scalar(
        select(PatientProfile).where(PatientProfile.user_id == current_user.id)
    )
    if patient_profile is None:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    now_utc = datetime.now(timezone.utc)

    # Auto-expire stale pending requests
    pending_records = db.scalars(
        select(ConsentRequest).where(
            ConsentRequest.patient_profile_id == patient_profile.id,
            ConsentRequest.status == "pending",
        )
    ).all()

    has_stale = False
    for req in pending_records:
        if _to_utc(req.expires_at) <= now_utc:
            req.status = "expired"
            req.resolved_at = now_utc
            has_stale = True

    if has_stale:
        db.commit()

    query = (
        select(ConsentRequest)
        .where(
            ConsentRequest.patient_profile_id == patient_profile.id,
            ConsentRequest.status == "pending",
        )
        .order_by(ConsentRequest.created_at.desc())
    )

    total = (
        db.scalar(
            select(func.count(ConsentRequest.id)).where(
                ConsentRequest.patient_profile_id == patient_profile.id,
                ConsentRequest.status == "pending",
            )
        )
        or 0
    )

    items = db.scalars(query.limit(limit).offset(offset)).all()

    return ConsentRequestListResponse(
        items=[_build_request_read(db, item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 7. GET CONSENT REQUEST DETAILS - SHARED (DOCTOR OR PATIENT)
# =========================================================

@router.get(
    "/requests/{request_id}",
    response_model=ConsentRequestRead,
    tags=["Consent Request"],
)
def get_consent_request_by_id(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConsentRequestRead:
    """Retrieve details of a specific consent request (accessible only by the involved patient or doctor)."""
    request = db.get(ConsentRequest, request_id)
    if request is None:
        raise HTTPException(status_code=404, detail="Consent request not found.")

    is_authorized = False
    if current_user.role == "patient":
        patient_profile = db.scalar(
            select(PatientProfile).where(PatientProfile.user_id == current_user.id)
        )
        if patient_profile and request.patient_profile_id == patient_profile.id:
            is_authorized = True
    elif current_user.role == "doctor":
        doctor_profile = db.scalar(
            select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
        )
        if doctor_profile and request.doctor_profile_id == doctor_profile.id:
            is_authorized = True

    if not is_authorized:
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to view this consent request.",
        )

    now_utc = datetime.now(timezone.utc)
    if request.status == "pending" and _to_utc(request.expires_at) <= now_utc:
        request.status = "expired"
        request.resolved_at = now_utc
        db.commit()
        db.refresh(request)

    return _build_request_read(db, request)


# =========================================================
# 8. RESPOND TO CONSENT REQUEST - PATIENT
# =========================================================

@router.patch(
    "/requests/{request_id}/respond",
    response_model=ConsentRequestRead,
    tags=["Patient Consent Request"],
)
def respond_to_consent_request(
    request_id: UUID,
    payload: ConsentRequestRespond,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> ConsentRequestRead:
    """Patient explicitly approves, partially approves, or declines a consent request."""
    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    # 1. Lock patient profile
    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.user_id == current_user.id)
        .with_for_update()
    )
    if patient_profile is None:
        raise HTTPException(status_code=404, detail="Patient profile not found.")

    # 2. Lock consent request
    consent_request = db.scalar(
        select(ConsentRequest)
        .where(
            ConsentRequest.id == request_id,
            ConsentRequest.patient_profile_id == patient_profile.id,
        )
        .with_for_update()
    )
    if consent_request is None:
        raise HTTPException(status_code=404, detail="Consent request not found.")

    # 3. Idempotent replay check
    if (
        effective_idempotency_key
        and consent_request.resolution_idempotency_key == effective_idempotency_key
    ):
        return _build_request_read(db, consent_request)

    now_utc = datetime.now(timezone.utc)

    # 4. Check status
    if consent_request.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"This consent request is no longer pending (current status: {consent_request.status}).",
        )

    # 5. Check expiration
    if _to_utc(consent_request.expires_at) <= now_utc:
        consent_request.status = "expired"
        consent_request.resolved_at = now_utc
        db.commit()
        raise HTTPException(
            status_code=409,
            detail="This consent request has expired and can no longer be accepted or declined.",
        )

    doctor_profile = db.get(DoctorProfile, consent_request.doctor_profile_id)
    doctor_user_id = doctor_profile.user_id if doctor_profile else None

    if payload.action == "approve":
        # 6. Validate approved_scopes
        if not payload.approved_scopes or len(payload.approved_scopes) == 0:
            raise HTTPException(
                status_code=422,
                detail="At least one data scope must be selected when approving a consent request.",
            )

        requested_set = set(consent_request.requested_scopes)
        approved_set = set(payload.approved_scopes)

        # STRICT SUBSET ENFORCEMENT: approved scopes must be a subset of requested scopes
        if not approved_set.issubset(requested_set):
            raise HTTPException(
                status_code=422,
                detail="Approved scopes must be a subset of requested scopes.",
            )

        is_partial = approved_set != requested_set
        target_status = "partially_approved" if is_partial else "approved"

        # 7. Create discrete active ConsentRecord for this explicit authorization event
        # CRITICAL REAUTHORIZATION & AUDIT INTEGRITY:
        # Every consent request approval represents an independent, immutable authorization event.
        # We do NOT mutate prior active records or merge foreign scopes into them.
        # This guarantees:
        # 1. No historical timestamp distortion (granted_at strictly reflects approval time).
        # 2. Revoking an older grant reliably revokes its distinct scopes without phantom retention.
        # 3. Prior active records remain completely untouched and immutable.
        new_consent = ConsentRecord(
            patient_profile_id=patient_profile.id,
            doctor_profile_id=consent_request.doctor_profile_id,
            data_scopes=sorted(list(approved_set)),
            is_active=True,
            granted_at=now_utc,
            revoked_at=None,
        )
        db.add(new_consent)
        db.flush()
        target_consent_record_id = new_consent.id

        # 8. Update ConsentRequest
        consent_request.status = target_status
        consent_request.approved_scopes = sorted(list(approved_set))
        consent_request.consent_record_id = target_consent_record_id
        consent_request.resolved_at = now_utc
        consent_request.resolution_idempotency_key = effective_idempotency_key

        # 9. Invalidate any other pending requests from this doctor for this patient
        other_pending = db.scalars(
            select(ConsentRequest).where(
                ConsentRequest.patient_profile_id == patient_profile.id,
                ConsentRequest.doctor_profile_id == consent_request.doctor_profile_id,
                ConsentRequest.id != consent_request.id,
                ConsentRequest.status == "pending",
            )
        ).all()
        for other in other_pending:
            other.status = "superseded"
            other.resolved_at = now_utc

        # 10. Notification to doctor
        if doctor_user_id:
            notify_consent_response(
                db,
                request_id=consent_request.id,
                action="approve",
                doctor_user_id=doctor_user_id,
                patient_name=current_user.full_name,
                is_partial=is_partial,
            )

        # 11. Audit log
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=patient_profile.id,
            doctor_profile_id=consent_request.doctor_profile_id,
            event_type=(
                "consent.request_partially_approved"
                if is_partial
                else "consent.request_approved"
            ),
            resource_type="consent_request",
            resource_id=consent_request.id,
            outcome="success",
            details={
                "approved_scopes": sorted(list(approved_set)),
                "is_partial": is_partial,
                "consent_record_id": str(target_consent_record_id),
            },
        )

        db.commit()
        db.refresh(consent_request)

    else:
        # Patient declined
        consent_request.status = "declined"
        consent_request.approved_scopes = None
        consent_request.resolved_at = now_utc
        consent_request.resolution_idempotency_key = effective_idempotency_key

        # Notification to doctor
        if doctor_user_id:
            notify_consent_response(
                db,
                request_id=consent_request.id,
                action="decline",
                doctor_user_id=doctor_user_id,
                patient_name=current_user.full_name,
            )

        # Audit log
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=patient_profile.id,
            doctor_profile_id=consent_request.doctor_profile_id,
            event_type="consent.request_declined",
            resource_type="consent_request",
            resource_id=consent_request.id,
            outcome="success",
            details={
                "doctor_profile_id": str(consent_request.doctor_profile_id),
                "patient_profile_id": str(patient_profile.id),
            },
        )

        db.commit()
        db.refresh(consent_request)

    return _build_request_read(db, consent_request)
