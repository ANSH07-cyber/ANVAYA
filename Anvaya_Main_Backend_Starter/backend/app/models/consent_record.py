
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    __table_args__ = (
        CheckConstraint(
            "(is_active = TRUE AND revoked_at IS NULL) OR "
            "(is_active = FALSE AND revoked_at IS NOT NULL)",
            name="ck_consent_records_active_revoked_consistency",
        ),
        Index(
            "ix_consent_records_patient_doctor_active",
            "patient_profile_id",
            "doctor_profile_id",
            "is_active",
        ),
        Index(
            "ix_consent_records_doctor_active",
            "doctor_profile_id",
            "is_active",
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

    # Stores the list of health-information scopes
    # selected by the patient.
    data_scopes: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
    )

    # True means permission is currently active.
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
