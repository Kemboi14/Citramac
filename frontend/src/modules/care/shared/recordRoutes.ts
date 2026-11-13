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

/** The psychiatrist's assessment workspace for one client. */
export function psychiatryAssessmentPath(patientId: string) {
  return `/clinical/psychiatry/assessments/${patientId}`;
}

/** The Individual Psychotherapy session workspace, inside the clinical shell. */
export function psychotherapySessionPath(patientId: string, episodeId: string) {
  return `/clinical/psychotherapy/individual/session/${patientId}/${episodeId}`;
}

/** Entry page that resolves the client's open therapy episode before opening a session. */
export function psychotherapyEntryPath(patientId: string) {
  return `/clinical/psychotherapy/individual/session/${patientId}`;
}

/** A saved psychotherapy note (draft or signed) opened in the same workspace. */
export function psychotherapyNotePath(patientId: string, episodeId: string, noteId: string) {
  return `/clinical/psychotherapy/individual/session/${patientId}/${episodeId}/note/${noteId}`;
}
