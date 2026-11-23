from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    recipient_user_id: UUID
    notification_type: str
    title: str
    message: str
    is_read: bool
    created_at: datetime
    read_at: datetime | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None
    safe_action_path: str | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    total: int
    unread_count: int
    limit: int
    offset: int


class NotificationUnreadCount(BaseModel):
    unread_count: int


class NotificationReadAllResponse(BaseModel):
    marked_count: int
    detail: str = "All unread notifications marked as read."
