import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class ConsentRequest(Base):
    """Represents a doctor-initiated request for patient consent to access EHR data scopes.

    Preserves patient sovereignty: a pending request NEVER authorizes EHR access.
    Only explicit patient approval creates or expands an active ConsentRecord.
    """

    __tablename__ = "consent_requests"

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'partially_approved', 'declined', 'expired', 'superseded')",
            name="ck_consent_request_status",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="ck_consent_request_expiry",
        ),
        Index(
            "uq_active_consent_request_doctor_patient",
            "doctor_profile_id",
            "patient_profile_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index(
            "ix_consent_requests_patient_status",
            "patient_profile_id",
            "status",
        ),
        Index(
            "ix_consent_requests_doctor_status",
            "doctor_profile_id",
            "status",
        ),
        Index(
            "ix_consent_requests_doctor_patient_status",
            "doctor_profile_id",
            "patient_profile_id",
            "status",
        ),
        Index(
            "ix_consent_requests_expires_at",
            "expires_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
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

    # Scopes requested by the doctor (list of HealthDataScope strings)
    requested_scopes: Mapped[list[str]] = mapped_column(
        JSON,
        nullable=False,
    )

    # Scopes approved by the patient (populated upon approval or partial approval)
    approved_scopes: Mapped[list[str] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # Optional clinical note/reason provided by the requesting doctor
    doctor_message: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        index=True,
    )

    # Link to the resulting or updated ConsentRecord upon approval
    consent_record_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("consent_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
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
