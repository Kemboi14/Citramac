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
  status: "ACTIVE" | "PAST_DUE" | "CANCELED";
  seats_used: number;
  current_period_end: string;
  renewing_soon: boolean;
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
