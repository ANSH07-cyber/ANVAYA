from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.api.deps import require_roles, verify_csrf_and_origin
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import get_db
from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.doctor_profile import DoctorProfile
from app.models.notification import Notification
from app.models.patient_profile import PatientProfile
from app.models.refresh_token import RefreshToken, RefreshTokenFamily
from app.models.user import User
from app.schemas.admin import (
    AdminAppointmentItem,
    AdminAppointmentListResponse,
    AdminDashboardStatsResponse,
    AdminNotificationSettingsResponse,
    AdminPatientItem,
    AdminPatientListResponse,
    AdminProfileResponse,
    AdminProfileUpdate,
    AdminSecurityAuditEventItem,
    AdminSecuritySettingsResponse,
    AdminSystemSettingsResponse,
    AdminUserDetailResponse,
    AdminUserListItem,
    AdminUserListResponse,
    AdminUserStatusResponse,
    AdminUserStatusUpdate,
)
from app.schemas.audit_log import AuditLogListResponse
from app.schemas.doctor import (
    DoctorAccountCreate,
    DoctorProfileRead,
    DoctorReviewItem,
    DoctorReviewListResponse,
    DoctorVerificationUpdate,
)
from app.services.notification_service import (
    notify_doctor_onboarded,
    notify_doctor_verification_status,
)

router = APIRouter(prefix="/admin", tags=["Admin"])


ALLOWED_VERIFICATION_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"approved", "rejected"},
    "approved": {"suspended"},
    "rejected": {"pending"},
    "suspended": {"pending"},
}

TRANSITIONS_REQUIRING_REASON: set[tuple[str, str]] = {
    ("pending", "rejected"),
    ("approved", "suspended"),
    ("rejected", "pending"),
    ("suspended", "pending"),
}


@router.get("/access-check")
def admin_access_check(
    current_user: User = Depends(require_roles("admin")),
) -> dict[str, str]:
    return {
        "message": "Admin access granted",
        "role": current_user.role,
    }


# =========================================================
# 1. ADMIN DASHBOARD STATISTICS
# =========================================================

@router.get(
    "/dashboard/stats",
    response_model=AdminDashboardStatsResponse,
)
def get_admin_dashboard_stats(
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminDashboardStatsResponse:
    """
    Return high-level operational counts across doctors, patients, and appointments.
    Strictly restricted to administrators. Contains zero patient clinical data.
    """
    doc_row = db.execute(
        select(
            func.count(DoctorProfile.id).label("total_doctors"),
            func.count().filter(DoctorProfile.verification_status == "pending").label("pending_doctors"),
            func.count().filter(DoctorProfile.verification_status == "approved").label("approved_doctors"),
            func.count().filter(DoctorProfile.verification_status == "rejected").label("rejected_doctors"),
            func.count().filter(DoctorProfile.verification_status == "suspended").label("suspended_doctors"),
        )
    ).one()

    total_patients = db.scalar(select(func.count(PatientProfile.id))) or 0

    appt_row = db.execute(
        select(
            func.count(Appointment.id).label("total_appointments"),
            func.count().filter(Appointment.status == "booked").label("booked_appointments"),
            func.count().filter(Appointment.status == "completed").label("completed_appointments"),
            func.count().filter(Appointment.status == "cancelled").label("cancelled_appointments"),
        )
    ).one()

    return AdminDashboardStatsResponse(
        total_doctors=doc_row.total_doctors or 0,
        pending_doctors=doc_row.pending_doctors or 0,
        approved_doctors=doc_row.approved_doctors or 0,
        rejected_doctors=doc_row.rejected_doctors or 0,
        suspended_doctors=doc_row.suspended_doctors or 0,
        total_patients=total_patients,
        total_appointments=appt_row.total_appointments or 0,
        booked_appointments=appt_row.booked_appointments or 0,
        completed_appointments=appt_row.completed_appointments or 0,
        cancelled_appointments=appt_row.cancelled_appointments or 0,
    )


# =========================================================
# 2. CREATE DOCTOR ACCOUNT (ADMIN ONBOARDING)
# =========================================================

@router.post(
    "/doctors",
    response_model=DoctorProfileRead,
    status_code=status.HTTP_201_CREATED,
)
def create_doctor(
    payload: DoctorAccountCreate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
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
        db.flush()

        # Atomic Audit Logging
        audit_entry = AuditLog(
            actor_user_id=current_user.id,
            patient_profile_id=None,
            doctor_profile_id=doctor_profile.id,
            event_type="doctor.created",
            resource_type="doctor_profile",
            resource_id=str(doctor_profile.id),
            outcome="success",
            details={
                "action": "create_doctor",
                "doctor_user_id": str(doctor_user.id),
                "doctor_email": doctor_user.email,
                "doctor_name": doctor_user.full_name,
                "license_number": doctor_profile.license_number,
                "specialization": doctor_profile.specialization,
                "initial_status": "pending",
            },
        )
        db.add(audit_entry)

        notify_doctor_onboarded(
            db,
            doctor_profile_id=doctor_profile.id,
            doctor_user_id=doctor_user.id,
            admin_user_id=current_user.id,
            doctor_name=doctor_user.full_name,
        )

        db.commit()
        db.refresh(doctor_profile)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Doctor account or license number already exists.",
        )
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create doctor account and audit log.",
        )

    return doctor_profile


# =========================================================
# 3. LIST DOCTORS (OPTIMIZED JOIN + SEARCH)
# =========================================================

@router.get(
    "/doctors",
    response_model=DoctorReviewListResponse,
)
def list_doctors(
    verification_status: Literal["pending", "approved", "rejected", "suspended"] | None = Query(
        default=None
    ),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> DoctorReviewListResponse:

    # Optimized JOIN: select DoctorProfile and User together to avoid N+1 queries
    base_query = (
        select(DoctorProfile, User)
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

    if search is not None:
        search_term = search.strip()
        if search_term:
            search_pattern = f"%{search_term}%"
            search_filter = or_(
                User.full_name.ilike(search_pattern),
                User.email.ilike(search_pattern),
                DoctorProfile.license_number.ilike(search_pattern),
            )
            base_query = base_query.where(search_filter)
            count_query = count_query.where(search_filter)

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

    for profile, doctor_user in rows:
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


# =========================================================
# 4. REVIEW DOCTOR VERIFICATION (ROW-LOCK + ATOMIC AUDIT)
# =========================================================

@router.patch(
    "/doctors/{doctor_profile_id}/verification",
    response_model=DoctorProfileRead,
)
def review_doctor(
    doctor_profile_id: UUID,
    payload: DoctorVerificationUpdate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> DoctorProfileRead:

    # Row-level lock on doctor profile to prevent concurrent overwrites
    doctor_profile = db.execute(
        select(DoctorProfile)
        .where(DoctorProfile.id == doctor_profile_id)
        .with_for_update()
    ).scalar_one_or_none()

    if doctor_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doctor profile not found.",
        )

    previous_status = doctor_profile.verification_status
    target_status = payload.verification_status

    allowed_next_statuses = ALLOWED_VERIFICATION_TRANSITIONS.get(previous_status, set())
    if target_status not in allowed_next_statuses:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot transition doctor verification status from '{previous_status}' to '{target_status}'.",
        )

    if (previous_status, target_status) in TRANSITIONS_REQUIRING_REASON:
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"A reason is required when transitioning doctor verification status from '{previous_status}' to '{target_status}'.",
            )

    doctor_user = db.get(User, doctor_profile.user_id)

    if doctor_user is None or doctor_user.role != "doctor":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The linked doctor account is invalid.",
        )

    clean_reason = payload.reason.strip() if payload.reason else None

    try:
        doctor_profile.verification_status = target_status

        # Atomic Audit Logging
        audit_entry = AuditLog(
            actor_user_id=current_user.id,
            patient_profile_id=None,
            doctor_profile_id=doctor_profile.id,
            event_type=f"doctor.verification.{target_status}",
            resource_type="doctor_profile",
            resource_id=str(doctor_profile.id),
            outcome="success",
            details={
                "action": "review_doctor",
                "previous_status": previous_status,
                "new_status": target_status,
                "reason": clean_reason,
                "license_number": doctor_profile.license_number,
            },
        )
        db.add(audit_entry)

        notify_doctor_verification_status(
            db,
            doctor_profile_id=doctor_profile.id,
            doctor_user_id=doctor_profile.user_id,
            target_status=target_status,
            reason=clean_reason,
        )

        db.commit()
        db.refresh(doctor_profile)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update doctor verification status and audit record.",
        )

    return doctor_profile


# =========================================================
# 5. VIEW AUDIT LOGS - ADMIN ONLY
# =========================================================

@router.get(
    "/audit-logs",
    response_model=AuditLogListResponse,
)
def list_audit_logs(
    event_type: str | None = Query(
        default=None,
        min_length=1,
        max_length=100,
    ),

    outcome: Literal["success", "denied", "failure"] | None = Query(
        default=None,
    ),

    patient_profile_id: UUID | None = Query(default=None),

    doctor_profile_id: UUID | None = Query(default=None),

    date_from: date | None = Query(default=None),

    date_to: date | None = Query(default=None),

    limit: int = Query(default=20, ge=1, le=100),

    offset: int = Query(default=0, ge=0),

    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AuditLogListResponse:
    """
    Return a filtered, paginated audit history.

    Only authenticated administrators can view audit logs.
    This endpoint is read-only.
    """

    # STEP 1: Validate date range.

    if date_from is not None and date_to is not None:
        if date_from > date_to:
            raise HTTPException(
                status_code=422,
                detail="date_from cannot be after date_to.",
            )

    # STEP 2: Build common database filters.

    filters = []

    if event_type is not None:
        normalized_event_type = event_type.strip()

        if not normalized_event_type:
            raise HTTPException(
                status_code=422,
                detail="Event type cannot be empty.",
            )

        # Support safe prefix matching for categories (e.g. "doctor.", "consent.", "ehr.", "prescription.", "admin.")
        if normalized_event_type.endswith("."):
            filters.append(
                AuditLog.event_type.startswith(normalized_event_type)
            )
        elif "." not in normalized_event_type:
            filters.append(
                or_(
                    AuditLog.event_type == normalized_event_type,
                    AuditLog.event_type.startswith(f"{normalized_event_type}."),
                )
            )
        else:
            filters.append(
                AuditLog.event_type == normalized_event_type
            )

    if outcome is not None:
        filters.append(
            AuditLog.outcome == outcome
        )

    if patient_profile_id is not None:
        filters.append(
            AuditLog.patient_profile_id == patient_profile_id
        )

    if doctor_profile_id is not None:
        filters.append(
            AuditLog.doctor_profile_id == doctor_profile_id
        )

    # Audit timestamps are stored in UTC.
    # End date uses an exclusive upper bound.

    if date_from is not None:
        start_datetime = datetime.combine(
            date_from,
            time.min,
            tzinfo=timezone.utc,
        )

        filters.append(
            AuditLog.created_at >= start_datetime
        )

    if date_to is not None:
        end_datetime = datetime.combine(
            date_to + timedelta(days=1),
            time.min,
            tzinfo=timezone.utc,
        )

        filters.append(
            AuditLog.created_at < end_datetime
        )

    # STEP 3: Calculate total matching audit records.

    total = db.scalar(
        select(func.count(AuditLog.id))
        .where(*filters)
    ) or 0

    # STEP 4: Retrieve records with pagination.
    # Newest events appear first.

    logs = db.scalars(
        select(AuditLog)
        .where(*filters)
        .order_by(
            AuditLog.created_at.desc(),
            AuditLog.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    # STEP 5: Return structured response.

    return AuditLogListResponse(
        items=logs,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 6. LIST PATIENTS (OPTIMIZED JOIN + SEARCH & FILTERS)
# =========================================================

@router.get(
    "/patients",
    response_model=AdminPatientListResponse,
)
def list_patients(
    search: str | None = Query(default=None, max_length=100),
    gender: str | None = Query(default=None, max_length=30),
    blood_group: str | None = Query(default=None, max_length=5),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminPatientListResponse:
    """
    List all registered patients with demographic profiles for administrative oversight.
    Optimized single-query JOIN between PatientProfile and User to eliminate N+1 queries.
    """
    base_query = (
        select(PatientProfile, User)
        .join(User, User.id == PatientProfile.user_id)
        .where(User.role == "patient")
    )
    count_query = (
        select(func.count(PatientProfile.id))
        .join(User, User.id == PatientProfile.user_id)
        .where(User.role == "patient")
    )

    if gender is not None:
        clean_gender = gender.strip()
        if clean_gender and clean_gender.lower() != "all":
            base_query = base_query.where(PatientProfile.gender.ilike(clean_gender))
            count_query = count_query.where(PatientProfile.gender.ilike(clean_gender))

    if blood_group is not None:
        clean_bg = blood_group.strip()
        if clean_bg and clean_bg.lower() != "all":
            base_query = base_query.where(PatientProfile.blood_group == clean_bg)
            count_query = count_query.where(PatientProfile.blood_group == clean_bg)

    if search is not None:
        search_term = search.strip()
        if search_term:
            search_pattern = f"%{search_term}%"
            search_filter = or_(
                User.full_name.ilike(search_pattern),
                User.email.ilike(search_pattern),
                PatientProfile.phone_number.ilike(search_pattern),
            )
            base_query = base_query.where(search_filter)
            count_query = count_query.where(search_filter)

    total = db.scalar(count_query) or 0

    rows = db.execute(
        base_query
        .order_by(
            PatientProfile.created_at.desc(),
            PatientProfile.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = []
    for profile, patient_user in rows:
        items.append(
            AdminPatientItem(
                id=profile.id,
                user_id=profile.user_id,
                full_name=patient_user.full_name,
                email=patient_user.email,
                date_of_birth=profile.date_of_birth,
                phone_number=profile.phone_number,
                gender=profile.gender,
                blood_group=profile.blood_group,
                address=profile.address,
                created_at=profile.created_at,
            )
        )

    return AdminPatientListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 7. LIST APPOINTMENTS (CROSS-JOIN WITH DOCTOR & PATIENT)
# =========================================================

@router.get(
    "/appointments",
    response_model=AdminAppointmentListResponse,
)
def list_admin_appointments(
    status: Literal["booked", "completed", "cancelled", "in_progress"] | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    doctor_profile_id: UUID | None = Query(default=None),
    patient_profile_id: UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminAppointmentListResponse:
    """
    List clinical appointments across all doctors and patients for administrative schedule oversight.
    Cross-joins Appointment with DoctorProfile, doctor User, PatientProfile, and patient User.
    """
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail="date_from cannot be after date_to.",
        )

    DoctorUser = aliased(User)
    PatientUser = aliased(User)

    base_query = (
        select(
            Appointment,
            DoctorProfile,
            DoctorUser,
            PatientProfile,
            PatientUser,
        )
        .join(DoctorProfile, DoctorProfile.id == Appointment.doctor_profile_id)
        .join(DoctorUser, DoctorUser.id == DoctorProfile.user_id)
        .join(PatientProfile, PatientProfile.id == Appointment.patient_profile_id)
        .join(PatientUser, PatientUser.id == PatientProfile.user_id)
    )

    count_query = (
        select(func.count(Appointment.id))
        .join(DoctorProfile, DoctorProfile.id == Appointment.doctor_profile_id)
        .join(DoctorUser, DoctorUser.id == DoctorProfile.user_id)
        .join(PatientProfile, PatientProfile.id == Appointment.patient_profile_id)
        .join(PatientUser, PatientUser.id == PatientProfile.user_id)
    )

    filters = []

    if status is not None:
        filters.append(Appointment.status == status)

    if doctor_profile_id is not None:
        filters.append(Appointment.doctor_profile_id == doctor_profile_id)

    if patient_profile_id is not None:
        filters.append(Appointment.patient_profile_id == patient_profile_id)

    if date_from is not None:
        filters.append(Appointment.appointment_date >= date_from)

    if date_to is not None:
        filters.append(Appointment.appointment_date <= date_to)

    if search is not None:
        search_term = search.strip()
        if search_term:
            search_pattern = f"%{search_term}%"
            filters.append(
                or_(
                    DoctorUser.full_name.ilike(search_pattern),
                    PatientUser.full_name.ilike(search_pattern),
                    DoctorProfile.specialization.ilike(search_pattern),
                    Appointment.reason.ilike(search_pattern),
                )
            )

    if filters:
        base_query = base_query.where(*filters)
        count_query = count_query.where(*filters)

    total = db.scalar(count_query) or 0

    rows = db.execute(
        base_query
        .order_by(
            Appointment.appointment_date.desc(),
            Appointment.start_time.desc(),
            Appointment.id,
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = []
    for appt, doc_profile, doc_user, pat_profile, pat_user in rows:
        items.append(
            AdminAppointmentItem(
                id=appt.id,
                patient_profile_id=appt.patient_profile_id,
                doctor_profile_id=appt.doctor_profile_id,
                patient_name=pat_user.full_name,
                patient_email=pat_user.email,
                doctor_name=doc_user.full_name,
                doctor_email=doc_user.email,
                doctor_specialization=doc_profile.specialization,
                appointment_date=appt.appointment_date,
                start_time=appt.start_time,
                end_time=appt.end_time,
                status=appt.status,
                reason=appt.reason,
                created_at=appt.created_at,
                updated_at=appt.updated_at,
            )
        )

    return AdminAppointmentListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 8. LIST USERS (SEARCH + ROLE/STATUS FILTERS + PAGINATION)
# =========================================================

@router.get(
    "/users",
    response_model=AdminUserListResponse,
)
def list_admin_users(
    role: Literal["patient", "doctor", "admin"] | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminUserListResponse:
    """List platform users across all roles with search, filtering, and stable ordering."""
    base_query = select(User)
    count_query = select(func.count(User.id))

    filters = []

    if role is not None:
        filters.append(User.role == role)

    if is_active is not None:
        filters.append(User.is_active == is_active)

    if search is not None:
        search_term = search.strip()
        if search_term:
            pattern = f"%{search_term}%"
            filters.append(
                or_(
                    User.full_name.ilike(pattern),
                    User.email.ilike(pattern),
                )
            )

    if filters:
        base_query = base_query.where(*filters)
        count_query = count_query.where(*filters)

    total = db.scalar(count_query) or 0

    users = db.scalars(
        base_query
        .order_by(User.created_at.desc(), User.id.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    items = [
        AdminUserListItem(
            id=u.id,
            full_name=u.full_name,
            email=u.email,
            role=u.role,
            is_active=u.is_active,
            has_password=u.password_hash is not None,
            has_firebase=u.firebase_uid is not None,
            created_at=u.created_at,
        )
        for u in users
    ]

    return AdminUserListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 9. GET USER ACCOUNT DETAILS (PRIVACY-PRESERVING)
# =========================================================

@router.get(
    "/users/{user_id}",
    response_model=AdminUserDetailResponse,
)
def get_admin_user_detail(
    user_id: UUID,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminUserDetailResponse:
    """Retrieve minimal account metadata without exposing PHI, passwords, or credentials."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    now = datetime.now(timezone.utc)
    active_sessions = db.scalar(
        select(func.count(RefreshToken.id)).where(
            RefreshToken.user_id == user.id,
            RefreshToken.is_revoked.is_(False),
            RefreshToken.expires_at > now,
        )
    ) or 0

    linked_profile_type: str | None = None
    linked_profile_id: UUID | None = None
    doctor_verification_status: str | None = None
    doctor_specialization: str | None = None
    patient_profile_exists = False

    if user.role == "doctor":
        doc_profile = db.scalar(
            select(DoctorProfile).where(DoctorProfile.user_id == user.id)
        )
        if doc_profile:
            linked_profile_type = "doctor"
            linked_profile_id = doc_profile.id
            doctor_verification_status = doc_profile.verification_status
            doctor_specialization = doc_profile.specialization

    elif user.role == "patient":
        pat_profile = db.scalar(
            select(PatientProfile).where(PatientProfile.user_id == user.id)
        )
        if pat_profile:
            linked_profile_type = "patient"
            linked_profile_id = pat_profile.id
            patient_profile_exists = True

    return AdminUserDetailResponse(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        has_password=user.password_hash is not None,
        has_firebase=user.firebase_uid is not None,
        created_at=user.created_at,
        active_sessions_count=active_sessions,
        linked_profile_type=linked_profile_type,
        linked_profile_id=linked_profile_id,
        doctor_verification_status=doctor_verification_status,
        doctor_specialization=doctor_specialization,
        patient_profile_exists=patient_profile_exists,
    )


# =========================================================
# 10. UPDATE USER ACCOUNT STATUS (ACTIVATION / DEACTIVATION)
# =========================================================

@router.patch(
    "/users/{user_id}/status",
    response_model=AdminUserStatusResponse,
)
def update_user_status(
    user_id: UUID,
    payload: AdminUserStatusUpdate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> AdminUserStatusResponse:
    """Safely activate or deactivate a user account with session invalidation and audit logging.

    Enforces self-lockout prevention, last active administrator protection, and row locking.
    """
    # 1. Row-lock target user to serialize concurrent status updates
    target_user = db.execute(
        select(User).where(User.id == user_id).with_for_update()
    ).scalar_one_or_none()

    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # 2. Self-lockout check: Admin cannot deactivate their own account
    if target_user.id == current_user.id and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrators cannot deactivate their own account.",
        )

    # 3. Mandatory reason on deactivation
    clean_reason: str | None = None
    if not payload.is_active:
        clean_reason = (payload.reason or "").strip()
        if len(clean_reason) < 5:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A reason of at least 5 characters is required to deactivate an account.",
            )

    # 4. Protect the last active administrator
    if target_user.role == "admin" and not payload.is_active:
        # Acquire row lock on all active admins to serialize concurrent attempts
        active_admins = db.scalars(
            select(User)
            .where(
                User.role == "admin",
                User.is_active.is_(True),
            )
            .with_for_update()
        ).all()

        if len(active_admins) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot deactivate the platform's last active administrator.",
            )

    previous_status = target_user.is_active
    revoked_count = 0
    now = datetime.now(timezone.utc)

    try:
        # 5. Atomically revoke all active refresh tokens if deactivating
        if not payload.is_active:
            revoked_tokens = db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.user_id == target_user.id,
                    RefreshToken.is_revoked.is_(False),
                )
                .values(
                    is_revoked=True,
                    revoked_at=now,
                    revocation_reason=f"admin_deactivation: {clean_reason}",
                )
            )
            revoked_count = revoked_tokens.rowcount

            db.execute(
                update(RefreshTokenFamily)
                .where(
                    RefreshTokenFamily.user_id == target_user.id,
                    RefreshTokenFamily.is_revoked.is_(False),
                )
                .values(
                    is_revoked=True,
                    revoked_at=now,
                    revocation_reason=f"admin_deactivation: {clean_reason}",
                )
            )

        # 6. Atomic audit logging
        event_type = "user.deactivated" if not payload.is_active else "user.activated"
        audit_entry = AuditLog(
            actor_user_id=current_user.id,
            patient_profile_id=None,
            doctor_profile_id=None,
            event_type=event_type,
            resource_type="user",
            resource_id=str(target_user.id),
            outcome="success",
            details={
                "action": "update_user_status",
                "target_user_id": str(target_user.id),
                "target_user_email": target_user.email,
                "target_user_role": target_user.role,
                "previous_status": previous_status,
                "new_status": payload.is_active,
                "reason": clean_reason,
                "revoked_sessions": revoked_count,
            },
        )
        db.add(audit_entry)

        target_user.is_active = payload.is_active
        db.commit()
        db.refresh(target_user)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user status and audit record.",
        )

    return AdminUserStatusResponse(
        id=target_user.id,
        email=target_user.email,
        role=target_user.role,
        is_active=target_user.is_active,
        updated_at=now,
        revoked_sessions_count=revoked_count,
    )


# =========================================================
# 11. ADMIN SETTINGS - PROFILE (READ & UPDATE)
# =========================================================

@router.get(
    "/settings/profile",
    response_model=AdminProfileResponse,
)
def get_admin_profile(
    current_user: User = Depends(require_roles("admin")),
) -> AdminProfileResponse:
    """Retrieve the current administrator's account profile."""
    return AdminProfileResponse(
        id=current_user.id,
        full_name=current_user.full_name,
        email=current_user.email,
        role=current_user.role,
        has_password=current_user.password_hash is not None,
        has_firebase=current_user.firebase_uid is not None,
        created_at=current_user.created_at,
    )


@router.patch(
    "/settings/profile",
    response_model=AdminProfileResponse,
)
def update_admin_profile(
    payload: AdminProfileUpdate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> AdminProfileResponse:
    """Update current administrator full_name. Email and role changes are strictly prohibited."""
    clean_name = payload.full_name.strip()
    if len(clean_name) < 2 or len(clean_name) > 120:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Full name must be between 2 and 120 characters.",
        )

    previous_name = current_user.full_name

    try:
        user_in_db = db.get(User, current_user.id)
        if user_in_db is None:
            raise HTTPException(status_code=404, detail="User not found.")

        user_in_db.full_name = clean_name

        audit_entry = AuditLog(
            actor_user_id=current_user.id,
            patient_profile_id=None,
            doctor_profile_id=None,
            event_type="admin.profile_updated",
            resource_type="user",
            resource_id=str(current_user.id),
            outcome="success",
            details={
                "action": "update_admin_profile",
                "previous_full_name": previous_name,
                "new_full_name": clean_name,
            },
        )
        db.add(audit_entry)

        db.commit()
        db.refresh(user_in_db)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update administrator profile.",
        )

    return AdminProfileResponse(
        id=user_in_db.id,
        full_name=user_in_db.full_name,
        email=user_in_db.email,
        role=user_in_db.role,
        has_password=user_in_db.password_hash is not None,
        has_firebase=user_in_db.firebase_uid is not None,
        created_at=user_in_db.created_at,
    )


# =========================================================
# 12. ADMIN SETTINGS - SYSTEM INFORMATION (NON-SECRET)
# =========================================================

@router.get(
    "/settings/system",
    response_model=AdminSystemSettingsResponse,
)
def get_admin_system_settings(
    current_user: User = Depends(require_roles("admin")),
) -> AdminSystemSettingsResponse:
    """Return safe non-secret configuration only. Never returns passwords, keys, or secrets."""
    return AdminSystemSettingsResponse(
        app_name=settings.app_name,
        environment=settings.environment,
        api_version="v1",
        jwt_algorithm=settings.jwt_algorithm,
        access_token_expire_minutes=settings.access_token_expire_minutes,
        refresh_token_expire_days=settings.refresh_token_expire_days,
        notification_retention_days=90,
        database_engine="PostgreSQL",
        database_status="connected",
        cors_allowed_origins_count=len(settings.cors_origin_list),
    )


# =========================================================
# 13. ADMIN SETTINGS - SECURITY & ACTIVE SESSIONS
# =========================================================

@router.get(
    "/settings/security",
    response_model=AdminSecuritySettingsResponse,
)
def get_admin_security_settings(
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminSecuritySettingsResponse:
    """Return current administrator's own session count and relevant audit summary."""
    now = datetime.now(timezone.utc)
    active_sessions = db.scalar(
        select(func.count(RefreshToken.id)).where(
            RefreshToken.user_id == current_user.id,
            RefreshToken.is_revoked.is_(False),
            RefreshToken.expires_at > now,
        )
    ) or 0

    recent_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.actor_user_id == current_user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(5)
    ).all()

    audit_items = [
        AdminSecurityAuditEventItem(
            id=log.id,
            event_type=log.event_type,
            resource_type=log.resource_type,
            outcome=log.outcome,
            created_at=log.created_at,
        )
        for log in recent_logs
    ]

    return AdminSecuritySettingsResponse(
        admin_user_id=current_user.id,
        email=current_user.email,
        active_sessions_count=active_sessions,
        recent_audit_events=audit_items,
    )


# =========================================================
# 14. ADMIN SETTINGS - NOTIFICATIONS METRICS
# =========================================================

@router.get(
    "/settings/notifications",
    response_model=AdminNotificationSettingsResponse,
)
def get_admin_notification_settings(
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AdminNotificationSettingsResponse:
    """Return platform notification operational statistics without exposing other users' bodies."""
    total_notifications = db.scalar(select(func.count(Notification.id))) or 0
    unread_admin = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.recipient_user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    ) or 0

    return AdminNotificationSettingsResponse(
        total_notifications_sent=total_notifications,
        unread_notifications_count=unread_admin,
        supported_notification_types=[
            "appointment.booked",
            "appointment.cancelled",
            "appointment.rescheduled",
            "prescription.created",
            "doctor.onboarded",
            "doctor.verification.approved",
            "doctor.verification.rejected",
            "doctor.verification.suspended",
        ],
    )
