import api from "./api";
import type {
  NotificationFilter,
  NotificationItem,
  NotificationListResponse,
  NotificationReadAllResponse,
  NotificationUnreadCountResponse,
} from "../types/notification";

export {
  isSafeRolePath,
  getNotificationActionLabel,
  getNotificationCategoryLabel,
  getNotificationTagModifier,
} from "./notificationHelpers";

export const notificationService = {
  async getNotifications(options?: {
    filter?: NotificationFilter;
    limit?: number;
    offset?: number;
  }): Promise<NotificationListResponse> {
    const params: Record<string, string | number | boolean> = {
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
    };

    if (options?.filter === "unread") {
      params.is_read = false;
    }

    const response = await api.get<NotificationListResponse>("/notifications/me", { params });
    return response.data;
  },

  async getUnreadCount(): Promise<number> {
    const response = await api.get<NotificationUnreadCountResponse>("/notifications/unread-count");
    return response.data.unread_count ?? 0;
  },

  async markAsRead(id: string): Promise<NotificationItem> {
    const response = await api.patch<NotificationItem>(`/notifications/${id}/read`);
    return response.data;
  },

  async markAllAsRead(): Promise<NotificationReadAllResponse> {
    const response = await api.patch<NotificationReadAllResponse>("/notifications/read-all");
    return response.data;
  },
};
