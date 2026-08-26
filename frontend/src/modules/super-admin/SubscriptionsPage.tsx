import { useEffect, useState } from "react";
import { AlertTriangle, Clock, CreditCard, Plus, TrendingUp } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
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
import { StatCard } from "../../components/StatCard";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const STATUS_TINT: Record<Subscription["status"], string> = {
  ACTIVE: "bg-brand-green-tint text-brand-green-dark",
  PAST_DUE: "bg-status-red-tint text-status-red",
  CANCELED: "bg-surface-bg text-ink-500",
};

const STATUS_OPTIONS: Subscription["status"][] = ["ACTIVE", "PAST_DUE", "CANCELED"];

const STATUS_FILTERS = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PAST_DUE", label: "Past Due" },
  { key: "RENEWING_SOON", label: "Renewing Soon" },
] as const;

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
    setError(null);
    try {
      await updateSubscription(accessToken, sub.id, { status });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the subscription.");
    }
  };

  const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE");
  const pastDueCount = subscriptions.filter((s) => s.status === "PAST_DUE").length;
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
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Subscriptions & Billing</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={CreditCard}
          value={activeSubscriptions.length}
          label="Active Subscriptions"
        />
        <StatCard icon={TrendingUp} value={formatMrr(mrr)} label="Monthly Recurring Revenue" />
        <StatCard icon={Clock} tone="amber" value={renewingSoonCount} label="Renewing Soon" />
        <StatCard icon={AlertTriangle} tone="red" value={pastDueCount} label="Past Due" />
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
                  onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                  required
                />
              </label>
              <label className={LABEL_CLASS}>
                Code (slug)
                <input
                  className={FIELD_CLASS}
                  value={newPlan.code}
                  onChange={(e) => setNewPlan({ ...newPlan, code: e.target.value })}
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
                  onChange={(e) => setNewPlan({ ...newPlan, max_branches: e.target.value })}
                />
              </label>
              <label className={LABEL_CLASS}>
                Max Staff Seats
                <input
                  type="number"
                  min={0}
                  className={FIELD_CLASS}
                  value={newPlan.max_staff_seats}
                  onChange={(e) => setNewPlan({ ...newPlan, max_staff_seats: e.target.value })}
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
                  onChange={(e) => setNewPlan({ ...newPlan, price_monthly: e.target.value })}
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
                onChange={(e) => setNewSub({ ...newSub, organization: e.target.value })}
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
                onChange={(e) => setNewSub({ ...newSub, plan: e.target.value })}
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
                onChange={(e) =>
                  setNewSub({
                    ...newSub,
                    billing_cycle: e.target.value as "MONTHLY" | "ANNUAL",
                  })
                }
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
                onChange={(e) => setNewSub({ ...newSub, current_period_end: e.target.value })}
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
                  {sub.current_period_end}
                  {sub.renewing_soon && (
                    <span className="ml-2 rounded-sm bg-status-amber-tint px-2 py-0.5 text-xs font-semibold text-status-amber">
                      Renewing Soon
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    className={`rounded-sm border-0 px-2 py-0.5 text-xs font-semibold outline-none ${
                      STATUS_TINT[sub.status]
                    }`}
                    value={sub.status}
                    onChange={(e) => changeStatus(sub, e.target.value as Subscription["status"])}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
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
    </div>
  );
}
