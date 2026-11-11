
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.models.user import User
from app.models.doctor_profile import DoctorProfile
from app.schemas.doctor import (
    DoctorAccountCreate,
    DoctorProfileRead,
    DoctorReviewItem,
    DoctorReviewListResponse,
    DoctorVerificationUpdate,
)

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/access-check")
def admin_access_check(
    current_user: User = Depends(require_roles("admin")),
) -> dict[str, str]:
    return {
        "message": "Admin access granted",
        "role": current_user.role,
    }


@router.post(
    "/doctors",
    response_model=DoctorProfileRead,
    status_code=status.HTTP_201_CREATED,
)
def create_doctor(
    payload: DoctorAccountCreate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> DoctorProfileRead:

    normalized_email = str(payload.email).strip().lower()
    normalized_license = payload.license_number.strip()

    existing_email = db.scalar(
        select(User).where(User.email == normalized_email)
    )

    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    existing_license = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.license_number == normalized_license
        )
    )

    if existing_license:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This medical license number is already registered.",
        )

    doctor_user = User(
        full_name=payload.full_name.strip(),
        email=normalized_email,
        password_hash=hash_password(payload.password),
        role="doctor",
    )

    profile_data = payload.model_dump(
        exclude={"full_name", "email", "password"}
    )
    profile_data["license_number"] = normalized_license

    try:
        db.add(doctor_user)
        db.flush()

        doctor_profile = DoctorProfile(
            user_id=doctor_user.id,
            verification_status="pending",
            **profile_data,
        )

        db.add(doctor_profile)
        db.commit()
        db.refresh(doctor_profile)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Doctor account or license number already exists.",
        )

    return doctor_profile


@router.get(
    "/doctors",
    response_model=DoctorReviewListResponse,
)
def list_doctors(
    verification_status: Literal["pending", "approved", "rejected"] | None = Query(
        default=None
    ),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> DoctorReviewListResponse:

    base_query = (
        select(DoctorProfile)
        .join(User, User.id == DoctorProfile.user_id)
        .where(User.role == "doctor")
    )

    count_query = (
        select(func.count(DoctorProfile.id))
        .join(User, User.id == DoctorProfile.user_id)
        .where(User.role == "doctor")
    )

    if verification_status is not None:
        base_query = base_query.where(
            DoctorProfile.verification_status == verification_status
        )
        count_query = count_query.where(
            DoctorProfile.verification_status == verification_status
        )

    total = db.scalar(count_query) or 0

    result = db.execute(
        base_query
        .order_by(
            DoctorProfile.created_at.desc(),
            DoctorProfile.id,
        )
        .limit(limit)
        .offset(offset)
    )

    rows = result.all()

    items = []

    for profile, in rows:
        doctor_user = db.get(User, profile.user_id)

        if doctor_user is None:
            continue

        item_data = {
            "id": profile.id,
            "user_id": profile.user_id,
            "full_name": doctor_user.full_name,
            "email": doctor_user.email,
            "specialization": profile.specialization,
            "qualification": profile.qualification,
            "license_number": profile.license_number,
            "years_experience": profile.years_experience,
            "clinic_name": profile.clinic_name,
            "consultation_fee": profile.consultation_fee,
            "bio": profile.bio,
            "verification_status": profile.verification_status,
            "created_at": profile.created_at,
        }

        items.append(DoctorReviewItem.model_validate(item_data))

    return DoctorReviewListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/doctors/{doctor_profile_id}/verification",
    response_model=DoctorProfileRead,
)
def review_doctor(
    doctor_profile_id: UUID,
    payload: DoctorVerificationUpdate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> DoctorProfileRead:

    doctor_profile = db.get(DoctorProfile, doctor_profile_id)

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if doctor_profile.verification_status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This doctor profile has already been reviewed.",
        )

    doctor_user = db.get(User, doctor_profile.user_id)

    if doctor_user is None or doctor_user.role != "doctor":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The linked doctor account is invalid.",
        )

    doctor_profile.verification_status = payload.verification_status

    db.commit()
    db.refresh(doctor_profile)

    return doctor_profile
