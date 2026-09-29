import { useEffect, useState } from "react";
import { AlertTriangle, Clock, CreditCard, Lock, Plus, TrendingUp } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createSubscription,
  createSubscriptionPlan,
  listSubscriptionPlans,
  listSubscriptions,
  updateSubscription,
  type Subscription,
  type SubscriptionPlan,
} from "../../lib/subscriptionsApi";
import { listOrganizations, type Organization } from "../../lib/organizationsApi";
import {
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_TINT,
  formatIsoDate,
} from "../../lib/subscriptionDisplay";
import { StatCard } from "../../components/StatCard";
import { ConfirmDialog } from "../../components/ConfirmDialog";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const STATUS_OPTIONS: Subscription["status"][] = ["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"];

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "RENEWING_SOON", label: "Renewing Soon" },
  { key: "PAST_DUE", label: "Past Due" },
  { key: "EXPIRED", label: "Expired" },
  { key: "CANCELED", label: "Canceled" },
] as const;

/** Today as "YYYY-MM-DD" in local time — compared against a `<input type="date">` value. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isLapsed(sub: Subscription) {
  return sub.status === "PAST_DUE" || sub.status === "EXPIRED";
}

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

function formatMrr(amount: number): string {
  if (amount >= 1_000_000) {
    return `KES ${(amount / 1_000_000).toFixed(2)}M`;
  }
  return `KES ${Math.round(amount).toLocaleString()}`;
}

interface NewPlanState {
  name: string;
  code: string;
  max_branches: string;
  max_staff_seats: string;
  price_monthly: string;
}

const EMPTY_NEW_PLAN: NewPlanState = {
  name: "",
  code: "",
  max_branches: "",
  max_staff_seats: "",
  price_monthly: "",
};

interface NewSubscriptionState {
  organization: string;
  plan: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  current_period_end: string;
}

const EMPTY_NEW_SUBSCRIPTION: NewSubscriptionState = {
  organization: "",
  plan: "",
  billing_cycle: "MONTHLY",
  current_period_end: "",
};

/**
 * Super Admin — Subscriptions & Billing. This is SaaS billing for CITRAMAC
 * itself (the plan catalog + per-tenant subscription records), not
 * patient/clinical billing.
 */
export function SubscriptionsPage() {
  const { accessToken } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showPlanForm, setShowPlanForm] = useState(false);
  const [newPlan, setNewPlan] = useState<NewPlanState>(EMPTY_NEW_PLAN);
  const [planFormError, setPlanFormError] = useState<string | null>(null);

  const [showSubForm, setShowSubForm] = useState(false);
  const [newSub, setNewSub] = useState<NewSubscriptionState>(EMPTY_NEW_SUBSCRIPTION);
  const [subFormError, setSubFormError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  // Inline renewal-date editor: one row at a time.
  const [renewal, setRenewal] = useState<{ id: string; date: string } | null>(null);
  const [renewalBusy, setRenewalBusy] = useState(false);
  const [renewalError, setRenewalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Setting EXPIRED by hand makes the tenant read-only at once — confirmed first.
  const [expireTarget, setExpireTarget] = useState<Subscription | null>(null);
  const [expireBusy, setExpireBusy] = useState(false);
  const [expireError, setExpireError] = useState<string | null>(null);

  const refresh = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [planRes, subRes] = await Promise.all([
        listSubscriptionPlans(accessToken),
        listSubscriptions(accessToken),
      ]);
      setPlans(planRes.results);
      setSubscriptions(subRes.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load subscriptions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    // Deferred one microtask so `refresh`'s own setLoading(true) runs inside
    // a callback rather than synchronously in the effect body.
    void Promise.resolve().then(() => refresh());
    listOrganizations(accessToken)
      .then((res) => setOrganizations(res.results))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const submitNewPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !newPlan.name || !newPlan.code) return;
    setPlanFormError(null);
    setBusy(true);
    try {
      await createSubscriptionPlan(accessToken, {
        name: newPlan.name,
        code: newPlan.code,
        max_branches: Number(newPlan.max_branches) || 0,
        max_staff_seats: newPlan.max_staff_seats ? Number(newPlan.max_staff_seats) : null,
        price_monthly: newPlan.price_monthly || "0",
        included_modules: [],
        is_active: true,
      });
      setShowPlanForm(false);
      setNewPlan(EMPTY_NEW_PLAN);
      await refresh();
    } catch (err) {
      setPlanFormError(err instanceof ApiError ? err.message : "Couldn't create the plan.");
    } finally {
      setBusy(false);
    }
  };

  const submitNewSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !newSub.organization || !newSub.plan || !newSub.current_period_end) return;
    setSubFormError(null);
    setBusy(true);
    try {
      await createSubscription(accessToken, {
        organization: newSub.organization,
        plan: Number(newSub.plan),
        billing_cycle: newSub.billing_cycle,
        current_period_end: newSub.current_period_end,
      });
      setShowSubForm(false);
      setNewSub(EMPTY_NEW_SUBSCRIPTION);
      await refresh();
    } catch (err) {
      setSubFormError(err instanceof ApiError ? err.message : "Couldn't create the subscription.");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (sub: Subscription, status: Subscription["status"]) => {
    if (!accessToken || status === sub.status) return;
    if (status === "EXPIRED") {
      setExpireError(null);
      setExpireTarget(sub);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await updateSubscription(accessToken, sub.id, { status });
      if (status === "ACTIVE" && isLapsed(sub)) {
        setNotice(`${sub.organization_name} is Active again and its admins have been notified.`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the subscription.");
    }
  };

  const confirmExpire = async () => {
    if (!accessToken || !expireTarget) return;
    setExpireBusy(true);
    setExpireError(null);
    try {
      await updateSubscription(accessToken, expireTarget.id, { status: "EXPIRED" });
      setExpireTarget(null);
      await refresh();
    } catch (err) {
      setExpireError(err instanceof ApiError ? err.message : "Couldn't update the subscription.");
    } finally {
      setExpireBusy(false);
    }
  };

  const saveRenewal = async (sub: Subscription) => {
    if (!accessToken || !renewal || !renewal.date) return;
    setRenewalBusy(true);
    setRenewalError(null);
    setNotice(null);
    try {
      // Only the date is sent: the backend returns a lapsed subscription to
      // ACTIVE (and notifies the tenant) only when `status` is left out.
      const updated = await updateSubscription(accessToken, sub.id, {
        current_period_end: renewal.date,
      });
      if (isLapsed(sub) && updated.status === "ACTIVE") {
        setNotice(
          `${sub.organization_name} renewed to ${formatIsoDate(updated.current_period_end)} — restored to Active and its admins have been notified.`,
        );
      }
      setRenewal(null);
      await refresh();
    } catch (err) {
      setRenewalError(err instanceof ApiError ? err.message : "Couldn't update the renewal date.");
    } finally {
      setRenewalBusy(false);
    }
  };

  const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE");
  const pastDueCount = subscriptions.filter((s) => s.status === "PAST_DUE").length;
  const expiredCount = subscriptions.filter((s) => s.status === "EXPIRED").length;
  const renewingSoonCount = subscriptions.filter((s) => s.renewing_soon).length;
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const mrr = activeSubscriptions.reduce((sum, sub) => {
    const plan = planById.get(sub.plan);
    return sum + (plan ? Number(plan.price_monthly) : 0);
  }, 0);

  const filteredSubscriptions = subscriptions.filter((sub) => {
    if (statusFilter === "ALL") return true;
    if (statusFilter === "RENEWING_SOON") return sub.renewing_soon;
    return sub.status === statusFilter;
  });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Subscriptions & Billing</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={CreditCard}
          value={activeSubscriptions.length}
          label="Active Subscriptions"
        />
        <StatCard icon={TrendingUp} value={formatMrr(mrr)} label="Monthly Recurring Revenue" />
        <StatCard icon={Clock} tone="amber" value={renewingSoonCount} label="Renewing Soon" />
        <StatCard icon={AlertTriangle} tone="amber" value={pastDueCount} label="Past Due" />
        <StatCard icon={Lock} tone="red" value={expiredCount} label="Expired (read-only)" />
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-ink-900">Plans</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green hover:underline"
            onClick={() => {
              setPlanFormError(null);
              setShowPlanForm((v) => !v);
            }}
          >
            <Plus className="h-4 w-4" />
            New Plan
          </button>
        </div>

        {plans.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const orgCount = subscriptions.filter((sub) => sub.plan === plan.id).length;
              return (
                <div
                  key={plan.id}
                  className="rounded-md border border-surface-border bg-surface-bg p-4"
                >
                  <div className="font-display text-sm font-semibold text-ink-900">{plan.name}</div>
                  <div className="mt-1 text-xs uppercase tracking-wide text-ink-500">
                    {plan.code}
                  </div>
                  <div className="mt-3 text-lg font-bold text-ink-900">
                    KES {plan.price_monthly} / month
                  </div>
                  <div className="mt-2 text-sm text-ink-700">
                    {plan.max_branches} branch{plan.max_branches === 1 ? "" : "es"}
                  </div>
                  <div className="text-sm text-ink-700">
                    {plan.max_staff_seats == null
                      ? "unlimited seats"
                      : `up to ${plan.max_staff_seats} seats`}
                  </div>
                  <div className="mt-2 text-xs font-semibold text-ink-500">
                    {orgCount} organization{orgCount === 1 ? "" : "s"} on this plan
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {plans.length === 0 && !loading && (
          <p className="text-sm text-ink-500">No subscription plans in the catalog yet.</p>
        )}

        {showPlanForm && (
          <form onSubmit={submitNewPlan} className="mt-4 border-t border-surface-border pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <label className={LABEL_CLASS}>
                Name
                <input
                  className={FIELD_CLASS}
                  value={newPlan.name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlan((prev) => ({ ...prev, name: value }));
                  }}
                  required
                />
              </label>
              <label className={LABEL_CLASS}>
                Code (slug)
                <input
                  className={FIELD_CLASS}
                  value={newPlan.code}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlan((prev) => ({ ...prev, code: value }));
                  }}
                  placeholder="e.g. standard"
                  required
                />
              </label>
              <label className={LABEL_CLASS}>
                Max Branches
                <input
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={newPlan.max_branches}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlan((prev) => ({ ...prev, max_branches: value }));
                  }}
                />
              </label>
              <label className={LABEL_CLASS}>
                Max Staff Seats
                <input
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={newPlan.max_staff_seats}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlan((prev) => ({ ...prev, max_staff_seats: value }));
                  }}
                  placeholder="Leave blank for unlimited"
                />
              </label>
              <label className={LABEL_CLASS}>
                Price Monthly (KES)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={FIELD_CLASS}
                  value={newPlan.price_monthly}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewPlan((prev) => ({ ...prev, price_monthly: value }));
                  }}
                  required
                />
              </label>
            </div>
            {planFormError && (
              <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {planFormError}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button type="submit" disabled={busy} className={BUTTON_CLASS}>
                Create Plan
              </button>
              <button
                type="button"
                className="text-sm font-semibold text-ink-500 hover:text-ink-700"
                onClick={() => setShowPlanForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-ink-900">Tenant Subscriptions</h2>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => {
            setSubFormError(null);
            setShowSubForm((v) => !v);
          }}
        >
          <CreditCard className="h-4 w-4" />
          Assign Subscription
        </button>
      </div>

      {showSubForm && (
        <form
          onSubmit={submitNewSubscription}
          className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className={LABEL_CLASS}>
              Organization
              <select
                className={FIELD_CLASS}
                value={newSub.organization}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewSub((prev) => ({ ...prev, organization: value }));
                }}
                required
              >
                <option value="">Select an organization…</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Plan
              <select
                className={FIELD_CLASS}
                value={newSub.plan}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewSub((prev) => ({ ...prev, plan: value }));
                }}
                required
              >
                <option value="">Select a plan…</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Billing Cycle
              <select
                className={FIELD_CLASS}
                value={newSub.billing_cycle}
                onChange={(e) => {
                  const value = e.target.value as "MONTHLY" | "ANNUAL";
                  setNewSub((prev) => ({ ...prev, billing_cycle: value }));
                }}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Renewal Date
              <input
                type="date"
                className={FIELD_CLASS}
                value={newSub.current_period_end}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewSub((prev) => ({ ...prev, current_period_end: value }));
                }}
                required
              />
            </label>
          </div>
          {subFormError && (
            <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {subFormError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button type="submit" disabled={busy} className={BUTTON_CLASS}>
              Assign Subscription
            </button>
            <button
              type="button"
              className="text-sm font-semibold text-ink-500 hover:text-ink-700"
              onClick={() => setShowSubForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {notice && (
        <p className="flex items-center justify-between gap-3 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold hover:underline"
          >
            Dismiss
          </button>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setStatusFilter(filter.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              statusFilter === filter.key
                ? "bg-brand-green text-white"
                : "border border-surface-border text-ink-700 hover:bg-surface-bg"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Billing Cycle</th>
              <th className="px-4 py-3">Seats Used</th>
              <th className="px-4 py-3">Renewal Date</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredSubscriptions.map((sub) => (
              <tr key={sub.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-3 font-medium text-ink-900">{sub.organization_name}</td>
                <td className="px-4 py-3 text-ink-700">{sub.plan_name}</td>
                <td className="px-4 py-3 text-ink-700">
                  {sub.billing_cycle === "MONTHLY" ? "Monthly" : "Annual"}
                </td>
                <td className="px-4 py-3 text-ink-700">{sub.seats_used}</td>
                <td className="px-4 py-3 text-ink-700">
                  {renewal?.id === sub.id ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          className={`${FIELD_CLASS} py-1`}
                          value={renewal.date}
                          onChange={(e) => {
                            const date = e.target.value;
                            setRenewal((prev) => (prev ? { ...prev, date } : prev));
                          }}
                        />
                        <button
                          type="button"
                          disabled={renewalBusy || !renewal.date}
                          onClick={() => saveRenewal(sub)}
                          className="text-xs font-semibold text-brand-green hover:underline disabled:opacity-60"
                        >
                          {renewalBusy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={renewalBusy}
                          onClick={() => setRenewal(null)}
                          className="text-xs font-semibold text-ink-500 hover:text-ink-700"
                        >
                          Cancel
                        </button>
                      </div>
                      {isLapsed(sub) && renewal.date >= todayIso() && (
                        <span className="max-w-xs text-xs text-brand-green-dark">
                          Saving this date restores the subscription to Active and notifies{" "}
                          {sub.organization_name}&rsquo;s admins that it has been renewed.
                        </span>
                      )}
                      {isLapsed(sub) && renewal.date !== "" && renewal.date < todayIso() && (
                        <span className="max-w-xs text-xs text-status-amber">
                          This date is in the past — the subscription stays{" "}
                          {SUBSCRIPTION_STATUS_LABEL[sub.status]}.
                        </span>
                      )}
                      {renewalError && (
                        <span className="max-w-xs text-xs font-medium text-status-red">
                          {renewalError}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {formatIsoDate(sub.current_period_end)}
                      {sub.renewing_soon && (
                        <span className="rounded-sm bg-status-amber-tint px-2 py-0.5 text-xs font-semibold text-status-amber">
                          Renewing Soon
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRenewalError(null);
                          setRenewal({ id: sub.id, date: sub.current_period_end });
                        }}
                        className="text-xs font-semibold text-brand-green hover:underline"
                      >
                        {isLapsed(sub) ? "Renew" : "Change"}
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    className={`rounded-sm border-0 px-2 py-0.5 text-xs font-semibold outline-none ${
                      SUBSCRIPTION_STATUS_TINT[sub.status]
                    }`}
                    value={sub.status}
                    onChange={(e) => changeStatus(sub, e.target.value as Subscription["status"])}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {/* eslint-disable-next-line security/detect-object-injection -- `status` is iterated from the fixed `STATUS_OPTIONS` const array, not user input. */}
                        {SUBSCRIPTION_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                  {sub.status === "PAST_DUE" && (
                    <div className="mt-1 text-xs text-ink-500">
                      Past due since {formatIsoDate(sub.past_due_since)}
                      {sub.grace_ends_on && <> · grace ends {formatIsoDate(sub.grace_ends_on)}</>}
                    </div>
                  )}
                  {sub.status === "EXPIRED" && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-status-red">
                      <Lock className="h-3 w-3" />
                      Read-only
                      {sub.grace_ends_on && <> since {formatIsoDate(sub.grace_ends_on)}</>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filteredSubscriptions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-500">
                  {subscriptions.length === 0
                    ? "No subscriptions assigned yet."
                    : "No subscriptions match this filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">Loading subscriptions…</div>
        )}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <ConfirmDialog
        open={expireTarget !== null}
        title="Mark subscription as expired?"
        confirmLabel="Mark as expired"
        busyLabel="Updating…"
        tone="danger"
        busy={expireBusy}
        error={expireError}
        onConfirm={confirmExpire}
        onCancel={() => setExpireTarget(null)}
      >
        <p>
          <span className="font-semibold text-ink-900">{expireTarget?.organization_name}</span>{" "}
          becomes read-only immediately, skipping any remaining grace period. Its staff can still
          sign in, view and export records, but nothing can be added or changed.
        </p>
        <p>No data is deleted. Setting a future renewal date restores full access.</p>
      </ConfirmDialog>
    </div>
  );
}
