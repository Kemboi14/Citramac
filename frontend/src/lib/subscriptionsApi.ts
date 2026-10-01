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

export function listSubscriptions(accessToken: string) {
  return apiRequest<Paginated<Subscription>>("/platform/subscriptions/", { accessToken });
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
