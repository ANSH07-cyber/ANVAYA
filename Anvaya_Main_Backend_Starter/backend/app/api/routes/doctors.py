
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db

from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.models.user import User

from app.schemas.doctor import (
    DoctorPublicListResponse,
    DoctorPublicRead,
)

from app.schemas.availability import (
    DoctorPublicAvailabilityListResponse,
    DoctorPublicAvailabilityRead,
)


router = APIRouter(
    prefix="/doctors",
    tags=["Doctor Discovery"],
)


# =====================================================
# 1. LIST ALL APPROVED DOCTORS
# =====================================================

@router.get(
    "",
    response_model=DoctorPublicListResponse,
)
def list_approved_doctors(
    specialization: str | None = Query(
        default=None,
        min_length=2,
        max_length=100,
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        default=0,
        ge=0,
    ),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> DoctorPublicListResponse:

    base_query = (
        select(DoctorProfile, User.full_name)
        .join(User, User.id == DoctorProfile.user_id)
        .where(
            User.role == "doctor",
            User.is_active.is_(True),
            DoctorProfile.verification_status == "approved",
        )
    )

    count_query = (
        select(func.count(DoctorProfile.id))
        .join(User, User.id == DoctorProfile.user_id)
        .where(
            User.role == "doctor",
            User.is_active.is_(True),
            DoctorProfile.verification_status == "approved",
        )
    )

    if specialization is not None:
        normalized_specialization = specialization.strip()

        if normalized_specialization:
            search_pattern = f"%{normalized_specialization}%"

            base_query = base_query.where(
                DoctorProfile.specialization.ilike(search_pattern)
            )

            count_query = count_query.where(
                DoctorProfile.specialization.ilike(search_pattern)
            )

    total = db.scalar(count_query) or 0

    rows = db.execute(
        base_query
        .order_by(
            DoctorProfile.created_at.desc(),
            DoctorProfile.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = []

    for profile, full_name in rows:

        doctor_data = {
            "id": profile.id,
            "full_name": full_name,
            "specialization": profile.specialization,
            "qualification": profile.qualification,
            "years_experience": profile.years_experience,
            "clinic_name": profile.clinic_name,
            "consultation_fee": profile.consultation_fee,
            "bio": profile.bio,
        }

        items.append(
            DoctorPublicRead.model_validate(doctor_data)
        )

    return DoctorPublicListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =====================================================
# 2. GET PUBLIC AVAILABILITY OF AN APPROVED DOCTOR
# =====================================================

@router.get(
    "/{doctor_profile_id}/availability",
    response_model=DoctorPublicAvailabilityListResponse,
)
def get_public_doctor_availability(
    doctor_profile_id: UUID,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> DoctorPublicAvailabilityListResponse:

    # STEP 1: Find the requested doctor.
    # The doctor must have an active account and
    # an approved professional profile.

    doctor_profile = db.scalar(
        select(DoctorProfile)
        .join(
            User,
            User.id == DoctorProfile.user_id,
        )
        .where(
            DoctorProfile.id == doctor_profile_id,
            User.role == "doctor",
            User.is_active.is_(True),
            DoctorProfile.verification_status == "approved",
        )
    )

    # STEP 2: Hide doctors who are not eligible
    # for patient-facing discovery.

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approved doctor not found.",
        )

    # STEP 3: Fetch only active availability
    # belonging to the selected doctor.

    availability_query = (
        select(DoctorAvailability)
        .where(
            DoctorAvailability.doctor_profile_id == doctor_profile.id,
            DoctorAvailability.is_active.is_(True),
        )
        .order_by(
            DoctorAvailability.weekday,
            DoctorAvailability.start_time,
        )
    )

    availability_records = db.scalars(
        availability_query
    ).all()

    # STEP 4: Convert database records into
    # the public response schema.

    items = [
        DoctorPublicAvailabilityRead.model_validate(record)
        for record in availability_records
    ]

    # STEP 5: Return the schedules to the patient.

    return DoctorPublicAvailabilityListResponse(
        items=items,
        total=len(items),
    )
