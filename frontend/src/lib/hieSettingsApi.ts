import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy's PlatformHieSettingsSerializer and the
// PlatformHie*View endpoints — Super Admin "DHA / SHA Integration" screen.

export type HieEnvironment = "sandbox" | "production";

export interface PlatformHieSettings {
  environment: HieEnvironment;
  base_url: string;
  client_id: string;
  has_credentials: boolean;
  /** Where the service account in use comes from: saved here, the server environment, or none. */
  source: "saved" | "environment" | "none";
  tenant_id: string;
  tenant_code: string;
  public_api_base_url: string;
  /** "" until a public API base URL and a callback token both exist. */
  callback_url: string;
  remittance_path: string;
  remittance_claims_path: string;
  updated_at: string;
  updated_by_name: string;
}

export interface PlatformHieSettingsPayload {
  environment?: HieEnvironment;
  base_url?: string;
  client_id?: string;
  /** Write-only; omit (or blank) to keep the saved secret. */
  client_secret?: string;
  remove_client_secret?: boolean;
  tenant_id?: string;
  tenant_code?: string;
  public_api_base_url?: string;
  rotate_callback_token?: boolean;
  remittance_path?: string;
  remittance_claims_path?: string;
}

/** One branch's Facility Registry answer from "Test connection" — the registry's own words. */
export interface HieFacilityResult {
  branch: string;
  organization: string;
  status: "VERIFIED" | "NOT_FOUND" | "ERROR" | "";
  status_label?: string;
  checked_at?: string | null;
  problem: string;
  official_name?: string;
  fr_code?: string;
  fid_code?: string;
  keph_level?: string;
  facility_type?: string;
  license_status?: string;
  license_end?: string;
  sha_contract_status?: string;
  sha_contract_end?: string;
  sha_operational_status?: string;
}

export interface HieTestResult {
  success: boolean;
  message: string;
  facilities: HieFacilityResult[];
}

export interface HieCallbackEntityResult {
  entity_type: string;
  status: string;
  endpoint_id?: string;
}

export type HieCallbackBranchResult =
  | { branch: string; results: HieCallbackEntityResult[] }
  | { branch: string; error: string };

export interface HieTransaction {
  id: string;
  at: string;
  type: string;
  method: string;
  endpoint: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  http_status: number | null;
  trace_id: string;
  error: string;
  duration_ms: number | null;
}

export function getPlatformHieSettings(accessToken: string) {
  return apiRequest<PlatformHieSettings>("/platform/hie-settings/", { accessToken });
}

export function updatePlatformHieSettings(
  accessToken: string,
  payload: PlatformHieSettingsPayload,
) {
  return apiRequest<PlatformHieSettings>("/platform/hie-settings/", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function testPlatformHieSettings(accessToken: string) {
  return apiRequest<HieTestResult>("/platform/hie-settings/test/", {
    method: "POST",
    accessToken,
  });
}

export function registerHieCallbacks(accessToken: string) {
  return apiRequest<{ branches: HieCallbackBranchResult[] }>(
    "/platform/hie-settings/register-callbacks/",
    { method: "POST", accessToken },
  );
}

export function getHieTransactionLog(accessToken: string) {
  return apiRequest<{ transactions: HieTransaction[] }>("/platform/hie-settings/log/", {
    accessToken,
  });
}
