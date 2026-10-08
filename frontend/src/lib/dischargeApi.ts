import { apiRequest } from "./apiClient";

// Mirrors backend/apps/care_pathway (views.py, services.py) — discharge planning
// and follow-up, docs/17-DISCHARGE-AND-FOLLOW-UP.md. Nothing here touches browser
// storage (CLAUDE.md §5): drafts live on the server.

// ── Discharge planning ──

export type DischargeState = "NOT_STARTED" | "DRAFT";

export interface CurrentInpatientRow {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  bed_label: string;
  admission_type: "VOLUNTARY" | "INVOLUNTARY";
  admitted_at: string;
  days_in: number;
  state: DischargeState;
  draft_saved_at: string | null;
}

export interface RecentDischargeRow {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  bed_label: string;
  discharged_at: string;
  summary_id: string | null;
  version: number | null;
  /** "LEGACY" is a discharge recorded before signed summaries existed. */
  status: "IN_PROGRESS" | "COMPLETED" | "LEGACY";
  disposition_label: string;
}

export interface DischargeWorklist {
  current: CurrentInpatientRow[];
  recent: RecentDischargeRow[];
}

export interface DischargeDiagnosis {
  id: string;
  code: string;
  description: string;
  is_primary: boolean;
}

export interface DischargeContextMedication {
  prescription_item: string;
  drug: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  last_mar_status: string;
}

export interface DischargeMedicationLine {
  prescription_item: string | null;
  drug: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  action: string;
  action_label?: string;
  note: string;
}

export interface DischargeFollowUp {
  id: string;
  scheduled_for: string;
  reason: string;
  reason_label: string;
  status: string;
}

/** A restricted summary carries only the header fields; the rest is omitted by the server. */
export interface DischargeSummary {
  id: string;
  admission_id: string;
  version: number;
  supersedes: string | null;
  status: "IN_PROGRESS" | "COMPLETED";
  disposition: string;
  disposition_label: string;
  discharged_at: string | null;
  signed_at: string | null;
  signed_by_name: string;
  signed_role: string;
  draft_saved_at: string | null;
  restricted: boolean;
  destination?: string;
  clinical_status?: string;
  treatment_summary?: string;
  legal_status_at_discharge?: string;
  education?: string[];
  diagnoses?: DischargeDiagnosis[];
  medications?: DischargeMedicationLine[];
  follow_up?: DischargeFollowUp | null;
}

export interface DischargeAdmission {
  id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  bed_label: string;
  admission_type: "VOLUNTARY" | "INVOLUNTARY";
  admitted_at: string;
  status: "ADMITTED" | "TRANSFERRED" | "DISCHARGED";
  discharged_at: string | null;
  consultant_name: string;
  legacy_summary: string;
}

export interface DischargePayload {
  admission: DischargeAdmission;
  restricted: boolean;
  summary: DischargeSummary | null;
  context: {
    diagnoses: DischargeDiagnosis[];
    medications: DischargeContextMedication[];
    involuntary: boolean;
    legal_status: string;
    legal_order_reference: string;
  } | null;
  versions: {
    id: string;
    version: number;
    status: "IN_PROGRESS" | "COMPLETED";
    signed_at: string | null;
    signed_by_name: string;
  }[];
}

export interface DischargeFollowUpInput {
  scheduled_for: string;
  reason: string;
  mode?: string;
  client_request_id: string;
}

export interface DischargeInput {
  disposition: string;
  destination: string;
  discharged_at?: string;
  clinical_status: string;
  treatment_summary: string;
  legal_status_at_discharge: string;
  education: string[];
  diagnoses: string[];
  medications: {
    prescription_item: string | null;
    drug: string;
    dose: string;
    route: string;
    frequency: string;
    duration: string;
    action: string;
    note: string;
  }[];
  follow_up?: DischargeFollowUpInput;
}

export function getDischargeWorklist(accessToken: string) {
  return apiRequest<DischargeWorklist>("/care/discharges/", { accessToken });
}

export function getAdmissionDischarge(accessToken: string, admissionId: string) {
  return apiRequest<DischargePayload>(`/care/admissions/${admissionId}/discharge/`, {
    accessToken,
  });
}

export function saveDischargeDraft(
  accessToken: string,
  admissionId: string,
  input: DischargeInput,
) {
  return apiRequest<DischargePayload>(`/care/admissions/${admissionId}/discharge/`, {
    method: "PUT",
    body: input,
    accessToken,
  });
}

export function signDischarge(accessToken: string, admissionId: string, input: DischargeInput) {
  return apiRequest<DischargePayload>(`/care/admissions/${admissionId}/discharge/sign/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function amendDischarge(accessToken: string, summaryId: string) {
  return apiRequest<DischargePayload>(`/care/discharges/${summaryId}/amend/`, {
    method: "POST",
    accessToken,
  });
}

export function dischargeFhirPath(summaryId: string) {
  return `/care/discharges/${summaryId}/fhir/`;
}

// ── Follow-up ──

export type FollowUpBucket = "upcoming" | "overdue" | "missed" | "unbooked";

export interface FollowUpAppointmentRow {
  kind: "appointment";
  id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  scheduled_for: string;
  reason: string;
  reason_label: string;
  status: string;
  provider_name: string;
  origin: "MANUAL" | "DISCHARGE" | "CARE_PLAN";
  admission_id: string | null;
  episode_id: string | null;
}

export interface FollowUpUnbookedRow {
  kind: "unbooked";
  id: string;
  patient_id: string;
  patient_name: string;
  citramac_number: string;
  discharged_at: string;
  days_since_discharge: number;
  admission_id: string;
  episode_id: string | null;
}

export interface FollowUpOverview {
  bucket: FollowUpBucket;
  counts: Record<FollowUpBucket, number>;
  results: (FollowUpAppointmentRow | FollowUpUnbookedRow)[];
}

export interface BookFollowUpInput {
  /** Book for a client… */
  patient?: string;
  /** …or for a discharged admission that has no follow-up yet. */
  admission?: string;
  scheduled_for: string;
  reason: string;
  mode?: string;
  notes?: string;
  client_request_id: string;
}

export function getFollowUps(accessToken: string, bucket: FollowUpBucket) {
  return apiRequest<FollowUpOverview>(`/care/follow-ups/?bucket=${bucket}`, { accessToken });
}

export function bookFollowUp(accessToken: string, input: BookFollowUpInput) {
  return apiRequest<FollowUpAppointmentRow>("/care/follow-ups/", {
    method: "POST",
    body: input,
    accessToken,
  });
}
