
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


class Prescription(Base):
    __tablename__ = "prescriptions"

    __table_args__ = (
        UniqueConstraint(
            "appointment_id",
            name="uq_prescriptions_appointment",
        ),
        UniqueConstraint(
            "health_record_id",
            name="uq_prescriptions_health_record",
        ),
        Index(
            "ix_prescriptions_patient_issued",
            "patient_profile_id",
            "issued_at",
        ),
        Index(
            "ix_prescriptions_doctor_issued",
            "doctor_profile_id",
            "issued_at",
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

    health_record_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("health_records.id"),
        nullable=False,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
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

    items: Mapped[list["PrescriptionItem"]] = relationship(
        back_populates="prescription",
        cascade="all, delete-orphan",
        order_by="PrescriptionItem.sort_order",
        passive_deletes=True,
    )


class PrescriptionItem(Base):
    __tablename__ = "prescription_items"

    __table_args__ = (
        CheckConstraint(
            "length(trim(medicine_name)) > 0",
            name="ck_prescription_items_medicine_name",
        ),
        CheckConstraint(
            "length(trim(dosage)) > 0",
            name="ck_prescription_items_dosage",
        ),
        CheckConstraint(
            "length(trim(frequency)) > 0",
            name="ck_prescription_items_frequency",
        ),
        CheckConstraint(
            "length(trim(duration)) > 0",
            name="ck_prescription_items_duration",
        ),
        CheckConstraint(
            "sort_order >= 0",
            name="ck_prescription_items_sort_order",
        ),
        Index(
            "ix_prescription_items_prescription",
            "prescription_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    prescription_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("prescriptions.id", ondelete="CASCADE"),
        nullable=False,
    )

    medicine_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    dosage: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    route: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
    )

    frequency: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    duration: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    quantity: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    instructions: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    sort_order: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    prescription: Mapped["Prescription"] = relationship(
        back_populates="items",
    )
