import { apiRequest } from "./apiClient";

// Mirrors apps/ccp_program's §7.14.5/§7.14.6 extensions serializers.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export interface ClinicalReview {
  id: string;
  patient: string;
  status: string;
  case_summary: string;
  review_notes: string;
  requested_at: string;
  reviewed_at: string | null;
}

export function listClinicalReviews(accessToken: string) {
  return apiRequest<Paginated<ClinicalReview>>("/ccp/clinical-reviews/", { accessToken });
}

export function requestClinicalReview(accessToken: string, patientId: string, caseSummary: string) {
  return apiRequest<ClinicalReview>("/ccp/clinical-reviews/", {
    method: "POST",
    body: { patient: patientId, case_summary: caseSummary },
    accessToken,
  });
}

export function decideClinicalReview(
  accessToken: string,
  reviewId: string,
  status: "APPROVED" | "CHANGES_REQUESTED",
  reviewNotes: string,
) {
  return apiRequest<ClinicalReview>(`/ccp/clinical-reviews/${reviewId}/decide/`, {
    method: "POST",
    body: { status, review_notes: reviewNotes },
    accessToken,
  });
}

export interface SupervisionRequest {
  id: string;
  patient: string;
  topic: string;
  notes: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
}

export function listSupervisionRequests(accessToken: string) {
  return apiRequest<Paginated<SupervisionRequest>>("/ccp/supervision-requests/", { accessToken });
}

export function createSupervisionRequest(accessToken: string, patientId: string, topic: string) {
  return apiRequest<SupervisionRequest>("/ccp/supervision-requests/", {
    method: "POST",
    body: { patient: patientId, topic },
    accessToken,
  });
}

export function scheduleSupervisionRequest(accessToken: string, requestId: string) {
  return apiRequest<SupervisionRequest>(`/ccp/supervision-requests/${requestId}/schedule/`, {
    method: "POST",
    accessToken,
  });
}

export function completeSupervisionRequest(accessToken: string, requestId: string, notes: string) {
  return apiRequest<SupervisionRequest>(`/ccp/supervision-requests/${requestId}/complete/`, {
    method: "POST",
    body: { notes },
    accessToken,
  });
}

export interface CcpTeamRosterRow {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  caseload_count: number;
  specialties: string[];
}

export function getCcpTeamRoster(accessToken: string) {
  return apiRequest<CcpTeamRosterRow[]>("/ccp/team-roster/", { accessToken });
}

export interface NacadaNdoReport {
  id: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  summary_data: Record<string, unknown>;
  status: string;
}

export function listNacadaReports(accessToken: string) {
  return apiRequest<Paginated<NacadaNdoReport>>("/ccp/nacada-ndo-reports/", { accessToken });
}

export function generateNacadaReport(accessToken: string, periodStart: string, periodEnd: string) {
  return apiRequest<NacadaNdoReport>("/ccp/nacada-ndo-reports/", {
    method: "POST",
    body: { period_start: periodStart, period_end: periodEnd },
    accessToken,
  });
}

export function exportNacadaReport(accessToken: string, reportId: string) {
  return apiRequest<NacadaNdoReport>(`/ccp/nacada-ndo-reports/${reportId}/export/`, {
    method: "POST",
    accessToken,
  });
}
