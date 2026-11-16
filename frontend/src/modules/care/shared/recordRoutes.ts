// docs/15-CLINICAL-WORKSPACE-V3.md §1.9 — record views, and the care-journey
// stages shown under "Journey". Routes: /clinical/clients/:patientId/:view.
export const RECORD_VIEWS = [
  { key: "snapshot", label: "Snapshot" },
  { key: "timeline", label: "Timeline" },
  { key: "charts", label: "Charts" },
  { key: "legal", label: "Legal & consent" },
  { key: "mse", label: "MSE" },
  { key: "journey", label: "Journey" },
] as const;

export const JOURNEY_STAGES = [
  { key: "snapshot", label: "Capture" },
  { key: "triage", label: "Triage" },
  { key: "intake", label: "Intake" },
  { key: "care-plan", label: "Care Plan" },
  { key: "interventions", label: "Interventions" },
  { key: "outcomes", label: "Outcomes" },
  { key: "billing", label: "Billing" },
  { key: "follow-up", label: "Follow-up" },
] as const;

export type RecordView =
  | "snapshot"
  | "timeline"
  | "charts"
  | "legal"
  | "mse"
  | "triage"
  | "intake"
  | "care-plan"
  | "interventions"
  | "outcomes"
  | "billing"
  | "follow-up";

export const JOURNEY_KEYS = new Set<string>([
  "triage",
  "intake",
  "care-plan",
  "interventions",
  "outcomes",
  "billing",
  "follow-up",
]);

export function clientRecordPath(patientId: string, view: RecordView = "triage") {
  return `/clinical/clients/${patientId}/${view}`;
}

/** The full read-only report of everything recorded for a client. */
export function clientReportPath(patientId: string) {
  return `/clinical/clients/${patientId}/report`;
}

/** The psychiatrist's assessment workspace for one client. */
export function psychiatryAssessmentPath(patientId: string) {
  return `/clinical/psychiatry/assessments/${patientId}`;
}

/** Individual or Family Psychotherapy — the main-menu list a session belongs to. */
export type PsychotherapyKind = "individual" | "family";

/** The psychotherapy menu list (Clients or Sessions tab). */
export function psychotherapyListPath(kind: PsychotherapyKind, tab?: "sessions") {
  return `/clinical/psychotherapy/${kind}${tab ? `?tab=${tab}` : ""}`;
}

/** The session page, inside the clinical shell. Without an episode it sets up or
 * picks the client's therapy episode first; with one it prepares the session. */
export function psychotherapySessionPath(
  kind: PsychotherapyKind,
  patientId: string,
  episodeId?: string,
) {
  const base = `/clinical/psychotherapy/${kind}/session/${patientId}`;
  return episodeId ? `${base}/${episodeId}` : base;
}

/** A saved psychotherapy note (draft or signed) opened in the session page. */
export function psychotherapyNotePath(
  kind: PsychotherapyKind,
  patientId: string,
  episodeId: string,
  noteId: string,
) {
  return `${psychotherapySessionPath(kind, patientId, episodeId || "history")}/note/${noteId}`;
}
