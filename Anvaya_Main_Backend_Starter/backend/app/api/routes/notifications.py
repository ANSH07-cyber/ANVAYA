from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, verify_csrf_and_origin
from app.db.session import get_db
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationListResponse,
    NotificationReadAllResponse,
    NotificationRead,
    NotificationUnreadCount,
)
from app.services.notification_service import (
    get_unread_count,
    is_safe_role_path,
    mark_all_notifications_as_read,
    mark_notification_as_read,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def _to_notification_read(notification: Notification, user_role: str) -> NotificationRead:
    """Serializes a Notification model into a Pydantic schema, sanitizing action paths."""
    safe_path = notification.safe_action_path
    if safe_path and not is_safe_role_path(safe_path, user_role):
        safe_path = None

    return NotificationRead(
        id=notification.id,
        recipient_user_id=notification.recipient_user_id,
        notification_type=notification.notification_type,
        title=notification.title,
        message=notification.message,
        is_read=notification.is_read,
        created_at=notification.created_at,
        read_at=notification.read_at,
        related_entity_type=notification.related_entity_type,
        related_entity_id=notification.related_entity_id,
        safe_action_path=safe_path,
    )


# =========================================================
# 1. GET NOTIFICATIONS FOR CURRENT USER (PAGINATED)
# =========================================================
@router.get(
    "/me",
    response_model=NotificationListResponse,
    status_code=status.HTTP_200_OK,
)
def get_my_notifications(
    is_read: bool | None = Query(
        default=None,
        description="Filter by read status (true=read only, false=unread only)",
    ),
    limit: int = Query(
        default=20,
        ge=1,
        le=100,
        description="Page limit (minimum 1, maximum 100)",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Page offset (minimum 0)",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    """Retrieves paginated notifications for the authenticated user (Patient, Doctor, or Admin).

    Security:
    - Enforces strict recipient ownership filtering (recipient_user_id == current_user.id).
    - Prevents cross-tenant / cross-user visibility.
    - Sanitizes safe_action_path against the caller's role to prevent unauthorized cross-portal navigation.
    """
    base_filter = [Notification.recipient_user_id == current_user.id]
    if is_read is not None:
        base_filter.append(Notification.is_read.is_(is_read))

    total = db.scalar(
        select(func.count()).select_from(Notification).where(*base_filter)
    ) or 0

    unread_count = get_unread_count(db, current_user.id)

    query = (
        db.query(Notification)
        .filter(*base_filter)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    )
    records = query.all()

    items = [_to_notification_read(record, current_user.role) for record in records]

    return NotificationListResponse(
        items=items,
        total=total,
        unread_count=unread_count,
        limit=limit,
        offset=offset,
    )


# =========================================================
# 2. GET UNREAD NOTIFICATIONS COUNT (LIGHTWEIGHT POLLING)
# =========================================================
@router.get(
    "/unread-count",
    response_model=NotificationUnreadCount,
    status_code=status.HTTP_200_OK,
)
def get_my_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationUnreadCount:
    """Lightweight polling endpoint returning the count of unread notifications for the caller.

    Utilizes covered index `ix_notifications_recipient_unread` for minimal database overhead.
    """
    count = get_unread_count(db, current_user.id)
    return NotificationUnreadCount(unread_count=count)


# =========================================================
# 3. MARK SINGLE NOTIFICATION AS READ
# =========================================================
@router.patch(
    "/{id}/read",
    response_model=NotificationRead,
    status_code=status.HTTP_200_OK,
)
def mark_single_notification_read(
    id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> NotificationRead:
    """Marks a single notification as read.

    Security & Privacy:
    - Enforces Double-Submit CSRF protection on cookie-authenticated requests.
    - Employs pessimistic row-locking (with_for_update) to serialize concurrent mark-read calls.
    - If notification does not exist OR belongs to another user, returns 404 NOT FOUND
      to prevent resource enumeration.
    """
    notification = mark_notification_as_read(
        db,
        notification_id=id,
        user_id=current_user.id,
    )

    if notification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    return _to_notification_read(notification, current_user.role)


# =========================================================
# 4. MARK ALL NOTIFICATIONS AS READ
# =========================================================
@router.patch(
    "/read-all",
    response_model=NotificationReadAllResponse,
    status_code=status.HTTP_200_OK,
)
def mark_all_my_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _csrf: None = Depends(verify_csrf_and_origin),
) -> NotificationReadAllResponse:
    """Marks all unread notifications as read for the authenticated caller in a single atomic query.

    Security:
    - Enforces Double-Submit CSRF protection on cookie-authenticated requests.
    - Strictly scoped to current_user.id.
    """
    marked_count = mark_all_notifications_as_read(db, user_id=current_user.id)
    return NotificationReadAllResponse(
        marked_count=marked_count,
        detail="All unread notifications marked as read.",
    )
