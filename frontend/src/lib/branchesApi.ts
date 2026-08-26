import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.tenancy's BranchSerializer — citramac_SUPER-ADMIN.html
// "Branches" + citramac_ORG-admin.html "Branch Settings".

export type CcpRegistrationStatus = "OPEN" | "WAITLIST" | "CLOSED";

export interface Branch {
  id: string;
  organization: string;
  organization_name: string;
  name: string;
  facility_level: "L2" | "L3" | "L4" | "L5" | "L6";
  ownership_type: "PRIVATE" | "PUBLIC" | "FAITH_BASED" | "NGO" | "PARTNERSHIP" | "OTHER";
  address: string;
  county: string;
  sub_county: string;
  gps_coordinates: string;
  mfl_code: string;
  phone: string;
  email: string;
  outpatient_capacity_per_day: number | null;
  ccp_registration_status: CcpRegistrationStatus;
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
  ccp_registration_status?: string;
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
  organization: string;
  name: string;
  facility_level: string;
  address?: string;
  county?: string;
  sub_county?: string;
  mfl_code?: string;
  outpatient_capacity_per_day?: number;
  ccp_registration_status?: CcpRegistrationStatus;
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
