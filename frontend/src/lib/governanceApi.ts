import type { ProfessionalProfileSummary } from "./professionalProfileApi";
import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.accounts's Permission/Role/Staff serializers —
// citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform Staff",
// citramac_ORG-admin.html "Roles & Permissions" + "Staff / MHP Team".

export interface Permission {
  id: number;
  codename: string;
  /** Plain-language name (backend apps/accounts/catalogue.py). */
  label: string;
  /** What the permission allows. */
  description: string;
  module: string;
  module_label: string;
  /** ORG: an organisation may grant it. PLATFORM: the platform team's console only. */
  scope: "ORG" | "PLATFORM";
}

/** PLATFORM: the platform team's own roles. ORG_TEMPLATE: an organisation's role. */
export type RoleScope = "PLATFORM" | "ORG_TEMPLATE";

/**
 * built_in: a locked administrator role (Org Admin, Auditor, Super Admin) —
 * name and access fixed. standard: the organisation's own copy of a standard
 * role. custom: a role the organisation (or platform) made itself.
 */
export type RoleKind = "built_in" | "standard" | "custom";

export interface Role {
  id: number;
  name: string;
  organization: string | null;
  organization_name: string | null;
  scope: RoleScope;
  /** Which built-in role this is ("org_admin", "psychiatrist", …); "" for a custom role. */
  system_key: string;
  kind: RoleKind;
  is_locked: boolean;
  /** False once retired: kept on record, but can't be given to anyone. */
  is_active: boolean;
  description: string;
  permissions: number[];
  user_count: number;
}

export const ORG_ADMIN_KEY = "org_admin";

/** Someone holding a role, and the branches they hold it at. */
export interface RoleMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  branches: string[];
}

export type StaffAccessStatus = "not_started" | "active" | "expired" | null;

/** One role held at one branch — `branch` null means every branch of the organisation. */
export interface RoleAssignment {
  id?: string;
  role: number;
  role_name?: string;
  branch: string | null;
  branch_name?: string | null;
}

/** PractitionerCredential.nacada_status — null when no NACADA number is recorded. */
export type NacadaStatus = "UNVERIFIED" | "EXPIRED" | "EXPIRING" | "VALID" | null;

export interface Staff {
  id: string;
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  roles: number[];
  role_names: string[];
  organization: string | null;
  organization_name: string | null;
  primary_branch: string | null;
  primary_branch_name: string | null;
  department: string | null;
  department_name: string | null;
  branch_access: string[];
  is_active: boolean;
  /** A Super Admin account (platform console), whatever roles it holds. */
  is_superuser: boolean;
  is_on_duty: boolean;
  last_login: string | null;
  /** True while this account is inside LoginView's failed-attempt lockout window. */
  is_locked: boolean;
  /** Null when unrestricted; otherwise where `now` sits relative to the access window. */
  access_starts_at: string | null;
  access_ends_at: string | null;
  access_status: StaffAccessStatus;
  assignments: RoleAssignment[];
  nacada_status: NacadaStatus;
  /** Never signed in: what happened to their latest activation email (from the outbox). */
  invite_email: InviteEmail | null;
  /** Their professional profile's status (null for platform accounts). */
  professional_profile: ProfessionalProfileSummary | null;
}

export type InviteEmailStatus = "PENDING" | "SENT" | "FAILED" | "NOT_CONFIGURED";

export interface InviteEmail {
  status: InviteEmailStatus;
  queued_at: string;
}

export interface StaffInvitePayload {
  email: string;
  first_name: string;
  last_name: string;
  staff_id?: string;
  /** Either one `role` (held at `primary_branch`, or org-wide) or `assignments`. */
  role?: number;
  assignments?: RoleAssignment[];
  primary_branch?: string;
  department?: string;
  /** Super Admin only — which org to create this staff member in. Ignored
   * (an Org Admin's own org is used instead) for any other caller. */
  organization?: string;
  /** Time-bound (e.g. locum/fixed-term) access window — both optional, null/omitted means unrestricted. */
  access_starts_at?: string | null;
  access_ends_at?: string | null;
}

export function listPermissions(accessToken: string, scope?: "ORG" | "PLATFORM") {
  return apiRequest<Permission[]>(`/permissions/${scope ? `?scope=${scope}` : ""}`, {
    accessToken,
  });
}

/**
 * The caller's roles: an Org Admin gets their organisation's roles; a Super
 * Admin the platform team's. `organizationId` lets a Super Admin list one
 * organisation's roles instead (read-only — to add staff to it).
 */
export function listRoles(accessToken: string, organizationId?: string) {
  const query = organizationId ? `?organization=${organizationId}` : "";
  return apiRequest<Role[]>(`/roles/${query}`, { accessToken });
}

export function createRole(
  accessToken: string,
  payload: { name: string; description?: string; permissions?: number[]; copy_from?: number },
) {
  return apiRequest<Role>("/roles/", { method: "POST", body: payload, accessToken });
}

export function updateRole(
  accessToken: string,
  id: number,
  payload: { name?: string; description?: string; permissions?: number[] },
) {
  return apiRequest<Role>(`/roles/${id}/`, { method: "PATCH", body: payload, accessToken });
}

export function listRoleMembers(accessToken: string, id: number) {
  return apiRequest<RoleMember[]>(`/roles/${id}/members/`, { accessToken });
}

export function retireRole(accessToken: string, id: number) {
  return apiRequest<Role>(`/roles/${id}/retire/`, { method: "POST", accessToken });
}

export function reactivateRole(accessToken: string, id: number) {
  return apiRequest<Role>(`/roles/${id}/reactivate/`, { method: "POST", accessToken });
}

/** Every staff member — all pages, so filtering and printing never miss anyone past the first 25. */
export async function listStaff(accessToken: string): Promise<Paginated<Staff>> {
  const first = await apiRequest<Paginated<Staff>>("/staff/", { accessToken });
  const results = [...first.results];
  for (let page = 2; results.length < first.count; page += 1) {
    const next = await apiRequest<Paginated<Staff>>(`/staff/?page=${page}`, { accessToken });
    if (next.results.length === 0) break;
    results.push(...next.results);
  }
  return { ...first, results };
}

export function inviteStaff(accessToken: string, payload: StaffInvitePayload) {
  return apiRequest<Staff>("/staff/", { method: "POST", body: payload, accessToken });
}

export function updateStaff(
  accessToken: string,
  id: string,
  payload: Partial<Omit<Staff, "assignments">> & { assignments?: RoleAssignment[] },
) {
  return apiRequest<Staff>(`/staff/${id}/`, { method: "PATCH", body: payload, accessToken });
}

export function deactivateStaff(accessToken: string, id: string) {
  return apiRequest<void>(`/staff/${id}/`, { method: "DELETE", accessToken });
}

export function toggleStaffDuty(accessToken: string, id: string) {
  return apiRequest<Staff>(`/staff/${id}/toggle_duty/`, { method: "POST", accessToken });
}

export function resendStaffInvite(accessToken: string, id: string) {
  return apiRequest<Staff>(`/staff/${id}/resend_invite/`, { method: "POST", accessToken });
}

export function unlockStaff(accessToken: string, id: string) {
  return apiRequest<Staff>(`/staff/${id}/unlock/`, { method: "POST", accessToken });
}

export function resetStaffCredentials(accessToken: string, id: string) {
  return apiRequest<{ detail: string }>(`/staff/${id}/reset_credentials/`, {
    method: "POST",
    accessToken,
  });
}

export function listPlatformStaff(accessToken: string) {
  return apiRequest<Paginated<Staff>>("/platform/staff/", { accessToken });
}

export function invitePlatformStaff(accessToken: string, payload: StaffInvitePayload) {
  return apiRequest<Staff>("/platform/staff/", { method: "POST", body: payload, accessToken });
}

export interface SuperAdminInvitePayload {
  email: string;
  first_name: string;
  last_name: string;
  /** Why this person needs full access — required, written to the audit trail. */
  reason: string;
  /** When sign-in stops on its own; null means no end date. */
  access_ends_at: string | null;
}

/** A second Super Admin — the same full access as the inviting Super Admin. */
export function inviteSuperAdmin(accessToken: string, payload: SuperAdminInvitePayload) {
  return apiRequest<Staff>("/platform/staff/", {
    method: "POST",
    body: { ...payload, super_admin: true },
    accessToken,
  });
}

export function resendPlatformStaffInvite(accessToken: string, id: string) {
  return apiRequest<Staff>(`/platform/staff/${id}/resend_invite/`, { method: "POST", accessToken });
}

export function changePlatformStaffRole(accessToken: string, id: string, role: number) {
  return apiRequest<Staff>(`/platform/staff/${id}/change_role/`, {
    method: "POST",
    body: { role },
    accessToken,
  });
}

export function unlockPlatformStaff(accessToken: string, id: string) {
  return apiRequest<Staff>(`/platform/staff/${id}/unlock/`, { method: "POST", accessToken });
}

export function resetPlatformStaffCredentials(accessToken: string, id: string) {
  return apiRequest<{ detail: string }>(`/platform/staff/${id}/reset_credentials/`, {
    method: "POST",
    accessToken,
  });
}
