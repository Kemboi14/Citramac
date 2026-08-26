import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.accounts's Permission/Role/Staff serializers —
// citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform Staff",
// citramac_ORG-admin.html "Roles & Permissions" + "Staff / CCP Team".

export interface Permission {
  id: number;
  codename: string;
  description: string;
}

export type RoleScope = "PLATFORM" | "ORG_TEMPLATE";

export interface Role {
  id: number;
  name: string;
  organization: string | null;
  scope: RoleScope;
  description: string;
  permissions: number[];
  user_count: number;
}

export interface Staff {
  id: string;
  staff_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  roles: number[];
  role_names: string[];
  primary_branch: string | null;
  primary_branch_name: string | null;
  branch_access: string[];
  is_active: boolean;
  is_on_duty: boolean;
  last_login: string | null;
}

export interface StaffInvitePayload {
  email: string;
  first_name: string;
  last_name: string;
  staff_id?: string;
  role: number;
  primary_branch?: string;
}

export function listPermissions(accessToken: string) {
  return apiRequest<Permission[]>("/permissions/", { accessToken });
}

export function listRoles(accessToken: string) {
  return apiRequest<Paginated<Role>>("/roles/", { accessToken });
}

export function createRole(
  accessToken: string,
  payload: { name: string; description?: string; permissions: number[] },
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

export function listStaff(accessToken: string) {
  return apiRequest<Paginated<Staff>>("/staff/", { accessToken });
}

export function inviteStaff(accessToken: string, payload: StaffInvitePayload) {
  return apiRequest<Staff>("/staff/", { method: "POST", body: payload, accessToken });
}

export function updateStaff(accessToken: string, id: string, payload: Partial<Staff>) {
  return apiRequest<Staff>(`/staff/${id}/`, { method: "PATCH", body: payload, accessToken });
}

export function deactivateStaff(accessToken: string, id: string) {
  return apiRequest<void>(`/staff/${id}/`, { method: "DELETE", accessToken });
}

export function toggleStaffDuty(accessToken: string, id: string) {
  return apiRequest<Staff>(`/staff/${id}/toggle_duty/`, { method: "POST", accessToken });
}

export function listPlatformStaff(accessToken: string) {
  return apiRequest<Paginated<Staff>>("/platform/staff/", { accessToken });
}

export function invitePlatformStaff(accessToken: string, payload: StaffInvitePayload) {
  return apiRequest<Staff>("/platform/staff/", { method: "POST", body: payload, accessToken });
}
