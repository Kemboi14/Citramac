import { apiRequest } from "./apiClient";
import type { FollowUpAppointmentRow } from "./dischargeApi";
import type { OutcomeSummary, PlanWorkspace } from "./carePathwayApi";

// Care plan (mockup v4 stage 4) additions: bulk accept, added actions, the
// client's acknowledgement and the nursing care plan.

export function acceptRemainingRecommendations(accessToken: string, patientId: string) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/accept-remaining/`, {
    method: "POST",
    accessToken,
  });
}

export function removeAddedAction(accessToken: string, patientId: string, key: string) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/actions/${key}/decide/`, {
    method: "DELETE",
    accessToken,
  });
}

export function confirmPlanReviewed(accessToken: string, patientId: string, bulkReviewed: boolean) {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/confirm/`, {
    method: "POST",
    body: { bulk_reviewed: bulkReviewed },
    accessToken,
  });
}

export function acknowledgePlan(accessToken: string, patientId: string, language: "en" | "sw") {
  return apiRequest<PlanWorkspace>(`/care/clients/${patientId}/care-plan/client-acknowledge/`, {
    method: "POST",
    body: { language },
    accessToken,
  });
}

export interface NursingProblem {
  id: string;
  problem: string;
  goal: string;
  interventions: string;
  evaluations: { text: string; by: string; at: string }[];
  action_key: string;
  action_name: string;
  recorded_by: string;
  recorded_at: string;
}

export function listNursingProblems(accessToken: string, patientId: string) {
  return apiRequest<{ results: NursingProblem[] }>(`/care/clients/${patientId}/care-plan/nursing/`, {
    accessToken,
  });
}

export function addNursingProblem(
  accessToken: string,
  patientId: string,
  body: { problem: string; goal: string; interventions?: string; evaluation?: string; action_key?: string },
) {
  return apiRequest<NursingProblem>(`/care/clients/${patientId}/care-plan/nursing/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export function evaluateNursingProblem(accessToken: string, problemId: string, evaluation: string) {
  return apiRequest<NursingProblem>(`/care/nursing-problems/${problemId}/evaluate/`, {
    method: "POST",
    body: { evaluation },
    accessToken,
  });
}

// Outcomes (mockup v4 stage 6): measures, discharge checklist, follow-up.

export interface MeasureOption {
  code: string;
  name: string;
  why: string;
}

export interface OutcomeScoreRow {
  id: string;
  instrument: string;
  name: string;
  score: number;
  max: number;
  band: string;
  timepoint: string;
  context: string;
  note: string;
  flags: string[];
  recorded_at: string;
  recorded_by: string;
}

export interface PreviousEpisode {
  id: string;
  number: number;
  period_start: string;
  period_end: string | null;
  status: string;
  outcome: string;
  destination: string;
  reason: string;
  plan_version: number;
  plan_actions: string[];
}

export interface OutcomesOverview {
  summary: OutcomeSummary[];
  scores: OutcomeScoreRow[];
  measure_options: MeasureOption[];
  discharge_measures_due: boolean;
  episode: {
    open: boolean;
    outcome: {
      outcome: string;
      destination: string;
      reason: string;
      recorded_at: string;
      recorded_by: string;
    } | null;
  };
  previous_episodes: PreviousEpisode[];
}

export function getOutcomesOverview(accessToken: string, patientId: string) {
  return apiRequest<OutcomesOverview>(`/care/clients/${patientId}/outcomes/overview/`, { accessToken });
}

export interface DischargeAnswers {
  meds_reconciled?: boolean;
  counter_referral?: "SENT" | "NO_REFERRER" | "";
  naloxone?: "OFFERED" | "DECLINED" | "";
  teach_back?: boolean;
  no_follow_up_reason?: string;
}

export interface DischargeChecklist {
  source: "episode" | "inpatient";
  answers: DischargeAnswers;
  items: { key: string; label: string; ok: boolean }[];
}

export function getDischargeChecklist(accessToken: string, patientId: string) {
  return apiRequest<DischargeChecklist>(`/care/clients/${patientId}/discharge-checklist/`, { accessToken });
}

export function saveDischargeAnswers(accessToken: string, patientId: string, body: DischargeAnswers) {
  return apiRequest<DischargeChecklist>(`/care/clients/${patientId}/discharge-checklist/`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

export interface ClientFollowUpRow extends FollowUpAppointmentRow {
  overdue: boolean;
  notes: string;
  missed_reason: string;
  missed_reason_label: string;
  dna_actioned_at: string | null;
  escalate: boolean;
  contact_note: { text: string; by: string; at: string | null } | null;
}

export interface ClientFollowUps {
  counts: { due: number; overdue: number; completed: number; missed: number };
  next_due: ClientFollowUpRow | null;
  active_risk: boolean;
  results: ClientFollowUpRow[];
}

export function getClientFollowUps(accessToken: string, patientId: string) {
  return apiRequest<ClientFollowUps>(`/care/clients/${patientId}/follow-ups/`, { accessToken });
}

export function completeFollowUp(accessToken: string, appointmentId: string, note: string) {
  return apiRequest<ClientFollowUps>(`/care/appointments/${appointmentId}/contact-done/`, {
    method: "POST",
    body: { note },
    accessToken,
  });
}

export function rebookMissedFollowUp(
  accessToken: string,
  appointmentId: string,
  body: { scheduled_for: string; client_request_id: string },
) {
  return apiRequest<ClientFollowUps>(`/care/appointments/${appointmentId}/rebook/`, {
    method: "POST",
    body,
    accessToken,
  });
}
