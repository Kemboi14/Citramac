import { apiRequest } from "./apiClient";
import type { ThemeOverrides } from "../theme/themeTokens";

// Mirrors apps.tenancy's OrganizationThemeSerializer — a narrow endpoint
// over Organization.theme_overrides (docs/03-DESIGN-SYSTEM.md §3.6).

export interface OrganizationTheme {
  /** Light/dark palettes keyed by theme token (theme/themeTokens.ts) —
   * never status colors, which are platform-wide only. */
  theme_overrides: ThemeOverrides;
  logo_url: string;
}

export function getOrganizationTheme(accessToken: string, organizationId: string) {
  return apiRequest<OrganizationTheme>(`/platform/organizations/${organizationId}/theme/`, {
    accessToken,
  });
}

export function updateOrganizationTheme(
  accessToken: string,
  organizationId: string,
  themeOverrides: OrganizationTheme["theme_overrides"],
) {
  return apiRequest<OrganizationTheme>(`/platform/organizations/${organizationId}/theme/`, {
    method: "PATCH",
    body: { theme_overrides: themeOverrides },
    accessToken,
  });
}
