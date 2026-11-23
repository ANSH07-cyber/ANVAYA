import React from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Check,
  FileCheck2,
  Info,
  Pill,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserCheck,
} from "lucide-react";
import type { NotificationItem } from "../../types/notification";
import {
  isSafeRolePath,
  getNotificationActionLabel,
  getNotificationCategoryLabel,
  getNotificationTagModifier,
} from "../../services/notificationHelpers";

interface NotificationCardProps {
  notification: NotificationItem;
  userRole: string;
  onMarkRead: (id: string) => Promise<void>;
  onCloseDrawer?: () => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 45) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    }).format(date);
  } catch {
    return "";
  }
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "consent.requested":
    case "consent.request_created":
      return <FileCheck2 size={18} className="notif-icon consent-requested" />;
    case "consent.approved":
    case "consent.request_approved":
      return <ShieldCheck size={18} className="notif-icon consent-approved" />;
    case "consent.partially_approved":
    case "consent.request_partially_approved":
      return <FileCheck2 size={18} className="notif-icon consent-partial" />;
    case "consent.declined":
    case "consent.request_declined":
      return <ShieldOff size={18} className="notif-icon consent-declined" />;
    case "consent.revoked":
      return <ShieldAlert size={18} className="notif-icon consent-revoked" />;
    case "appointment.booked":
      return <CalendarCheck size={18} className="notif-icon booked" />;
    case "appointment.rescheduled":
    case "appointment.reschedule_proposed":
    case "appointment.reschedule_accepted":
      return <CalendarClock size={18} className="notif-icon rescheduled" />;
    case "appointment.reschedule_declined":
    case "appointment.cancelled":
      return <CalendarX size={18} className="notif-icon cancelled" />;
    case "prescription.issued":
      return <Pill size={18} className="notif-icon rx" />;
    case "doctor.onboarded":
    case "doctor.application.received":
      return <UserCheck size={18} className="notif-icon doctor" />;
    case "doctor.verification.approved":
      return <ShieldCheck size={18} className="notif-icon approved" />;
    case "doctor.verification.rejected":
    case "doctor.verification.suspended":
      return <ShieldAlert size={18} className="notif-icon rejected" />;
    default:
      return <Info size={18} className="notif-icon default" />;
  }
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  userRole,
  onMarkRead,
  onCloseDrawer,
}) => {
  const navigate = useNavigate();
  const [marking, setMarking] = React.useState(false);

  const canNavigate = isSafeRolePath(notification.safe_action_path, userRole);
  const actionLabel = getNotificationActionLabel(notification.safe_action_path, notification.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notification.notification_type);
  const tagModifier = getNotificationTagModifier(notification.notification_type);

  const handleActionClick = async () => {
    if (!notification.is_read) {
      void onMarkRead(notification.id);
    }
    if (canNavigate && notification.safe_action_path) {
      if (onCloseDrawer) onCloseDrawer();
      navigate(notification.safe_action_path);
    }
  };

  const handleMarkReadClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (marking || notification.is_read) return;
    setMarking(true);
    try {
      await onMarkRead(notification.id);
    } finally {
      setMarking(false);
    }
  };

  return (
    <article
      className={`notification-card ${notification.is_read ? "is-read" : "is-unread"} notif-card-${tagModifier}`}
      aria-label={`${notification.is_read ? "Read" : "Unread"} notification: ${notification.title}. Category: ${categoryLabel}.`}
    >
      <div className="notif-icon-col">
        {getNotificationIcon(notification.notification_type)}
        {!notification.is_read && <span className="notif-unread-dot" aria-hidden="true" />}
      </div>

      <div className="notif-body-col">
        <div className="notif-header-row">
          <div className="notif-title-group">
            <span className={`notif-category-tag notif-tag-${tagModifier}`} aria-hidden="true">
              {categoryLabel}
            </span>
            <h4 className="notif-title">{notification.title}</h4>
          </div>
          <time
            className="notif-timestamp"
            dateTime={notification.created_at}
            title={new Date(notification.created_at).toLocaleString()}
          >
            {formatRelativeTime(notification.created_at)}
          </time>
        </div>

        {/* Plain text message rendering to prevent XSS */}
        <p className="notif-message">{notification.message}</p>

        <div className="notif-footer-row">
          {canNavigate && notification.safe_action_path ? (
            <button
              type="button"
              className="notif-action-btn"
              onClick={handleActionClick}
              aria-label={`${actionLabel} for ${notification.title}`}
            >
              {actionLabel}
            </button>
          ) : (
            <span />
          )}

          {!notification.is_read && (
            <button
              type="button"
              className="notif-mark-read-btn"
              onClick={handleMarkReadClick}
              disabled={marking}
              title="Mark as read"
              aria-label={`Mark "${notification.title}" as read`}
            >
              <Check size={14} />
              <span>{marking ? "Saving..." : "Mark as read"}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
