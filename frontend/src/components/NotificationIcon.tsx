import { AlertTriangle, Archive, Bell, CreditCard } from "lucide-react";
import type { Notification } from "../lib/notificationsApi";

const ICONS = {
  RISK_ALERT: AlertTriangle,
  SUBSCRIPTION: CreditCard,
  RETENTION: Archive,
  SYSTEM: Bell,
} as const;

/** Category icon for a notification, coloured by severity. */
export function NotificationIcon({
  notification,
  className = "h-4 w-4",
}: {
  notification: Pick<Notification, "category" | "severity">;
  className?: string;
}) {
  const Icon = ICONS[notification.category] ?? Bell;
  const tone =
    notification.severity === "CRITICAL" || notification.category === "RISK_ALERT"
      ? "text-status-red"
      : notification.severity === "WARNING"
        ? "text-status-amber"
        : "text-ink-400";
  return <Icon aria-hidden className={`${className} ${tone}`} />;
}
