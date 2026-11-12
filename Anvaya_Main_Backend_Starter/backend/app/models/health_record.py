
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class HealthRecord(Base):
    __tablename__ = "health_records"

    __table_args__ = (
        UniqueConstraint(
            "appointment_id",
            name="uq_health_records_appointment",
        ),
        Index(
            "ix_health_records_patient_date",
            "patient_profile_id",
            "visit_date",
        ),
        Index(
            "ix_health_records_doctor_date",
            "doctor_profile_id",
            "visit_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    patient_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patient_profiles.id"),
        nullable=False,
    )

    doctor_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("doctor_profiles.id"),
        nullable=False,
    )

    appointment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("appointments.id"),
        nullable=False,
    )

    visit_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    chief_complaint: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    visit_summary: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    symptoms: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    diagnosis: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    clinical_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    treatment_plan: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    follow_up_instructions: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
