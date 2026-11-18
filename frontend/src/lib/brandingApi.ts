import { apiRequest } from "./apiClient";
import type { ThemeOverrides } from "../theme/themeTokens";

// Mirrors apps.tenancy's PlatformBrandingView — the CITRAMAC-the-product
// logo shown in every shell's sidebar and the generic (no-tenant-resolved)
// login screen. Distinct from an Organization's own logo_url, which is
// per-tenant branding shown only on that tenant's branded login screen.

export interface PlatformBranding {
  logo: string | null;
  /** Square icon for the platform console's sidebar only (Super Admin). */
  icon: string | null;
  theme_overrides: ThemeOverrides;
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

/** The platform console's sidebar icon (Super Admin only); the logo is untouched. */
export function uploadPlatformIcon(accessToken: string, file: File) {
  const body = new FormData();
  body.append("icon", file);
  return apiRequest<PlatformBranding>("/platform/branding/", {
    method: "POST",
    body,
    accessToken,
  });
}

/** Platform-wide light/dark palette (every color token, including status
 * colors) — the baseline every user sees, including Super Admin, who has no
 * Organization to theme. An org's own theme applies on top of this, not
 * instead of it. */
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
