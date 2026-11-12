
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db

from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User

from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentRead,
    AppointmentListResponse,
    AppointmentReschedule,
    AppointmentStatusUpdate,
    DoctorAppointmentRead,
    DoctorAppointmentListResponse,
)

from app.services.appointment_service import generate_available_slots


IST = ZoneInfo("Asia/Kolkata")

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

    return AppointmentListResponse(
        items=appointments,
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

    try:
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
# 6. MARK APPOINTMENT AS COMPLETED - DOCTOR
# =========================================================

@router.patch(
    "/{appointment_id}/status",
    response_model=AppointmentRead,
)
def update_appointment_status(
    appointment_id: UUID,
    payload: AppointmentStatusUpdate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> AppointmentRead:

    # STEP 1: Find the doctor's own profile.

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

    # Only approved doctors may update consultation status.

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can update appointment status.",
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
            detail="Only booked appointments can be marked as completed.",
        )

    # STEP 4: Appointment must have started.

    appointment_start = datetime.combine(
        appointment.appointment_date,
        appointment.start_time,
    ).replace(tzinfo=IST)

    if appointment_start > datetime.now(IST):
        raise HTTPException(
            status_code=409,
            detail="A future appointment cannot be marked as completed.",
        )

    # STEP 5: Update appointment status.

    appointment.status = payload.status

    try:
        db.commit()
        db.refresh(appointment)

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Appointment status could not be updated.",
        )

    return appointment
