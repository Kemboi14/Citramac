import { useEffect, useState } from "react";
import { CreditCard, Lock, Phone } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getMySubscription, type MySubscription } from "../../lib/subscriptionsApi";
import {
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_TINT,
  describeDaysUntil,
  formatIsoDate,
} from "../../lib/subscriptionDisplay";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm text-ink-900">{children}</div>
    </div>
  );
}

/**
 * Org Admin — the organisation's own CITRAMAC subscription, read-only.
 * Renewal is done by the CITRAMAC account team (Super Admin moves the period
 * end forward); an Org Admin can't change their own plan, dates or status,
 * so this screen explains the lifecycle and who to contact rather than
 * offering controls the API would refuse.
 */
export function SubscriptionPage() {
  const { accessToken } = useAuth();
  // `undefined` = not loaded yet; `null` = loaded, this org has no subscription record.
  const [subscription, setSubscription] = useState<MySubscription | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getMySubscription(accessToken)
      .then((result) => setSubscription(result))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load your subscription."),
      );
  }, [accessToken]);

  const contact = subscription?.renewal_contact.trim() || "your CITRAMAC account manager";

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Organization · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Subscription</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your organisation&rsquo;s CITRAMAC plan and renewal date. This is read-only — renewals are
          handled by the CITRAMAC account team.
        </p>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
      {subscription === undefined && !error && (
        <p className="text-sm text-ink-500">Loading subscription…</p>
      )}
      {subscription === null && (
        <p className="rounded-lg border border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-ink-500 shadow-sm">
          No subscription is on record for your organisation. Contact your CITRAMAC account manager.
        </p>
      )}

      {subscription && (
        <>
          <div className={CARD_CLASS}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-ink-900">
                <span className="inline-flex items-center gap-2">
                  <CreditCard size={16} className="text-brand-green" />
                  {subscription.plan_name}
                </span>
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  SUBSCRIPTION_STATUS_TINT[subscription.status]
                }`}
              >
                {SUBSCRIPTION_STATUS_LABEL[subscription.status]}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Billing cycle">
                {subscription.billing_cycle === "MONTHLY" ? "Monthly" : "Annual"}
              </Detail>
              <Detail label="Started">{formatIsoDate(subscription.started_on)}</Detail>
              <Detail label="Current period ends">
                {formatIsoDate(subscription.current_period_end)}{" "}
                <span className="text-ink-500">
                  ({describeDaysUntil(subscription.days_until_period_end)})
                </span>
              </Detail>
              {subscription.status === "ACTIVE" && (
                <Detail label="Days remaining">
                  {Math.max(0, subscription.days_until_period_end)}
                </Detail>
              )}
              {subscription.grace_ends_on && (
                <Detail label="Full access until">
                  {formatIsoDate(subscription.grace_ends_on)}
                </Detail>
              )}
              <Detail label="Access">
                {subscription.is_read_only ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-status-red">
                    <Lock className="h-3.5 w-3.5" />
                    Read-only
                  </span>
                ) : (
                  "Full access"
                )}
              </Detail>
            </div>
            {subscription.is_read_only && (
              <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                Your organisation is read-only. Staff can still sign in, view and export records,
                but nothing can be added or changed until the subscription is renewed.
              </p>
            )}
            {subscription.status === "PAST_DUE" && (
              <p className="mt-4 rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-status-amber">
                The subscription period has ended. Full access continues
                {subscription.grace_ends_on
                  ? ` until ${formatIsoDate(subscription.grace_ends_on)}`
                  : " during the grace period"}
                , after which CITRAMAC becomes read-only for your organisation.
              </p>
            )}
            {subscription.status === "ACTIVE" && subscription.renewing_soon && (
              <p className="mt-4 rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-status-amber">
                Renewal is coming up. Arrange it before{" "}
                {formatIsoDate(subscription.current_period_end)} to avoid any interruption.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>What happens when a subscription ends</h2>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink-700">
                <li>
                  Before the renewal date, Org Admins are reminded in CITRAMAC, by email and by SMS.
                </li>
                <li>
                  If the date passes without renewal, full access continues for a{" "}
                  {subscription.grace_period_days}-day grace period.
                </li>
                <li>
                  After the grace period, CITRAMAC becomes read-only: staff can still sign in, view
                  and export every record, but can&rsquo;t add or change anything.
                </li>
                <li>
                  No data is ever deleted because a subscription ends. Renewing restores full access
                  immediately.
                </li>
              </ol>
            </div>
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <Phone size={16} className="text-brand-green" />
                  Renewing
                </span>
              </h2>
              <p className="text-sm text-ink-700">
                To renew or change your plan, contact{" "}
                <span className="font-semibold text-ink-900">{contact}</span>.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
