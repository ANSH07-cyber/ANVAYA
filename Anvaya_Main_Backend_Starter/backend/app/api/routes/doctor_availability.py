
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.user import User
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.schemas.availability import (
    DoctorAvailabilityCreate,
    DoctorAvailabilityRead,
    DoctorAvailabilityListResponse,
)

router = APIRouter(
    prefix="/doctors/me/availability",
    tags=["Doctor Availability"],
)


def get_my_doctor_profile(
    current_user: User,
    db: Session,
) -> DoctorProfile:

    profile = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.user_id == current_user.id
        )
    )

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if profile.verification_status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Rejected doctor accounts cannot manage availability.",
        )

    return profile


@router.post(
    "",
    response_model=DoctorAvailabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_my_availability(
    payload: DoctorAvailabilityCreate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorAvailabilityRead:

    profile = get_my_doctor_profile(current_user, db)

    overlapping_schedule = db.scalar(
        select(DoctorAvailability).where(
            DoctorAvailability.doctor_profile_id == profile.id,
            DoctorAvailability.weekday == payload.weekday,
            DoctorAvailability.is_active.is_(True),
            DoctorAvailability.start_time < payload.end_time,
            DoctorAvailability.end_time > payload.start_time,
        )
    )

    if overlapping_schedule is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This schedule overlaps an existing active schedule.",
        )

    availability = DoctorAvailability(
        doctor_profile_id=profile.id,
        **payload.model_dump(),
    )

    try:
        db.add(availability)
        db.commit()
        db.refresh(availability)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This availability schedule already exists or violates a database constraint.",
        )

    return availability


@router.get(
    "",
    response_model=DoctorAvailabilityListResponse,
)
def get_my_availability(
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorAvailabilityListResponse:

    profile = get_my_doctor_profile(current_user, db)

    query = (
        select(DoctorAvailability)
        .where(
            DoctorAvailability.doctor_profile_id == profile.id
        )
        .order_by(
            DoctorAvailability.weekday,
            DoctorAvailability.start_time,
        )
    )

    items = db.scalars(query).all()

    total = db.scalar(
        select(func.count())
        .select_from(DoctorAvailability)
        .where(
            DoctorAvailability.doctor_profile_id == profile.id
        )
    ) or 0

    return DoctorAvailabilityListResponse(
        items=items,
        total=total,
    )
