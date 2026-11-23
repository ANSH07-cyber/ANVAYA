import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class AppointmentRescheduleProposal(Base):
    """Represents a doctor-initiated proposal to reschedule an existing booked appointment.

    Preserves the original appointment in 'booked' status until the patient explicitly accepts.
    A proposed slot is never reserved until atomic acceptance occurs.
    """

    __tablename__ = "appointment_reschedule_proposals"

    __table_args__ = (
        CheckConstraint(
            "proposed_start_time < proposed_end_time",
            name="ck_reschedule_proposal_time_range",
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined', 'expired', 'superseded')",
            name="ck_reschedule_proposal_status",
        ),
        Index(
            "uq_appointment_active_reschedule_proposal",
            "appointment_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index(
            "ix_reschedule_proposals_patient_status",
            "patient_profile_id",
            "status",
        ),
        Index(
            "ix_reschedule_proposals_doctor_status",
            "doctor_profile_id",
            "status",
        ),
        Index(
            "ix_reschedule_proposals_expires_at",
            "expires_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("appointments.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    doctor_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("doctor_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    patient_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patient_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    proposed_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    proposed_start_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    proposed_end_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    doctor_message: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    resolution_idempotency_key: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
