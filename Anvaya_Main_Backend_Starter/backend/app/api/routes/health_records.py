
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db

from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User

from app.schemas.consent import HealthDataScope

from app.schemas.health_record import (
    HealthRecordListResponse,
    DoctorSharedHealthRecordRead,
    DoctorSharedHealthRecordListResponse,
)

from app.services.audit_service import add_audit_log


router = APIRouter(
    prefix="/health-records",
    tags=["Health Records"],
)


# =========================================================
# AUDIT HELPER - DOCTOR EHR ACCESS
# =========================================================

def _log_doctor_ehr_access(
    db: Session,
    *,
    actor_user_id: UUID,
    requested_patient_profile_id: UUID,
    doctor_profile_id: UUID | None,
    patient_profile_id: UUID | None,
    scopes: list[HealthDataScope],
    outcome: Literal["success", "denied"],
    reason: str,
    limit: int,
    offset: int,
    total_record_count: int | None = None,
    returned_record_count: int | None = None,
) -> None:
    """
    Record doctor access attempts for patient health records.

    Only access metadata is stored.
    Clinical values are never copied into audit details.

    The caller's session commits the audit entry so that
    denied attempts remain recorded before HTTPException.
    """

    details = {
        "reason": reason,
        "requested_scopes": list(scopes),
        "limit": limit,
        "offset": offset,
    }

    if total_record_count is not None:
        details["total_record_count"] = total_record_count

    if returned_record_count is not None:
        details["returned_record_count"] = returned_record_count

    add_audit_log(
        db,
        actor_user_id=actor_user_id,
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        event_type=(
            "ehr.records.accessed"
            if outcome == "success"
            else "ehr.records.access_denied"
        ),
        resource_type="patient_health_records",
        resource_id=requested_patient_profile_id,
        outcome=outcome,
        details=details,
    )

    # Commit the audit event independently of the HTTP response.
    db.commit()


# =========================================================
# 1. GET MY HEALTH RECORDS - PATIENT
# =========================================================

@router.get(
    "/me",
    response_model=HealthRecordListResponse,
)
def get_my_health_records(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> HealthRecordListResponse:

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

    patient_filter = (
        HealthRecord.patient_profile_id == patient_profile.id
    )

    total = db.scalar(
        select(func.count(HealthRecord.id)).where(patient_filter)
    ) or 0

    records = db.scalars(
        select(HealthRecord)
        .where(patient_filter)
        .order_by(
            HealthRecord.visit_date.desc(),
            HealthRecord.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    return HealthRecordListResponse(
        items=records,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 2. GET PATIENT HEALTH RECORDS - DOCTOR
# CONSENT-PROTECTED ACCESS + AUDIT LOGGING
# =========================================================

@router.get(
    "/patient/{patient_profile_id}",
    response_model=DoctorSharedHealthRecordListResponse,
)
def get_patient_health_records_for_doctor(
    patient_profile_id: UUID,

    scopes: list[HealthDataScope] = Query(
        ...,
        min_length=1,
        max_length=7,
        description="Health-information fields requested by the doctor.",
    ),

    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),

    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorSharedHealthRecordListResponse:

    # STEP 1: Find the authenticated doctor's profile.

    doctor_profile = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.user_id == current_user.id
        )
    )

    if doctor_profile is None:

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=None,
            patient_profile_id=None,
            scopes=scopes,
            outcome="denied",
            reason="doctor_profile_not_found",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=404,
            detail="Doctor profile not found.",
        )

    # STEP 2: Only approved doctors may access patient records.

    if doctor_profile.verification_status != "approved":

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=None,
            scopes=scopes,
            outcome="denied",
            reason="doctor_not_approved",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can access patient records.",
        )

    # STEP 3: Ensure the requested patient exists.

    patient_profile = db.scalar(
        select(PatientProfile).where(
            PatientProfile.id == patient_profile_id
        )
    )

    if patient_profile is None:

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=None,
            scopes=scopes,
            outcome="denied",
            reason="patient_profile_not_found",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=404,
            detail="Patient profile not found.",
        )

    # STEP 4: Reject duplicate requested scopes.

    if len(scopes) != len(set(scopes)):

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=patient_profile.id,
            scopes=scopes,
            outcome="denied",
            reason="duplicate_requested_scopes",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=422,
            detail="Duplicate health-information scopes are not allowed.",
        )

    # STEP 5: Find active consent for this exact
    # patient and authenticated doctor.
    #
    # Row locking prevents a concurrent revocation from
    # changing consent while the protected access is checked.

    consent = db.scalar(
        select(ConsentRecord)
        .where(
            ConsentRecord.patient_profile_id == patient_profile.id,
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.is_active.is_(True),
        )
        .with_for_update()
    )

    if consent is None:

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=patient_profile.id,
            scopes=scopes,
            outcome="denied",
            reason="active_consent_missing",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=403,
            detail="Active patient consent is required.",
        )

    # STEP 6: Verify that consent covers every
    # requested health-information field.

    permitted_scopes = set(consent.data_scopes)
    requested_scopes = set(scopes)

    if not requested_scopes.issubset(permitted_scopes):

        _log_doctor_ehr_access(
            db,
            actor_user_id=current_user.id,
            requested_patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=patient_profile.id,
            scopes=scopes,
            outcome="denied",
            reason="requested_scopes_not_covered",
            limit=limit,
            offset=offset,
        )

        raise HTTPException(
            status_code=403,
            detail="Consent does not cover all requested information.",
        )

    # STEP 7: Fetch only this patient's health records.

    patient_filter = (
        HealthRecord.patient_profile_id == patient_profile.id
    )

    total = db.scalar(
        select(func.count(HealthRecord.id)).where(patient_filter)
    ) or 0

    records = db.scalars(
        select(HealthRecord)
        .where(patient_filter)
        .order_by(
            HealthRecord.visit_date.desc(),
            HealthRecord.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    # STEP 8: Return only the fields explicitly
    # authorized by the patient's consent.

    items = []

    for record in records:

        authorized_data = {
            scope: getattr(record, scope)
            for scope in scopes
        }

        items.append(
            DoctorSharedHealthRecordRead(
                record_id=record.id,
                visit_date=record.visit_date,
                data=authorized_data,
            )
        )

    # STEP 9: Record successful EHR access.
    # No diagnosis, symptoms or clinical notes are logged.

    _log_doctor_ehr_access(
        db,
        actor_user_id=current_user.id,
        requested_patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=patient_profile.id,
        scopes=scopes,
        outcome="success",
        reason="consent_verified",
        limit=limit,
        offset=offset,
        total_record_count=total,
        returned_record_count=len(records),
    )

    return DoctorSharedHealthRecordListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        requested_scopes=scopes,
    )
