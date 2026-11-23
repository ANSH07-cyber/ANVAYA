import React, { useEffect, useState, useCallback, useRef } from "react";
import { Bell } from "lucide-react";
import { notificationService } from "../../services/notificationService";
import { NotificationDrawer } from "./NotificationDrawer";
import "./NotificationComponents.css";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface NotificationBellProps {
  userRole: string;
  className?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  userRole,
  className = "",
}) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const isPollingRef = useRef<boolean>(false);

  const fetchUnreadCount = useCallback(async () => {
    // Avoid concurrent duplicate requests
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count);
    } catch {
      // Gracefully swallow network/polling errors to prevent UI disruption
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  // 30-second interval polling with Page Visibility API integration
  useEffect(() => {
    // Initial fetch on mount (deferred to avoid synchronous setState inside effect body)
    const initTimer = setTimeout(() => {
      void fetchUnreadCount();
    }, 0);

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (!intervalId) {
        intervalId = setInterval(() => {
          if (document.visibilityState === "visible") {
            void fetchUnreadCount();
          }
        }, POLL_INTERVAL_MS);
      }
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchUnreadCount();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const handleWindowFocus = () => {
      if (document.visibilityState === "visible") {
        void fetchUnreadCount();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      clearTimeout(initTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [fetchUnreadCount]);

  const handleToggleDrawer = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      void fetchUnreadCount();
    }
  };

  const handleSingleRead = () => {
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const handleAllRead = () => {
    setUnreadCount(0);
  };

  const badgeText = unreadCount > 99 ? "99+" : unreadCount.toString();

  return (
    <div className={`notif-bell-container ${className}`}>
      <button
        type="button"
        className={`notif-bell-button ${unreadCount > 0 ? "has-unread" : ""}`}
        onClick={handleToggleDrawer}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
      >
        <Bell size={19} strokeWidth={1.8} className="notif-bell-icon" />

        {unreadCount > 0 && (
          <span className="notif-bell-badge" aria-hidden="true">
            {badgeText}
          </span>
        )}
      </button>

      <NotificationDrawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userRole={userRole}
        unreadCount={unreadCount}
        onNotificationRead={handleSingleRead}
        onAllNotificationsRead={handleAllRead}
      />
    </div>
  );
};
