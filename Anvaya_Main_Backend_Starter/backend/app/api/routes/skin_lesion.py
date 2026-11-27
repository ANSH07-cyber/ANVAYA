from __future__ import annotations

import logging
from typing import Any
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
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
from PIL import Image
from sqlalchemy import desc, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import require_roles, verify_csrf_and_origin
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
from app.services.audit_service import add_audit_log, record_audit_log
from app.services.skin_lesion_service import (
    CLASS_DISPLAY_NAMES,
    EXPECTED_CLASS_NAMES,
    MANDATORY_DISCLAIMER,
    MAX_UPLOAD_BYTES,
    InvalidImageError,
    ModelUnavailableError,
    TRAINED_INFERENCE_MODE,
    UnsupportedImageError,
    get_skin_lesion_service,
)

router = APIRouter(prefix="/ai/skin-lesion", tags=["AI Skin Lesion"])
logger = logging.getLogger(__name__)


def _analysis_response(analysis: SkinLesionAnalysis, education_content: dict[str, Any] | None = None) -> SkinLesionAnalyzeResponse:
    verified = (
        analysis.inference_mode == TRAINED_INFERENCE_MODE
        and bool(analysis.model_version)
        and bool(re.fullmatch(r"[a-f0-9]{64}", analysis.checkpoint_sha256 or ""))
    )
    if verified and education_content is None:
        from app.education.skin_lesion_content import get_education_content

        education_content = get_education_content(analysis.predicted_class, "en")

    return SkinLesionAnalyzeResponse(
        id=analysis.id,
        patient_profile_id=analysis.patient_profile_id,
        # Historical client-supplied filenames can embed identifying information.
        image_filename=analysis.image_filename if verified else None,
        predicted_class=analysis.predicted_class if verified else None,
        predicted_label=analysis.predicted_label if verified else None,
        confidence=analysis.confidence if verified else None,
        probabilities=analysis.probabilities if verified else {},
        risk_level=None,
        disclaimer=MANDATORY_DISCLAIMER,
        education_title=analysis.education_title if verified else None,
        education_summary=analysis.education_summary if verified else None,
        education_content=education_content if verified else None,
        reviewed_by_doctor_id=analysis.reviewed_by_doctor_id,
        doctor_notes=analysis.doctor_notes,
        reviewed_at=analysis.reviewed_at,
        created_at=analysis.created_at,
        inference_mode=TRAINED_INFERENCE_MODE if verified else "unknown",
        model_version=analysis.model_version if verified else None,
        checkpoint_sha256=analysis.checkpoint_sha256 if verified else None,
    )


def _remove_failed_upload(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.error("Skin-lesion upload cleanup failed.")


def _save_validated_image(image: Image.Image, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with destination.open("xb") as output:
            created = True
            image.save(output, format="PNG")
    except Exception:
        if created:
            _remove_failed_upload(destination)
        raise


@router.get("/classes", response_model=SkinLesionClassesResponse)
def get_supported_classes() -> SkinLesionClassesResponse:
    """Return model classes, display names, and clinical disclaimer."""
    service = get_skin_lesion_service()
    return SkinLesionClassesResponse(
        model_version=service.model_version,
        available=service.model is not None,
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
    _csrf: None = Depends(verify_csrf_and_origin),
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

    # Parse only bounded data and release FastAPI's spooled upload promptly.
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the uploaded image.") from None
    finally:
        await file.close()

    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded image exceeds the 10 MB limit.")

    service = await run_in_threadpool(get_skin_lesion_service)
    try:
        image = await run_in_threadpool(service.validate_image_bytes, content, file.content_type or "")
    except UnsupportedImageError as error:
        raise HTTPException(status_code=415, detail=str(error)) from None
    except InvalidImageError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None

    try:
        result = await run_in_threadpool(service.predict, image, language)
    except ModelUnavailableError:
        image.close()
        raise HTTPException(
            status_code=503, detail="Skin lesion screening is temporarily unavailable."
        ) from None

    # Store only validated, re-encoded pixels after verified inference succeeds.
    upload_dir = Path(__file__).resolve().parents[3] / settings.skin_lesion_upload_dir
    filename = f"lesion_{uuid.uuid4().hex}.png"
    destination = upload_dir / filename
    try:
        await run_in_threadpool(_save_validated_image, image, destination)
    except (OSError, ValueError):
        logger.error("Skin-lesion image storage unavailable.")
        raise HTTPException(status_code=503, detail="Could not save the screening image.") from None
    finally:
        image.close()

    analysis = SkinLesionAnalysis(
        patient_profile_id=patient_profile.id,
        image_path=str(destination),
        image_filename=filename,
        predicted_class=result["predicted_class"],
        predicted_label=result["predicted_label"],
        confidence=result["confidence"],
        probabilities=result["probabilities"],
        risk_level="unassessed",
        disclaimer=result["disclaimer"],
        education_title=result["education_title"],
        education_summary=result["education_summary"],
        inference_mode=result["inference_mode"],
        model_version=result["model_version"],
        checkpoint_sha256=result["checkpoint_sha256"],
    )
    try:
        db.add(analysis)
        db.flush()
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            event_type="ai.skin_lesion.analyzed",
            resource_type="skin_lesion_analysis",
            resource_id=analysis.id,
            patient_profile_id=patient_profile.id,
            outcome="success",
            details={
                "inference_mode": analysis.inference_mode,
                "model_version": analysis.model_version,
                "checkpoint_sha256": analysis.checkpoint_sha256,
            },
        )
        response = _analysis_response(analysis, result["education_content"])
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        await run_in_threadpool(_remove_failed_upload, destination)
        logger.error("Skin-lesion analysis persistence failed.")
        raise HTTPException(status_code=503, detail="Could not save the screening result.") from None
    return response


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

    return SkinLesionListResponse(items=[_analysis_response(record) for record in records], total=total)


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

    return SkinLesionListResponse(
        items=[_analysis_response(record) for record in records],
        total=len(records),
    )


@router.patch("/{analysis_id}/review", response_model=SkinLesionAnalyzeResponse)
def review_skin_lesion_analysis(
    analysis_id: UUID,
    payload: SkinLesionReviewRequest,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active patient consent is required to review skin lesion analysis.",
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

    return _analysis_response(analysis_record)
