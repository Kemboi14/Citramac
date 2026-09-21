import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy's OrganizationThemeSerializer — a narrow endpoint
// over Organization.theme_overrides only (docs/03-DESIGN-SYSTEM.md §3.6).

export interface OrganizationTheme {
  theme_overrides: {
    primary?: string;
    secondary?: string;
  };
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
