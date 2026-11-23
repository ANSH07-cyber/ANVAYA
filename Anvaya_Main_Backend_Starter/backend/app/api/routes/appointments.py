from datetime import datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles, verify_csrf_and_origin
from app.db.session import get_db

from app.models.appointment import Appointment
from app.models.appointment_reschedule_proposal import AppointmentRescheduleProposal
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User

from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentRead,
    AppointmentListResponse,
    AppointmentReschedule,
    DoctorAppointmentCancel,
    DoctorAppointmentRead,
    DoctorAppointmentListResponse,
)
from app.schemas.appointment_reschedule_proposal import (
    RescheduleProposalCreate,
    RescheduleProposalRespond,
    RescheduleProposalRead,
    RescheduleProposalListResponse,
)
from app.schemas.health_record import ConsultationCompletion, HealthRecordRead

from app.services.appointment_service import generate_available_slots
from app.services.audit_service import add_audit_log
from app.services.notification_service import (
    notify_appointment_booked,
    notify_appointment_cancelled,
    notify_appointment_rescheduled,
    notify_reschedule_proposed,
    notify_reschedule_response,
)


IST = ZoneInfo("Asia/Kolkata")


def sanitize_patient_appointment_reason(reason: str | None) -> str | None:
    """Sanitizes appointment reason for patient-facing endpoints.

    Ensures internal doctor cancellation justifications or legacy appended
    doctor notes are strictly excluded from patient-visible serialization,
    preserving only the patient's original consultation complaint.
    """
    if not reason:
        return reason
    if " | [Doctor Cancelled:" in reason:
        cleaned = reason.split(" | [Doctor Cancelled:")[0].strip()
        return cleaned if cleaned else None
    if reason.startswith("[Doctor Cancelled:"):
        return None
    return reason


def _to_utc(dt: datetime) -> datetime:
    """Ensures a datetime is timezone-aware in UTC across SQLite and PostgreSQL engines."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_proposal_read(
    db: Session,
    proposal: AppointmentRescheduleProposal,
    appointment: Appointment | None = None,
) -> RescheduleProposalRead:
    doctor_user = db.scalar(
        select(User)
        .join(DoctorProfile, DoctorProfile.user_id == User.id)
        .where(DoctorProfile.id == proposal.doctor_profile_id)
    )
    doctor_profile = db.get(DoctorProfile, proposal.doctor_profile_id)
    patient_user = db.scalar(
        select(User)
        .join(PatientProfile, PatientProfile.user_id == User.id)
        .where(PatientProfile.id == proposal.patient_profile_id)
    )

    if appointment is None:
        appointment = db.get(Appointment, proposal.appointment_id)

    return RescheduleProposalRead(
        id=proposal.id,
        appointment_id=proposal.appointment_id,
        doctor_profile_id=proposal.doctor_profile_id,
        patient_profile_id=proposal.patient_profile_id,
        proposed_date=proposal.proposed_date,
        proposed_start_time=proposal.proposed_start_time,
        proposed_end_time=proposal.proposed_end_time,
        doctor_message=proposal.doctor_message,
        status=proposal.status,
        created_at=proposal.created_at,
        expires_at=proposal.expires_at,
        resolved_at=proposal.resolved_at,
        doctor_name=doctor_user.full_name if doctor_user else "Doctor",
        doctor_specialization=doctor_profile.specialization if doctor_profile else None,
        patient_name=patient_user.full_name if patient_user else "Patient",
        current_appointment_date=appointment.appointment_date if appointment else None,
        current_start_time=appointment.start_time if appointment else None,
        current_end_time=appointment.end_time if appointment else None,
    )


def _expire_stale_proposals_for_appointment(
    db: Session,
    appointment_id: UUID,
) -> None:
    """Expires any active proposals whose expiration deadline has passed."""
    now_utc = datetime.now(timezone.utc)
    proposals = db.scalars(
        select(AppointmentRescheduleProposal)
        .where(
            AppointmentRescheduleProposal.appointment_id == appointment_id,
            AppointmentRescheduleProposal.status == "pending",
        )
    ).all()
    for prop in proposals:
        if _to_utc(prop.expires_at) <= now_utc:
            prop.status = "expired"
            prop.resolved_at = now_utc


router = APIRouter(
    prefix="/appointments",
    tags=["Appointments"],
)


# =========================================================
# 1. CREATE APPOINTMENT - PATIENT
# =========================================================

@router.post(
    "",
    response_model=AppointmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> AppointmentRead:

    if (
        payload.start_time.tzinfo is not None
        and payload.start_time.utcoffset() is not None
    ):
        raise HTTPException(
            status_code=422,
            detail="Use local IST time without a timezone offset.",
        )

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

    available_slots = generate_available_slots(
        db=db,
        doctor_profile_id=doctor_profile.id,
        appointment_date=payload.appointment_date,
    )

    selected_slot = next(
        (
            slot for slot in available_slots
            if slot.start_time == payload.start_time
        ),
        None,
    )

    if selected_slot is None:
        raise HTTPException(
            status_code=409,
            detail="Selected slot is unavailable.",
        )

    patient_conflict = db.scalar(
        select(Appointment).where(
            Appointment.patient_profile_id == patient_profile.id,
            Appointment.appointment_date == payload.appointment_date,
            Appointment.status == "booked",
            Appointment.start_time < selected_slot.end_time,
            Appointment.end_time > selected_slot.start_time,
        ).limit(1)
    )

    if patient_conflict is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an overlapping appointment.",
        )

    appointment = Appointment(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        appointment_date=payload.appointment_date,
        start_time=selected_slot.start_time,
        end_time=selected_slot.end_time,
        status="booked",
        reason=payload.reason,
    )

    try:
        db.add(appointment)
        db.flush()

        doctor_user = db.get(User, doctor_profile.user_id)
        notify_appointment_booked(
            db,
            appointment_id=appointment.id,
            appointment_date=appointment.appointment_date,
            start_time=appointment.start_time,
            patient_user_id=current_user.id,
            doctor_user_id=doctor_profile.user_id,
            doctor_name=doctor_user.full_name if doctor_user else None,
        )

        db.commit()
        db.refresh(appointment)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Appointment could not be created.",
        )

    return appointment


# =========================================================
# 2. GET MY APPOINTMENTS - PATIENT
# =========================================================

@router.get(
    "/me",
    response_model=AppointmentListResponse,
)
def get_my_appointments(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> AppointmentListResponse:

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

    total = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.patient_profile_id == patient_profile.id
        )
    ) or 0

    appointments = db.scalars(
        select(Appointment)
        .where(
            Appointment.patient_profile_id == patient_profile.id
        )
        .order_by(
            Appointment.appointment_date.desc(),
            Appointment.start_time.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = [
        AppointmentRead(
            id=appt.id,
            patient_profile_id=appt.patient_profile_id,
            doctor_profile_id=appt.doctor_profile_id,
            appointment_date=appt.appointment_date,
            start_time=appt.start_time,
            end_time=appt.end_time,
            status=appt.status,
            reason=sanitize_patient_appointment_reason(appt.reason),
            revision=appt.revision,
            created_at=appt.created_at,
            updated_at=appt.updated_at,
        )
        for appt in appointments
    ]

    return AppointmentListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 3. GET MY APPOINTMENTS - DOCTOR
# =========================================================

@router.get(
    "/doctor/me",
    response_model=DoctorAppointmentListResponse,
)
def get_doctor_appointments(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorAppointmentListResponse:

    doctor_profile = db.scalar(
        select(DoctorProfile).where(
            DoctorProfile.user_id == current_user.id
        )
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Doctor profile not found.",
        )

    total = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.doctor_profile_id == doctor_profile.id
        )
    ) or 0

    rows = db.execute(
        select(Appointment, User.full_name)
        .join(
            PatientProfile,
            PatientProfile.id == Appointment.patient_profile_id,
        )
        .join(
            User,
            User.id == PatientProfile.user_id,
        )
        .where(
            Appointment.doctor_profile_id == doctor_profile.id
        )
        .order_by(
            Appointment.appointment_date.desc(),
            Appointment.start_time.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = []

    for appointment, patient_name in rows:
        appointment_data = {
            "id": appointment.id,
            "patient_profile_id": appointment.patient_profile_id,
            "doctor_profile_id": appointment.doctor_profile_id,
            "appointment_date": appointment.appointment_date,
            "start_time": appointment.start_time,
            "end_time": appointment.end_time,
            "status": appointment.status,
            "reason": appointment.reason,
            "created_at": appointment.created_at,
            "updated_at": appointment.updated_at,
            "patient_name": patient_name,
        }

        items.append(
            DoctorAppointmentRead.model_validate(appointment_data)
        )

    return DoctorAppointmentListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 3a. GET MY PENDING PROPOSALS - PATIENT
# =========================================================

@router.get(
    "/proposals/pending",
    response_model=RescheduleProposalListResponse,
)
def get_my_pending_proposals(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> RescheduleProposalListResponse:
    patient_profile = db.scalar(
        select(PatientProfile).where(
            PatientProfile.user_id == current_user.id
        )
    )

    if patient_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient profile not found.",
        )

    # Lazy-expire pending proposals past their expiration deadline
    now_utc = datetime.now(timezone.utc)
    pending_proposals = db.scalars(
        select(AppointmentRescheduleProposal).where(
            AppointmentRescheduleProposal.patient_profile_id == patient_profile.id,
            AppointmentRescheduleProposal.status == "pending",
        )
    ).all()
    has_stale = False
    for prop in pending_proposals:
        if _to_utc(prop.expires_at) <= now_utc:
            prop.status = "expired"
            prop.resolved_at = now_utc
            has_stale = True
    if has_stale:
        db.commit()

    total = db.scalar(
        select(func.count(AppointmentRescheduleProposal.id)).where(
            AppointmentRescheduleProposal.patient_profile_id == patient_profile.id,
            AppointmentRescheduleProposal.status == "pending",
        )
    ) or 0

    proposals = db.scalars(
        select(AppointmentRescheduleProposal)
        .where(
            AppointmentRescheduleProposal.patient_profile_id == patient_profile.id,
            AppointmentRescheduleProposal.status == "pending",
        )
        .order_by(
            AppointmentRescheduleProposal.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    items = [_build_proposal_read(db, prop) for prop in proposals]

    return RescheduleProposalListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 3b. RESPOND TO PROPOSAL (ACCEPT / DECLINE) - PATIENT
# =========================================================

@router.patch(
    "/proposals/{proposal_id}/respond",
    response_model=RescheduleProposalRead,
)
def respond_to_reschedule_proposal(
    proposal_id: UUID,
    payload: RescheduleProposalRespond,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> RescheduleProposalRead:
    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    patient_profile = db.scalar(
        select(PatientProfile)
        .where(PatientProfile.user_id == current_user.id)
        .with_for_update()
    )

    if patient_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient profile not found.",
        )

    # 1. Unlocked lookup to retrieve appointment_id and perform ownership check
    raw_proposal = db.scalar(
        select(AppointmentRescheduleProposal).where(
            AppointmentRescheduleProposal.id == proposal_id
        )
    )

    if raw_proposal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reschedule proposal not found.",
        )

    if raw_proposal.patient_profile_id != patient_profile.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot respond to another patient's reschedule proposal.",
        )

    # 2. Strict hierarchical locking: Lock Appointment FIRST
    appointment = db.scalar(
        select(Appointment)
        .where(Appointment.id == raw_proposal.appointment_id)
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original appointment not found.",
        )

    # 3. Lock AppointmentRescheduleProposal SECOND
    proposal = db.scalar(
        select(AppointmentRescheduleProposal)
        .where(AppointmentRescheduleProposal.id == proposal_id)
        .with_for_update()
    )

    if proposal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reschedule proposal not found.",
        )

    # 4. Idempotent replay check
    if (
        effective_idempotency_key
        and proposal.resolution_idempotency_key == effective_idempotency_key
    ):
        return _build_proposal_read(db, proposal, appointment)

    now_utc = datetime.now(timezone.utc)
    now_ist = datetime.now(IST)

    if proposal.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This proposal is no longer pending (current status: {proposal.status}).",
        )

    if _to_utc(proposal.expires_at) <= now_utc:
        proposal.status = "expired"
        proposal.resolved_at = now_utc
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This reschedule proposal has expired.",
        )

    # Verify original appointment is still booked and untouched
    if appointment.status != "booked":
        proposal.status = "superseded"
        proposal.resolved_at = now_utc
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Original appointment is no longer booked (current status: {appointment.status}).",
        )

    # Prevent acceptance if original appointment has already started
    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if appointment_start <= now_ist:
        proposal.status = "superseded"
        proposal.resolved_at = now_utc
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The original appointment has already started or passed.",
        )

    # Prevent acceptance if proposed slot is in the past
    proposed_start_dt = datetime.combine(
        proposal.proposed_date,
        proposal.proposed_start_time,
    ).replace(tzinfo=IST)

    if proposed_start_dt <= now_ist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The proposed slot is in the past and can no longer be accepted.",
        )

    doctor_profile = db.get(DoctorProfile, proposal.doctor_profile_id)
    doctor_user_id = doctor_profile.user_id if doctor_profile else None

    if payload.action == "accept":
        # 1. Re-validate doctor availability for proposed slot
        available_slots = generate_available_slots(
            db=db,
            doctor_profile_id=proposal.doctor_profile_id,
            appointment_date=proposal.proposed_date,
        )
        is_available = any(
            slot.start_time == proposal.proposed_start_time
            for slot in available_slots
        )
        if not is_available:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The proposed slot is no longer available in the doctor's schedule. Please contact your practitioner.",
            )

        # 2. Check for patient conflicts at the proposed slot
        patient_conflict = db.scalar(
            select(Appointment).where(
                Appointment.patient_profile_id == patient_profile.id,
                Appointment.id != appointment.id,
                Appointment.appointment_date == proposal.proposed_date,
                Appointment.status == "booked",
                Appointment.start_time < proposal.proposed_end_time,
                Appointment.end_time > proposal.proposed_start_time,
            ).limit(1)
        )
        if patient_conflict is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You already have another booked appointment during the proposed time.",
            )

        # 3. Apply atomic update to appointment
        appointment.appointment_date = proposal.proposed_date
        appointment.start_time = proposal.proposed_start_time
        appointment.end_time = proposal.proposed_end_time
        appointment.revision = (appointment.revision or 0) + 1
        appointment.last_idempotency_key = effective_idempotency_key

        proposal.status = "accepted"
        proposal.resolved_at = now_utc
        proposal.resolution_idempotency_key = effective_idempotency_key

        # Invalidate any other proposals for this appointment
        db.execute(
            update(AppointmentRescheduleProposal)
            .where(
                AppointmentRescheduleProposal.appointment_id == appointment.id,
                AppointmentRescheduleProposal.id != proposal.id,
                AppointmentRescheduleProposal.status == "pending",
            )
            .values(status="superseded", resolved_at=now_utc)
        )

        try:
            if doctor_user_id:
                notify_reschedule_response(
                    db,
                    appointment_id=appointment.id,
                    proposal_id=proposal.id,
                    action="accept",
                    doctor_user_id=doctor_user_id,
                    patient_user_id=current_user.id,
                    patient_name=current_user.full_name,
                    proposed_date=proposal.proposed_date,
                    proposed_start_time=proposal.proposed_start_time,
                )

            add_audit_log(
                db,
                actor_user_id=current_user.id,
                patient_profile_id=patient_profile.id,
                doctor_profile_id=proposal.doctor_profile_id,
                event_type="appointment.reschedule_accepted",
                resource_type="appointment_reschedule_proposal",
                resource_id=proposal.id,
                outcome="success",
                details={
                    "appointment_id": str(appointment.id),
                    "new_date": str(appointment.appointment_date),
                    "new_start_time": str(appointment.start_time),
                    "revision": appointment.revision,
                },
            )

            db.commit()
            db.refresh(appointment)
            db.refresh(proposal)

        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Appointment could not be rescheduled due to a scheduling conflict.",
            )

    else:
        # Patient declined
        proposal.status = "declined"
        proposal.resolved_at = now_utc
        proposal.resolution_idempotency_key = effective_idempotency_key

        try:
            if doctor_user_id:
                notify_reschedule_response(
                    db,
                    appointment_id=appointment.id,
                    proposal_id=proposal.id,
                    action="decline",
                    doctor_user_id=doctor_user_id,
                    patient_user_id=current_user.id,
                    patient_name=current_user.full_name,
                    original_date=appointment.appointment_date,
                    original_start_time=appointment.start_time,
                )

            add_audit_log(
                db,
                actor_user_id=current_user.id,
                patient_profile_id=patient_profile.id,
                doctor_profile_id=proposal.doctor_profile_id,
                event_type="appointment.reschedule_declined",
                resource_type="appointment_reschedule_proposal",
                resource_id=proposal.id,
                outcome="success",
                details={
                    "appointment_id": str(appointment.id),
                    "original_date": str(appointment.appointment_date),
                    "original_start_time": str(appointment.start_time),
                },
            )

            db.commit()
            db.refresh(proposal)

        except Exception:
            db.rollback()
            raise

    return _build_proposal_read(db, proposal, appointment)


# =========================================================
# 3c. GET APPOINTMENT BY ID - DOCTOR / PATIENT
# =========================================================

@router.get(
    "/{appointment_id}",
    response_model=DoctorAppointmentRead,
)
def get_appointment_by_id(
    appointment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DoctorAppointmentRead:
    if current_user.role == "doctor":
        doctor_profile = db.scalar(
            select(DoctorProfile).where(
                DoctorProfile.user_id == current_user.id
            )
        )

        if doctor_profile is None:
            raise HTTPException(
                status_code=404,
                detail="Doctor profile not found.",
            )

        if doctor_profile.verification_status != "approved":
            raise HTTPException(
                status_code=403,
                detail="Only approved doctors can view appointments.",
            )

        row = db.execute(
            select(Appointment, User.full_name)
            .join(
                PatientProfile,
                PatientProfile.id == Appointment.patient_profile_id,
            )
            .join(
                User,
                User.id == PatientProfile.user_id,
            )
            .where(
                Appointment.id == appointment_id,
                Appointment.doctor_profile_id == doctor_profile.id,
            )
        ).first()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Appointment not found.",
            )

        appointment, patient_name = row
        return DoctorAppointmentRead(
            id=appointment.id,
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=appointment.doctor_profile_id,
            appointment_date=appointment.appointment_date,
            start_time=appointment.start_time,
            end_time=appointment.end_time,
            status=appointment.status,
            reason=appointment.reason,
            created_at=appointment.created_at,
            updated_at=appointment.updated_at,
            patient_name=patient_name,
        )

    elif current_user.role == "patient":
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

        row = db.execute(
            select(Appointment, User.full_name)
            .join(
                PatientProfile,
                PatientProfile.id == Appointment.patient_profile_id,
            )
            .join(
                User,
                User.id == PatientProfile.user_id,
            )
            .where(
                Appointment.id == appointment_id,
                Appointment.patient_profile_id == patient_profile.id,
            )
        ).first()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Appointment not found.",
            )

        appointment, patient_name = row
        return DoctorAppointmentRead(
            id=appointment.id,
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=appointment.doctor_profile_id,
            appointment_date=appointment.appointment_date,
            start_time=appointment.start_time,
            end_time=appointment.end_time,
            status=appointment.status,
            reason=sanitize_patient_appointment_reason(appointment.reason),
            created_at=appointment.created_at,
            updated_at=appointment.updated_at,
            patient_name=patient_name,
        )

    else:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )


# =========================================================
# 3d. GET PROPOSALS FOR APPOINTMENT - DOCTOR / PATIENT
# =========================================================

@router.get(
    "/{appointment_id}/proposals",
    response_model=RescheduleProposalListResponse,
)
def get_appointment_proposals(
    appointment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RescheduleProposalListResponse:
    appointment = db.get(Appointment, appointment_id)
    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found.",
        )

    # Ownership check
    if current_user.role == "doctor":
        doctor_profile = db.scalar(
            select(DoctorProfile).where(DoctorProfile.user_id == current_user.id)
        )
        if not doctor_profile or appointment.doctor_profile_id != doctor_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view proposals for this appointment.",
            )
    elif current_user.role == "patient":
        patient_profile = db.scalar(
            select(PatientProfile).where(PatientProfile.user_id == current_user.id)
        )
        if not patient_profile or appointment.patient_profile_id != patient_profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view proposals for this appointment.",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized role.",
        )

    # Lazy-expire stale pending proposals
    _expire_stale_proposals_for_appointment(db, appointment.id)
    db.commit()

    proposals = db.scalars(
        select(AppointmentRescheduleProposal)
        .where(AppointmentRescheduleProposal.appointment_id == appointment.id)
        .order_by(AppointmentRescheduleProposal.created_at.desc())
    ).all()

    items = [_build_proposal_read(db, prop, appointment) for prop in proposals]

    return RescheduleProposalListResponse(
        items=items,
        total=len(items),
        limit=len(items) or 20,
        offset=0,
    )


# =========================================================
# 3c. CANCEL APPOINTMENT - DOCTOR
# =========================================================

@router.patch(
    "/doctor/{appointment_id}/cancel",
    response_model=DoctorAppointmentRead,
)
def cancel_doctor_appointment(
    appointment_id: UUID,
    payload: DoctorAppointmentCancel,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> DoctorAppointmentRead:
    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    # 1. Doctor account status check
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive doctor account.",
        )

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

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors can cancel appointments.",
        )

    # 2. Appointment lookup and row-level locking
    appointment = db.scalar(
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found.",
        )

    # 3. Ownership check: Must belong to authenticated doctor
    if appointment.doctor_profile_id != doctor_profile.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot cancel another doctor's appointment.",
        )

    # 4. Idempotency replay check
    if (
        effective_idempotency_key
        and appointment.status == "cancelled"
        and appointment.last_idempotency_key == effective_idempotency_key
    ):
        patient_user = db.scalar(
            select(User)
            .join(PatientProfile, PatientProfile.user_id == User.id)
            .where(PatientProfile.id == appointment.patient_profile_id)
        )
        patient_name = patient_user.full_name if patient_user and patient_user.full_name else "Patient Consultation"

        return DoctorAppointmentRead(
            id=appointment.id,
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=appointment.doctor_profile_id,
            appointment_date=appointment.appointment_date,
            start_time=appointment.start_time,
            end_time=appointment.end_time,
            status=appointment.status,
            reason=appointment.reason,
            revision=appointment.revision,
            created_at=appointment.created_at,
            updated_at=appointment.updated_at,
            patient_name=patient_name,
            cancellation_reason=payload.cancellation_reason.strip(),
        )

    # 5. Status check: Only booked appointments can be cancelled
    if appointment.status != "booked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only booked appointments can be cancelled (current status: {appointment.status}).",
        )

    # 6. Future appointment check (start time must be in the future)
    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if appointment_start <= datetime.now(IST):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Appointments cannot be cancelled after their start time.",
        )

    # 7. Apply state transition and update metadata
    clean_reason = payload.cancellation_reason.strip()
    appointment.status = "cancelled"
    appointment.revision = (appointment.revision or 0) + 1
    appointment.last_idempotency_key = effective_idempotency_key

    # NOTE: appointment.reason preserves patient-visible consultation reason intact.
    # We do NOT overwrite or append doctor private notes to appointment.reason,
    # ensuring complete non-disclosure of internal operational/medical details to patients.

    patient_profile = db.get(PatientProfile, appointment.patient_profile_id)
    patient_user_id = patient_profile.user_id if patient_profile else None

    try:
        if patient_user_id:
            notify_appointment_cancelled(
                db,
                appointment_id=appointment.id,
                appointment_date=appointment.appointment_date,
                start_time=appointment.start_time,
                patient_user_id=patient_user_id,
                doctor_user_id=current_user.id,
                cancelled_by="doctor",
            )

        # Audit event records cancellation event securely (omits free-text PHI from audit metadata)
        add_audit_log(
            db,
            actor_user_id=current_user.id,
            event_type="appointment.cancelled_by_doctor",
            resource_type="appointment",
            resource_id=appointment.id,
            outcome="success",
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            details={
                "action": "doctor_cancellation",
                "cancellation_reason_provided": bool(clean_reason),
                "revision": appointment.revision,
            },
        )

        # Invalidate any pending reschedule proposals for this appointment
        db.execute(
            update(AppointmentRescheduleProposal)
            .where(
                AppointmentRescheduleProposal.appointment_id == appointment.id,
                AppointmentRescheduleProposal.status == "pending",
            )
            .values(
                status="superseded",
                resolved_at=datetime.now(timezone.utc),
            )
        )

        db.commit()
        db.refresh(appointment)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Appointment cancellation could not be completed.",
        )
    except Exception:
        db.rollback()
        raise

    patient_user = db.scalar(
        select(User)
        .join(PatientProfile, PatientProfile.user_id == User.id)
        .where(PatientProfile.id == appointment.patient_profile_id)
    )
    patient_name = patient_user.full_name if patient_user and patient_user.full_name else "Patient Consultation"

    return DoctorAppointmentRead(
        id=appointment.id,
        patient_profile_id=appointment.patient_profile_id,
        doctor_profile_id=appointment.doctor_profile_id,
        appointment_date=appointment.appointment_date,
        start_time=appointment.start_time,
        end_time=appointment.end_time,
        status=appointment.status,
        reason=appointment.reason,
        revision=appointment.revision,
        created_at=appointment.created_at,
        updated_at=appointment.updated_at,
        patient_name=patient_name,
        cancellation_reason=clean_reason,
    )


# =========================================================
# 3e. PROPOSE RESCHEDULE - DOCTOR
# =========================================================

@router.post(
    "/doctor/{appointment_id}/propose-reschedule",
    response_model=RescheduleProposalRead,
    status_code=status.HTTP_201_CREATED,
)
def propose_doctor_appointment_reschedule(
    appointment_id: UUID,
    payload: RescheduleProposalCreate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> RescheduleProposalRead:
    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive doctor account.",
        )

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

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved doctors can propose rescheduling appointments.",
        )

    appointment = db.scalar(
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found.",
        )

    if appointment.doctor_profile_id != doctor_profile.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot propose rescheduling another doctor's appointment.",
        )

    if appointment.status != "booked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only booked appointments can be rescheduled (current status: {appointment.status}).",
        )

    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    now_ist = datetime.now(IST)

    if appointment_start <= now_ist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Past or started appointments cannot be rescheduled.",
        )

    # Lead time check: Require at least 3 hours before original appointment start
    min_proposal_lead = now_ist + timedelta(hours=3)
    if appointment_start < min_proposal_lead:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Appointments starting in less than 3 hours cannot be rescheduled via proposal. Please cancel or contact the patient directly.",
        )

    # Validate proposed slot is strictly in the future
    proposed_start_dt = datetime.combine(
        payload.proposed_date,
        payload.proposed_start_time,
    ).replace(tzinfo=IST)

    if proposed_start_dt <= now_ist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Proposed slot must be in the future.",
        )

    # Reject proposed slot if identical to current slot
    if (
        appointment.appointment_date == payload.proposed_date
        and appointment.start_time == payload.proposed_start_time
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Proposed slot is identical to the current appointment slot.",
        )

    # 1. Lazy-expire any stale pending proposals for this appointment
    _expire_stale_proposals_for_appointment(db, appointment.id)

    # 2. Check for duplicate active proposals
    active_proposal = db.scalar(
        select(AppointmentRescheduleProposal)
        .where(
            AppointmentRescheduleProposal.appointment_id == appointment.id,
            AppointmentRescheduleProposal.status == "pending",
        )
        .with_for_update()
    )

    if active_proposal is not None:
        # Idempotent replay check
        if (
            effective_idempotency_key
            and active_proposal.resolution_idempotency_key == effective_idempotency_key
        ):
            return _build_proposal_read(db, active_proposal, appointment)

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A reschedule proposal is already pending patient response for this appointment.",
        )

    # 3. Validate proposed slot availability against doctor's schedule
    available_slots = generate_available_slots(
        db=db,
        doctor_profile_id=doctor_profile.id,
        appointment_date=payload.proposed_date,
    )

    selected_slot = next(
        (
            slot for slot in available_slots
            if slot.start_time == payload.proposed_start_time
        ),
        None,
    )

    if selected_slot is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Selected proposed slot is unavailable in doctor schedule.",
        )

    # 4. Calculate expiration deadline:
    # Earlier of now + 48 hours or appointment start minus 2 hours.
    # Guaranteed to be at least 1 hour in the future and strictly before appointment start.
    proposal_created = datetime.now(timezone.utc)
    max_expiration = proposal_created + timedelta(hours=48)
    appointment_start_utc = appointment_start.astimezone(timezone.utc)
    lead_cutoff = appointment_start_utc - timedelta(hours=2)
    expires_at = min(max_expiration, lead_cutoff)

    # 5. Insert proposal
    clean_message = payload.doctor_message.strip() if payload.doctor_message else None
    proposal = AppointmentRescheduleProposal(
        appointment_id=appointment.id,
        doctor_profile_id=doctor_profile.id,
        patient_profile_id=appointment.patient_profile_id,
        proposed_date=payload.proposed_date,
        proposed_start_time=selected_slot.start_time,
        proposed_end_time=selected_slot.end_time,
        doctor_message=clean_message,
        status="pending",
        created_at=proposal_created,
        expires_at=expires_at,
        resolution_idempotency_key=effective_idempotency_key,
    )

    patient_profile = db.get(PatientProfile, appointment.patient_profile_id)
    patient_user_id = patient_profile.user_id if patient_profile else None

    try:
        db.add(proposal)
        db.flush()

        if patient_user_id:
            notify_reschedule_proposed(
                db,
                appointment_id=appointment.id,
                proposal_id=proposal.id,
                proposed_date=proposal.proposed_date,
                proposed_start_time=proposal.proposed_start_time,
                patient_user_id=patient_user_id,
                doctor_name=current_user.full_name,
            )

        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            event_type="appointment.reschedule_proposed",
            resource_type="appointment_reschedule_proposal",
            resource_id=proposal.id,
            outcome="success",
            details={
                "appointment_id": str(appointment.id),
                "proposed_date": str(proposal.proposed_date),
                "proposed_start_time": str(proposal.proposed_start_time),
                "has_message": bool(clean_message),
            },
        )

        db.commit()
        db.refresh(proposal)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Reschedule proposal could not be created.",
        )
    except Exception:
        db.rollback()
        raise

    return _build_proposal_read(db, proposal, appointment)


# =========================================================
# 4. CANCEL APPOINTMENT - PATIENT
# =========================================================

@router.patch(
    "/{appointment_id}/cancel",
    response_model=AppointmentRead,
)
def cancel_my_appointment(
    appointment_id: UUID,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> AppointmentRead:

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

    appointment = db.scalar(
        select(Appointment)
        .where(
            Appointment.id == appointment_id,
            Appointment.patient_profile_id == patient_profile.id,
        )
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )

    if appointment.status != "booked":
        raise HTTPException(
            status_code=409,
            detail="Only booked appointments can be cancelled.",
        )

    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if appointment_start <= datetime.now(IST):
        raise HTTPException(
            status_code=409,
            detail="Appointments cannot be cancelled after their start time.",
        )

    appointment.status = "cancelled"

    try:
        doctor_profile = db.get(DoctorProfile, appointment.doctor_profile_id)
        if doctor_profile:
            notify_appointment_cancelled(
                db,
                appointment_id=appointment.id,
                appointment_date=appointment.appointment_date,
                start_time=appointment.start_time,
                patient_user_id=current_user.id,
                doctor_user_id=doctor_profile.user_id,
            )

        # Invalidate any pending reschedule proposals for this appointment
        db.execute(
            update(AppointmentRescheduleProposal)
            .where(
                AppointmentRescheduleProposal.appointment_id == appointment.id,
                AppointmentRescheduleProposal.status == "pending",
            )
            .values(
                status="superseded",
                resolved_at=datetime.now(timezone.utc),
            )
        )

        db.commit()
        db.refresh(appointment)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Appointment cancellation could not be completed.",
        )

    return appointment


# =========================================================
# 5. RESCHEDULE APPOINTMENT - PATIENT
# =========================================================

@router.patch(
    "/{appointment_id}/reschedule",
    response_model=AppointmentRead,
)
def reschedule_my_appointment(
    appointment_id: UUID,
    payload: AppointmentReschedule,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
    x_idempotency_key: str | None = Header(None, alias="X-Idempotency-Key"),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> AppointmentRead:

    effective_idempotency_key = (
        payload.idempotency_key or x_idempotency_key or idempotency_key or ""
    ).strip() or None

    if (
        payload.start_time.tzinfo is not None
        and payload.start_time.utcoffset() is not None
    ):
        raise HTTPException(
            status_code=422,
            detail="Use local IST time without a timezone offset.",
        )

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

    existing_appointment = db.scalar(
        select(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.patient_profile_id == patient_profile.id,
        )
    )

    if existing_appointment is None:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )

    doctor_profile = db.scalar(
        select(DoctorProfile)
        .join(User, User.id == DoctorProfile.user_id)
        .where(
            DoctorProfile.id == existing_appointment.doctor_profile_id,
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

    appointment = db.scalar(
        select(Appointment)
        .where(
            Appointment.id == appointment_id,
            Appointment.patient_profile_id == patient_profile.id,
        )
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )

    # 1. Network retry idempotency check:
    # If the client re-submits a previously processed reschedule request with the same idempotency key,
    # return the already-rescheduled appointment record without duplicate slot mutation or notifications.
    if effective_idempotency_key and appointment.last_idempotency_key == effective_idempotency_key:
        return appointment

    if appointment.doctor_profile_id != doctor_profile.id:
        raise HTTPException(
            status_code=409,
            detail="Appointment changed. Please retry.",
        )

    if appointment.status != "booked":
        raise HTTPException(
            status_code=409,
            detail="Only booked appointments can be rescheduled.",
        )

    current_appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if current_appointment_start <= datetime.now(IST):
        raise HTTPException(
            status_code=409,
            detail="Started appointments cannot be rescheduled.",
        )

    # 2. Reject same-slot requests that are not identical retries
    if (
        appointment.appointment_date == payload.appointment_date
        and appointment.start_time == payload.start_time
    ):
        raise HTTPException(
            status_code=409,
            detail="Selected slot is already the current appointment slot.",
        )

    available_slots = generate_available_slots(
        db=db,
        doctor_profile_id=doctor_profile.id,
        appointment_date=payload.appointment_date,
    )

    selected_slot = next(
        (
            slot for slot in available_slots
            if slot.start_time == payload.start_time
        ),
        None,
    )

    if selected_slot is None:
        raise HTTPException(
            status_code=409,
            detail="Selected reschedule slot is unavailable.",
        )

    patient_conflict = db.scalar(
        select(Appointment).where(
            Appointment.patient_profile_id == patient_profile.id,
            Appointment.id != appointment.id,
            Appointment.appointment_date == payload.appointment_date,
            Appointment.status == "booked",
            Appointment.start_time < selected_slot.end_time,
            Appointment.end_time > selected_slot.start_time,
        ).limit(1)
    )

    if patient_conflict is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have another overlapping appointment.",
        )

    appointment.appointment_date = payload.appointment_date
    appointment.start_time = selected_slot.start_time
    appointment.end_time = selected_slot.end_time
    appointment.revision = (appointment.revision or 0) + 1
    appointment.last_idempotency_key = effective_idempotency_key

    try:
        notify_appointment_rescheduled(
            db,
            appointment_id=appointment.id,
            new_date=appointment.appointment_date,
            new_start_time=appointment.start_time,
            patient_user_id=current_user.id,
            doctor_user_id=doctor_profile.user_id,
            revision=appointment.revision,
        )

        # Invalidate any pending doctor reschedule proposals for this appointment
        db.execute(
            update(AppointmentRescheduleProposal)
            .where(
                AppointmentRescheduleProposal.appointment_id == appointment.id,
                AppointmentRescheduleProposal.status == "pending",
            )
            .values(
                status="superseded",
                resolved_at=datetime.now(timezone.utc),
            )
        )

        db.commit()
        db.refresh(appointment)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Appointment rescheduling could not be completed.",
        )

    return appointment


# =========================================================
# 6. COMPLETE APPOINTMENT AND CREATE HEALTH RECORD - DOCTOR
# =========================================================

@router.patch(
    "/{appointment_id}/status",
    response_model=HealthRecordRead,
)
def update_appointment_status(
    appointment_id: UUID,
    payload: ConsultationCompletion,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> HealthRecordRead:

    # STEP 1: Find and lock the authenticated doctor's own profile.

    doctor_profile = db.scalar(
        select(DoctorProfile)
        .where(DoctorProfile.user_id == current_user.id)
        .with_for_update()
    )

    if doctor_profile is None:
        raise HTTPException(
            status_code=404,
            detail="Doctor profile not found.",
        )

    # Only approved doctors may complete consultations.

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can complete consultations.",
        )

    # STEP 2: Find and lock an appointment belonging
    # specifically to the authenticated doctor.

    appointment = db.scalar(
        select(Appointment)
        .where(
            Appointment.id == appointment_id,
            Appointment.doctor_profile_id == doctor_profile.id,
        )
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )

    # STEP 3: Only booked appointments can be completed.

    if appointment.status != "booked":
        raise HTTPException(
            status_code=409,
            detail="Only booked appointments can be completed.",
        )

    # STEP 4: Appointment must have started.

    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if appointment_start > datetime.now(IST):
        raise HTTPException(
            status_code=409,
            detail="A future appointment cannot be completed.",
        )

    # STEP 5: Build the consultation-linked health record.

    health_record = HealthRecord(
        patient_profile_id=appointment.patient_profile_id,
        doctor_profile_id=doctor_profile.id,
        appointment_id=appointment.id,
        visit_date=appointment.appointment_date,
        **payload.model_dump(),
    )

    # STEP 6: Save the health record and mark the appointment completed
    # in one transaction. Either both changes persist or neither does.

    appointment.status = "completed"
    db.add(health_record)

    try:
        db.commit()
        db.refresh(health_record)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "Consultation could not be saved or the appointment "
                "could not be completed."
            ),
        )

    return health_record
