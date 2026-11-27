
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles, verify_csrf_and_origin
from app.db.session import get_db

from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.prescription import Prescription, PrescriptionItem
from app.models.user import User

from app.schemas.prescription import (
    PrescriptionCreate,
    PrescriptionRead,
    PrescriptionListResponse,
    DoctorPrescriptionRead,
    DoctorPrescriptionListResponse,
)

from app.services.audit_service import add_audit_log
from app.services.notification_service import notify_prescription_issued


router = APIRouter(
    prefix="/prescriptions",
    tags=["Prescriptions"],
)


# =========================================================
# 1. CREATE PRESCRIPTION - DOCTOR
# =========================================================

@router.post(
    "",
    response_model=PrescriptionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_prescription(
    payload: PrescriptionCreate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> PrescriptionRead:

    # STEP 1: Find the authenticated doctor's profile.

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

    if doctor_profile.verification_status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Only approved doctors can issue prescriptions.",
        )

    # STEP 2: Find and lock the appointment belonging
    # specifically to this doctor.

    appointment = db.scalar(
        select(Appointment)
        .where(
            Appointment.id == payload.appointment_id,
            Appointment.doctor_profile_id == doctor_profile.id,
        )
        .with_for_update()
    )

    if appointment is None:
        raise HTTPException(
            status_code=404,
            detail="Appointment not found.",
        )

    # STEP 3: Prescription can only be issued for
    # a completed appointment.

    if appointment.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Prescription can only be issued for completed appointments.",
        )

    # STEP 4: Find the health record created during
    # consultation completion.

    health_record = db.scalar(
        select(HealthRecord)
        .where(
            HealthRecord.appointment_id == appointment.id,
            HealthRecord.patient_profile_id
            == appointment.patient_profile_id,
            HealthRecord.doctor_profile_id == doctor_profile.id,
        )
        .with_for_update()
    )

    if health_record is None:
        raise HTTPException(
            status_code=409,
            detail="Completed appointment health record not found.",
        )

    # STEP 5: Prevent duplicate prescriptions.

    existing_prescription = db.scalar(
        select(Prescription).where(
            Prescription.appointment_id == appointment.id
        )
    )

    if existing_prescription is not None:
        raise HTTPException(
            status_code=409,
            detail="A prescription already exists for this appointment.",
        )

    # STEP 6: Create prescription items.
    # The backend assigns their display order.

    prescription_items = [
        PrescriptionItem(
            **item.model_dump(),
            sort_order=index,
        )
        for index, item in enumerate(payload.items)
    ]

    prescription = Prescription(
        patient_profile_id=appointment.patient_profile_id,
        doctor_profile_id=doctor_profile.id,
        appointment_id=appointment.id,
        health_record_id=health_record.id,
        notes=payload.notes,
        items=prescription_items,
    )

    # STEP 7: Save prescription, medicine items and
    # audit event in a single database transaction.

    try:
        db.add(prescription)

        # Insert prescription and generate its UUID.
        db.flush()

        # Record successful prescription creation.
        # Do not store medicine names, dosage or clinical notes
        # in audit metadata.

        add_audit_log(
            db,
            actor_user_id=current_user.id,
            patient_profile_id=appointment.patient_profile_id,
            doctor_profile_id=doctor_profile.id,
            event_type="prescription.created",
            resource_type="prescription",
            resource_id=prescription.id,
            outcome="success",
            details={
                "appointment_id": str(appointment.id),
                "health_record_id": str(health_record.id),
                "medicine_item_count": len(prescription_items),
            },
        )

        patient_profile = db.get(PatientProfile, appointment.patient_profile_id)
        if patient_profile:
            notify_prescription_issued(
                db,
                prescription_id=prescription.id,
                patient_user_id=patient_profile.user_id,
                doctor_name=current_user.full_name,
            )

        # Both prescription and audit entry commit together.
        db.commit()

        # Reload prescription with its medicine items.
        saved_prescription = db.scalar(
            select(Prescription)
            .options(selectinload(Prescription.items))
            .where(Prescription.id == prescription.id)
        )

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Prescription could not be created.",
        )

    if saved_prescription is None:
        raise HTTPException(
            status_code=500,
            detail="Prescription was saved but could not be retrieved.",
        )

    return saved_prescription


# =========================================================
# 2. GET MY PRESCRIPTIONS - PATIENT
# =========================================================

@router.get(
    "/me",
    response_model=PrescriptionListResponse,
)
def get_my_prescriptions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
) -> PrescriptionListResponse:

    # STEP 1: Find the authenticated patient's profile.

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

    patient_filter = (
        Prescription.patient_profile_id == patient_profile.id
    )

    # STEP 2: Count the patient's prescriptions.

    total = db.scalar(
        select(func.count(Prescription.id)).where(patient_filter)
    ) or 0

    # STEP 3: Retrieve prescriptions with their medicine items.

    prescriptions = db.scalars(
        select(Prescription)
        .options(selectinload(Prescription.items))
        .where(patient_filter)
        .order_by(
            Prescription.issued_at.desc(),
            Prescription.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()

    return PrescriptionListResponse(
        items=prescriptions,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 3. GET DOCTOR PRESCRIPTION HISTORY - DOCTOR
# =========================================================

@router.get(
    "/doctor/me",
    response_model=DoctorPrescriptionListResponse,
)
def get_doctor_prescriptions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=100),
    appointment_id: UUID | None = Query(default=None),
    patient_profile_id: UUID | None = Query(default=None),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorPrescriptionListResponse:

    # STEP 1: Find the authenticated doctor's profile.
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
            detail="Only approved doctors can access prescription history.",
        )

    # STEP 2: Build filters scoped strictly to this doctor.
    filters = [
        Prescription.doctor_profile_id == doctor_profile.id,
    ]

    if appointment_id is not None:
        filters.append(Prescription.appointment_id == appointment_id)

    if patient_profile_id is not None:
        filters.append(Prescription.patient_profile_id == patient_profile_id)

    if search is not None:
        search_term = search.strip()
        if search_term:
            search_pattern = f"%{search_term}%"
            medicine_match = exists().where(
                PrescriptionItem.prescription_id == Prescription.id,
                PrescriptionItem.medicine_name.ilike(search_pattern),
            )
            filters.append(
                or_(
                    User.full_name.ilike(search_pattern),
                    medicine_match,
                )
            )

    # STEP 3: Count total matching prescriptions.
    count_query = (
        select(func.count(Prescription.id))
        .join(
            PatientProfile,
            PatientProfile.id == Prescription.patient_profile_id,
        )
        .join(
            User,
            User.id == PatientProfile.user_id,
        )
        .join(
            Appointment,
            Appointment.id == Prescription.appointment_id,
        )
        .where(*filters)
    )

    total = db.scalar(count_query) or 0

    # STEP 4: Query paginated prescriptions with joined patient name and appointment date.
    rows_query = (
        select(
            Prescription,
            User.full_name.label("patient_name"),
            Appointment.appointment_date.label("appointment_date"),
        )
        .join(
            PatientProfile,
            PatientProfile.id == Prescription.patient_profile_id,
        )
        .join(
            User,
            User.id == PatientProfile.user_id,
        )
        .join(
            Appointment,
            Appointment.id == Prescription.appointment_id,
        )
        .where(*filters)
        .options(selectinload(Prescription.items))
        .order_by(
            Prescription.issued_at.desc(),
            Prescription.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    )

    rows = db.execute(rows_query).all()

    items = [
        DoctorPrescriptionRead(
            id=prescription.id,
            patient_profile_id=prescription.patient_profile_id,
            doctor_profile_id=prescription.doctor_profile_id,
            appointment_id=prescription.appointment_id,
            health_record_id=prescription.health_record_id,
            notes=prescription.notes,
            issued_at=prescription.issued_at,
            created_at=prescription.created_at,
            updated_at=prescription.updated_at,
            items=prescription.items,
            patient_name=patient_name,
            appointment_date=appointment_date,
        )
        for prescription, patient_name, appointment_date in rows
    ]

    return DoctorPrescriptionListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 4. GET DOCTOR PRESCRIPTION DETAIL BY ID - DOCTOR
# =========================================================

@router.get(
    "/doctor/{prescription_id}",
    response_model=DoctorPrescriptionRead,
)
def get_doctor_prescription_by_id(
    prescription_id: UUID,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
) -> DoctorPrescriptionRead:

    # STEP 1: Find the authenticated doctor's profile.
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
            detail="Only approved doctors can view prescription details.",
        )

    # STEP 2: Find the prescription scoped strictly to this doctor.
    row = db.execute(
        select(
            Prescription,
            User.full_name.label("patient_name"),
            Appointment.appointment_date.label("appointment_date"),
        )
        .join(
            PatientProfile,
            PatientProfile.id == Prescription.patient_profile_id,
        )
        .join(
            User,
            User.id == PatientProfile.user_id,
        )
        .join(
            Appointment,
            Appointment.id == Prescription.appointment_id,
        )
        .where(
            Prescription.id == prescription_id,
            Prescription.doctor_profile_id == doctor_profile.id,
        )
        .options(selectinload(Prescription.items))
    ).first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Prescription not found.",
        )

    prescription, patient_name, appointment_date = row

    return DoctorPrescriptionRead(
        id=prescription.id,
        patient_profile_id=prescription.patient_profile_id,
        doctor_profile_id=prescription.doctor_profile_id,
        appointment_id=prescription.appointment_id,
        health_record_id=prescription.health_record_id,
        notes=prescription.notes,
        issued_at=prescription.issued_at,
        created_at=prescription.created_at,
        updated_at=prescription.updated_at,
        items=prescription.items,
        patient_name=patient_name,
        appointment_date=appointment_date,
    )

