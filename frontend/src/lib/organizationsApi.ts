import { apiRequest } from "./apiClient";

// Mirrors apps.tenancy's OrganizationSerializer/CreateOrganizationSerializer —
// citramac_SUPER-ADMIN.html "Organizations" + "Add Organization" drawer.

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type OrgType = "HOSPITAL" | "SCHOOL" | "UNIVERSITY" | "CORPORATE" | "INDIVIDUAL";
export type OwnershipType = "PRIVATE" | "PUBLIC" | "FAITH_BASED" | "NGO" | "PARTNERSHIP" | "OTHER";
export type OrganizationStatus = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  org_type: OrgType;
  facility_type: string;
  ownership_type: OwnershipType;
  dha_facility_code: string;
  identity_code_label: string;
  sha_provider_code: string;
  county: string;
  sub_county: string;
  status: OrganizationStatus;
  is_active: boolean;
  mfl_verified_at: string | null;
  enabled_modules: string[];
  branch_count: number;
  created_at: string;
  logo_url: string;
  tagline: string;
  primary_color: string;
  support_email: string;
  support_phone: string;
  website: string;
}

export interface CreateOrganizationPayload {
  name: string;
  slug: string;
  org_type: OrgType;
  facility_type?: string;
  ownership_type: OwnershipType;
  dha_facility_code?: string;
  county?: string;
  sub_county?: string;
  subscription_plan_code?: string;
  billing_cycle?: "MONTHLY" | "ANNUAL";
  logo_url?: string;
  tagline?: string;
  primary_color?: string;
  support_email?: string;
  support_phone?: string;
  website?: string;
  org_admin: { email: string; first_name: string; last_name: string; phone?: string };
}

export interface ListOrganizationsParams {
  q?: string;
  status?: OrganizationStatus;
  org_type?: OrgType;
  ownership_type?: OwnershipType;
  county?: string;
  /** DRF's default PageNumberPagination — see REST_FRAMEWORK.PAGE_SIZE in config/settings/base.py. */
  page?: number;
}

export function listOrganizations(accessToken: string, params: ListOrganizationsParams = {}) {
  const query = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => Boolean(v))
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return apiRequest<Paginated<Organization>>(
    `/platform/organizations/${query ? `?${query}` : ""}`,
    { accessToken },
  );
}

export function createOrganization(accessToken: string, payload: CreateOrganizationPayload) {
  return apiRequest<Organization>("/platform/organizations/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateOrganization(
  accessToken: string,
  id: string,
  payload: Partial<Organization>,
) {
  return apiRequest<Organization>(`/platform/organizations/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function setOrganizationStatus(accessToken: string, id: string, status: OrganizationStatus) {
  return apiRequest<Organization>(`/platform/organizations/${id}/status/`, {
    method: "POST",
    body: { status },
    accessToken,
  });
}

export function uploadOrganizationLogo(accessToken: string, id: string, file: File) {
  const body = new FormData();
  body.append("logo", file);
  return apiRequest<Organization>(`/platform/organizations/${id}/logo/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export interface PlatformActivityEntry {
  id: string;
  actor_name: string;
  organization_name: string;
  action: string;
  model: string;
  timestamp: string;
}

export interface PlatformDashboardStats {
  total_organizations: number;
  total_branches: number;
  active_users: number;
  pending_verification: number;
  orgs_added_this_month: number;
  branches_added_this_month: number;
  users_added_this_month: number;
  organization_growth: { month: string; count: number }[];
  branches_by_facility_level: { facility_level: string; count: number }[];
  recently_onboarded: Organization[];
  recent_activity: PlatformActivityEntry[];
}

export function getPlatformDashboardStats(accessToken: string) {
  return apiRequest<PlatformDashboardStats>("/platform/dashboard-stats/", { accessToken });
}

export interface OrgDashboardStats {
  bed_occupancy_percent: number;
  beds_occupied: number;
  beds_total: number;
  admissions_today: number;
  outpatient_ccp_volume: number;
  staff_on_duty: number;
  ward_occupancy: { id: string; name: string; occupied: number; total: number }[];
}

export function getOrgDashboardStats(accessToken: string) {
  return apiRequest<OrgDashboardStats>("/platform/org-dashboard-stats/", { accessToken });
}
