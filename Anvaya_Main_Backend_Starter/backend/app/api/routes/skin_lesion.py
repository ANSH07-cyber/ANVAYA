from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.config import settings
from app.core.rate_limit import RateLimiter
from app.db.session import get_db
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.skin_lesion_analysis import SkinLesionAnalysis
from app.models.user import User
from app.schemas.skin_lesion import (
    SkinLesionAnalyzeResponse,
    SkinLesionClassesResponse,
    SkinLesionListResponse,
    SkinLesionReviewRequest,
)
from app.services.audit_service import record_audit_log
from app.services.skin_lesion_service import (
    CLASS_DISPLAY_NAMES,
    EXPECTED_CLASS_NAMES,
    MANDATORY_DISCLAIMER,
    MAX_UPLOAD_BYTES,
    get_skin_lesion_service,
)

router = APIRouter(prefix="/ai/skin-lesion", tags=["AI Skin Lesion"])


@router.get("/classes", response_model=SkinLesionClassesResponse)
def get_supported_classes() -> SkinLesionClassesResponse:
    """Return model classes, display names, and clinical disclaimer."""
    service = get_skin_lesion_service()
    return SkinLesionClassesResponse(
        model_version=service.model_version,
        classes=[
            {"code": code, "display_name": CLASS_DISPLAY_NAMES.get(code, code)}
            for code in EXPECTED_CLASS_NAMES
        ],
        supported_languages=["en", "hi"],
        disclaimer=MANDATORY_DISCLAIMER,
    )


@router.post(
    "/analyze",
    response_model=SkinLesionAnalyzeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RateLimiter(times=20, seconds=60, prefix="ai_skin_lesion"))],
)
async def analyze_skin_lesion(
    file: UploadFile = File(..., description="Upload a JPEG or PNG dermoscopic image."),
    language: str = Query("en", pattern="^(en|hi)$", description="Patient education language (en or hi)."),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> SkinLesionAnalyzeResponse:
    """
    Patient-only endpoint to analyze a skin lesion image using the AI model.
    Enforces image format and dimension validation, records the analysis,
    and logs an audit trail event.
    """
    # 1. Retrieve the patient profile
    patient_profile = db.scalar(
        select(PatientProfile).where(PatientProfile.user_id == current_user.id)
    )
    if not patient_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient profile not found. Please complete your profile first.",
        )

    # 2. Read and validate raw content
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception as ex:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not read uploaded file: {ex}",
        )

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty.",
        )

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    service = get_skin_lesion_service()
    try:
        validated_image = service.validate_image_bytes(content)
    except ValueError as ve:
        msg = str(ve)
        if "Unsupported image format" in msg:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=msg)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    # 3. Save uploaded image to disk if upload dir is configured
    upload_dir = Path(settings.skin_lesion_upload_dir)
    if not upload_dir.is_absolute():
        backend_root = Path(__file__).resolve().parents[2]
        upload_dir = backend_root / upload_dir

    saved_path_str: str | None = None
    original_filename = file.filename or f"lesion_{uuid.uuid4().hex[:8]}.jpg"
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
        unique_filename = f"{uuid.uuid4().hex}_{original_filename.replace(' ', '_')}"
        destination = upload_dir / unique_filename
        with open(destination, "wb") as f_out:
            f_out.write(content)
        saved_path_str = str(destination)
    except Exception:
        # File storage failure should not block clinical inference
        saved_path_str = None

    # 4. Run AI inference
    result = service.predict(validated_image, language=language)

    # 5. Persist record in database
    analysis_record = SkinLesionAnalysis(
        patient_profile_id=patient_profile.id,
        image_path=saved_path_str,
        image_filename=original_filename,
        predicted_class=result["predicted_class"],
        predicted_label=result["predicted_label"],
        confidence=result["confidence"],
        probabilities=result["probabilities"],
        risk_level=result["risk_level"],
        disclaimer=result["disclaimer"],
        education_title=result.get("education_title"),
        education_summary=result.get("education_summary"),
    )
    db.add(analysis_record)
    db.commit()
    db.refresh(analysis_record)

    # 6. Forensic audit trail
    record_audit_log(
        db,
        actor_user_id=current_user.id,
        event_type="ai.skin_lesion.analyzed",
        resource_type="skin_lesion_analysis",
        resource_id=analysis_record.id,
        patient_profile_id=patient_profile.id,
        outcome="success",
        details={
            "predicted_class": analysis_record.predicted_class,
            "risk_level": analysis_record.risk_level,
            "confidence": analysis_record.confidence,
            "inference_mode": result.get("inference_mode"),
        },
    )

    response_data = SkinLesionAnalyzeResponse.model_validate(analysis_record)
    response_data.education_content = result.get("education_content")
    response_data.inference_mode = result.get("inference_mode")
    return response_data


@router.get("/me", response_model=SkinLesionListResponse)
def get_my_skin_lesion_analyses(
    page: int = Query(1, ge=1, description="Page number."),
    page_size: int = Query(20, ge=1, le=100, description="Items per page."),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> SkinLesionListResponse:
    """Retrieve history of skin lesion analyses for the authenticated patient."""
    patient_profile = db.scalar(
        select(PatientProfile).where(PatientProfile.user_id == current_user.id)
    )
    if not patient_profile:
        return SkinLesionListResponse(items=[], total=0)

    total = db.scalar(
        select(func.count(SkinLesionAnalysis.id)).where(
            SkinLesionAnalysis.patient_profile_id == patient_profile.id
        )
    ) or 0

    offset = (page - 1) * page_size
    records = db.scalars(
        select(SkinLesionAnalysis)
        .where(SkinLesionAnalysis.patient_profile_id == patient_profile.id)
        .order_by(desc(SkinLesionAnalysis.created_at))
        .offset(offset)
        .limit(page_size)
    ).all()

    service = get_skin_lesion_service()
    items = []
    for rec in records:
        item = SkinLesionAnalyzeResponse.model_validate(rec)
        item.education_content = service.get_education_content(rec.predicted_class, "en")
        item.inference_mode = service.inference_mode
        items.append(item)

    return SkinLesionListResponse(items=items, total=total)


@router.get("/patient/{patient_profile_id}", response_model=SkinLesionListResponse)
def get_patient_skin_lesion_analyses_for_doctor(
    patient_profile_id: UUID,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> SkinLesionListResponse:
    """
    Doctor-only endpoint to access a patient's skin lesion analyses.
    Strictly fail-closed: requires doctor verification AND active patient consent.
    """
    doctor_profile = db.scalar(
        select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
    )
    if not doctor_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if doctor_profile.verification_status != "approved":
        record_audit_log(
            db,
            actor_user_id=current_user.id,
            event_type="ai.skin_lesion.access_denied",
            resource_type="patient_profile",
            resource_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=patient_profile_id,
            outcome="denied",
            details={"reason": "doctor_not_approved"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors may access patient diagnostic records.",
        )

    # Verify patient exists
    patient_profile = db.get(PatientProfile, patient_profile_id)
    if not patient_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient profile not found.",
        )

    # Consent check: Doctor must have an active consent record
    active_consent = db.scalar(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == patient_profile_id,
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.is_active.is_(True),
        )
    )

    if not active_consent:
        record_audit_log(
            db,
            actor_user_id=current_user.id,
            event_type="ai.skin_lesion.access_denied",
            resource_type="patient_profile",
            resource_id=patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=patient_profile_id,
            outcome="denied",
            details={"reason": "active_consent_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active patient consent is required to access skin lesion analyses.",
        )

    # Retrieve patient's analyses
    records = db.scalars(
        select(SkinLesionAnalysis)
        .where(SkinLesionAnalysis.patient_profile_id == patient_profile_id)
        .order_by(desc(SkinLesionAnalysis.created_at))
    ).all()

    record_audit_log(
        db,
        actor_user_id=current_user.id,
        event_type="ai.skin_lesion.accessed",
        resource_type="patient_profile",
        resource_id=patient_profile_id,
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=patient_profile_id,
        outcome="success",
        details={"record_count": len(records)},
    )

    service = get_skin_lesion_service()
    items = []
    for rec in records:
        item = SkinLesionAnalyzeResponse.model_validate(rec)
        item.education_content = service.get_education_content(rec.predicted_class, "en")
        item.inference_mode = service.inference_mode
        items.append(item)

    return SkinLesionListResponse(items=items, total=len(items))


@router.patch("/{analysis_id}/review", response_model=SkinLesionAnalyzeResponse)
def review_skin_lesion_analysis(
    analysis_id: UUID,
    payload: SkinLesionReviewRequest,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> SkinLesionAnalyzeResponse:
    """
    Doctor-only endpoint to submit clinical review notes on a skin lesion analysis.
    Strictly fail-closed: requires active patient consent.
    """
    doctor_profile = db.scalar(
        select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
    )
    if not doctor_profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors may review patient diagnostic records.",
        )

    analysis_record = db.get(SkinLesionAnalysis, analysis_id)
    if not analysis_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skin lesion analysis record not found.",
        )

    # Verify active consent between the doctor and the patient
    active_consent = db.scalar(
        select(ConsentRecord).where(
            ConsentRecord.patient_profile_id == analysis_record.patient_profile_id,
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.is_active.is_(True),
        )
    )

    if not active_consent:
        record_audit_log(
            db,
            actor_user_id=current_user.id,
            event_type="ai.skin_lesion.review_denied",
            resource_type="skin_lesion_analysis",
            resource_id=analysis_id,
            doctor_profile_id=doctor_profile.id,
            patient_profile_id=analysis_record.patient_profile_id,
            outcome="denied",
            details={"reason": "active_consent_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active patient consent is required to review skin lesion analysis.",
        )

    # Update clinical review
    analysis_record.reviewed_by_doctor_id = doctor_profile.id
    analysis_record.doctor_notes = payload.doctor_notes.strip()
    analysis_record.reviewed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(analysis_record)

    record_audit_log(
        db,
        actor_user_id=current_user.id,
        event_type="ai.skin_lesion.reviewed",
        resource_type="skin_lesion_analysis",
        resource_id=analysis_id,
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=analysis_record.patient_profile_id,
        outcome="success",
        details={"notes_length": len(analysis_record.doctor_notes)},
    )

    service = get_skin_lesion_service()
    resp = SkinLesionAnalyzeResponse.model_validate(analysis_record)
    resp.education_content = service.get_education_content(analysis_record.predicted_class, "en")
    resp.inference_mode = service.inference_mode
    return resp
