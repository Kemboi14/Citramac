import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.tenancy's BranchSerializer — citramac_SUPER-ADMIN.html
// "Branches" + citramac_ORG-admin.html "Branch Settings".

export type MhpRegistrationStatus = "OPEN" | "WAITLIST" | "CLOSED";
export type LicenseStatus = "MISSING" | "VALID" | "EXPIRING" | "EXPIRED";

/** One append-only entry of a branch's registration-identifier history. */
export interface BranchIdentifierChange {
  id: string;
  field: string;
  field_label: string;
  previous_value: string;
  new_value: string;
  changed_by_email: string;
  created_at: string;
}

export interface Branch {
  id: string;
  organization: string;
  organization_name: string;
  name: string;
  facility_level: "L2" | "L3" | "L4" | "L5" | "L6";
  ownership_type: "PRIVATE" | "PUBLIC" | "FAITH_BASED" | "NGO" | "PARTNERSHIP" | "OTHER";
  address: string;
  country: string;
  county: string;
  sub_county: string;
  gps_coordinates: string;
  mfl_code: string;
  kmpdc_registration_number: string;
  facility_license_number: string;
  /** ISO date; the licence is renewed every year. */
  facility_license_valid_until: string | null;
  sha_fr_code: string;
  is_registered_health_provider: boolean;
  /** Required identifiers this branch is still missing (fields predating the requirement). */
  missing_identifiers: ("kmpdc_registration_number" | "sha_fr_code")[];
  license_status: LicenseStatus;
  license_days_remaining: number | null;
  identifier_history: BranchIdentifierChange[];
  phone: string;
  email: string;
  outpatient_capacity_per_day: number | null;
  mhp_registration_status: MhpRegistrationStatus;
  sha_claims_enabled: boolean;
  mpesa_paybill_enabled: boolean;
  sms_reminders_enabled: boolean;
  has_sha_credentials: boolean;
  is_active: boolean;
  ward_count: number;
  bed_count: number;
}

export interface ListBranchesParams {
  q?: string;
  county?: string;
  facility_level?: string;
  mhp_registration_status?: string;
  license_status?: LicenseStatus;
  missing_identifiers?: "true";
}

export function listBranches(accessToken: string, params: ListBranchesParams = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return apiRequest<Paginated<Branch>>(`/platform/branches/${query ? `?${query}` : ""}`, {
    accessToken,
  });
}

export interface CreateBranchPayload {
  /** Required for Super Admin (creating on behalf of a tenant); ignored for Org Admin, whose new branch always belongs to their own organization. */
  organization?: string;
  name: string;
  facility_level: string;
  address?: string;
  country?: string;
  county?: string;
  sub_county?: string;
  mfl_code?: string;
  kmpdc_registration_number?: string;
  facility_license_number?: string;
  facility_license_valid_until?: string | null;
  sha_fr_code?: string;
  sha_claims_enabled?: boolean;
  outpatient_capacity_per_day?: number;
  mhp_registration_status?: MhpRegistrationStatus;
  is_active?: boolean;
}

export function createBranch(accessToken: string, payload: CreateBranchPayload) {
  return apiRequest<Branch>("/platform/branches/", { method: "POST", body: payload, accessToken });
}

export function updateBranch(accessToken: string, id: string, payload: Partial<Branch>) {
  return apiRequest<Branch>(`/platform/branches/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function setBranchCredentials(accessToken: string, id: string, credentials: string) {
  return apiRequest<Branch>(`/platform/branches/${id}/`, {
    method: "PATCH",
    body: { sha_api_credentials: credentials },
    accessToken,
  });
}
