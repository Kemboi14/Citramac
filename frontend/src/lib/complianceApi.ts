import { apiRequest } from "./apiClient";

// Mirrors backend/apps/compliance (views.py) — docs/16-DATA-PROTECTION-COMPLIANCE.md,
// the system-side obligations from the CAFRIC legal opinion of 2 October 2026.

// ── Breach incidents (opinion §10) ──

export type BreachTrack = "TENANT_CONTROLLER" | "ODPC" | "DHA" | "DATA_SUBJECTS";
export type BreachRisk = "UNLIKELY" | "RISK" | "HIGH_RISK";
export type BreachStatus = "OPEN" | "CONTAINED" | "CLOSED";

export const BREACH_RISK_LABEL: Record<BreachRisk, string> = {
  UNLIKELY: "Unlikely to result in a risk to data subjects",
  RISK: "Likely to result in a risk of harm",
  HIGH_RISK: "Likely to result in a high risk",
};

export interface BreachNotificationTrack {
  id: string;
  track: BreachTrack;
  track_label: string;
  required: boolean;
  due_at: string;
  /** Data subjects: "without delay", no fixed hours. */
  without_delay: boolean;
  notified_at: string | null;
  notified_by: string;
  method: string;
  reference: string;
  notes: string;
  is_overdue: boolean;
}

export interface BreachIncidentSummary {
  id: string;
  organization_id: string;
  organization_name: string;
  reference: string;
  title: string;
  reported_role: "CONTROLLER" | "PROCESSOR";
  reported_role_label: string;
  became_aware_at: string;
  risk_level: BreachRisk;
  risk_level_label: string;
  status: BreachStatus;
  overdue_tracks: number;
  pending_tracks: number;
}

export interface BreachIncident extends BreachIncidentSummary {
  description: string;
  occurred_at: string | null;
  involves_health_data: boolean;
  data_categories: string;
  subjects_affected: number | null;
  containment_actions: string;
  reported_by: string;
  closed_at: string | null;
  tracks: BreachNotificationTrack[];
}

export interface BreachIncidentPayload {
  /** Platform staff only: the affected facility. */
  organization?: string;
  title: string;
  description: string;
  became_aware_at: string;
  occurred_at?: string | null;
  involves_health_data: boolean;
  data_categories?: string;
  subjects_affected?: number | null;
  risk_level: BreachRisk;
  containment_actions?: string;
}

export function listBreachIncidents(accessToken: string) {
  return apiRequest<{ results: BreachIncidentSummary[] }>("/compliance/breach-incidents/", {
    accessToken,
  });
}

export function getBreachIncident(accessToken: string, id: string) {
  return apiRequest<BreachIncident>(`/compliance/breach-incidents/${id}/`, { accessToken });
}

export function createBreachIncident(accessToken: string, payload: BreachIncidentPayload) {
  return apiRequest<BreachIncident>("/compliance/breach-incidents/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateBreachIncident(
  accessToken: string,
  id: string,
  payload: Partial<BreachIncidentPayload> & { status?: BreachStatus },
) {
  return apiRequest<BreachIncident>(`/compliance/breach-incidents/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function recordBreachNotification(
  accessToken: string,
  trackId: string,
  payload: { method: string; reference?: string; notes?: string; notified_at?: string },
) {
  return apiRequest<BreachNotificationTrack>(
    `/compliance/breach-notifications/${trackId}/record/`,
    { method: "POST", body: payload, accessToken },
  );
}

// ── Data subject requests (opinion §11) ──

export type SubjectRequestType =
  "ACCESS" | "PORTABILITY" | "CORRECTION" | "OBJECTION" | "RESTRICTION";
export type SubjectRequestStatus = "RECEIVED" | "APPROVED" | "FULFILLED" | "DECLINED";

export const SUBJECT_REQUEST_TYPES: { code: SubjectRequestType; label: string }[] = [
  { code: "ACCESS", label: "Access / copy of health record" },
  { code: "PORTABILITY", label: "Data portability" },
  { code: "CORRECTION", label: "Correction of false or misleading data" },
  { code: "OBJECTION", label: "Objection to processing" },
  { code: "RESTRICTION", label: "Restriction of processing" },
];

export interface SubjectRequest {
  id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  request_type: SubjectRequestType;
  request_type_label: string;
  received_at: string;
  received_in_writing: boolean;
  requester: "SELF" | "REPRESENTATIVE";
  requester_name: string;
  details: string;
  logged_by: string;
  status: SubjectRequestStatus;
  status_label: string;
  identity_verification: string;
  decided_by: string;
  decided_at: string | null;
  decision_notes: string;
  fulfilled_at: string | null;
  fulfilled_by: string;
  /** ACCESS and PORTABILITY are fulfilled by exporting the record. */
  exportable: boolean;
}

export function listSubjectRequests(accessToken: string, patientId?: string) {
  const query = patientId ? `?patient=${patientId}` : "";
  return apiRequest<{ results: SubjectRequest[] }>(`/compliance/subject-requests/${query}`, {
    accessToken,
  });
}

export function logSubjectRequest(
  accessToken: string,
  payload: {
    patient: string;
    request_type: SubjectRequestType;
    received_at?: string;
    received_in_writing?: boolean;
    requester?: "SELF" | "REPRESENTATIVE";
    requester_name?: string;
    details?: string;
  },
) {
  return apiRequest<SubjectRequest>("/compliance/subject-requests/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function decideSubjectRequest(
  accessToken: string,
  id: string,
  payload: {
    decision: "APPROVE" | "DECLINE" | "FULFIL";
    identity_verification?: string;
    notes?: string;
  },
) {
  return apiRequest<SubjectRequest>(`/compliance/subject-requests/${id}/decision/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

/** The full record export: `fhir` (R4 Bundle) + `record` (structured sections). */
export interface PatientRecordExport {
  generated_at: string;
  facility: string;
  request: { id: string; type: string; received_at: string };
  fhir: Record<string, unknown>;
  record: Record<string, unknown>;
}

export function exportSubjectRequest(accessToken: string, id: string) {
  return apiRequest<PatientRecordExport>(`/compliance/subject-requests/${id}/export/`, {
    accessToken,
  });
}

// ── Platform support access (opinion §4.2, §6) ──

export type SupportGrantStatus = "REQUESTED" | "APPROVED" | "DECLINED" | "REVOKED" | "EXPIRED";

export interface SupportGrant {
  id: string;
  organization_id: string;
  organization_name: string;
  requested_by: string;
  requested_by_email: string;
  requested_at: string;
  reason: string;
  reference: string;
  duration_hours: number;
  status: SupportGrantStatus;
  decided_by: string;
  decided_at: string | null;
  decision_note: string;
  expires_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
}

export const SUPPORT_GRANT_MAX_HOURS = 72;

export function listSupportGrants(accessToken: string) {
  return apiRequest<{ results: SupportGrant[] }>("/compliance/support-grants/", { accessToken });
}

export function requestSupportGrant(
  accessToken: string,
  payload: { organization: string; reason: string; reference?: string; duration_hours: number },
) {
  return apiRequest<SupportGrant>("/compliance/support-grants/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function decideSupportGrant(
  accessToken: string,
  id: string,
  payload: { decision: "APPROVE" | "DECLINE" | "REVOKE"; note?: string },
) {
  return apiRequest<SupportGrant>(`/compliance/support-grants/${id}/decision/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

// ── Compliance profile & platform settings (opinion §4.3, §5, §6) ──

export interface ComplianceProfile {
  organization_id: string;
  organization_name: string;
  odpc_registration_number: string;
  odpc_registration_expires_on: string | null;
  odpc_evidence_url: string | null;
  odpc_verified_by: string;
  odpc_verified_at: string | null;
  dpa_version: string;
  dpa_signed_on: string | null;
  warranty_version: string;
  warranty_accepted_at: string | null;
  warranty_accepted_by: string;
  current_warranty_version: string;
  current_warranty_text: string;
  dpo_name: string;
  dpo_email: string;
  dpo_phone: string;
  /** Plain-language list of what is still missing; empty = complete. */
  gaps: string[];
}

export function getComplianceProfile(accessToken: string) {
  return apiRequest<ComplianceProfile>("/compliance/profile/", { accessToken });
}

export function updateComplianceProfile(
  accessToken: string,
  payload: {
    dpo_name?: string;
    dpo_email?: string;
    dpo_phone?: string;
    odpc_registration_number?: string;
    odpc_evidence?: File;
  },
) {
  let body: FormData | Record<string, unknown> = payload;
  if (payload.odpc_evidence) {
    const form = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined) form.set(key, value as string | Blob);
    });
    body = form;
  }
  return apiRequest<ComplianceProfile>("/compliance/profile/", {
    method: "PATCH",
    body,
    accessToken,
  });
}

export function acceptComplianceWarranty(accessToken: string, version: string) {
  return apiRequest<ComplianceProfile>("/compliance/profile/accept-warranty/", {
    method: "POST",
    body: { version },
    accessToken,
  });
}

export function listTenantCompliance(accessToken: string) {
  return apiRequest<{ results: ComplianceProfile[] }>("/compliance/tenants/", { accessToken });
}

export function updateTenantCompliance(
  accessToken: string,
  organizationId: string,
  payload: {
    odpc_registration_number?: string;
    odpc_registration_expires_on?: string | null;
    dpa_version?: string;
    dpa_signed_on?: string | null;
    verify_odpc?: boolean;
  },
) {
  return apiRequest<ComplianceProfile>(`/compliance/tenants/${organizationId}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export interface PlatformComplianceSettings {
  dpo_name: string;
  dpo_email: string;
  dpo_phone: string;
  warranty_version: string;
  warranty_text: string;
  updated_at: string;
}

export function getPlatformComplianceSettings(accessToken: string) {
  return apiRequest<PlatformComplianceSettings>("/compliance/platform-settings/", {
    accessToken,
  });
}

export function updatePlatformComplianceSettings(
  accessToken: string,
  payload: Partial<Omit<PlatformComplianceSettings, "updated_at">>,
) {
  return apiRequest<PlatformComplianceSettings>("/compliance/platform-settings/", {
    method: "PUT",
    body: payload,
    accessToken,
  });
}

/** Public, no login — the platform DPO contact (opinion §5). */
export function getPublicDpo() {
  return apiRequest<{ dpo_name: string; dpo_email: string; dpo_phone: string }>(
    "/compliance/public/dpo/",
  );
}
