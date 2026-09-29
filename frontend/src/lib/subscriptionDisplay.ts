import type { SubscriptionStatus } from "./subscriptionsApi";

// Shared display vocabulary for a tenant's CITRAMAC subscription — used by
// the shell's renewal/read-only banner, the Org Admin Subscription page and
// the Super Admin Subscriptions screen so the three never disagree on what a
// status is called or how it is coloured.

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  PAST_DUE: "Past Due",
  EXPIRED: "Expired",
  CANCELED: "Canceled",
};

export const SUBSCRIPTION_STATUS_TINT: Record<SubscriptionStatus, string> = {
  ACTIVE: "bg-brand-green-tint text-brand-green-dark",
  PAST_DUE: "bg-status-amber-tint text-status-amber",
  EXPIRED: "bg-status-red-tint text-status-red",
  CANCELED: "bg-surface-bg text-ink-500",
};

/**
 * Formats a DRF `DateField` value ("YYYY-MM-DD") as a local calendar date.
 * Parsed by parts rather than `new Date(iso)`, which reads a bare date as
 * UTC midnight and can render the previous day west of Greenwich.
 */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "in 5 days" / "today" / "3 days ago" for `days_until_period_end`. */
export function describeDaysUntil(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days} days`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
}
