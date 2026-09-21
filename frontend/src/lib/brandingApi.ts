import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy's PlatformBrandingView — the CITRAMAC-the-product
// logo shown in every shell's sidebar and the generic (no-tenant-resolved)
// login screen. Distinct from an Organization's own logo_url, which is
// per-tenant branding shown only on that tenant's branded login screen.

export interface PlatformBranding {
  logo: string | null;
  theme_overrides: { primary?: string; secondary?: string };
  updated_at: string;
}

export function getPlatformBranding() {
  return apiRequest<PlatformBranding>("/platform/branding/", { method: "GET" });
}

export function uploadPlatformLogo(accessToken: string, file: File) {
  const body = new FormData();
  body.append("logo", file);
  return apiRequest<PlatformBranding>("/platform/branding/", {
    method: "POST",
    body,
    accessToken,
  });
}

/** Platform-wide default primary/secondary accent — the baseline every user
 * sees (including Super Admin, who has no Organization to theme). An org's
 * own theme applies on top of this, not instead of it. */
export function updatePlatformTheme(
  accessToken: string,
  themeOverrides: PlatformBranding["theme_overrides"],
) {
  return apiRequest<PlatformBranding>("/platform/branding/", {
    method: "PATCH",
    body: { theme_overrides: themeOverrides },
    accessToken,
  });
}
