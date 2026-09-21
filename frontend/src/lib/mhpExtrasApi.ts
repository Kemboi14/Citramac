import { apiRequest } from "./apiClient";

// Mirrors apps/mhp_program's §7.14.5/§7.14.6 extensions serializers.

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
  return apiRequest<Paginated<ClinicalReview>>("/mhp/clinical-reviews/", { accessToken });
}

export function requestClinicalReview(accessToken: string, patientId: string, caseSummary: string) {
  return apiRequest<ClinicalReview>("/mhp/clinical-reviews/", {
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
  return apiRequest<ClinicalReview>(`/mhp/clinical-reviews/${reviewId}/decide/`, {
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
  return apiRequest<Paginated<SupervisionRequest>>("/mhp/supervision-requests/", { accessToken });
}

export function createSupervisionRequest(accessToken: string, patientId: string, topic: string) {
  return apiRequest<SupervisionRequest>("/mhp/supervision-requests/", {
    method: "POST",
    body: { patient: patientId, topic },
    accessToken,
  });
}

export function scheduleSupervisionRequest(accessToken: string, requestId: string) {
  return apiRequest<SupervisionRequest>(`/mhp/supervision-requests/${requestId}/schedule/`, {
    method: "POST",
    accessToken,
  });
}

export function completeSupervisionRequest(accessToken: string, requestId: string, notes: string) {
  return apiRequest<SupervisionRequest>(`/mhp/supervision-requests/${requestId}/complete/`, {
    method: "POST",
    body: { notes },
    accessToken,
  });
}

export interface MhpTeamRosterRow {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  caseload_count: number;
  specialties: string[];
}

export function getMhpTeamRoster(accessToken: string) {
  return apiRequest<MhpTeamRosterRow[]>("/mhp/team-roster/", { accessToken });
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
  return apiRequest<Paginated<NacadaNdoReport>>("/mhp/nacada-ndo-reports/", { accessToken });
}

export function generateNacadaReport(accessToken: string, periodStart: string, periodEnd: string) {
  return apiRequest<NacadaNdoReport>("/mhp/nacada-ndo-reports/", {
    method: "POST",
    body: { period_start: periodStart, period_end: periodEnd },
    accessToken,
  });
}

export function exportNacadaReport(accessToken: string, reportId: string) {
  return apiRequest<NacadaNdoReport>(`/mhp/nacada-ndo-reports/${reportId}/export/`, {
    method: "POST",
    accessToken,
  });
}
