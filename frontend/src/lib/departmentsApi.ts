import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.tenancy's DepartmentSerializer — the org unit one level
// below Branch (docs/04-MULTI-TENANCY.md §4.1).

export interface Department {
  id: string;
  organization: string;
  organization_name: string;
  branch: string | null;
  branch_name: string;
  name: string;
  description: string;
  is_active: boolean;
}

export interface ListDepartmentsParams {
  q?: string;
  branch?: string;
}

export function listDepartments(accessToken: string, params: ListDepartmentsParams = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();
  return apiRequest<Paginated<Department>>(`/platform/departments/${query ? `?${query}` : ""}`, {
    accessToken,
  });
}

export interface CreateDepartmentPayload {
  /** Required for Super Admin (creating on behalf of a tenant); ignored for Org Admin, whose new department always belongs to their own organization. */
  organization?: string;
  name: string;
  description?: string;
  branch?: string | null;
  is_active?: boolean;
}

export function createDepartment(accessToken: string, payload: CreateDepartmentPayload) {
  return apiRequest<Department>("/platform/departments/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateDepartment(accessToken: string, id: string, payload: Partial<Department>) {
  return apiRequest<Department>(`/platform/departments/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}
