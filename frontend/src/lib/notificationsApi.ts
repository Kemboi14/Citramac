import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

export type NotificationCategory = "RISK_ALERT" | "SYSTEM" | "SUBSCRIPTION" | "RETENTION";
export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface Notification {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export function listNotifications(
  accessToken: string,
  {
    page = 1,
    category,
    unread,
  }: { page?: number; category?: NotificationCategory; unread?: boolean } = {},
) {
  const params = new URLSearchParams({ page: String(page) });
  if (category) params.set("category", category);
  if (unread) params.set("unread", "true");
  return apiRequest<Paginated<Notification>>(`/notifications/?${params}`, { accessToken });
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
