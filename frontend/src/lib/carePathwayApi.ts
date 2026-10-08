import { apiRequest } from "./apiClient";

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
  address: string;
  id_document_type: string;
  id_document_number: string;
  preferred_language: string;
  interpreter: string;
  allergy_status: string;
  allergy_details: string;
  payer: string;
}

export function searchRegistrations(accessToken: string, q: string) {
  return apiRequest<{ results: RegistrationRow[] }>(
    `/care/registration/search/?q=${encodeURIComponent(q)}`,
    { accessToken },
  );
}

export interface RegistrationPayload {
  client_request_id: string;
  patient_id?: string;
  identity_status: IdentityStatus;
  full_name?: string;
  description?: string;
  preferred_name?: string;
  pronouns?: string;
  date_of_birth?: string;
  estimated_age?: number | null;
  sex?: string;
  phone?: string;
  next_of_kin?: string;
  address?: string;
  id_document_type?: string;
  id_document_number?: string;
  referral_source?: string;
  preferred_language?: string;
  interpreter?: string;
  allergy_status?: string;
  allergy_details?: string;
  payer?: string;
  reason?: string;
}

export function registerArrival(accessToken: string, payload: RegistrationPayload) {
  return apiRequest<{ triage_encounter_id: string; patient_id: string }>("/care/registrations/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function resolveIdentity(
  accessToken: string,
  patientId: string,
  payload: {
    full_name: string;
    date_of_birth?: string;
    sex?: string;
    phone?: string;
    id_document_type?: string;
    id_document_number?: string;
  },
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

/** [finding/alert, current status, source] */
export type FindingRow = [string, string, string];

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
  payload: { actions: string[]; owner: string; status: CareTask["status"] },
) {
  return apiRequest<CareTask[]>(`/care/triage/${id}/tasks/`, {
    method: "POST",
    body: payload,
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
  recorded_by: string;
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
  instrument: "PHQ9" | "GAD7";
  score: number;
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

export interface ConsentTemplate {
  id: string;
  consent_type: "DATA_SHARING_HIE";
  version: string;
  text: string;
  active: boolean;
  created_at: string;
  created_by: string;
}

export interface ClientLegal {
  active_consent_template: ConsentTemplate | null;
  current_consent: { granted: boolean; captured_at: string | null };
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

export function recordDataSharingConsent(accessToken: string, patientId: string, granted: boolean) {
  return apiRequest<{
    id: string;
    granted: boolean;
    consent_text_version: string;
    captured_at: string;
  }>(`/care/clients/${patientId}/consent/`, { method: "POST", body: { granted }, accessToken });
}

export function listConsentTemplates(accessToken: string) {
  return apiRequest<{ results: ConsentTemplate[] }>("/care/consent-templates/", { accessToken });
}

export function createConsentTemplate(
  accessToken: string,
  payload: { version: string; text: string; consent_type?: "DATA_SHARING_HIE" },
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
}

export type IntakePayload = Omit<
  IntakeAssessment,
  "id" | "patient" | "episode" | "encounter" | "author_name" | "created_at"
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

export function getOutcomeScores(accessToken: string, patientId: string) {
  return apiRequest<{ results: OutcomeScore[] }>(`/care/clients/${patientId}/outcomes/`, {
    accessToken,
  });
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

export interface InterventionRecord {
  id: string;
  activity: string;
  activity_title: string;
  activity_goal: string;
  performed_at: string;
  provider: string | null;
  provider_name: string;
  intervention: string;
  response: string;
  next_action: string;
  billable: boolean;
  billing_service: string | null;
  billing_service_name: string | null;
  quantity: number;
}

export function listInterventions(accessToken: string, patientId: string) {
  return apiRequest<{ results: InterventionRecord[] }>(
    `/care/clients/${patientId}/interventions/`,
    { accessToken },
  );
}

export function recordIntervention(
  accessToken: string,
  patientId: string,
  payload: {
    activity: string;
    intervention: string;
    response?: string;
    next_action?: string;
    performed_at?: string;
    billable?: boolean;
    billing_service?: string | null;
    quantity?: number;
  },
) {
  return apiRequest<InterventionRecord>(`/care/clients/${patientId}/interventions/`, {
    method: "POST",
    body: payload,
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
