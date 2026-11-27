import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


class SkinLesionAnalysis(Base):
    __tablename__ = "skin_lesion_analyses"

    __table_args__ = (
        Index("ix_skin_lesion_analyses_patient", "patient_profile_id"),
        Index("ix_skin_lesion_analyses_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    patient_profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patient_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    image_path: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    image_filename: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    predicted_class: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    predicted_label: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    probabilities: Mapped[dict[str, float]] = mapped_column(
        JSON,
        nullable=False,
        default=dict,
    )

    risk_level: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="medium",
    )

    disclaimer: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # NULL preserves unknown provenance for rows predating verified inference.
    inference_mode: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    checkpoint_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    education_title: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    education_summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    reviewed_by_doctor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("doctor_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )

    doctor_notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    patient_profile = relationship("PatientProfile", foreign_keys=[patient_profile_id])
    doctor_profile = relationship("DoctorProfile", foreign_keys=[reviewed_by_doctor_id])
