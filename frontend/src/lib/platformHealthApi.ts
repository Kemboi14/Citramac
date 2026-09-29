import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy.views.PlatformHealthView — Super Admin only.
export interface PlatformHealth {
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "unavailable" | "degraded">;
  undelivered_notices_24h: number;
}

export function getPlatformHealth(accessToken: string) {
  return apiRequest<PlatformHealth>("/platform/health/", { accessToken });
}
