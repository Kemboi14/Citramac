import { apiRequest } from "./apiClient";

// Mirrors backend/apps/care_pathway/group_views.py — the v4 mockup's Group
// Psychotherapy workspace. Nothing here touches browser storage (CLAUDE.md §5):
// attendance being marked before confirmation lives in React state only.

/** Code from the served `group-attendance` value set. */
export type AttendanceCode = "PRESENT" | "ABSENT" | "EXCUSED" | "DECLINED";

export interface GroupCategory {
  code: string;
  display: string;
  active: boolean;
  is_other: boolean;
}

export interface GroupCategoriesPayload {
  results: GroupCategory[];
  can_configure: boolean;
}

/** Shared session facts — what any attendee's record may show. */
export interface GroupSessionFacts {
  id: string;
  reference: string;
  category_code: string;
  category: string;
  category_other: string;
  topic: string;
  session_date: string;
  start_time: string;
  end_time: string;
  facilitator: string;
  facilitator_id: string | null;
  facilitator_name: string;
  location: string;
  description: string;
  documented_by: string;
  confirmed_at: string;
}

/** A session in the shared list: facts plus aggregate counts, never an observation. */
export interface GroupSessionRow extends GroupSessionFacts {
  appointment_id: string | null;
  entry_count: number;
  present_count: number;
  not_present_count: number;
  follow_ups_outstanding: number;
}

export interface ScheduledGroupSession {
  key: string;
  appointment_id: string;
  /** Facility wall-clock date/time, server-formatted; prefer starts_at/ends_at. */
  date: string;
  time: string;
  end_time: string;
  /** ISO instants, formatted in the browser's own time zone. */
  starts_at: string;
  ends_at: string;
  category: string;
  topic: string;
  facilitator: string;
  facilitator_id: string | null;
  location: string;
  booked_count: number;
}

export interface GroupClient {
  id: string;
  display_id: string;
  name: string;
  programme: string;
  unit: string;
  /** True when the client has a current inpatient admission. */
  admitted: boolean;
  eligible: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
}

export interface GroupWorkspace {
  categories: GroupCategory[];
  can_configure: boolean;
  sessions: GroupSessionRow[];
  scheduled: ScheduledGroupSession[];
  clients: GroupClient[];
  staff: StaffMember[];
  current_user: StaffMember;
}

export type FollowUpStatus = "Open" | "Completed" | "Not required";

/** One client's own part of a session entry. */
export interface GroupEntryClinical {
  id: string;
  attendance: AttendanceCode;
  attendance_display: string;
  observation: string;
  risk_disclosure: boolean;
  /** The served lexicon found possible risk language in the observation. */
  risk_detected: boolean;
  risk_override_reason: string;
  follow_up_required: boolean;
  follow_up_status: FollowUpStatus;
  follow_up_task_id: string | null;
  intervention_linked: boolean;
  version: number;
}

export interface GroupSessionEntry extends GroupEntryClinical {
  patient_id: string;
  display_id: string;
  name: string;
  programme: string;
}

export interface GroupAuditItem {
  label: string;
  by: string;
  at: string;
  note: string;
}

export interface GroupSessionDetail extends GroupSessionRow {
  entries: GroupSessionEntry[];
  audit_trail: GroupAuditItem[];
}

export interface ClientGroupEntry extends GroupEntryClinical {
  session: GroupSessionFacts;
}

export interface GroupSessionDetailsPayload {
  category: string;
  category_other: string;
  topic: string;
  session_date: string;
  start_time: string;
  end_time: string;
  facilitator: string | null;
  facilitator_name: string;
  location: string;
  description: string;
}

export interface GroupEntryPayload {
  attendance: AttendanceCode;
  observation: string;
  risk_disclosure: boolean;
  follow_up: boolean;
  /** Why detected risk language is not a risk disclosure (kept in the audit). */
  risk_override_reason?: string;
}

/** Possible safety language the served lexicon found in one observation. */
export interface RiskFlag {
  matched: string;
  category: string;
  passage: string;
}

/** Screen observations before review — nothing is stored. */
export function screenGroupEntries(
  accessToken: string,
  entries: { patient: string; observation: string }[],
) {
  return apiRequest<{ results: { patient: string; flags: RiskFlag[] }[] }>(`${BASE}/screen/`, {
    method: "POST",
    body: { entries },
    accessToken,
  });
}

export interface ConfirmGroupSessionPayload extends GroupSessionDetailsPayload {
  client_request_id: string;
  appointment: string | null;
  entries: (GroupEntryPayload & { patient: string })[];
}

export interface GroupUtilisationRow {
  category: string;
  sessions: number;
  present: number;
  absent: number;
  excused: number;
  declined: number;
  attendance_percent: number;
}

export interface GroupUtilisation {
  confirmed_sessions: number;
  recorded_attendances: number;
  follow_ups_outstanding: number;
  linked_intervention_records: number;
  by_category: GroupUtilisationRow[];
  sessions_with_linked_records: number;
  risk_disclosures_flagged: number;
}

const BASE = "/care/group-programme";

export function getGroupWorkspace(accessToken: string) {
  return apiRequest<GroupWorkspace>(`${BASE}/workspace/`, { accessToken });
}

export function addGroupCategory(accessToken: string, display: string) {
  return apiRequest<GroupCategoriesPayload>(`${BASE}/categories/`, {
    method: "POST",
    body: { display },
    accessToken,
  });
}

export function modifyGroupCategory(accessToken: string, code: string, display: string) {
  return apiRequest<GroupCategoriesPayload>(`${BASE}/categories/${encodeURIComponent(code)}/`, {
    method: "PATCH",
    body: { display },
    accessToken,
  });
}

export function confirmGroupSession(accessToken: string, payload: ConfirmGroupSessionPayload) {
  return apiRequest<GroupSessionDetail>(`${BASE}/sessions/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function getGroupSession(accessToken: string, id: string) {
  return apiRequest<GroupSessionDetail>(`${BASE}/sessions/${id}/`, { accessToken });
}

export function correctGroupSession(
  accessToken: string,
  id: string,
  payload: GroupSessionDetailsPayload & { reason: string },
) {
  return apiRequest<GroupSessionDetail>(`${BASE}/sessions/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function correctGroupEntry(
  accessToken: string,
  id: string,
  payload: GroupEntryPayload & { reason: string },
) {
  return apiRequest<GroupSessionDetail>(`${BASE}/entries/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function completeGroupFollowUp(accessToken: string, entryId: string) {
  return apiRequest<{ results: ClientGroupEntry[] }>(
    `${BASE}/entries/${entryId}/follow-up/complete/`,
    { method: "POST", accessToken },
  );
}

export function getGroupUtilisation(accessToken: string) {
  return apiRequest<GroupUtilisation>(`${BASE}/utilisation/`, { accessToken });
}

export function getClientGroupEntries(accessToken: string, patientId: string) {
  return apiRequest<{ results: ClientGroupEntry[] }>(`/care/clients/${patientId}/group-entries/`, {
    accessToken,
  });
}
