import { apiRequest } from "./apiClient";

// Psychotherapy Session note — master prompt §7 (PSY-*). Server:
// backend/apps/care_pathway/psychotherapy.py. Drafts are saved on the server
// only (X-09); nothing here touches browser storage (guide.md §5). AI
// assistance (translation, rewording) runs on the server only — the browser
// never calls a model.

export type SafetyAnswer = "" | "YES" | "NO" | "NOT_ASSESSED";
/** TYPED / DICTATED; TYPE / SPEAK on drafts saved before answer metadata. */
export type InputMode = "TYPED" | "DICTATED" | "TYPE" | "SPEAK";
export type TranslationStatus = "pending" | "done" | "error" | "unavailable";
export type GoalDecision =
  "PROGRESS" | "NO_CHANGE" | "BARRIER" | "NOT_RELEVANT" | "CONFIRMED" | "DISMISSED";

/** PSY-CHANGE: the clinician's reading of a change between two recorded scores. */
export type ChangeDecision = "IMPROVEMENT" | "NO_CHANGE" | "DETERIORATION" | "NOT_RELEVANT";
export interface ScoreChange {
  key: string;
  instrument: string;
  name: string;
  previous: { score_id: string; total: number; band: string; at: string };
  current: { score_id: string; total: number; band: string; at: string };
  change: string;
  summary: string;
}
export interface ChangeLink {
  key: string;
  summary: string;
  status: ChangeDecision;
  by: string;
  at: string;
}

export interface PsyQuestion {
  key: string;
  title: string;
  hint: string;
  kind?: "TEXT" | "PARTICIPANTS";
  participant_kind?: "clinician" | "family";
}
export interface PsyParticipant {
  id: string;
  name: string;
  resource_type: "Practitioner" | "RelatedPerson";
}
export interface PsyParticipantOptions {
  clinicians: { id: string; name: string }[];
  family: { id: string; name: string }[];
  family_consent_required: boolean;
}
export interface TherapyModelRow {
  code: string;
  name: string;
  aliases: string[];
  concepts: string[];
  version: string;
  enabled: boolean;
  custom: boolean;
}
export interface ConcernCategory {
  code: string;
  label: string;
  register_row: string | null;
  register_label: string;
  options: string[];
}
export interface PsyConfig {
  questions: PsyQuestion[];
  questionnaires: Record<string, PsyQuestion[]>;
  safety_question: string;
  safety_options: { code: Exclude<SafetyAnswer, "">; label: string }[];
  detection_prompt: string;
  detection_note: string;
  watermark: string;
  sections: { key: string; title: string }[];
  therapy_models: TherapyModelRow[];
  concerns: {
    categories: ConcernCategory[];
    register: { row: string; label: string; options: string[] }[];
    other: { code: string; label: string }[];
  };
  safety_actions: { code: string; label: string }[];
  attendance_modes: { code: string; label: string }[];
  session_types: { code: string; label: string }[];
  languages: { code: string; label: string; translated: boolean }[];
  goal_decisions: { code: GoalDecision; label: string }[];
  not_assessed_ack_text: string;
  attestation_text: string;
  self_assessment: SelfAssessmentConfig;
  dictation_enabled: boolean;
  ai_enabled: boolean;
  processed_labels: { ai: string; rules: string; not_translated: string };
  can_configure: boolean;
}

/** The served reflection questionnaire (backend psychotherapy.SELF_ASSESSMENT_*):
 * the server decides what is asked and validates the answers it accepts. */
export interface SelfAssessmentQuestion {
  key: string;
  label: string;
  prompt: string;
  kind: "CHOICE" | "TEXT";
  required: boolean;
  rows: number;
  options: { code: string; display: string }[];
  show_when: { key: string; in: string[] } | null;
}
export interface SelfAssessmentConfig {
  intro: string;
  questions: SelfAssessmentQuestion[];
  supervision: { prompt: string; focus_label: string; focus_placeholder: string };
}
/** Stored with the session (extra.therapist_self_assessment); shown to its
 * author only. Workforce data — not a patient FHIR resource. */
export interface SelfAssessmentRecord {
  version: number;
  completed_at: string;
  updated_at: string;
  by: string;
  answers: Record<string, string>;
  supervision: {
    decision: "" | "YES" | "NO";
    focus: string;
    request_id: string;
    requested_at: string | null;
    /** Live status of the stored request, filled in when the note is read. */
    request_status?: "OPEN" | "SCHEDULED" | "COMPLETED" | null;
  };
}
export interface SelfAssessmentPayload {
  answers: Record<string, string>;
  supervision: "" | "YES" | "NO";
  supervision_focus?: string;
  request_supervision?: boolean;
}

export type Concern =
  { category: string; options?: string[] } | { row: string; option: string } | { other: string };
export interface Translation {
  status: TranslationStatus;
  text: string;
  model: string;
  at: string | null;
  requested_at?: string;
  error?: string;
}
export interface Answer {
  text: string;
  mode: InputMode;
  participants?: PsyParticipant[];
  language?: string;
  answered_at?: string | null;
  translation?: Translation;
}
export interface Detection {
  key: string;
  question: string;
  source?: "original" | "translation";
  category: string;
  phrase: string;
  matched: string;
  start: number;
  end: number;
  passage: string;
  passage_start: number;
  passage_end: number;
  prompt: string;
  resolution: { reason: string; by: string; at: string } | null;
}
export interface StigmaFlag {
  where: string;
  term: string;
  start: number;
  end: number;
  suggestion: string;
}
export interface GoalLink {
  goal_index: number;
  goal: string;
  evidence?: string;
  statement: string;
  status: GoalDecision;
  by: string;
  at: string;
}
export interface RiskItem {
  key: string;
  severity: string;
  text: string;
  source: string;
}
export interface DetectedModel {
  code: string;
  name: string;
  version: string;
  how: "named" | "suggested";
  concepts: string[];
  included: boolean;
}
export interface RiskLink {
  alert_id: string;
  display_id: string;
  opened_at: string;
  opened: string;
  proposal_ids: string[];
  by: string;
  at: string;
}
export interface SafetyDetail {
  concerns?: Concern[];
  description?: string;
  action_codes?: string[];
  actions?: string;
  risk_link?: RiskLink;
}
export interface TranscriptRow {
  question: string;
  title: string;
  text: string;
  participants?: PsyParticipant[];
  mode: InputMode;
  answered_at: string | null;
  language: string;
  translation: Translation | null | undefined;
}
export interface Processing {
  engine: "rules" | "ai";
  status: "none" | "pending" | "done" | "error" | "disabled";
  model: string;
  at: string | null;
  error: string;
  label: string;
  reason?: string;
  sections: Record<string, { source: "ai" | "rules"; model?: string; at: string }>;
}
export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}
export interface HistoryEntry {
  at: string;
  by: string;
  action: string;
  [k: string]: unknown;
}

export interface PsyNoteSummary {
  id: string;
  status: "DRAFT" | "SIGNED";
  questionnaire_version: string;
  session_date: string;
  session_type: string;
  author: string;
  therapy_episode: string;
  signed_at: string | null;
  restricted?: boolean;
  safety_answer?: SafetyAnswer;
  amendments?: number;
  draft_saved_at?: string;
}

export interface PsyNote extends Omit<PsyNoteSummary, "amendments"> {
  participant_options: PsyParticipantOptions;
  is_author: boolean;
  patient: { id: string; name: string; number: string };
  session_number: number | null;
  watermark: string | null;
  session: {
    id: string;
    session_date: string;
    duration_minutes: number | null;
    session_type: string;
    attendance_mode: string;
    location: string;
    encounter: string;
    activity: string;
    session_objective: string;
    primary_goal: string;
    secondary_goals: string;
    therapist_self_assessment: SelfAssessmentRecord | null;
    measure: { name: string; total: number } | null;
    process_notes: string | null;
  };
  answers: Record<string, Answer>;
  selected_models: string[];
  models_detected: DetectedModel[];
  transcript: TranscriptRow[];
  safety_detail: SafetyDetail;
  safety_action_options: { code: string; label: string }[];
  not_assessed_reason: string;
  safety_ack: { reason: string; at: string; by: string } | null;
  alerts: { code: string; status: string }[];
  detections: Detection[];
  goal_suggestions: { goal_index: number; goal: string; evidence: string }[];
  goal_links: GoalLink[];
  score_changes: ScoreChange[];
  change_links: ChangeLink[];
  sections: Record<string, string>;
  sections_edited: boolean;
  edited_sections: string[];
  models_applied: { code: string; name: string; version: string }[];
  processing: Processing;
  generated_at: string | null;
  accuracy_confirmed: boolean;
  flags: StigmaFlag[];
  blockers: { code: string; text: string }[];
  checklist: { items: ChecklistItem[]; done: number; total: number } | null;
  rendered: string;
  amendments: {
    id: string;
    section: string;
    previous_text: string;
    new_text: string;
    reason: string;
    by: string;
    at: string;
  }[];
  history: HistoryEntry[];
  inpatient?: boolean;
  context: {
    goals: { index: number; goal: string; owner: string; review_date: string }[];
    previous_note: {
      id: string | null;
      at: string;
      by?: string;
      response?: string;
      plan?: string;
      risk_safety?: string;
      text?: string;
      restricted?: boolean;
    } | null;
    risk: RiskItem[];
    safety_plan: { id: string; display_id: string; version: number; signed_at: string } | null;
    diagnoses: string[];
  };
}

export interface PsyClientRow {
  patient_id: string;
  name: string;
  number: string;
  diagnosis: string;
  next_appointment: string | null;
  episode_id: string | null;
  in_therapy: boolean;
  restricted?: boolean;
  sessions_recorded?: number;
  last_session?: string | null;
}

export interface PsyFamilySession extends PsyNoteSummary {
  patient_id: string;
  patient_name: string;
  patient_number: string;
}

const json = (method: "POST" | "PATCH", t: string, path: string, body?: unknown) =>
  apiRequest<PsyNote>(path, { method, body, accessToken: t });

export const getPsyConfig = (t: string) =>
  apiRequest<PsyConfig>("/care/psychotherapy/config/", { accessToken: t });
export const listPsyClients = (t: string, kind: "individual" | "family" = "individual") => {
  const query = kind === "family" ? "?kind=family" : "";
  return apiRequest<{ results: PsyClientRow[]; count: number }>(
    `/care/psychotherapy/clients/${query}`,
    { accessToken: t },
  );
};
export const listPsyFamilySessions = (t: string) =>
  apiRequest<{ results: PsyFamilySession[] }>("/care/psychotherapy/sessions/", {
    accessToken: t,
  });
export const listPsyNotes = (t: string, patientId: string) =>
  apiRequest<{ results: PsyNoteSummary[] }>(`/care/clients/${patientId}/psychotherapy-notes/`, {
    accessToken: t,
  });
export const startPsyNote = (t: string, patientId: string, body: Record<string, unknown>) =>
  json("POST", t, `/care/clients/${patientId}/psychotherapy-notes/`, body);
export const getPsyNote = (t: string, id: string) =>
  apiRequest<PsyNote>(`/care/psychotherapy-notes/${id}/`, { accessToken: t });
export const savePsyNote = (t: string, id: string, body: Record<string, unknown>) =>
  json("PATCH", t, `/care/psychotherapy-notes/${id}/`, body);
export const generatePsyNote = (t: string, id: string) =>
  json("POST", t, `/care/psychotherapy-notes/${id}/generate/`, {});
export const signPsyNote = (t: string, id: string) =>
  json("POST", t, `/care/psychotherapy-notes/${id}/sign/`, {});
export const amendPsyNote = (
  t: string,
  id: string,
  body: { section: string; text: string; reason: string },
) => json("POST", t, `/care/psychotherapy-notes/${id}/amend/`, body);
export const savePsySelfAssessment = (t: string, id: string, body: SelfAssessmentPayload) =>
  json("POST", t, `/care/psychotherapy-notes/${id}/self-assessment/`, body);

export const listTherapyModels = (t: string) =>
  apiRequest<{ results: TherapyModelRow[]; can_configure: boolean }>(
    "/care/psychotherapy/models/",
    { accessToken: t },
  );
export const addTherapyModel = (
  t: string,
  body: { name: string; aliases: string[]; concepts: string[] },
) =>
  apiRequest<TherapyModelRow>("/care/psychotherapy/models/", {
    method: "POST",
    body,
    accessToken: t,
  });
export const updateTherapyModel = (t: string, code: string, body: Partial<TherapyModelRow>) =>
  apiRequest<TherapyModelRow>(`/care/psychotherapy/models/${code}/`, {
    method: "PATCH",
    body,
    accessToken: t,
  });

/** The organisation's psychotherapy AI / dictation switches: Super Admin
 * allows, the Org Admin turns on (with the data-protection attestation). */
export interface PsyAssistSettings {
  ai_platform_available: boolean;
  ai_allowed: boolean;
  ai_enabled: boolean;
  dictation_platform_available: boolean;
  dictation_allowed: boolean;
  dictation_enabled: boolean;
  changed_by: string;
  changed_at: string | null;
  can_edit: boolean;
}

export function getPsyAssistSettings(accessToken: string) {
  return apiRequest<PsyAssistSettings>("/care/psychotherapy/assist-settings/", { accessToken });
}

export function updatePsyAssistSettings(
  accessToken: string,
  body: { ai_enabled?: boolean; dictation_enabled?: boolean; attest?: boolean },
) {
  return apiRequest<PsyAssistSettings>("/care/psychotherapy/assist-settings/", {
    method: "PUT",
    body,
    accessToken,
  });
}
