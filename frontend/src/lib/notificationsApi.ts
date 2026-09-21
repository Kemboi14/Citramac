import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

export type NotificationCategory = "RISK_ALERT" | "SYSTEM";

export interface Notification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export function listNotifications(accessToken: string) {
  return apiRequest<Paginated<Notification>>("/notifications/", { accessToken });
}

export function getUnreadNotificationCount(accessToken: string) {
  return apiRequest<{ count: number }>("/notifications/unread-count/", { accessToken });
}

export function markNotificationRead(accessToken: string, id: string) {
  return apiRequest<Notification>(`/notifications/${id}/read/`, {
    method: "POST",
    accessToken,
  });
}

export function markAllNotificationsRead(accessToken: string) {
  return apiRequest<void>("/notifications/mark-all-read/", { method: "POST", accessToken });
}
