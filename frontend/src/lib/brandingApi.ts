import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy's PlatformBrandingView — the CITRAMAC-the-product
// logo shown in every shell's sidebar and the generic (no-tenant-resolved)
// login screen. Distinct from an Organization's own logo_url, which is
// per-tenant branding shown only on that tenant's branded login screen.

export interface PlatformBranding {
  logo: string | null;
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
