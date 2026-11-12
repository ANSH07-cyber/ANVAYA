import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    __table_args__ = (
        CheckConstraint(
            "length(trim(event_type)) > 0",
            name="ck_audit_logs_event_type",
        ),
        CheckConstraint(
            "length(trim(resource_type)) > 0",
            name="ck_audit_logs_resource_type",
        ),
        CheckConstraint(
            "outcome IN ('success', 'denied', 'failure')",
            name="ck_audit_logs_outcome",
        ),
        Index(
            "ix_audit_logs_actor_created",
            "actor_user_id",
            "created_at",
        ),
        Index(
            "ix_audit_logs_patient_created",
            "patient_profile_id",
            "created_at",
        ),
        Index(
            "ix_audit_logs_resource",
            "resource_type",
            "resource_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # User who performed the action.
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )

    # Patient whose data or account was involved, if applicable.
    patient_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patient_profiles.id"),
        nullable=True,
    )

    # Doctor involved in the action, if applicable.
    doctor_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("doctor_profiles.id"),
        nullable=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    resource_type: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
    )

    # Resource UUID stored as text for a consistent audit reference.
    resource_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    outcome: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    # Store only safe, non-sensitive event metadata here.
    details: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )