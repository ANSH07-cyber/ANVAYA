export type NotificationType =
  | "appointment.booked"
  | "appointment.cancelled"
  | "appointment.rescheduled"
  | "appointment.reschedule_proposed"
  | "appointment.reschedule_accepted"
  | "appointment.reschedule_declined"
  | "prescription.issued"
  | "doctor.application.received"
  | "doctor.onboarded"
  | "doctor.verification.approved"
  | "doctor.verification.rejected"
  | "doctor.verification.suspended"
  | "consent.requested"
  | "consent.approved"
  | "consent.partially_approved"
  | "consent.declined"
  | "consent.revoked"
  | "consent.request_created"
  | "consent.request_approved"
  | "consent.request_partially_approved"
  | "consent.request_declined"
  | string;

export interface NotificationItem {
  id: string;
  recipient_user_id: string;
  notification_type: NotificationType;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  safe_action_path: string | null;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread_count: number;
  limit: number;
  offset: number;
}

export interface NotificationUnreadCountResponse {
  unread_count: number;
}

export interface NotificationReadAllResponse {
  marked_count: number;
  detail: string;
}

export type NotificationFilter = "all" | "unread";
