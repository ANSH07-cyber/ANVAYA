from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.schemas.appointment import AvailableSlotsResponse
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.doctor_availability import DoctorAvailability
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.services.appointment_service import generate_available_slots
from app.services.audit_service import add_audit_log
from app.schemas.doctor import (
    DoctorPatientDirectoryItem,
    DoctorPatientDirectoryResponse,
    DoctorProfileMeRead,
    DoctorProfileUpdate,
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


def _serialize_doctor_profile_me(
    profile: DoctorProfile,
    user: User,
) -> DoctorProfileMeRead:
    return DoctorProfileMeRead(
        id=profile.id,
        user_id=profile.user_id,
        full_name=user.full_name,
        email=user.email,
        specialization=profile.specialization,
        qualification=profile.qualification,
        license_number=profile.license_number,
        years_experience=profile.years_experience,
        clinic_name=profile.clinic_name,
        consultation_fee=profile.consultation_fee,
        bio=profile.bio,
        verification_status=profile.verification_status,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


# =====================================================
# DOCTOR PROFILE SELF-SERVICE
# =====================================================

@router.get(
    "/me",
    response_model=DoctorProfileMeRead,
    tags=["Doctor Profile"],
)
def get_my_doctor_profile(
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorProfileMeRead:
    """
    Retrieve the authenticated doctor's full profile merged with user data.
    Accessible to doctors in any verification status (pending, approved, rejected).
    """
    doctor_profile = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.user_id == current_user.id
        )
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    return _serialize_doctor_profile_me(doctor_profile, current_user)


@router.patch(
    "/me",
    response_model=DoctorProfileMeRead,
    tags=["Doctor Profile"],
)
def update_my_doctor_profile(
    payload: DoctorProfileUpdate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorProfileMeRead:
    """
    Update permitted professional profile fields for the authenticated doctor.
    Protected fields (license_number, verification_status, id, user_id, email)
    cannot be modified and will be rejected with 422.
    """
    # 1. Lock doctor profile row
    doctor_profile = db.scalar(
        select(DoctorProfile)
        .where(DoctorProfile.user_id == current_user.id)
        .with_for_update()
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    # 2. Lock user row
    user = db.scalar(
        select(User)
        .where(User.id == current_user.id)
        .with_for_update()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User account not found.",
        )

    update_data = payload.model_dump(exclude_unset=True)
    changed_fields: dict[str, dict[str, Any]] = {}

    # Handle full_name on User
    if "full_name" in update_data:
        new_full_name = update_data["full_name"].strip()
        if user.full_name != new_full_name:
            changed_fields["full_name"] = {
                "old": user.full_name,
                "new": new_full_name,
            }
            user.full_name = new_full_name

    # Handle permitted profile fields
    profile_updatable_fields = (
        "specialization",
        "qualification",
        "years_experience",
        "clinic_name",
        "consultation_fee",
        "bio",
    )

    for field in profile_updatable_fields:
        if field in update_data:
            old_val = getattr(doctor_profile, field)
            new_val = update_data[field]
            if field in ("clinic_name", "bio") and new_val == "":
                new_val = None

            if old_val != new_val:
                old_repr = str(old_val) if isinstance(old_val, Decimal) else old_val
                new_repr = str(new_val) if isinstance(new_val, Decimal) else new_val
                changed_fields[field] = {
                    "old": old_repr,
                    "new": new_repr,
                }
                setattr(doctor_profile, field, new_val)

    # 3. Commit atomically with audit log if changes were made
    try:
        if changed_fields:
            add_audit_log(
                db,
                actor_user_id=current_user.id,
                doctor_profile_id=doctor_profile.id,
                event_type="doctor.profile.updated",
                resource_type="doctor_profile",
                resource_id=doctor_profile.id,
                outcome="success",
                details={
                    "changed_fields": list(changed_fields.keys()),
                    "changes": changed_fields,
                },
            )

        db.commit()
        db.refresh(doctor_profile)
        db.refresh(user)
    except Exception:
        db.rollback()
        raise

    return _serialize_doctor_profile_me(doctor_profile, user)


# =====================================================
# DOCTOR PATIENT DIRECTORY
# =====================================================

@router.get(
    "/me/patients",
    response_model=DoctorPatientDirectoryResponse,
    tags=["Doctor Patient Directory"],
)
def get_my_patient_directory(
    search: str | None = Query(
        default=None,
        min_length=1,
        max_length=100,
        description="Case-insensitive search by patient name.",
    ),
    has_consent: bool | None = Query(
        default=None,
        description="Optional filter by active consent status.",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
        description="Pagination limit (1 to 100).",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Pagination offset.",
    ),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorPatientDirectoryResponse:
    """
    Retrieve a paginated directory of patients who have established an
    appointment relationship (booked or completed) with the authenticated doctor.
    Only approved doctors may access this endpoint.
    """
    # 1. Resolve authenticated doctor profile
    doctor_profile = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.user_id == current_user.id
        )
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors can access the patient directory.",
        )

    # 2. Window function subquery on qualifying appointments (booked or completed only)
    rn_col = func.row_number().over(
        partition_by=Appointment.patient_profile_id,
        order_by=[
            Appointment.appointment_date.desc(),
            Appointment.start_time.desc(),
            Appointment.id.desc(),
        ]
    ).label("rn")

    cnt_col = func.count(Appointment.id).over(
        partition_by=Appointment.patient_profile_id
    ).label("total_appointments")

    appt_subquery = (
        select(
            Appointment.patient_profile_id,
            Appointment.appointment_date.label("last_appointment_date"),
            Appointment.status.label("last_appointment_status"),
            cnt_col,
            rn_col,
        )
        .where(
            Appointment.doctor_profile_id == doctor_profile.id,
            Appointment.status.in_(["booked", "completed"]),
        )
        .subquery()
    )

    # 3. Active consent subquery scoped to this doctor
    consent_subquery = (
        select(ConsentRecord.patient_profile_id)
        .where(
            ConsentRecord.doctor_profile_id == doctor_profile.id,
            ConsentRecord.is_active.is_(True),
        )
        .distinct()
        .subquery()
    )

    has_active_consent_col = case(
        (consent_subquery.c.patient_profile_id.isnot(None), True),
        else_=False,
    ).label("has_active_consent")

    # 4. Base directory subquery containing exactly one row per qualifying patient (rn == 1)
    base_dir_subquery = (
        select(
            appt_subquery.c.patient_profile_id,
            User.full_name,
            PatientProfile.phone_number,
            PatientProfile.gender,
            appt_subquery.c.total_appointments,
            appt_subquery.c.last_appointment_date,
            appt_subquery.c.last_appointment_status,
            has_active_consent_col,
        )
        .join(
            PatientProfile,
            PatientProfile.id == appt_subquery.c.patient_profile_id,
        )
        .join(
            User,
            User.id == PatientProfile.user_id,
        )
        .outerjoin(
            consent_subquery,
            consent_subquery.c.patient_profile_id == appt_subquery.c.patient_profile_id,
        )
        .where(
            appt_subquery.c.rn == 1,
        )
        .subquery()
    )

    # 5. Apply search and consent filters
    filters = []
    if search is not None:
        normalized_search = search.strip()
        if normalized_search:
            filters.append(
                base_dir_subquery.c.full_name.ilike(f"%{normalized_search}%")
            )

    if has_consent is not None:
        filters.append(base_dir_subquery.c.has_active_consent == has_consent)

    # 6. Count total matching unique patients
    count_query = (
        select(func.count())
        .select_from(base_dir_subquery)
        .where(*filters)
    )
    total = db.scalar(count_query) or 0

    # 7. Retrieve paginated results
    data_query = (
        select(base_dir_subquery)
        .where(*filters)
        .order_by(
            base_dir_subquery.c.last_appointment_date.desc(),
            base_dir_subquery.c.full_name.asc(),
        )
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(data_query).all()

    items = [
        DoctorPatientDirectoryItem.model_validate(dict(row._mapping))
        for row in rows
    ]

    return DoctorPatientDirectoryResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
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

# =====================================================
# 3. GET DATE-WISE AVAILABLE APPOINTMENT SLOTS
# =====================================================

@router.get(
    "/{doctor_profile_id}/availability/slots",
    response_model=AvailableSlotsResponse,
)
def get_available_appointment_slots(
    doctor_profile_id: UUID,
    appointment_date: date = Query(
        ...,
        description="Appointment date in YYYY-MM-DD format.",
    ),
    current_user: User = Depends(require_roles("patient", "doctor")),
    db: Session = Depends(get_db),
) -> AvailableSlotsResponse:

    # STEP 1: Only active and approved doctors
    # can receive patient-facing booking requests.

    doctor_profile = db.scalar(
        select(DoctorProfile)
        .join(User, User.id == DoctorProfile.user_id)
        .where(
            DoctorProfile.id == doctor_profile_id,
            User.role == "doctor",
            User.is_active.is_(True),
            DoctorProfile.verification_status == "approved",
        )
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approved doctor not found.",
        )

    # STEP 2: Generate slots using the appointment service.

    available_slots = generate_available_slots(
        db=db,
        doctor_profile_id=doctor_profile.id,
        appointment_date=appointment_date,
    )

    # STEP 3: Return available slots.

    return AvailableSlotsResponse(
        doctor_profile_id=doctor_profile.id,
        appointment_date=appointment_date,
        items=available_slots,
        total=len(available_slots),
    )
