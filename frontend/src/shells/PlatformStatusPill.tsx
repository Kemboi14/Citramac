import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { getPlatformHealth, type PlatformHealth } from "../lib/platformHealthApi";

const POLL_INTERVAL_MS = 60_000;

const CHECK_LABELS = new Map([
  ["database", "Database"],
  ["cache", "Cache"],
  ["notification_delivery", "Notice delivery"],
]);

/**
 * Super Admin topbar status light, fed by the real platform health checks
 * (GET /platform/health/) rather than a fixed "All Systems Operational".
 * A health request that fails outright is itself shown as "Status
 * unavailable", never as healthy.
 */
export function PlatformStatusPill() {
  const { accessToken } = useAuth();
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let ignore = false;
    const poll = () => {
      getPlatformHealth(accessToken)
        .then((result) => {
          if (ignore) return;
          setHealth(result);
          setUnreachable(false);
        })
        .catch(() => {
          if (!ignore) setUnreachable(true);
        });
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [accessToken]);

  if (!health && !unreachable) {
    return <div aria-hidden className="h-7 w-40 animate-pulse rounded-full bg-surface-bg" />;
  }

  const failing = health
    ? Object.entries(health.checks)
        .filter(([, value]) => value !== "ok")
        .map(([key]) => CHECK_LABELS.get(key) ?? key)
    : [];
  const ok = !unreachable && health?.status === "ok";
  const label = unreachable
    ? "Status unavailable"
    : ok
      ? "All Systems Operational"
      : `Degraded: ${failing.join(", ")}`;
  const title =
    !unreachable && health && health.undelivered_notices_24h > 0
      ? `${health.undelivered_notices_24h} notice(s) could not be delivered in the last 24 hours — check Email and SMS Settings.`
      : undefined;

  return (
    <div
      role="status"
      title={title}
      className={`flex max-w-[16rem] items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${
        ok ? "bg-brand-green-tint text-brand-green-dark" : "bg-status-red-tint text-status-red"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${ok ? "bg-brand-green" : "bg-status-red"}`}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}
