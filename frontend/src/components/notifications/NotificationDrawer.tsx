import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  CheckCheck,
  Loader2,
  RefreshCw,
  X,
  AlertCircle,
} from "lucide-react";
import type { NotificationFilter, NotificationItem } from "../../types/notification";
import { notificationService } from "../../services/notificationService";
import { NotificationCard } from "./NotificationCard";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string;
  unreadCount: number;
  onNotificationRead: () => void;
  onAllNotificationsRead: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  userRole,
  unreadCount,
  onNotificationRead,
  onAllNotificationsRead,
}) => {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Fetch notifications for the active tab
  const fetchNotifications = useCallback(async (activeFilter: NotificationFilter) => {
    setLoading(true);
    setError(null);
    try {
      const data = await notificationService.getNotifications({
        filter: activeFilter,
        limit: 50,
        offset: 0,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setError("Failed to load notifications. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on drawer open or filter tab switch
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        void fetchNotifications(filter);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, filter, fetchNotifications]);

  // Focus management, focus trap, and Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    // Save current active element to restore focus when closing
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const container = drawerRef.current;
        if (!container) return;

        const focusableElements = container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Focus close button on open
    const focusTimer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus to previously focused element (bell button)
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  // Prevent background body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleMarkOneRead = async (id: string) => {
    try {
      const updated = await notificationService.markAsRead(id);
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: true, read_at: updated.read_at } : item))
      );
      onNotificationRead();
    } catch {
      // Re-fetch to ensure sync if server rejected
      void fetchNotifications(filter);
    }
  };

  const handleMarkAllRead = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    try {
      await notificationService.markAllAsRead();
      setItems((prev) =>
        prev.map((item) => ({ ...item, is_read: true, read_at: new Date().toISOString() }))
      );
      onAllNotificationsRead();
      if (filter === "unread") {
        setItems([]);
        setTotal(0);
      }
    } catch {
      setError("Could not mark all notifications as read. Please try again.");
    } finally {
      setMarkingAll(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="notif-drawer-portal">
      {/* Backdrop overlay */}
      <div
        className="notif-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Shell */}
      <aside
        ref={drawerRef}
        className="notif-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-drawer-title"
      >
        {/* Drawer Header */}
        <header className="notif-drawer-header">
          <div className="notif-header-title-wrap">
            <h2 id="notif-drawer-title" className="notif-drawer-title">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <span className="notif-badge-pill" aria-label={`${unreadCount} unread`}>
                {unreadCount > 99 ? "99+" : unreadCount} unread
              </span>
            )}
          </div>

          <div className="notif-header-actions">
            {unreadCount > 0 && (
              <button
                type="button"
                className="notif-mark-all-btn"
                onClick={handleMarkAllRead}
                disabled={markingAll}
                title="Mark all notifications as read"
                aria-label="Mark all as read"
              >
                <CheckCheck size={16} />
                <span>{markingAll ? "Marking..." : "Mark all read"}</span>
              </button>
            )}

            <button
              ref={closeBtnRef}
              type="button"
              className="notif-close-btn"
              onClick={onClose}
              title="Close notifications drawer"
              aria-label="Close notifications"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Filter Navigation Tabs */}
        <nav className="notif-tabs" aria-label="Filter notifications">
          <button
            type="button"
            className={`notif-tab ${filter === "all" ? "is-active" : ""}`}
            onClick={() => setFilter("all")}
            role="tab"
            aria-selected={filter === "all"}
          >
            <span>All</span>
            <span className="notif-tab-count">
              {filter === "all" ? total : total}
            </span>
          </button>

          <button
            type="button"
            className={`notif-tab ${filter === "unread" ? "is-active" : ""}`}
            onClick={() => setFilter("unread")}
            role="tab"
            aria-selected={filter === "unread"}
          >
            <span>Unread</span>
            {unreadCount > 0 && (
              <span className="notif-tab-badge">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </nav>

        {/* Drawer Scrollable Content */}
        <div className="notif-drawer-body">
          {loading && items.length === 0 ? (
            <div className="notif-loading-state" aria-live="polite">
              <Loader2 size={24} className="notif-spinner" />
              <p>Loading notifications...</p>
            </div>
          ) : error ? (
            <div className="notif-error-state" role="alert">
              <AlertCircle size={24} className="notif-error-icon" />
              <p>{error}</p>
              <button
                type="button"
                className="notif-retry-btn"
                onClick={() => void fetchNotifications(filter)}
              >
                <RefreshCw size={14} />
                <span>Retry</span>
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="notif-empty-state">
              <div className="notif-empty-icon-wrap">
                <Bell size={28} strokeWidth={1.5} />
              </div>
              <h3>
                {filter === "unread" ? "No unread notifications" : "No notifications yet"}
              </h3>
              <p>
                {filter === "unread"
                  ? "You are all caught up! There are no unread notifications right now."
                  : "When appointments, prescriptions, or clinical updates occur, they will appear here."}
              </p>
            </div>
          ) : (
            <div className="notif-list" role="feed" aria-label="Notification list">
              {items.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  userRole={userRole}
                  onMarkRead={handleMarkOneRead}
                  onCloseDrawer={onClose}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
};
