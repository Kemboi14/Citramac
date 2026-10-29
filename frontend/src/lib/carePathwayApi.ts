import { apiRequest } from "./apiClient";
import type { LegalBanner } from "./legalStatusApi";

// Mirrors backend/apps/care_pathway (views.py) — docs/15-CLINICAL-WORKSPACE-V3.md.
// Every clinical screen of the approved 2026-10-07 mockup reads/writes here.
// Nothing in this module touches browser storage (CLAUDE.md §5).

export type Priority = "RED" | "ORANGE" | "YELLOW" | "GREEN";
export type PriorityOrBlank = Priority | "";
export type TriageStatus =
  "AWAITING" | "IN_TRIAGE" | "COMPLETED" | "RECHECK_COMPLETED" | "RECHECK_DUE";
export type IdentityStatus = "IDENTIFIED" | "UNIDENTIFIED" | "UNKNOWN";

export const PRIORITY_LABEL: Record<Priority, string> = {
  RED: "Emergency",
  ORANGE: "Urgent",
  YELLOW: "Priority",
  GREEN: "Routine",
};

// ── Served value sets ──

export interface ValueSetConcept {
  code: string;
  display: string;
}
export interface ValueSet {
  title: string;
  version: string;
  concepts: ValueSetConcept[];
}

export function getValueSets(accessToken: string, ids: string[]) {
  const query = ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
  return apiRequest<Record<string, ValueSet>>(`/care/valuesets/${query}`, { accessToken });
}

// ── Registration ──

export interface RegistrationRow {
  id: string;
  name: string;
  identity_status: IdentityStatus;
  identity_label: string;
  identity_description: string;
  citramac_number: string;
  first_name: string;
  middle_other_names: string;
  last_name: string;
  preferred_name: string;
  pronouns: string;
  date_of_birth: string | null;
  estimated_age: number | null;
  age: number | null;
  sex: string;
  phone: string;
  next_of_kin: string;
  next_of_kin_relationship: string;
  next_of_kin_phone: string;
  referral_source: string;
  /** A temporary (unidentified / unknown) record awaiting identity resolution. */
  is_temporary: boolean;
  emergency_arrival: EmergencyArrival | null;
  marital_status: string;
  employment_status: string;
  occupation: string;
  living_with_disability: string;
  disability_details: string;
  address: string;
  id_document_type: string;
  id_document_number: string;
  preferred_language: string;
  interpreter: string;
  allergy_status: string;
  allergy_details: string;
  payer: string;
  identifiers?: { kind: string; value: string; superseded: boolean }[];
}

/** What the desk recorded when a temporary record arrived (registration only). */
export interface EmergencyArrival {
  arrival_at: string | null;
  found_location: string;
  arrival_referral_info: string;
  identification_notes: string;
  brought_by: { name: string; relationship: string; phone: string } | null;
}

/** Identity and social details sent by a registration or an identity resolution. */
export interface IdentityDetails {
  first_name?: string;
  last_name?: string;
  middle_other_names?: string;
  preferred_name?: string;
  pronouns?: string;
  date_of_birth?: string;
  estimated_age?: number | null;
  sex?: string;
  phone?: string;
  address?: string;
  id_document_type?: string;
  id_document_number?: string;
  unhcr_number?: string;
  sha_member_number?: string;
  preferred_language?: string;
  interpreter?: string;
  living_with_disability?: string;
  disability_details?: string;
  employment_status?: string;
  occupation?: string;
  marital_status?: string;
}

export type ConsentDecision = "NOT_ASKED" | "YES" | "NO" | "RESTRICTED";

export interface HieConsentPayload {
  general?: ConsentDecision;
  mental_health?: ConsentDecision;
  substance_use?: ConsentDecision;
  family?: ConsentDecision;
}

export interface DuplicateMatch {
  match: "exact" | "probable";
  reason: string;
  client: RegistrationRow;
}

export function checkRegistrationDuplicates(
  accessToken: string,
  payload: {
    full_name?: string;
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    sex?: string;
    phone?: string;
    id_document_type?: string;
    id_document_number?: string;
    unhcr_number?: string;
    sha_member_number?: string;
  },
) {
  return apiRequest<{ matches: DuplicateMatch[] }>("/care/registrations/duplicate-check/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function searchRegistrations(accessToken: string, q: string) {
  return apiRequest<{ results: RegistrationRow[] }>(
    `/care/registration/search/?q=${encodeURIComponent(q)}`,
    { accessToken },
  );
}

export interface RegistrationPayload extends IdentityDetails {
  client_request_id: string;
  patient_id?: string;
  identity_status: IdentityStatus;
  /** Older single-field name; still accepted by the API. */
  full_name?: string;
  description?: string;
  next_of_kin_name?: string;
  next_of_kin_phone?: string;
  next_of_kin_relationship?: string;
  next_of_kin_is_guardian?: boolean;
  guardian_legal_status?: string;
  next_of_kin_may_be_informed?: boolean;
  hie_consent?: HieConsentPayload;
  consent_text_version?: string;
  consent_text_snapshot?: string;
  confirm_new_record?: boolean;
  referral_source?: string;
  allergy_status?: string;
  allergy_details?: string;
  payer?: string;
  reason?: string;
  // Emergency — identity unknown
  apparent_sex?: string;
  found_location?: string;
  arrival_referral_info?: string;
  identification_notes?: string;
  brought_by_name?: string;
  brought_by_relationship?: string;
  brought_by_phone?: string;
  brought_by_id_number?: string;
  brought_by_address?: string;
}

export function registerArrival(accessToken: string, payload: RegistrationPayload) {
  return apiRequest<{ triage_encounter_id: string; patient_id: string; open_triage: boolean }>(
    "/care/registrations/",
    { method: "POST", body: payload, accessToken },
  );
}

export function getRegistration(accessToken: string, patientId: string) {
  return apiRequest<RegistrationRow>(`/care/patients/${patientId}/registration/`, { accessToken });
}

/** Correct an identified client's details in place — no triage encounter is
 * opened. A field sent as "" is cleared; one left out keeps what is on file. */
export function updateRegistration(
  accessToken: string,
  patientId: string,
  payload: Omit<RegistrationPayload, "client_request_id" | "identity_status" | "patient_id">,
) {
  return apiRequest<RegistrationRow>(`/care/patients/${patientId}/registration/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function resolveIdentity(
  accessToken: string,
  patientId: string,
  payload: IdentityDetails & { merge_into_patient_id?: string },
) {
  return apiRequest<RegistrationRow>(`/care/patients/${patientId}/resolve-identity/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

// ── Triage ──

export interface WorklistRow {
  id: string;
  patient_id: string;
  name: string;
  citramac_number: string;
  /** UHID — the mockup's "MRN". */
  mrn: string;
  setting: "INPATIENT" | "OUTPATIENT";
  status: TriageStatus;
  status_label: string;
  due_at: string;
  is_overdue: boolean;
  /** v4: a re-check past due for a RED / ORANGE client ("Re-triage OVERDUE"). */
  recheck_overdue?: boolean;
  wait_minutes: number;
  visit_number: number;
  triage_version: number;
  last_triaged_at: string | null;
  priority: PriorityOrBlank;
}

export function getTriageWorklist(accessToken: string) {
  return apiRequest<{ results: WorklistRow[]; overdue_count: number }>("/care/triage/worklist/", {
    accessToken,
  });
}

/** Answers keyed by stable item code (see backend triage_rules.DEFAULT_ANSWERS). */
export type TriageAnswers = Record<string, string | string[]>;

/** [finding/alert, current status, source] — v4 signed rows add [time, recorded by] (AT-20). */
export type FindingRow = [string, string, string, string?, string?];

export interface TriageEvaluation {
  rules_version: string;
  priority: Priority;
  ready: boolean;
  recommendation: string;
  summary_priority: Priority | "pending";
  reasons: string;
  alerts: { code: string; label: string }[];
  findings: FindingRow[];
  /** Section letters whose trigger callout should show: d, e, f, g, h, i. */
  triggers: string[];
  unanswered: string[];
  unresolved: string[];
}

export interface TriageAssessmentRecord {
  id: string;
  version: number;
  status: "IN_PROGRESS" | "COMPLETED";
  answers: TriageAnswers;
  findings: FindingRow[];
  alerts: { code: string; label: string }[];
  recommendation: string;
  recommendation_reasons: string;
  final_priority: PriorityOrBlank;
  decision: "CONFIRM" | "OVERRIDE" | "";
  override_reason: string;
  rules_version: string;
  tasks: { action_label: string; owner: string; status: string; created_at: string }[];
  draft_saved_at: string | null;
  signed_at: string | null;
  signed_by: string;
}

export interface CareTask {
  id: string;
  action_code: string;
  action_label: string;
  owner: string;
  status: "INITIATED" | "PENDING" | "COMPLETED";
  created_at: string;
  created_by_name: string;
  /** Triage v4 timed tasks (TRIAGE_CALLBACK, PEP_EC_DECISION, DUTY_TO_PROTECT). */
  focus_type?: string;
  due_at?: string | null;
  priority?: string;
  /** A psychiatric review's outcome (`psychiatric-review-outcome` code). */
  outcome?: string;
  outcome_note?: string;
  completed_at?: string | null;
}

export type ObservationStatus = "NOT_REPEATED" | "MEASURED" | "NOT_MEASURED";
export interface RecheckObservations {
  [key: string]: { value: string; status: ObservationStatus };
}

export interface RecheckRecord {
  id: string;
  version: number;
  status: "IN_PROGRESS" | "COMPLETED";
  change_since_last_check: string;
  distress_behaviour: string;
  observations: RecheckObservations;
  note: string;
  draft_saved_at: string | null;
  signed_at: string | null;
  signed_by: string;
}

export interface TriageEncounterDetail {
  id: string;
  patient_id: string;
  episode_id: string;
  status: TriageStatus;
  status_label: string;
  visit_number: number;
  arrival_at: string;
  due_at: string;
  wait_minutes: number;
  presenting_concern: string;
  referral_source: string;
  priority: PriorityOrBlank;
  triage_version: number;
  last_triaged_at: string | null;
  last_triaged_by: string;
  next_recheck_at: string | null;
  triage_started_at: string | null;
  clinician: string;
  tenant_location: string;
  defaults: TriageAnswers;
  /** "v5" for new / in-progress triages; "v4" / "v3" for a record signed under those rules. */
  schema?: "v3" | "v4" | "v5";
  draft: TriageAssessmentRecord | null;
  signed: TriageAssessmentRecord | null;
  evaluation: TriageEvaluation;
  tasks: CareTask[];
  recheck_draft: RecheckRecord | null;
  rechecks: RecheckRecord[];
}

export function getTriageEncounter(accessToken: string, id: string) {
  return apiRequest<TriageEncounterDetail>(`/care/triage/${id}/`, { accessToken });
}

export function startTriage(accessToken: string, id: string) {
  return apiRequest<{ status: TriageStatus }>(`/care/triage/${id}/start/`, {
    method: "POST",
    accessToken,
  });
}

export function saveTriageDraft(accessToken: string, id: string, answers: TriageAnswers) {
  return apiRequest<{ draft_saved_at: string; evaluation: TriageEvaluation }>(
    `/care/triage/${id}/draft/`,
    { method: "PUT", body: { answers }, accessToken },
  );
}

/** Section H referral: a facility's official name from the DHA Facility Registry. */
export function lookupTriageFacility(accessToken: string, id: string, frCode: string) {
  return apiRequest<{ match: { fr_code: string; official_name: string } | null }>(
    `/care/triage/${id}/facility-lookup/?fr_code=${encodeURIComponent(frCode)}`,
    { accessToken },
  );
}

export function evaluateTriage(accessToken: string, id: string, answers: TriageAnswers) {
  return apiRequest<TriageEvaluation>(`/care/triage/${id}/evaluate/`, {
    method: "POST",
    body: { answers },
    accessToken,
  });
}

export function signTriage(
  accessToken: string,
  id: string,
  payload: {
    answers: TriageAnswers;
    decision: "CONFIRM" | "OVERRIDE";
    final_priority: PriorityOrBlank;
    override_reason?: string;
  },
) {
  return apiRequest<TriageAssessmentRecord>(`/care/triage/${id}/sign/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function registerTriageTasks(
  accessToken: string,
  id: string,
  payload: { actions: string[]; owner: string; assignee?: string; status: CareTask["status"] },
) {
  return apiRequest<CareTask[]>(`/care/triage/${id}/tasks/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

/** Section N "Responsible person / team": the organisation's clinical roles
 * (teams) and clinical staff (people). */
export function getTaskOwners(accessToken: string) {
  return apiRequest<{ teams: string[]; people: { id: string; name: string }[] }>(
    "/care/task-owners/",
    { accessToken },
  );
}

/** Complete a psychiatric review with its coded outcome (and an optional note). */
export function completePsychiatricReview(
  accessToken: string,
  id: string,
  outcome: string,
  outcomeNote: string,
) {
  return apiRequest<CareTask>(`/care/tasks/${id}/`, {
    method: "PATCH",
    body: { status: "COMPLETED", outcome, outcome_note: outcomeNote },
    accessToken,
  });
}

export function updateCareTask(accessToken: string, id: string, status: CareTask["status"]) {
  return apiRequest<CareTask>(`/care/tasks/${id}/`, {
    method: "PATCH",
    body: { status },
    accessToken,
  });
}

export interface RecheckPayload {
  change_since_last_check: string;
  distress_behaviour: string;
  observations: RecheckObservations;
  note: string;
}

export function saveRecheckDraft(accessToken: string, id: string, payload: RecheckPayload) {
  return apiRequest<RecheckRecord>(`/care/triage/${id}/recheck/draft/`, {
    method: "PUT",
    body: payload,
    accessToken,
  });
}

export function signRecheck(accessToken: string, id: string, payload: RecheckPayload) {
  return apiRequest<RecheckRecord>(`/care/triage/${id}/recheck/sign/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function requestFullRetriage(accessToken: string, id: string) {
  return apiRequest<{ status: TriageStatus }>(`/care/triage/${id}/full-retriage/`, {
    method: "POST",
    accessToken,
  });
}

export function openPsychiatryReview(accessToken: string, triageEncounterId: string) {
  return apiRequest<{ patient_id: string; psychiatry_encounter_id: string }>(
    `/care/triage/${triageEncounterId}/open-review/`,
    { method: "POST", accessToken },
  );
}

// ── Psychiatry queue & documents ──

export interface PsychiatryQueueRow {
  id: string;
  patient_id: string;
  name: string;
  citramac_number: string;
  mrn: string;
  priority: Priority;
  presenting_concern: string;
  signed_at: string;
  signed_by: string;
  review_started_at: string | null;
  wait_minutes: number | null;
  target_minutes: number | null;
  over_target: boolean;
  /** The psychiatric review raised by withdrawal (triage spec item 10), if any. */
  withdrawal_review: WithdrawalReview | null;
}

export interface WithdrawalReview {
  id: string;
  label: string;
  status: CareTask["status"];
  priority: string;
  outcome: string;
  outcome_label: string;
  outcome_note: string;
  completed_at: string | null;
}

export function getPsychiatryQueue(accessToken: string) {
  return apiRequest<{ results: PsychiatryQueueRow[] }>("/care/psychiatry/queue/", { accessToken });
}

export interface SignedDocumentRow {
  id: string;
  document: string;
  triage_encounter_id: string;
  patient_id: string;
  name: string;
  citramac_number: string;
  mrn: string;
  priority: Priority;
  version: number;
  signed_at: string;
  signed_by: string;
}

export function getSignedDocuments(accessToken: string, patientId?: string) {
  const query = patientId ? `?patient=${patientId}` : "";
  return apiRequest<{ results: SignedDocumentRow[] }>(`/care/documents/${query}`, { accessToken });
}

export function getSignedAssessment(accessToken: string, id: string) {
  return apiRequest<
    TriageAssessmentRecord & { patient_id: string; name: string; labels: Record<string, string> }
  >(`/care/assessments/${id}/`, { accessToken });
}

// ── Client record ──

export interface ClientBanner {
  patient_id: string;
  name: string;
  preferred_name: string;
  identity_status: IdentityStatus;
  identity_label: string;
  identity_description: string;
  citramac_number: string;
  mrn: string;
  age: number | null;
  sex: string;
  date_of_birth: string | null;
  payer: string;
  phone: string;
  next_of_kin: string;
  referral_source: string;
  allergy: {
    state: "known" | "none" | "unknown";
    items: { substance: string; reaction: string; verification_status: string }[];
  };
  setting: {
    type: "INPATIENT" | "OUTPATIENT";
    ward: string | null;
    bed: string | null;
    status: string;
  };
  priority: PriorityOrBlank;
  alerts: { id: string; code: string; label: string }[];
  clinician: string;
  team: string;
  /** BAN-10 / LGL-DATA-01 — legal admission status + notice countdown (master prompt §7A). */
  legal_status?: LegalBanner | null;
  episode_id: string | null;
  latest_triage_encounter_id: string | null;
  latest_signed_triage_encounter_id: string | null;
  psychiatry_encounter_id: string | null;
}

export function getClientBanner(accessToken: string, patientId: string) {
  return apiRequest<ClientBanner>(`/care/clients/${patientId}/banner/`, { accessToken });
}

export interface VitalRow {
  id: string;
  recorded_at: string;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  temperature_c: string | null;
  spo2: number | null;
  blood_glucose_mmol: string | null;
  consciousness?: string;
  supplemental_o2?: boolean | null;
  ews?: EwsResult;
  recorded_by: string;
}

export interface EwsResult {
  score: number;
  measured: number;
  total_parameters: number;
  complete: boolean;
  single_parameter_3: boolean;
  label: string;
  response: { tone: "ok" | "warn" | "bad"; text: string };
  approval: string;
  version: string;
}

export function getClientVitals(accessToken: string, patientId: string) {
  return apiRequest<{ results: VitalRow[] }>(`/care/clients/${patientId}/vitals/`, {
    accessToken,
  });
}

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string;
}

export function getClientTimeline(accessToken: string, patientId: string) {
  return apiRequest<{ results: TimelineEvent[] }>(`/care/clients/${patientId}/timeline/`, {
    accessToken,
  });
}

export interface OutcomeScore {
  id: string;
  instrument: string;
  score: number;
  items?: number[];
  flags?: string[];
  positive?: boolean | null;
  /** Supplementary answers (EPDS item 10, MDQ co-occurrence / impairment, PAWSS threshold). */
  detail?: Record<string, string | number>;
  context?: string;
  /** `assessment-timepoint` code. */
  timepoint?: string;
  note?: string;
  recorded_at: string;
  source_intake: string | null;
}

export interface CarePlanActivity {
  id: string;
  title: string;
  goal: string;
  module: string;
  status: "PLANNED" | "SCHEDULED" | "ACTIVE" | "COMPLETED";
  created_at: string;
}

export interface EpisodeSummary {
  id: string;
  status: string;
  status_label: string;
  period_start: string;
  period_end: string | null;
  care_manager: string;
  /** Minutes from waitlist to first active; null if not yet active. */
  waiting_minutes: number | null;
  still_waiting: boolean;
  history: {
    status: string;
    status_label: string;
    period_start: string;
    period_end: string | null;
    changed_by: string;
  }[];
}

export interface AlertRecord {
  id: string;
  code: string;
  label: string;
  status: "ACTIVE" | "RESOLVED";
  raised_at: string;
  raised_by: string;
  resolved_at: string | null;
  resolved_by: string;
}

export interface ClientSnapshot {
  presenting_concern: string;
  triage: TriageAssessmentRecord | null;
  diagnoses: { id: string; code: string; description: string; is_primary: boolean }[];
  latest_vitals: VitalRow | null;
  next_appointment: { scheduled_for: string; appointment_type: string } | null;
  care_plan_activities: CarePlanActivity[];
  latest_scores: Partial<Record<"PHQ9" | "GAD7", OutcomeScore>>;
  episode: EpisodeSummary | null;
  alerts: AlertRecord[];
}

export function getClientSnapshot(accessToken: string, patientId: string) {
  return apiRequest<ClientSnapshot>(`/care/clients/${patientId}/snapshot/`, { accessToken });
}

export type ConsentType = "DATA_SHARING_HIE" | "AI_NOTE_PROCESSING";

export interface ConsentTemplate {
  id: string;
  consent_type: ConsentType;
  version: string;
  text: string;
  active: boolean;
  created_at: string;
  created_by: string;
}

export interface ClientLegal {
  active_consent_template: ConsentTemplate | null;
  current_consent: { granted: boolean; captured_at: string | null };
  /** AI-assisted psychotherapy note processing — offered only where the
   * organisation has turned the AI assistance on. */
  ai_consent: {
    offered: boolean;
    template: ConsentTemplate | null;
    decision: "YES" | "NO" | "NOT_ASKED" | string;
    captured_at: string | null;
    captured_by: string;
    consent_text_version: string;
  };
  data_sharing_consent: {
    id: string;
    consent_type: string;
    granted: boolean;
    consent_text_version: string;
    captured_at: string;
    captured_by: string;
  }[];
  admissions: {
    id: string;
    admitted_at: string;
    status: string;
    admission_type: "VOLUNTARY" | "INVOLUNTARY";
    admission_type_label: string;
    /** The legal basis is the client's legal admission status, not these legacy fields. */
    legal_status_linked: boolean;
    consent_status: string;
    capacity_assessed: boolean | null;
    consent_at: string | null;
    legal_status: string;
    legal_order_reference: string;
    legal_order_date: string | null;
    legal_review_due_date: string | null;
    authorizing_professional: string;
    next_of_kin_notification: string;
    next_of_kin_notification_code: string;
    consent_status_code: "" | "PENDING" | "OBTAINED" | "DECLINED";
    consent_notes: string;
    legal_rationale: string;
    oversight_notes: string;
    next_of_kin_notes: string;
  }[];
}

export function recordDataSharingConsent(
  accessToken: string,
  patientId: string,
  granted: boolean,
  consentType: ConsentType = "DATA_SHARING_HIE",
) {
  return apiRequest<{
    id: string;
    granted: boolean;
    consent_text_version: string;
    captured_at: string;
  }>(`/care/clients/${patientId}/consent/`, {
    method: "POST",
    body: { granted, consent_type: consentType },
    accessToken,
  });
}

export function listConsentTemplates(accessToken: string) {
  return apiRequest<{ results: ConsentTemplate[] }>("/care/consent-templates/", { accessToken });
}

export function createConsentTemplate(
  accessToken: string,
  payload: { version: string; text: string; consent_type?: ConsentType },
) {
  return apiRequest<ConsentTemplate>("/care/consent-templates/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function resolveAlert(accessToken: string, alertId: string) {
  return apiRequest<{ id: string; status: string }>(`/care/alerts/${alertId}/resolve/`, {
    method: "POST",
    accessToken,
  });
}

export interface TriageThresholds {
  rules_version: string;
  vital_thresholds: {
    systolic_above: number;
    pulse_above: number;
    pulse_below: number;
    spo2_below: number;
    temperature_above: number;
  };
  recheck_interval_minutes: Record<Priority, number>;
  triage_target_minutes: number;
}

export function getTriageThresholds(accessToken: string) {
  return apiRequest<TriageThresholds>("/care/triage/thresholds/", { accessToken });
}

export function getClientLegal(accessToken: string, patientId: string) {
  return apiRequest<ClientLegal>(`/care/clients/${patientId}/legal/`, { accessToken });
}

export interface IntakeAssessment {
  id: string;
  patient: string;
  episode: string | null;
  encounter: string | null;
  presenting_concern: string;
  history: string;
  symptoms: string[];
  risk_level: "" | "LOW" | "MODERATE" | "HIGH";
  risk_notes: string;
  mse_appearance: string;
  mse_behaviour: string;
  mse_mood: string;
  mse_affect: string;
  gad7_score: number | null;
  phq9_score: number | null;
  formulation: string;
  clinical_decision: string;
  care_needs: string[];
  author_name: string;
  created_at: string;
  version: number;
  status: "DRAFT" | "SIGNED";
  completeness: "" | "COMPLETE" | "PARTIAL" | "UNABLE";
  signed_at: string | null;
}

export type IntakePayload = Omit<
  IntakeAssessment,
  | "id"
  | "patient"
  | "episode"
  | "encounter"
  | "author_name"
  | "created_at"
  | "version"
  | "status"
  | "completeness"
  | "signed_at"
>;

export function listIntakeAssessments(accessToken: string, patientId: string) {
  return apiRequest<{ results: IntakeAssessment[] }>(`/care/clients/${patientId}/intake/`, {
    accessToken,
  });
}

export function saveIntakeAssessment(
  accessToken: string,
  patientId: string,
  payload: IntakePayload,
) {
  return apiRequest<IntakeAssessment>(`/care/clients/${patientId}/intake/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export interface OutcomeSummary {
  instrument: string;
  name: string;
  max: number;
  approval: "approved" | "illustrative";
  baseline: { score: number; at: string };
  latest: { score: number; band: string; at: string; flags: string[] };
  series: { score: number; at: string }[];
  change: {
    text: string;
    direction: "flat" | "good" | "bad";
    reliable: boolean;
    clinically_significant: boolean;
  };
}

export interface InstrumentDef {
  code: string;
  name: string;
  title: string;
  kind: "items" | "total";
  max: number;
  items: { text: string; options: { points: number; label: string }[] }[];
  bands: { upTo: number; label: string }[];
  higherIsWorse: boolean;
  approval: "approved" | "illustrative";
  experimental: boolean;
  hasPositiveFlag: boolean;
  /** Positive / negative is derived on the server from the published rule (MDQ). */
  positiveRule?: boolean;
  /** Questions answered alongside the items or total; each is required. */
  supplementary?: {
    key: string;
    text: string;
    options: { value: string | number; label: string }[];
  }[];
  /** A supplementary answer that ends the screen before the items (PAWSS threshold 'No'). */
  gate?: { key: string; value: string | number } | null;
  withdrawal?: boolean;
}

export interface ToolRow {
  key: string;
  name: string;
  kind: "link" | "score";
  status:
    "Recommended" | "In progress" | "Completed" | "Declined" | "Not approved" | "Not indicated";
  why: string[];
  later: boolean;
  /** Why a "Not approved" tool cannot be started. */
  note: string;
  decision: { status: string; reason: string; at: string; by: string } | null;
  last: { score: number; band: string; at: string } | null;
}

export function getInstruments(accessToken: string) {
  return apiRequest<{ results: InstrumentDef[]; ews: { version: string; approval: string } }>(
    "/care/instruments/",
    { accessToken },
  );
}

export function getClientTools(accessToken: string, patientId: string) {
  return apiRequest<{ results: ToolRow[] }>(`/care/clients/${patientId}/tools/`, { accessToken });
}

export function decideTool(
  accessToken: string,
  patientId: string,
  tool: string,
  status: "ACCEPTED" | "DECLINED" | "RECONSIDERED",
  reason = "",
) {
  return apiRequest<{ results: ToolRow[] }>(`/care/clients/${patientId}/tools/${tool}/decision/`, {
    method: "POST",
    body: { status, reason },
    accessToken,
  });
}

export function recordAssessment(
  accessToken: string,
  patientId: string,
  payload: {
    instrument: string;
    answers?: number[];
    total?: number;
    positive?: boolean;
    context?: string;
    note?: string;
    detail?: Record<string, string | number>;
    timepoint?: string;
    /** When the assessment was done, if earlier than now (ISO date-time). */
    assessed_at?: string;
  },
) {
  return apiRequest<OutcomeScore>(`/care/clients/${patientId}/assessments/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export interface WithdrawalScale {
  instrument: string;
  name: string;
  protocolConfigured: boolean;
  latest: { score: number; band: string; at: string } | null;
  flags: string[];
  nextDueAt: string | null;
  overdue: boolean;
  lastAttempt: { reason: string; at: string } | null;
  /** Facility protocol thresholds (settings.WITHDRAWAL_PROTOCOL) — null when unset. */
  prnThreshold: number | null;
  severeThreshold: number | null;
  /** Scored totals, oldest first, for the serial chart. */
  series: { score: number; at: string }[];
  /** Latest scores and unable-to-score attempts, newest first. */
  history: { at: string; score: number | null; band: string; unable: string; by: string }[];
}

export function getWithdrawal(accessToken: string, patientId: string) {
  return apiRequest<{
    scales: WithdrawalScale[];
    recommended: string | null;
    substance: string;
    /** Intake's main substance is benzodiazepines (only an approved scale is suggested). */
    benzodiazepine: boolean;
  }>(`/care/clients/${patientId}/withdrawal/`, { accessToken });
}

export function recordUnableToScore(
  accessToken: string,
  patientId: string,
  instrument: string,
  reason: string,
) {
  return apiRequest<{ id: string }>(`/care/clients/${patientId}/withdrawal/`, {
    method: "POST",
    body: { instrument, reason },
    accessToken,
  });
}

export function getOutcomeScores(accessToken: string, patientId: string) {
  return apiRequest<{ results: OutcomeScore[]; summary: OutcomeSummary[] }>(
    `/care/clients/${patientId}/outcomes/`,
    {
      accessToken,
    },
  );
}

export interface CarePlan {
  id: string;
  patient: string;
  episode: string;
  plan_type: string;
  interventions: string[];
  goals: string;
  review_date: string | null;
  care_coordinator: string | null;
  care_coordinator_name: string;
  activities: CarePlanActivity[];
  updated_at: string;
  recommendation: string;
  suggestions: { title: string; goal: string; module: string }[];
}

export function getCarePlan(accessToken: string, patientId: string) {
  return apiRequest<CarePlan>(`/care/clients/${patientId}/care-plan/`, { accessToken });
}

export function updateCarePlan(
  accessToken: string,
  patientId: string,
  payload: Partial<
    Pick<CarePlan, "plan_type" | "interventions" | "goals" | "review_date" | "care_coordinator">
  >,
) {
  return apiRequest<CarePlan>(`/care/clients/${patientId}/care-plan/`, {
    method: "PUT",
    body: payload,
    accessToken,
  });
}

export function addCarePlanActivity(
  accessToken: string,
  patientId: string,
  payload: { title: string; goal: string; module: string; status?: CarePlanActivity["status"] },
) {
  return apiRequest<CarePlanActivity>(`/care/clients/${patientId}/care-plan/activities/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateCarePlanActivity(
  accessToken: string,
  id: string,
  payload: Partial<Pick<CarePlanActivity, "title" | "goal" | "module" | "status">>,
) {
  return apiRequest<CarePlanActivity>(`/care/care-plan-activities/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export interface InterventionCorrection {
  at: string;
  by: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface InterventionRecord {
  id: string;
  activity: string | null;
  module: string;
  activity_title: string;
  activity_goal: string;
  performed_at: string;
  provider: string | null;
  provider_name: string;
  intervention: string;
  note: string;
  response: string;
  outcome: string;
  next_action: string;
  completes_activity: boolean;
  billable: boolean;
  billing_service: string | null;
  billing_service_name: string | null;
  quantity: number;
  voided_at: string | null;
  void_reason: string;
  corrections: InterventionCorrection[];
}

export function listInterventions(accessToken: string, patientId: string) {
  return apiRequest<{ results: InterventionRecord[] }>(
    `/care/clients/${patientId}/interventions/`,
    { accessToken },
  );
}

/** A delivery recorded from an Interventions module. Billing follows the
 * module's tariff line server-side — the client never picks a service. */
export function recordIntervention(
  accessToken: string,
  patientId: string,
  payload: {
    module: string;
    activity: string | null;
    intervention: string;
    note: string;
    quantity: number;
    response?: string;
    outcome?: string;
    next_action?: string;
    completes_activity?: boolean;
  },
) {
  return apiRequest<InterventionRecord>(`/care/clients/${patientId}/interventions/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

/** Correct a delivery recorded in error: it stays on record, marked corrected,
 * and leaves billing and delivered totals. */
export function voidIntervention(accessToken: string, id: string, reason: string) {
  return apiRequest<InterventionRecord>(`/care/interventions/${id}/void/`, {
    method: "POST",
    body: { reason },
    accessToken,
  });
}

export type InterventionGroup = "Assess" | "Treat" | "Support" | "Close-out";

export interface InterventionAction {
  id: string;
  title: string;
  goal: string;
  modules: string[];
  status: CarePlanActivity["status"];
  status_display: string;
  priority: PriorityOrBlank;
  instructions: string;
  /** Accepted / Modified / Added by clinician, with the first recommendation reason. */
  decision_display: string;
  why: string;
  due_at: string | null;
  /** Past due, not completed, and not Routine (v4). */
  overdue: boolean;
  records: number;
  latest_by: string;
  latest_at: string | null;
}

export interface InterventionModule {
  code: string;
  name: string;
  group: InterventionGroup;
  options: string[];
  recommended: boolean;
  reason: string;
  action_id: string | null;
  /** Tariff line this module charges against; null when not separately priced. */
  billing_service: string | null;
  /** The facility has that tariff line set up, so a delivery creates a charge. */
  billable: boolean;
  /** Facility rate; null when none is configured — never assumed. */
  rate: string | null;
  /** Set when the module's own workflow raises the charge (e.g. "signing the discharge"). */
  charged_by: string;
  delivered: number;
  /** Modules whose records this card counts and lists (Psychotherapy includes group sessions). */
  history_modules: string[];
  unit: string;
  note: string;
  /** Care-plan actions this module delivers. */
  linked_actions: string[];
  /** The facility's configured SHA code for the tariff line — blank when not configured. */
  sha_code: string;
  /** A configured payer requires pre-authorisation for this service. */
  preauth: boolean;
}

export interface InterventionContext {
  client: string;
  diagnoses: string[];
  allergies: string;
  /** Signed intake risk formulation; blank when none is signed. */
  risk: string;
  risk_change_72h: string;
  alerts: string[];
  medicines: string[];
  goals: string[];
}

export interface InterventionWorkspace {
  has_plan: boolean;
  /** The care plan has a signed version (v4 "confirmed"). */
  plan_signed: boolean;
  actions: InterventionAction[];
  modules: InterventionModule[];
  context: InterventionContext;
}

export function getInterventionWorkspace(accessToken: string, patientId: string) {
  return apiRequest<InterventionWorkspace>(`/care/clients/${patientId}/interventions/workspace/`, {
    accessToken,
  });
}

// ── Billing ──

export type BillingStatus = "unbilled" | "claimed" | "paid" | "partial" | "partial-claim";

export interface BillingEvent {
  id: string;
  client_id: string;
  client_name: string;
  client_number: string;
  service: string;
  payer: string;
  delivered_at: string;
  quantity: number;
  amount: string;
  paid_amount: string;
  claimed_balance: string;
  unbilled_balance: string;
  status: BillingStatus;
}

export interface BillingOverview {
  summary: Record<"services" | "unbilled" | "claimed" | "paid", { amount: string; count: number }>;
  events: BillingEvent[];
  unpriced_services: string[];
  currency: string;
}

export function getBillingOverview(accessToken: string) {
  return apiRequest<BillingOverview>("/care/billing/", { accessToken });
}

export function getClientBilling(accessToken: string, patientId: string) {
  return apiRequest<BillingOverview>(`/care/clients/${patientId}/billing/`, { accessToken });
}

export interface BillingService {
  id: string;
  name: string;
  rate: string | null;
  active: boolean;
}

export function listBillingServices(accessToken: string) {
  return apiRequest<BillingService[]>("/care/billing-services/", { accessToken });
}

export function updateBillingService(
  accessToken: string,
  id: string,
  payload: { rate?: string | null; active?: boolean },
) {
  return apiRequest<BillingService>(`/care/billing-services/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

// ── Dashboard, outpatients, reports ──

export interface CareDashboard {
  total_clients: number;
  new_this_week: number;
  inpatients: number;
  beds_available: number;
  outpatients: number;
  outpatients_new_today: number;
  red_orange: number;
  triage_due: number;
  psychiatry_queued: number;
  caseload_count: number;
  appointments_today: number;
  follow_ups_overdue: number;
  discharged_without_follow_up: number;
  group_session_count: number;
  group_follow_up_open: number;
  recent_activity: { at: string; title: string; detail: string }[];
  triage_arrivals: WorklistRow[];
  generated_at: string;
}

export function getCareDashboard(accessToken: string) {
  return apiRequest<CareDashboard>("/care/dashboard/", { accessToken });
}

export interface OutpatientRow {
  patient_id: string;
  name: string;
  citramac_number: string;
  diagnosis: string;
  priority: PriorityOrBlank;
  last_visit: string | null;
  next_appointment: string | null;
  status: string;
}

export function getOutpatients(accessToken: string) {
  return apiRequest<{ results: OutpatientRow[] }>("/care/outpatients/", { accessToken });
}

export interface CareReports {
  registered_clients: number;
  awaiting_triage: number;
  rechecks_due: number;
  signed_triage_assessments: number;
  inpatients: number;
  occupied_beds: number;
  total_beds: number;
  appointments_today: number;
  priority_distribution: { priority: Priority; count: number }[];
}

export function getCareReports(accessToken: string) {
  return apiRequest<CareReports>("/care/reports/", { accessToken });
}

// ── Sectioned intake (served schema → draft → sign) ──

export interface IntakeField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "datetime" | "select" | "multi" | "check";
  valueset?: string;
  unit?: string;
  hint?: string;
  rows?: number;
  full?: boolean;
  required?: boolean;
  restricted?: boolean;
  group?: string;
  highlight?: string[];
  /** Shown (and kept) only while another field of the section holds one of these codes. */
  show_when?: { field: string; in: string[] };
}

export interface IntakeSectionSpec {
  key: string;
  n: string;
  title: string;
  core: boolean;
  required?: boolean;
  kind?: "risk" | "meds" | "allergy" | "mse" | "formulation" | "tools" | "close" | "substances";
  fields: IntakeField[];
  /** Per-substance card fields (Section 8). */
  cardFields?: IntakeField[];
}

export interface IntakeRiskRow {
  key: string;
  label: string;
  options: string[];
  none: string[];
  active: string[];
  single?: boolean;
}

export interface IntakeSchema {
  version: string;
  sections: IntakeSectionSpec[];
  required: string[];
  riskRows: IntakeRiskRow[];
  mseDomains: { key: string; label: string; valueset: string | null; required?: boolean }[];
  mseNormal: Record<string, string>;
  sectionStates: string[];
}

export type IntakeSectionState = "Not started" | "In progress" | "Complete" | "Not applicable";
export type IntakeSections = Record<string, Record<string, unknown>>;

export interface IntakeDraft {
  id: string;
  version: number;
  status: "DRAFT" | "SIGNED";
  completeness: "" | "COMPLETE" | "PARTIAL" | "UNABLE";
  sections: IntakeSections;
  section_state: Record<string, IntakeSectionState>;
  section_overview: Record<string, IntakeSectionState>;
  current_section: string;
  outstanding_now: string[];
  outstanding: string[];
  signed_at: string | null;
  created_at: string;
  author_name: string;
}

export function getIntakeSchema(accessToken: string) {
  return apiRequest<IntakeSchema>("/care/intake/schema/", { accessToken });
}

export function openIntakeDraft(accessToken: string, patientId: string) {
  return apiRequest<IntakeDraft>(`/care/clients/${patientId}/intake/draft/`, { accessToken });
}

export function saveIntakeDraft(
  accessToken: string,
  patientId: string,
  payload: {
    sections?: IntakeSections;
    section_state?: Record<string, IntakeSectionState>;
    current_section?: string;
  },
) {
  return apiRequest<IntakeDraft>(`/care/clients/${patientId}/intake/draft/`, {
    method: "PUT",
    body: payload,
    accessToken,
  });
}

export function signIntake(
  accessToken: string,
  patientId: string,
  completeness: "COMPLETE" | "PARTIAL" | "UNABLE",
) {
  return apiRequest<IntakeDraft>(`/care/clients/${patientId}/intake/sign/`, {
    method: "POST",
    body: { completeness },
    accessToken,
  });
}

export interface MedicationHistoryRow {
  id: string;
  name: string;
  drug_code: string;
  dose: string;
  frequency: string;
  route: string;
  status: "TAKING" | "STOPPED" | "INTERMITTENT" | "UNKNOWN";
  reason: string;
  source: string;
  started_on: string | null;
  recorded_at: string;
}

export function listMedicationHistory(accessToken: string, patientId: string) {
  return apiRequest<{ results: MedicationHistoryRow[] }>(
    `/care/clients/${patientId}/medication-history/`,
    { accessToken },
  );
}

export function addMedicationHistory(
  accessToken: string,
  patientId: string,
  payload: Partial<Omit<MedicationHistoryRow, "id" | "recorded_at">> & { name: string },
) {
  return apiRequest<MedicationHistoryRow>(`/care/clients/${patientId}/medication-history/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function retireMedicationHistory(accessToken: string, entryId: string) {
  return apiRequest<void>(`/care/medication-history/${entryId}/`, {
    method: "DELETE",
    accessToken,
  });
}

export type AllergyType = "ALLERGY" | "INTOLERANCE" | "ADR";

export interface IntakeAllergyRecord {
  id: string;
  substance: string;
  reaction: string;
  /** `allergy-type` code — only ALLERGY hard-stops prescribing (INT-06). */
  allergy_type: AllergyType;
  /** `allergy-severity` code (older rows may hold free text). */
  severity: string;
  clinical_status: "ACTIVE" | "RESOLVED";
  verification_status: "UNCONFIRMED" | "CONFIRMED" | "REFUTED";
  source: string;
  noted_at: string;
  recorded_by: string;
}

export interface IntakeAllergy {
  status: "NONE" | "ACTIVE_ALLERGIES" | "UNKNOWN";
  /** `allergy-info-source` code for the record as a whole. */
  info_source: string;
  confirmed_at: string | null;
  confirmed_by: string;
  records: IntakeAllergyRecord[];
}

export function getIntakeAllergy(accessToken: string, patientId: string) {
  return apiRequest<IntakeAllergy>(`/care/clients/${patientId}/allergy/`, { accessToken });
}

export function setIntakeAllergyStatus(
  accessToken: string,
  patientId: string,
  status: IntakeAllergy["status"],
) {
  return updateIntakeAllergy(accessToken, patientId, { status });
}

/** Status, source of information, or `confirm: true` ("Confirm — unchanged"). */
export function updateIntakeAllergy(
  accessToken: string,
  patientId: string,
  body: { status?: IntakeAllergy["status"]; info_source?: string; confirm?: boolean },
) {
  return apiRequest<IntakeAllergy>(`/care/clients/${patientId}/allergy/`, {
    method: "PUT",
    body,
    accessToken,
  });
}

export function addIntakeAllergy(
  accessToken: string,
  patientId: string,
  body: { substance: string; reaction?: string; allergy_type: AllergyType; severity?: string },
) {
  return apiRequest<IntakeAllergy>(`/care/clients/${patientId}/allergy/`, {
    method: "POST",
    body,
    accessToken,
  });
}

/** Edit a reaction, or resolve / refute it — records are never deleted. */
export function updateAllergyRecord(
  accessToken: string,
  recordId: string,
  body: Partial<
    Pick<IntakeAllergyRecord, "substance" | "reaction" | "allergy_type" | "severity">
  > & {
    status?: "ACTIVE" | "RESOLVED" | "REFUTED";
  },
) {
  return apiRequest<IntakeAllergy>(`/care/allergies/${recordId}/verify/`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

export function verifyAllergy(
  accessToken: string,
  recordId: string,
  verdict: "CONFIRMED" | "REFUTED",
) {
  return apiRequest<IntakeAllergy>(`/care/allergies/${recordId}/verify/`, {
    method: "POST",
    body: { verification_status: verdict },
    accessToken,
  });
}

// ── Care plan workspace (decisions · with the client · tasks & reviews) ──

export type PlanPriority = "RED" | "ORANGE" | "YELLOW" | "GREEN";
export type PlanDecision = "ACCEPTED" | "MODIFIED" | "ADDED" | "DECLINED";

export interface PlanTask {
  id: string;
  label: string;
  owner_role: string;
  due_at: string | null;
  done_at: string | null;
  done_by: string;
}

export interface PlanAction {
  id: string;
  key: string;
  name: string;
  decision: PlanDecision | "";
  priority: PlanPriority | "";
  recommended_priority: PlanPriority | "";
  instructions: string;
  reason: string;
  why: string[];
  status: string;
  due_at: string | null;
  bulk_accepted: boolean;
  tasks: PlanTask[];
}

/** A goal in the client's own words (FHIR Goal), linked to an action and a 5P heading. */
export interface PlanGoal {
  goal: string;
  action_key: string;
  formulation: string;
  owner: string;
  review_date: string;
  source: string;
}

export interface CarriedScore {
  instrument: string;
  name: string;
  score: number;
  max: number;
  band: string;
  at: string;
  timepoint: string;
  approval: "approved" | "illustrative";
}

export interface PlanWorkspace {
  version: number;
  confirmed_at: string | null;
  confirmed_by: string;
  rules_version: string;
  rules_approval: string;
  suggested_priority: PlanPriority;
  recommendations: {
    key: string;
    name: string;
    priority: PlanPriority;
    why: string[];
    decided: boolean;
  }[];
  actions: PlanAction[];
  details: {
    /** A code of the served `care-plan-agreement` value set. */
    client_agreement: string;
    disagreements: { part: string; words: string }[];
    what_matters: string;
    rationale: string;
    senior_reviewer: string;
    contact_72h_at: string | null;
    follow_up_clinician: string;
    means_counselling_done: boolean;
    goal_items: PlanGoal[];
    crisis_plan: string;
    family_involvement: string;
    advance_statement: string;
    naloxone_teaching: boolean;
    oat_offer: string;
  };
  client_ack: { at: string; language: "en" | "sw"; recorded_by: string } | null;
  other_actions: { key: string; name: string }[];
  carried_scores: CarriedScore[];
  intake: {
    state: "complete" | "partial" | "unsigned" | "none";
    reason_incomplete: string;
    what_matters: string;
    goals: string;
  };
  is_opioid: boolean;
  /** The client's current family-involvement consent decision (ConsentRecord). */
  family_consent: "NOT_ASKED" | "YES" | "NO" | "RESTRICTED";
  outstanding: string[];
  conflicts: string[];
  needs_safety_plan: boolean;
  priority_meaning: Record<PlanPriority, string>;
}

export function getPlanWorkspace(accessToken: string, patientId: string) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/workspace/`, {
    accessToken,
  });
}

export function decidePlanAction(
  accessToken: string,
  patientId: string,
  key: string,
  body: { decision: PlanDecision; priority?: PlanPriority; instructions?: string; reason?: string },
) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/actions/${key}/decide/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export function updatePlanDetails(
  accessToken: string,
  patientId: string,
  body: Partial<Omit<PlanWorkspace["details"], "contact_72h_at">> & {
    contact_72h_at?: string | null;
  },
) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/details/`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

export function confirmPlan(accessToken: string, patientId: string) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/confirm/`, {
    method: "POST",
    accessToken,
  });
}

export function setPlanTaskDone(accessToken: string, taskId: string, done: boolean) {
  return apiRequest<PlanAction>(`/care/plan-tasks/${taskId}/`, {
    method: "PATCH",
    body: { done },
    accessToken,
  });
}

export function listSeniors(accessToken: string) {
  return apiRequest<{ results: { id: string; name: string }[] }>("/care/seniors/", { accessToken });
}

export interface SafetyPlanDoc {
  id: string;
  version: number;
  signed_at: string | null;
  signed_by: string;
  copy_given_at: string | null;
  warning_signs: string;
  coping: string;
  self_talk: string;
  places_people_distract: string;
  people_to_ask: string;
  professionals: string;
  safer_surroundings: string;
  reasons_for_living: string;
  keepsake: string;
  language: "en" | "sw";
}

export function openSafetyPlan(accessToken: string, patientId: string) {
  return apiRequest<SafetyPlanDoc>(`/care/clients/${patientId}/safety-plan/`, { accessToken });
}

export function saveSafetyPlan(
  accessToken: string,
  patientId: string,
  body: Partial<SafetyPlanDoc>,
) {
  return apiRequest<SafetyPlanDoc>(`/care/clients/${patientId}/safety-plan/`, {
    method: "PUT",
    body,
    accessToken,
  });
}

export function signSafetyPlan(accessToken: string, patientId: string) {
  return apiRequest<SafetyPlanDoc>(`/care/clients/${patientId}/safety-plan/sign/`, {
    method: "POST",
    accessToken,
  });
}

export function giveSafetyPlanCopy(accessToken: string, patientId: string) {
  return apiRequest<SafetyPlanDoc>(`/care/clients/${patientId}/safety-plan/copy/`, {
    method: "POST",
    accessToken,
  });
}

export interface MdtReviewRow {
  id: string;
  scheduled_for: string;
  held_at: string | null;
  attendees: string;
  notes: string;
  outcome: string;
  dissent: string;
  next_review: string | null;
}

export function listMdt(accessToken: string, patientId: string) {
  return apiRequest<{ results: MdtReviewRow[] }>(`/care/clients/${patientId}/care-plan/mdt/`, {
    accessToken,
  });
}

export function scheduleMdt(accessToken: string, patientId: string, scheduledFor: string) {
  return apiRequest<MdtReviewRow>(`/care/clients/${patientId}/care-plan/mdt/`, {
    method: "POST",
    body: { scheduled_for: scheduledFor },
    accessToken,
  });
}

export function recordMdt(
  accessToken: string,
  reviewId: string,
  body: {
    notes: string;
    attendees?: string;
    outcome?: string;
    dissent?: string;
    next_review?: string;
  },
) {
  return apiRequest<MdtReviewRow>(`/care/mdt/${reviewId}/record/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export interface CosignRow {
  id: string;
  patient_id: string;
  patient_name: string;
  kind: string;
  what: string;
  status: "REQUESTED" | "SIGNED" | "DECLINED" | "ACKNOWLEDGED";
  requested_by: string;
  requested_at: string;
  decided_by: string;
  decided_at: string | null;
  decline_reason: string;
  thread: { by: string; at: string; note: string }[];
  inbox_kind: "" | "cosign" | "returned" | "discuss";
}

export function listCosign(accessToken: string, patientId: string) {
  return apiRequest<{ results: CosignRow[] }>(`/care/clients/${patientId}/cosign/`, {
    accessToken,
  });
}

export function requestCosign(accessToken: string, patientId: string, what: string) {
  return apiRequest<CosignRow>(`/care/clients/${patientId}/cosign/`, {
    method: "POST",
    body: { what, kind: "GENERAL" },
    accessToken,
  });
}

export function decideCosign(
  accessToken: string,
  id: string,
  action: "SIGN" | "DECLINE" | "DISCUSS",
  note = "",
) {
  return apiRequest<CosignRow>(`/care/cosign/${id}/decide/`, {
    method: "POST",
    body: { action, note },
    accessToken,
  });
}

export function acknowledgeCosign(accessToken: string, id: string) {
  return apiRequest<CosignRow>(`/care/cosign/${id}/acknowledge/`, { method: "POST", accessToken });
}

export function getDecisionInbox(accessToken: string) {
  return apiRequest<{ results: CosignRow[] }>("/care/decisions/", { accessToken });
}

// ── Intervention modules ──

export interface ObservationConfig {
  levels: { code: string; display: string; interval_minutes: number }[];
  locations: string[];
  engagement: string[];
  max_continuous_minutes: number;
  approval: string;
}

export interface ObservationState {
  level: { code: string; display: string; reason: string; since: string; by: string } | null;
  next_entry_due: string | null;
  overdue: boolean;
  observer: { name: string; gender: string; since: string } | null;
  rotation_due: string | null;
  rotation_overdue: boolean;
  entries: {
    id: string;
    at: string;
    location: string;
    engagement: string;
    note: string;
    by: string;
  }[];
}

export const getObservationConfig = (t: string) =>
  apiRequest<ObservationConfig>("/care/observation/config/", { accessToken: t });
export const getObservation = (t: string, id: string) =>
  apiRequest<ObservationState>(`/care/clients/${id}/observation/`, { accessToken: t });
export const setObservationLevel = (t: string, id: string, level: string, reason: string) =>
  apiRequest<ObservationState>(`/care/clients/${id}/observation/level/`, {
    method: "POST",
    body: { level, reason },
    accessToken: t,
  });
export const handOverObserver = (
  t: string,
  id: string,
  observer_name: string,
  observer_gender: string,
) =>
  apiRequest<ObservationState>(`/care/clients/${id}/observation/handover/`, {
    method: "POST",
    body: { observer_name, observer_gender },
    accessToken: t,
  });
export const addObservationEntry = (
  t: string,
  id: string,
  body: { location: string; engagement: string; note: string },
) =>
  apiRequest<ObservationState>(`/care/clients/${id}/observation/entries/`, {
    method: "POST",
    body,
    accessToken: t,
  });

export type ObservationSetPayload = {
  heart_rate?: number | string;
  systolic_bp?: number | string;
  diastolic_bp?: number | string;
  respiratory_rate?: number | string;
  temperature_c?: number | string;
  spo2?: number | string;
  blood_glucose_mmol?: number | string;
  consciousness?: string;
  supplemental_o2?: boolean;
  not_measured?: Record<string, string>;
};

export const recordObservationSet = (t: string, id: string, body: ObservationSetPayload) =>
  apiRequest<VitalRow & { warnings: string[]; not_measured: Record<string, string> }>(
    `/care/clients/${id}/observation-sets/`,
    { method: "POST", body, accessToken: t },
  );

export const getSbar = (t: string, id: string) =>
  apiRequest<{ text: string }>(`/care/clients/${id}/sbar/`, { accessToken: t });

export interface PrescribingCheck {
  blocking: string[];
  warnings: string[];
  not_checked: string[];
}
export const checkPrescribing = (t: string, id: string, drug: string) =>
  apiRequest<PrescribingCheck>(`/care/clients/${id}/prescribing-checks/`, {
    method: "POST",
    body: { drug },
    accessToken: t,
  });

export interface MarEntry {
  id: string;
  /** The prescription item (order) this dose belongs to, "" for an unlinked row. */
  order: string;
  drug: string;
  dose: string;
  scheduled_time: string;
  status: string;
  state: "given" | "declined" | "withheld" | "future" | "due" | "late" | "missed";
  is_prn: boolean;
  prn_indication: string;
  controlled_drug: boolean;
  witness_name: string;
  own_supply: boolean;
  notes: string;
  effect: string;
  administered_at: string | null;
  by: string;
  prn_max_override_reason: string;
}
export interface MedicationOrder {
  id: string;
  drug_code: string;
  drug: string;
  dose: string;
  route: string;
  frequency: string;
  is_prn: boolean;
  prn_max_per_24h: number | null;
  indication: string;
  controlled_drug: boolean;
  findings: { level: "HARD" | "WARN"; text: string }[];
  allergy_override_reason: string;
  prescribed_by: string;
  prescribed_at: string;
}
export interface MarOrder extends MedicationOrder {
  /** Today's dose times; `entry` is null until the dose is charted. */
  slots: { time: string; entry: string | null; state: MarEntry["state"] }[];
  /** PRN only: doses given in the last 24 h, and whether the written maximum is reached. */
  given_24h: number | null;
  at_max: boolean;
}
export interface MarState {
  admission: string | null;
  orders: MarOrder[];
  entries: MarEntry[];
  pending_effects: MarEntry[];
}
export interface DoseDocumentation {
  outcome: "ADMINISTERED" | "REFUSED" | "WITHHELD";
  notes?: string;
  prn_indication?: string;
  witness_name?: string;
  own_supply?: boolean;
  override_reason?: string;
}
export const getMar = (t: string, id: string) =>
  apiRequest<MarState>(`/care/clients/${id}/mar/`, { accessToken: t });
export const administerDose = (t: string, entryId: string, body: DoseDocumentation) =>
  apiRequest<MarState>(`/care/mar/${entryId}/administer/`, {
    method: "POST",
    body,
    accessToken: t,
  });
/** A dose against an order — at one of today's dose times (`slot`), or unscheduled when `slot` is blank. */
export const administerOrder = (
  t: string,
  patientId: string,
  orderId: string,
  body: DoseDocumentation & { slot?: string },
) =>
  apiRequest<MarState>(`/care/clients/${patientId}/mar/orders/${orderId}/administer/`, {
    method: "POST",
    body,
    accessToken: t,
  });

export interface PrescribingState {
  allergy_status: string;
  allergy_text: string;
  /** Allergy status unknown — no order may be placed. */
  locked: boolean;
  can_prescribe: boolean;
  is_senior: boolean;
  frequencies: string[];
  orders: MedicationOrder[];
}
export interface OrderPayload {
  drug: string;
  dose: string;
  route: string;
  frequency: string;
  is_prn: boolean;
  prn_max_per_24h?: number;
  indication: string;
  controlled_drug: boolean;
  acknowledged_warnings: boolean;
  override_reason?: string;
}
export const getPrescribing = (t: string, id: string) =>
  apiRequest<PrescribingState>(`/care/clients/${id}/prescribing/`, { accessToken: t });
export const placeOrder = (t: string, id: string, body: OrderPayload) =>
  apiRequest<PrescribingState>(`/care/clients/${id}/prescribing/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const recordPrnEffect = (t: string, entryId: string, effect: string) =>
  apiRequest<MarState>(`/care/mar/${entryId}/effect/`, {
    method: "POST",
    body: { effect },
    accessToken: t,
  });

export interface RestrictiveEpisode {
  id: string;
  kind: string;
  kind_display: string;
  de_escalation: string[];
  authorised_by: string;
  start_at: string;
  end_at: string | null;
  injury_check: string;
  incident_reference: string;
  client_debrief_at: string | null;
  staff_debrief_held: boolean;
  senior_review_due: boolean;
  recorded_by: string;
  /** Co-signature request raised because the authoriser is not a senior clinician. */
  cosign_status: CosignRow["status"] | null;
  checks: { id: string; label: string; due_at: string; done_at: string | null; done_by: string }[];
}
export const listRestrictive = (t: string, id: string) =>
  apiRequest<{
    results: RestrictiveEpisode[];
    de_escalation_options: string[];
    authorisers: { id: string; name: string; senior: boolean }[];
  }>(`/care/clients/${id}/restrictive-practice/`, { accessToken: t });
export const recordRestrictive = (t: string, id: string, body: Record<string, unknown>) =>
  apiRequest<RestrictiveEpisode>(`/care/clients/${id}/restrictive-practice/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const completeRestrictiveCheck = (t: string, checkId: string) =>
  apiRequest<RestrictiveEpisode>(`/care/restrictive-checks/${checkId}/done/`, {
    method: "POST",
    accessToken: t,
  });
export const endRestrictive = (t: string, id: string, endAt?: string) =>
  apiRequest<RestrictiveEpisode>(`/care/restrictive-practice/${id}/end/`, {
    method: "POST",
    body: endAt ? { end_at: endAt } : {},
    accessToken: t,
  });
export const debriefRestrictive = (t: string, id: string) =>
  apiRequest<RestrictiveEpisode>(`/care/restrictive-practice/${id}/debrief/`, {
    method: "POST",
    accessToken: t,
  });

// ── attention, proposals, capacity, consent, notes, episode outcome ──

export interface AttentionAlert {
  key: string;
  severity: "high" | "medium" | "info";
  text: string;
  source: string;
}
export interface AttentionItem {
  key: string;
  category: string;
  text: string;
  due_at: string | null;
  overdue: boolean;
}
export interface MyTask extends AttentionItem {
  patient_id: string;
  patient: string;
  kind?: string;
}
export interface RiskProposalRow {
  id: string;
  source: string;
  row: string;
  option: string;
  status: "PROPOSED" | "ADDED" | "DEFERRED" | "DISMISSED";
  reason: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string;
}
export interface CapacityRow {
  id: string;
  decision: string;
  other_decision: string;
  understand: string;
  retain: string;
  weigh: string;
  communicate: string;
  outcome: string;
  reassess_by: string | null;
  note: string;
  assessed_by: string;
  assessed_at: string;
}
export interface VisitConsentRow {
  id: string;
  scope: string;
  party: string;
  method: string;
  given_by_name: string;
  warnings: string[];
  recorded_at: string;
  recorded_by: string;
  completed_at: string | null;
  open_deferred: boolean;
}
export interface ProgressNoteRow {
  id: string;
  note_type: string;
  text: string;
  status: "DRAFT" | "SIGNED";
  amends: string | null;
  author: string;
  created_at: string;
  signed_at: string | null;
}

export const getAttention = (t: string, id: string) =>
  apiRequest<{ alerts: AttentionAlert[]; items: AttentionItem[] }>(
    `/care/clients/${id}/attention/`,
    { accessToken: t },
  );
export const getMyTasks = (t: string) =>
  apiRequest<{ results: MyTask[] }>("/care/my-tasks/", { accessToken: t });
export const getProposals = (t: string, id: string) =>
  apiRequest<{ results: RiskProposalRow[] }>(`/care/clients/${id}/proposals/`, { accessToken: t });
export const decideProposal = (
  t: string,
  proposalId: string,
  action: "ADD" | "DEFER" | "DISMISS",
  reason = "",
) =>
  apiRequest<RiskProposalRow>(`/care/proposals/${proposalId}/decision/`, {
    method: "POST",
    body: { action, reason },
    accessToken: t,
  });
export const getCapacity = (t: string, id: string) =>
  apiRequest<{ current: CapacityRow[]; history: CapacityRow[] }>(`/care/clients/${id}/capacity/`, {
    accessToken: t,
  });
export const recordCapacity = (t: string, id: string, body: Record<string, unknown>) =>
  apiRequest<CapacityRow>(`/care/clients/${id}/capacity/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const getVisitConsents = (t: string, id: string) =>
  apiRequest<{ results: VisitConsentRow[] }>(`/care/clients/${id}/visit-consents/`, {
    accessToken: t,
  });
export const recordVisitConsent = (t: string, id: string, body: Record<string, unknown>) =>
  apiRequest<VisitConsentRow>(`/care/clients/${id}/visit-consents/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const completeDeferredConsent = (t: string, consentId: string) =>
  apiRequest<VisitConsentRow>(`/care/visit-consents/${consentId}/complete/`, {
    method: "POST",
    body: {},
    accessToken: t,
  });
export const getNotes = (t: string, id: string) =>
  apiRequest<{ results: ProgressNoteRow[] }>(`/care/clients/${id}/notes/`, { accessToken: t });
export const createNote = (
  t: string,
  id: string,
  body: { note_type: string; text: string; amends?: string },
) =>
  apiRequest<ProgressNoteRow>(`/care/clients/${id}/notes/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const saveNote = (t: string, noteId: string, text: string) =>
  apiRequest<ProgressNoteRow>(`/care/notes/${noteId}/`, {
    method: "PUT",
    body: { text },
    accessToken: t,
  });
export const signNote = (t: string, noteId: string) =>
  apiRequest<ProgressNoteRow>(`/care/notes/${noteId}/`, {
    method: "POST",
    body: {},
    accessToken: t,
  });
export const closeEpisode = (
  t: string,
  id: string,
  body: { outcome: string; destination?: string; reason?: string },
) =>
  apiRequest<{ episode: string; outcome: string }>(`/care/clients/${id}/episode-outcome/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const startNewEpisode = (t: string, id: string, presenting = "") =>
  apiRequest<{ episode: string }>(`/care/clients/${id}/new-episode/`, {
    method: "POST",
    body: { presenting },
    accessToken: t,
  });

// ── therapy, OAT, labs, legal forms, module recommendations, missed appointments ──
export interface TherapySessionRow {
  id: string;
  n: number;
  at: string;
  by: string;
  notes: string;
  homework: string;
  activity: string;
  measure: { score_id: string; instrument: string; name: string; total: number } | null;
  has_process_notes: boolean;
  /** Present only for roles that may see restricted content. */
  process_notes?: string;
  /** The structured psychotherapy note (psychotherapyNoteApi), when written through it. */
  note_id: string | null;
}
export interface TherapyEpisodeRow {
  id: string;
  modality: string;
  planned_sessions: number | null;
  frequency: string;
  trauma_phase: number | null;
  confidentiality_agreed: boolean;
  consent_to_record: boolean;
  under_supervision: boolean;
  ended: boolean;
  activity: string;
  activity_title: string;
  sessions: TherapySessionRow[];
}
export interface TherapyState {
  results: TherapyEpisodeRow[];
  link_options: { id: string; title: string; goal: string }[];
  can_view_process_notes: boolean;
}
export interface OatState {
  enrolments: {
    id: string;
    medicine: string;
    clinic: string;
    status: string;
    prescribed_dose: string;
    supervised_dispensing: boolean;
    status_reason: string;
  }[];
  naloxone: {
    id: string;
    outcome: string;
    quantity: number | null;
    training_given: boolean;
    at: string;
  }[];
}
export interface LabsState {
  orders: {
    id: string;
    code: string;
    name: string;
    status: string;
    ordered_at: string;
    ordered_by: string;
  }[];
  results: {
    id: string;
    order: string;
    code: string;
    name: string;
    value: string;
    unit: string;
    reference_range: string;
    abnormal: boolean;
    critical: boolean;
    interpretation: string;
    recorded_at: string;
    ordered_at: string;
    ordered_by: string;
    acknowledged: boolean;
    acknowledged_by: string;
    acknowledged_at: string | null;
  }[];
  order_sets: Record<string, string[]>;
  /** Abnormal-result acknowledgement is for prescribers only. */
  can_acknowledge: boolean;
}
export interface LegalFormsState {
  catalogue: { key: string; title: string }[];
  results: {
    id: string;
    form_key: string;
    status: string;
    signed_at: string | null;
    signed_by: string;
  }[];
}
const post = (t: string, path: string, body: unknown = {}) =>
  apiRequest<Record<string, unknown>>(path, { method: "POST", body, accessToken: t });
export const getTherapy = (t: string, id: string) =>
  apiRequest<TherapyState>(`/care/clients/${id}/therapy/`, { accessToken: t });
export const startTherapy = (t: string, id: string, body: Record<string, unknown>) =>
  post(t, `/care/clients/${id}/therapy/`, body);
export const agreeConfidentiality = (t: string, episodeId: string) =>
  post(t, `/care/therapy/${episodeId}/confidentiality/`);
export const recordTherapySession = (t: string, id: string, body: Record<string, unknown>) =>
  post(t, `/care/clients/${id}/therapy/sessions/`, body);
export const getOat = (t: string, id: string) =>
  apiRequest<OatState>(`/care/clients/${id}/oat/`, { accessToken: t });
export const referOat = (t: string, id: string, body: Record<string, unknown>) =>
  post(t, `/care/clients/${id}/oat/`, body);
export const updateOatStatus = (t: string, oatId: string, body: Record<string, unknown>) =>
  post(t, `/care/oat/${oatId}/status/`, body);
export const recordNaloxone = (t: string, id: string, body: Record<string, unknown>) =>
  post(t, `/care/clients/${id}/naloxone/`, body);
export const getLabs = (t: string, id: string) =>
  apiRequest<LabsState>(`/care/clients/${id}/labs/`, { accessToken: t });
export const orderLabs = (t: string, id: string, codes: string[]) =>
  post(t, `/care/clients/${id}/labs/`, { codes });
export const acknowledgeLab = (t: string, resultId: string, note = "") =>
  post(t, `/care/labs/results/${resultId}/acknowledge/`, { note });
export const enterLabResult = (
  t: string,
  orderId: string,
  body: {
    value: string;
    interpretation: "NORMAL" | "ABNORMAL" | "CRITICAL";
    unit?: string;
    reference_range?: string;
  },
) =>
  apiRequest<LabsState>(`/care/labs/orders/${orderId}/result/`, {
    method: "POST",
    body,
    accessToken: t,
  });
export const getLegalForms = (t: string, id: string) =>
  apiRequest<LegalFormsState>(`/care/clients/${id}/legal-forms/`, { accessToken: t });
export const prepareLegalForm = (t: string, id: string, formKey: string) =>
  post(t, `/care/clients/${id}/legal-forms/`, { form_key: formKey });
export const signLegalForm = (t: string, formId: string) =>
  post(t, `/care/legal-forms/${formId}/sign/`);
export const getModuleRecommendations = (t: string, id: string) =>
  apiRequest<{ recommended: Record<string, string[]> }>(`/care/clients/${id}/modules/`, {
    accessToken: t,
  });
export const markAppointmentMissed = (t: string, apptId: string, reason: string) =>
  post(t, `/care/appointments/${apptId}/missed/`, { reason });
export const markRecontacted = (t: string, apptId: string) =>
  post(t, `/care/appointments/${apptId}/recontacted/`);

export interface WardBoardRow {
  patient_id: string;
  patient: string;
  bed: string;
  ward: string;
  day: number;
  legal_status: string;
  observation: string;
  ews: string;
  ews_trend: "rising" | "improving" | "steady" | null;
  withdrawal: Record<string, { score: number; band: string }>;
  next_mdt: string | null;
  due_within_hour: number;
}
export const getWardBoardTable = (t: string) =>
  apiRequest<{ results: WardBoardRow[] }>("/care/ward-board/", { accessToken: t });

/** The organisation's approved assessments (trauma, benzodiazepine withdrawal). */
export interface ApprovedAssessmentPurpose {
  purpose: "TRAUMA" | "BENZO_WITHDRAWAL";
  title: string;
  what: string;
  options: { code: string; name: string; confirm: string }[];
  instrument: string;
  clinical_lead: string;
  approved_by: string;
  approved_at: string | null;
}

export interface ApprovedAssessments {
  purposes: ApprovedAssessmentPurpose[];
  attest: string;
  can_edit: boolean;
}

export function getApprovedAssessments(accessToken: string) {
  return apiRequest<ApprovedAssessments>("/care/approved-assessments/", { accessToken });
}

export function approveAssessment(
  accessToken: string,
  body: {
    purpose: string;
    instrument: string;
    clinical_lead?: string;
    attest?: boolean;
    confirm?: boolean;
  },
) {
  return apiRequest<ApprovedAssessments>("/care/approved-assessments/", {
    method: "PUT",
    body,
    accessToken,
  });
}
