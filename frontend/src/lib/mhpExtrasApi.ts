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

// NACADA NDO report — apps/mhp_program/nacada_views.py. Counts only; small
// numbers are already withheld in the stored snapshot.

export interface NacadaCell {
  value: number | null;
  display: string;
  masked: "small" | "secondary" | null;
}

export interface NacadaRow extends NacadaCell {
  code: string;
  label: string;
}

export interface NacadaSection {
  code: string;
  title: string;
  scope: "branch" | "organization";
  total_label: string;
  total: NacadaCell;
  median_days?: NacadaCell;
  breakdowns: { code: string; title: string; rows: NacadaRow[] }[];
  notes: string[];
}

export interface NacadaSummary {
  definition: string;
  definition_label: string;
  organization_name: string;
  branch_name: string;
  period_start: string;
  period_end: string;
  sections: NacadaSection[];
  notes: string[];
}

export type NacadaDeliveryStatus = "PENDING" | "SENT" | "FAILED" | "NOT_CONFIGURED" | null;

export interface NacadaReportSend {
  id: string;
  target: "NACADA" | "SELF";
  address: string;
  sent_by_name: string;
  sent_at: string;
  delivery_status: NacadaDeliveryStatus;
  delivery_error: string;
}

export interface NacadaNdoReport {
  id: string;
  period_start: string;
  period_end: string;
  branch: string | null;
  branch_name: string;
  /** Blank for reports compiled in the old format, which cannot be sent. */
  definition: string;
  generated_by_name: string;
  generated_at: string;
  summary_data: NacadaSummary | Record<string, unknown>;
  status: string;
  sends: NacadaReportSend[];
}

export interface NacadaSettings {
  nacada_report_email: string;
  can_edit: boolean;
  can_send: boolean;
  my_email: string;
  branches: { id: string; name: string }[];
  /** The branch the user is working at; null when viewing all branches. */
  working_branch: string | null;
}

export function listNacadaReports(accessToken: string) {
  return apiRequest<Paginated<NacadaNdoReport>>("/mhp/nacada-ndo-reports/", { accessToken });
}

export function compileNacadaReport(
  accessToken: string,
  body: { period_start: string; period_end: string; branch?: string },
) {
  return apiRequest<NacadaNdoReport>("/mhp/nacada-ndo-reports/", {
    method: "POST",
    body,
    accessToken,
  });
}

export function sendNacadaReport(accessToken: string, reportId: string, target: "NACADA" | "SELF") {
  return apiRequest<NacadaNdoReport>(`/mhp/nacada-ndo-reports/${reportId}/send/`, {
    method: "POST",
    body: { target, confirm: true },
    accessToken,
  });
}

export function getNacadaSettings(accessToken: string) {
  return apiRequest<NacadaSettings>("/mhp/nacada-settings/", { accessToken });
}

export function saveNacadaSettings(accessToken: string, nacadaReportEmail: string) {
  return apiRequest<NacadaSettings>("/mhp/nacada-settings/", {
    method: "PUT",
    body: { nacada_report_email: nacadaReportEmail },
    accessToken,
  });
}
