import { apiRequest } from "./apiClient";

// Mirrors apps/mhp_program PsychotherapySessionViewSet — docs/15-CLINICAL-WORKSPACE-V3.md §1.11.
// The list returns, per row, either the full serializer (care team with full MHP
// access; the view is audit-logged server-side) or the restricted one, which
// proves a session exists but carries no clinical content.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export type PsychotherapySessionType = "INDIVIDUAL" | "FAMILY" | "GROUP";

/** PsychotherapySessionRestrictedSerializer — existence only, no content. */
export interface PsychotherapySessionRestricted {
  id: string;
  patient: string;
  session_type: PsychotherapySessionType;
  session_date: string;
}

/** PsychotherapySessionSerializer. */
export interface PsychotherapySessionFull extends PsychotherapySessionRestricted {
  therapist: string | null;
  therapist_name: string;
  duration_minutes: number | null;
  modality: string;
  goals: string;
  session_notes: string;
  trauma_processing_stage: string;
  progress_rating: number | null;
  extra: Record<string, unknown>;
}

export type PsychotherapySession = PsychotherapySessionFull | PsychotherapySessionRestricted;

export function isFullSession(session: PsychotherapySession): session is PsychotherapySessionFull {
  return "session_notes" in session;
}

export function listPsychotherapySessions(
  accessToken: string,
  params?: { patient?: string; sessionType?: PsychotherapySessionType },
) {
  const query = new URLSearchParams();
  if (params?.patient) query.set("patient", params.patient);
  if (params?.sessionType) query.set("session_type", params.sessionType);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<Paginated<PsychotherapySession>>(`/mhp/psychotherapy-sessions/${suffix}`, {
    accessToken,
  });
}
