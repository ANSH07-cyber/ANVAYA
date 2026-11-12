from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db

from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User

from app.schemas.consent import (
    ConsentGrantRequest,
    ConsentRead,
    ConsentListResponse,
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

    # Do not allow multiple active consent records
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
) -> ConsentRead:

    # Import UUID inside this module if not already imported.
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

    consent.is_active = False
    consent.revoked_at = datetime.now(timezone.utc)

    try:
        db.commit()
        db.refresh(consent)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Consent revocation could not be completed.",
        )

    return consent
