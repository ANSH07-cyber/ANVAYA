
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.doctor_availability import DoctorAvailability
from app.schemas.appointment import AvailableSlotRead


IST = ZoneInfo("Asia/Kolkata")


def generate_available_slots(
    db: Session,
    doctor_profile_id: UUID,
    appointment_date: date,
) -> list[AvailableSlotRead]:
    """
    Generate available appointment slots for a doctor
    on a selected date.

    Slots are generated using the doctor's active weekly
    availability and exclude already-booked appointments.

    All appointment times use Asia/Kolkata local time.
    """

    now = datetime.now(IST)
    today = now.date()
    current_local_time = now.replace(tzinfo=None)

    # Past dates cannot have available slots.
    if appointment_date < today:
        return []

    # Find the weekday of the requested date.
    # Monday = 0, Sunday = 6.
    weekday = appointment_date.weekday()

    # Fetch active weekly schedules for this doctor.
    schedules = db.scalars(
        select(DoctorAvailability)
        .where(
            DoctorAvailability.doctor_profile_id == doctor_profile_id,
            DoctorAvailability.weekday == weekday,
            DoctorAvailability.is_active.is_(True),
        )
        .order_by(DoctorAvailability.start_time)
    ).all()

    if not schedules:
        return []

    # Fetch existing booked appointments on this date.
    # Cancelled and completed appointments do not block slots.
    booked_appointments = db.execute(
        select(
            Appointment.start_time,
            Appointment.end_time,
        ).where(
            Appointment.doctor_profile_id == doctor_profile_id,
            Appointment.appointment_date == appointment_date,
            Appointment.status == "booked",
        )
    ).all()

    booked_times = list(booked_appointments)

    available_slots: list[AvailableSlotRead] = []

    for schedule in schedules:

        slot_duration = timedelta(
            minutes=schedule.slot_duration_minutes
        )

        schedule_start = datetime.combine(
            appointment_date,
            schedule.start_time,
        )

        schedule_end = datetime.combine(
            appointment_date,
            schedule.end_time,
        )

        slot_start = schedule_start

        while True:

            slot_end = slot_start + slot_duration

            # Do not generate a slot that exceeds
            # the configured schedule.
            if slot_end > schedule_end:
                break

            start_time = slot_start.time()
            end_time = slot_end.time()

            # Hide slots that have already started or passed.
            if (
                appointment_date == today
                and slot_start <= current_local_time
            ):
                slot_start = slot_end
                continue

            # Check whether an existing booking overlaps
            # this candidate slot.
            is_booked = any(
                booked_start < end_time
                and booked_end > start_time
                for booked_start, booked_end in booked_times
            )

            if not is_booked:
                available_slots.append(
                    AvailableSlotRead(
                        start_time=start_time,
                        end_time=end_time,
                    )
                )

            slot_start = slot_end

    # Keep slots in chronological order.
    available_slots.sort(
        key=lambda slot: slot.start_time
    )

    return available_slots
