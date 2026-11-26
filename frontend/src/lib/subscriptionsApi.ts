import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.tenancy's SubscriptionPlan/Subscription serializers —
// citramac_SUPER-ADMIN.html "Subscriptions & Billing".

export interface SubscriptionPlan {
  id: number;
  code: string;
  name: string;
  max_branches: number;
  max_staff_seats: number | null;
  included_modules: string[];
  price_monthly: string;
  /** Monthly KES per active branch; null = not charged on this plan. */
  rate_per_branch: string | null;
  /** Monthly KES per private room; null = not charged on this plan. */
  rate_per_private_room: string | null;
  /** Monthly KES per shared room; null = not charged on this plan. */
  rate_per_shared_room: string | null;
  is_active: boolean;
}

export interface Subscription {
  id: string;
  organization: string;
  organization_name: string;
  plan: number;
  plan_name: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  status: SubscriptionStatus;
  seats_used: number;
  started_on: string | null;
  current_period_end: string;
  /** Set when the subscription became PAST_DUE; the grace period runs from here. */
  past_due_since: string | null;
  grace_ends_on: string | null;
  days_until_period_end: number;
  renewing_soon: boolean;
  /** EXPIRED: staff can read and export, but not write. */
  is_read_only: boolean;
  /** This tenant's own grace period in days; null uses the platform default. */
  grace_period_days: number | null;
  /** The grace period that applies — the override, else the platform default. */
  effective_grace_period_days: number;
}

export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELED";

/** GET /platform/my-subscription/ — any member of a tenant; null for platform staff. */
export interface MySubscription {
  status: SubscriptionStatus;
  plan_name: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  started_on: string | null;
  current_period_end: string;
  past_due_since: string | null;
  grace_ends_on: string | null;
  days_until_period_end: number;
  renewing_soon: boolean;
  is_read_only: boolean;
  renewal_contact: string;
  grace_period_days: number;
}

/** Super Admin: when tenants are reminded, and how long they keep full access afterwards. */
export interface SubscriptionPolicy {
  reminder_days_before: number[];
  grace_period_days: number;
  renewal_contact: string;
  updated_at: string;
}

export function getMySubscription(accessToken: string) {
  // apiRequest turns an empty body into `{}`; anything without a `status` is
  // "no subscription", never a half-formed object the banner would crash on.
  return apiRequest<MySubscription | null>("/platform/my-subscription/", { accessToken }).then(
    (result) => (result && typeof result === "object" && "status" in result ? result : null),
  );
}

export function getSubscriptionPolicy(accessToken: string) {
  return apiRequest<SubscriptionPolicy>("/platform/subscription-policy/", { accessToken });
}

export function updateSubscriptionPolicy(
  accessToken: string,
  payload: Partial<Omit<SubscriptionPolicy, "updated_at">>,
) {
  return apiRequest<SubscriptionPolicy>("/platform/subscription-policy/", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function listSubscriptionPlans(accessToken: string) {
  return apiRequest<Paginated<SubscriptionPlan>>("/platform/subscription-plans/", {
    accessToken,
  });
}

export function createSubscriptionPlan(accessToken: string, payload: Omit<SubscriptionPlan, "id">) {
  return apiRequest<SubscriptionPlan>("/platform/subscription-plans/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateSubscriptionPlan(
  accessToken: string,
  id: number,
  payload: Partial<Omit<SubscriptionPlan, "id">>,
) {
  return apiRequest<SubscriptionPlan>(`/platform/subscription-plans/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function listSubscriptions(accessToken: string, page = 1) {
  return apiRequest<Paginated<Subscription>>(`/platform/subscriptions/?page=${page}`, {
    accessToken,
  });
}

export function createSubscription(
  accessToken: string,
  payload: {
    organization: string;
    plan: number;
    billing_cycle: "MONTHLY" | "ANNUAL";
    current_period_end: string;
  },
) {
  return apiRequest<Subscription>("/platform/subscriptions/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateSubscription(
  accessToken: string,
  id: string,
  payload: Partial<Subscription>,
) {
  return apiRequest<Subscription>(`/platform/subscriptions/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

// ── Subscription billing by branches, private rooms and shared rooms ──
// Mirrors apps.tenancy.subscription_billing.billing_overview.

export interface UnclassifiedRoom {
  id: string;
  room: string;
  reason: string;
}

export interface SubscriptionUsage {
  branches: number;
  branch_names: string[];
  private_rooms: number;
  shared_rooms: number;
  /** Rooms whose type is "Shared bed / ward bay — not a room": counted, never charged. */
  ward_bays: number;
  unclassified_rooms: number;
  unclassified: UnclassifiedRoom[];
  beds_outside_rooms: number;
  notes: { room: string; note: string }[];
}

export interface StatementLine {
  key: "base" | "branches" | "private_rooms" | "shared_rooms";
  label: string;
  count: number | null;
  /** null = the plan sets no rate for this unit ("No rate set"). */
  rate: string | null;
  months: number;
  amount: string | null;
  charged: boolean;
  note: string;
}

export interface SubscriptionStatement {
  id: string;
  reference: string;
  period_start: string;
  period_end: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  months: number;
  plan_name: string;
  currency: string;
  lines: StatementLine[];
  usage: SubscriptionUsage;
  total: string;
  counted_at: string;
  method: "SCHEDULED" | "MANUAL" | "CORRECTION";
  method_label: string;
  issued_by: string;
  supersedes: string | null;
  supersedes_reference: string;
  reason: string;
  /** A later correction replaced this statement. */
  superseded: boolean;
}

export interface SubscriptionBilling {
  organization: string;
  organization_name: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  months: number;
  current_period: { start: string; end: string };
  current_period_has_statement: boolean;
  rates: {
    plan_name: string;
    price_monthly: string;
    rate_per_branch: string | null;
    rate_per_private_room: string | null;
    rate_per_shared_room: string | null;
    currency: string;
  };
  usage: SubscriptionUsage;
  estimate: { lines: StatementLine[]; total: string; currency: string };
  statements: SubscriptionStatement[];
}

/** Org Admin: their own organisation's usage, rates and statements (read-only). */
export function getMySubscriptionBilling(accessToken: string) {
  return apiRequest<SubscriptionBilling | null>("/platform/my-subscription/billing/", {
    accessToken,
  }).then((result) =>
    result && typeof result === "object" && "statements" in result ? result : null,
  );
}

/** Super Admin: one organisation's usage, rates and statements. */
export function getOrganizationSubscriptionBilling(accessToken: string, organizationId: string) {
  return apiRequest<SubscriptionBilling>(
    `/platform/organizations/${organizationId}/subscription-billing/`,
    { accessToken },
  );
}

/** Super Admin: issue the current period's statement now (refused if one exists). */
export function issueSubscriptionStatement(accessToken: string, organizationId: string) {
  return apiRequest<SubscriptionBilling>(
    `/platform/organizations/${organizationId}/subscription-billing/`,
    { method: "POST", body: {}, accessToken },
  );
}

/** Super Admin: correct a statement with a reason (a new, superseding statement). */
export function supersedeSubscriptionStatement(
  accessToken: string,
  statementId: string,
  reason: string,
) {
  return apiRequest<SubscriptionBilling>(
    `/platform/subscription-statements/${statementId}/supersede/`,
    { method: "POST", body: { reason }, accessToken },
  );
}

export function subscriptionStatementPrintPath(statementId: string) {
  return `/platform/subscription-statements/${statementId}/print/`;
}
