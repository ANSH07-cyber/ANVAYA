from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles, verify_csrf_and_origin
from app.db.session import get_db
from app.models.user import User
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.models.appointment import Appointment
from app.schemas.availability import (
    DoctorAvailabilityCreate,
    DoctorAvailabilityUpdate,
    DoctorAvailabilityStatusUpdate,
    DoctorAvailabilityRead,
    DoctorAvailabilityListResponse,
)

IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(
    prefix="/doctors/me/availability",
    tags=["Doctor Availability"],
)


def get_my_doctor_profile(
    current_user: User,
    db: Session,
    for_update: bool = False,
) -> DoctorProfile:
    query = select(DoctorProfile).where(
        DoctorProfile.user_id == current_user.id
    )
    if for_update:
        query = query.with_for_update()

    profile = db.scalar(query)

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if profile.verification_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors can manage availability.",
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
    _csrf: None = Depends(verify_csrf_and_origin),
) -> DoctorAvailabilityRead:
    profile = get_my_doctor_profile(current_user, db, for_update=True)

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


@router.put(
    "/{availability_id}",
    response_model=DoctorAvailabilityRead,
)
def update_my_availability(
    availability_id: UUID,
    payload: DoctorAvailabilityUpdate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> DoctorAvailabilityRead:
    profile = get_my_doctor_profile(current_user, db, for_update=True)

    availability = db.scalar(
        select(DoctorAvailability).where(
            DoctorAvailability.id == availability_id,
            DoctorAvailability.doctor_profile_id == profile.id,
        )
    )

    if availability is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Availability schedule not found.",
        )

    # Check overlap against other active schedules belonging to this doctor
    overlapping_schedule = db.scalar(
        select(DoctorAvailability).where(
            DoctorAvailability.doctor_profile_id == profile.id,
            DoctorAvailability.id != availability.id,
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

    # Existing future booked appointment protection:
    # If updating this shift causes any existing future booked appointment
    # to fall outside the revised schedule, reject with 409 Conflict.
    now = datetime.now(IST)
    today = now.date()

    future_booked_apts = db.scalars(
        select(Appointment).where(
            Appointment.doctor_profile_id == profile.id,
            Appointment.appointment_date >= today,
            Appointment.status == "booked",
        )
    ).all()

    for apt in future_booked_apts:
        if apt.appointment_date.weekday() == availability.weekday:
            # Check if appointment fell within the original availability window
            if (
                availability.start_time <= apt.start_time
                and apt.end_time <= availability.end_time
            ):
                # If weekday changed or appointment falls outside revised window:
                if (
                    payload.weekday != availability.weekday
                    or apt.start_time < payload.start_time
                    or apt.end_time > payload.end_time
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "Cannot update schedule: 1 or more future booked appointments "
                            "would fall outside the revised consulting hours. "
                            "Please resolve or reschedule those appointments first."
                        ),
                    )

    availability.weekday = payload.weekday
    availability.start_time = payload.start_time
    availability.end_time = payload.end_time
    availability.slot_duration_minutes = payload.slot_duration_minutes

    try:
        db.commit()
        db.refresh(availability)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This availability schedule already exists or violates a database constraint.",
        )

    return availability


@router.patch(
    "/{availability_id}/status",
    response_model=DoctorAvailabilityRead,
)
def update_my_availability_status(
    availability_id: UUID,
    payload: DoctorAvailabilityStatusUpdate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> DoctorAvailabilityRead:
    profile = get_my_doctor_profile(current_user, db, for_update=True)

    availability = db.scalar(
        select(DoctorAvailability).where(
            DoctorAvailability.id == availability_id,
            DoctorAvailability.doctor_profile_id == profile.id,
        )
    )

    if availability is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Availability schedule not found.",
        )

    # If reactivating, verify it does not conflict with another active schedule
    if payload.is_active and not availability.is_active:
        overlapping_schedule = db.scalar(
            select(DoctorAvailability).where(
                DoctorAvailability.doctor_profile_id == profile.id,
                DoctorAvailability.id != availability.id,
                DoctorAvailability.weekday == availability.weekday,
                DoctorAvailability.is_active.is_(True),
                DoctorAvailability.start_time < availability.end_time,
                DoctorAvailability.end_time > availability.start_time,
            )
        )

        if overlapping_schedule is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot reactivate schedule: it overlaps another active schedule on this day.",
            )

    # Deactivating does not cancel or modify appointments; it simply stops future slot generation
    availability.is_active = payload.is_active
    db.commit()
    db.refresh(availability)
    return availability


@router.delete(
    "/{availability_id}",
    response_model=DoctorAvailabilityRead,
)
def delete_my_availability(
    availability_id: UUID,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> DoctorAvailabilityRead:
    profile = get_my_doctor_profile(current_user, db, for_update=True)

    availability = db.scalar(
        select(DoctorAvailability).where(
            DoctorAvailability.id == availability_id,
            DoctorAvailability.doctor_profile_id == profile.id,
        )
    )

    if availability is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Availability schedule not found.",
        )

    # Strict soft-deactivation policy: never execute SQL DELETE
    availability.is_active = False
    db.commit()
    db.refresh(availability)
    return availability
