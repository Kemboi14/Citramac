import { apiRequest } from "./apiClient";

// Mirrors apps/client_registry's ErasureRequest serializer — docs/09-SECURITY-COMPLIANCE.md §9.5.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export interface ErasureRequest {
  id: string;
  patient: string;
  requested_by: string | null;
  reason: string;
  status: "PENDING" | "RETENTION_CONFLICT" | "REJECTED" | "COMPLETED";
  org_admin_approved_by: string | null;
  org_admin_approved_at: string | null;
  compliance_officer_approved_by: string | null;
  compliance_officer_approved_at: string | null;
  rejection_reason: string;
  retention_conflict_detail: string;
  completed_at: string | null;
  is_fully_approved: boolean;
  created_at: string;
}

export function listErasureRequests(accessToken: string) {
  return apiRequest<Paginated<ErasureRequest>>("/erasure-requests/", { accessToken });
}

export function createErasureRequest(accessToken: string, patientId: string, reason: string) {
  return apiRequest<ErasureRequest>("/erasure-requests/", {
    method: "POST",
    body: { patient: patientId, reason },
    accessToken,
  });
}

export function approveAsOrgAdmin(accessToken: string, requestId: string) {
  return apiRequest<ErasureRequest>(`/erasure-requests/${requestId}/approve-org-admin/`, {
    method: "POST",
    accessToken,
  });
}

export function executeErasure(accessToken: string, requestId: string) {
  return apiRequest<ErasureRequest>(`/erasure-requests/${requestId}/execute/`, {
    method: "POST",
    accessToken,
  });
}
