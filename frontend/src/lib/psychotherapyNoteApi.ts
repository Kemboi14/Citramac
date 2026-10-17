import { apiRequest } from "./apiClient";

// Psychotherapy Session note — master prompt §7 (PSY-*). Server:
// backend/apps/care_pathway/psychotherapy.py. Drafts are saved on the server
// only (X-09); nothing here touches browser storage (CLAUDE.md §5).

export type SafetyAnswer = "" | "YES" | "NO" | "NOT_ASSESSED";
export type InputMode = "SPEAK" | "TYPE";

export interface PsyQuestion { key: string; title: string; hint: string }
export interface TherapyModelRow { code: string; name: string; aliases: string[]; concepts: string[]; version: string; enabled: boolean }
export interface PsyConfig {
  questions: PsyQuestion[];
  safety_question: string;
  safety_options: { code: Exclude<SafetyAnswer, "">; label: string }[];
  detection_prompt: string;
  watermark: string;
  sections: { key: string; title: string }[];
  therapy_models: TherapyModelRow[];
  concerns: { register: { row: string; label: string; options: string[] }[]; other: { code: string; label: string }[] };
  attendance_modes: { code: string; label: string }[];
  session_types: { code: string; label: string }[];
  dictation_enabled: boolean;
  can_configure: boolean;
}

export type Concern = { row: string; option: string } | { other: string };
export interface Detection {
  key: string; question: string; category: string; phrase: string; matched: string;
  start: number; end: number; passage: string; prompt: string;
  resolution: { reason: string; by: string; at: string } | null;
}
export interface StigmaFlag { where: string; term: string; start: number; end: number; suggestion: string }
export interface GoalLink { goal_index: number; goal: string; statement: string; status: "CONFIRMED" | "DISMISSED"; by: string; at: string }
export interface RiskItem { key: string; severity: string; text: string; source: string }

export interface PsyNoteSummary {
  id: string; status: "DRAFT" | "SIGNED"; session_date: string; session_type: string; author: string;
  therapy_episode: string; signed_at: string | null; restricted?: boolean; safety_answer?: SafetyAnswer;
  amendments?: number; draft_saved_at?: string;
}

export interface PsyNote extends Omit<PsyNoteSummary, "amendments"> {
  is_author: boolean;
  watermark: string | null;
  session: {
    id: string; session_date: string; duration_minutes: number | null; session_type: string;
    attendance_mode: string; activity: string; measure: { name: string; total: number } | null; process_notes: string | null;
  };
  answers: Record<string, { text: string; mode: InputMode }>;
  selected_models: string[];
  safety_detail: { concerns?: Concern[]; description?: string; actions?: string };
  safety_ack: { reason: string; at: string; by: string } | null;
  alerts: { code: string; status: string }[];
  detections: Detection[];
  goal_suggestions: { goal_index: number; goal: string; evidence: string }[];
  goal_links: GoalLink[];
  sections: Record<string, string>;
  sections_edited: boolean;
  models_applied: { code: string; name: string; version: string }[];
  generated_at: string | null;
  accuracy_confirmed: boolean;
  flags: StigmaFlag[];
  blockers: { code: string; text: string }[];
  rendered: string;
  amendments: { id: string; section: string; previous_text: string; new_text: string; reason: string; by: string; at: string }[];
  history: { at: string; by: string; action: string; [k: string]: unknown }[];
  context: {
    goals: { index: number; goal: string; owner: string; review_date: string }[];
    previous_note: { id: string | null; at: string; by?: string; response?: string; plan?: string; risk_safety?: string; text?: string; restricted?: boolean } | null;
    risk: RiskItem[];
    safety_plan: { id: string; version: number; signed_at: string } | null;
  };
}

const json = (method: "POST" | "PATCH", t: string, path: string, body?: unknown) =>
  apiRequest<PsyNote>(path, { method, body, accessToken: t });

export const getPsyConfig = (t: string) => apiRequest<PsyConfig>("/care/psychotherapy/config/", { accessToken: t });
export const listPsyNotes = (t: string, patientId: string) =>
  apiRequest<{ results: PsyNoteSummary[] }>(`/care/clients/${patientId}/psychotherapy-notes/`, { accessToken: t });
export const startPsyNote = (t: string, patientId: string, body: Record<string, unknown>) =>
  json("POST", t, `/care/clients/${patientId}/psychotherapy-notes/`, body);
export const getPsyNote = (t: string, id: string) => apiRequest<PsyNote>(`/care/psychotherapy-notes/${id}/`, { accessToken: t });
export const savePsyNote = (t: string, id: string, body: Record<string, unknown>) =>
  json("PATCH", t, `/care/psychotherapy-notes/${id}/`, body);
export const generatePsyNote = (t: string, id: string) => json("POST", t, `/care/psychotherapy-notes/${id}/generate/`, {});
export const signPsyNote = (t: string, id: string) => json("POST", t, `/care/psychotherapy-notes/${id}/sign/`, {});
export const amendPsyNote = (t: string, id: string, body: { section: string; text: string; reason: string }) =>
  json("POST", t, `/care/psychotherapy-notes/${id}/amend/`, body);

export const listTherapyModels = (t: string) =>
  apiRequest<{ results: TherapyModelRow[]; can_configure: boolean }>("/care/psychotherapy/models/", { accessToken: t });
export const addTherapyModel = (t: string, body: { name: string; aliases: string[]; concepts: string[] }) =>
  apiRequest<TherapyModelRow>("/care/psychotherapy/models/", { method: "POST", body, accessToken: t });
export const updateTherapyModel = (t: string, code: string, body: Partial<TherapyModelRow>) =>
  apiRequest<TherapyModelRow>(`/care/psychotherapy/models/${code}/`, { method: "PATCH", body, accessToken: t });
