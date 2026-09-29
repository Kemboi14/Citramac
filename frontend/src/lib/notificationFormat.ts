import type { NotificationSeverity } from "./notificationsApi";

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Left-edge accent for a notification row, by severity. */
export function severityAccent(severity: NotificationSeverity | undefined): string {
  if (severity === "CRITICAL") return "border-l-status-red";
  if (severity === "WARNING") return "border-l-status-amber";
  return "border-l-transparent";
}
