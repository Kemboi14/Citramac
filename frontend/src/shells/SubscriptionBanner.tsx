import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Clock, Lock, X } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { getMySubscription, type MySubscription } from "../lib/subscriptionsApi";
import { formatIsoDate } from "../lib/subscriptionDisplay";

// Re-checked on this interval and whenever the window regains focus, so a
// renewal (or a lapse) shows up without a reload — the lifecycle job runs
// daily server-side, so anything tighter is wasted requests.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ORG_ADMIN_ROLE = "Org Admin";

/**
 * Tenant-wide subscription notice — renewal coming up, grace period running,
 * or the organisation is read-only because its subscription has expired.
 * Shown to every member of the tenant, not just admins: an EXPIRED tenant's
 * clinicians need to know *why* their saves are being refused (the API
 * returns 403 SUBSCRIPTION_EXPIRED on every write). Renders nothing for
 * platform staff (the endpoint returns null) and for a healthy ACTIVE
 * subscription.
 *
 * A failed refresh keeps the last known state rather than hiding the
 * banner — the notice is informational, the server enforces read-only
 * regardless of what this component shows.
 */
export function SubscriptionBanner() {
  const { accessToken, claims } = useAuth();
  const [subscription, setSubscription] = useState<MySubscription | null>(null);
  // Only the "renewing soon" notice can be dismissed, and only until the
  // next page load — past-due and read-only are never hideable.
  const [dismissedRenewal, setDismissedRenewal] = useState(false);

  const load = useCallback(() => {
    if (!accessToken) return;
    getMySubscription(accessToken)
      .then((result) => setSubscription(result))
      .catch(() => undefined);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(load);
    const interval = window.setInterval(load, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", load);
    };
  }, [accessToken, load]);

  if (!accessToken || !subscription) return null;

  const isOrgAdmin = claims?.role === ORG_ADMIN_ROLE;
  const contact = subscription.renewal_contact.trim();
  const followUp = (
    <>
      {contact && <> To renew, contact {contact}.</>}
      {isOrgAdmin && (
        <>
          {" "}
          <Link to="/org-admin/subscription" className="font-semibold underline">
            View subscription
          </Link>
        </>
      )}
    </>
  );

  if (subscription.status === "EXPIRED") {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-2 rounded-sm bg-status-red-tint px-3 py-2 text-sm font-medium text-status-red"
      >
        <Lock className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Read-only: your organisation&apos;s subscription has expired. You can view and export
          records but not add or change them.{followUp}
        </span>
      </div>
    );
  }

  if (subscription.status === "PAST_DUE") {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-2 rounded-sm bg-status-red-tint px-3 py-2 text-sm font-medium text-status-red"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Subscription ended — full access continues
          {subscription.grace_ends_on
            ? ` until ${formatIsoDate(subscription.grace_ends_on)}`
            : " for a limited grace period"}
          , then CITRAMAC becomes read-only.{followUp}
        </span>
      </div>
    );
  }

  if (subscription.status === "ACTIVE" && subscription.renewing_soon && !dismissedRenewal) {
    const days = subscription.days_until_period_end;
    return (
      <div
        role="status"
        className="mb-4 flex items-start gap-2 rounded-sm bg-status-amber-tint px-3 py-2 text-sm font-medium text-status-amber"
      >
        <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span className="flex-1">
          Your organisation&apos;s CITRAMAC subscription ends on{" "}
          {formatIsoDate(subscription.current_period_end)} (
          {days <= 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}).{followUp}
        </span>
        <button
          type="button"
          onClick={() => setDismissedRenewal(true)}
          aria-label="Dismiss renewal notice"
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm hover:bg-surface-card"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
