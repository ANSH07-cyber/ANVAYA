import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


class Notification(Base):
    """Stores in-app operational notifications for users across all ANVAYA portals.

    Privacy & Compliance Notice:
    Zero Protected Health Information (PHI) stored in title or message.
    Diagnoses, medication details, lab values, symptoms, and clinical notes
    must never be stored in notification records.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    notification_type: Mapped[str] = mapped_column(
        String(60),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )
    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    related_entity_type: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    related_entity_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    safe_action_path: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    idempotency_key: Mapped[str | None] = mapped_column(
        String(120),
        unique=True,
        nullable=True,
        index=True,
    )

    __table_args__ = (
        Index(
            "ix_notifications_recipient_unread",
            "recipient_user_id",
            "is_read",
            "created_at",
        ),
        Index(
            "ix_notifications_recipient_created",
            "recipient_user_id",
            "created_at",
        ),
    )
