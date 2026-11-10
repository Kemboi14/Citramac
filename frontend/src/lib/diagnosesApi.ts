import { apiRequest } from "./apiClient";

// Mirrors apps/clinical_encounter's DiagnosisCode — the Diagnoses tab from
// mockups/citramac_clinical_workspace.html's patient workspace.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export type DiagnosisStatus = "ACTIVE" | "HISTORICAL" | "RESOLVED";
/** Diagnostic certainty — `intake-dx-status` codes → Condition.verificationStatus.
 * Blank on diagnoses recorded before it existed. */
export type DiagnosisVerification =
  | ""
  | "PROVISIONAL"
  | "DIFFERENTIAL"
  | "CONFIRMED"
  | "RULED_OUT"
  /** Set only by markDiagnosisInError (wrong client or wrong code), never chosen. */
  | "ENTERED_IN_ERROR";

export interface Diagnosis {
  id: string;
  encounter: string;
  patient: string;
  icd11_code: string;
  /** What the clinician chose the code by — kept as recorded (Condition.code.coding.display). */
  icd11_description: string;
  /** WHO ICD-11 release the code was chosen from; blank for the old, unverified list. */
  icd11_release: string;
  /** Set when a code from the old list means something else in WHO ICD-11. */
  code_review_reason: string;
  /** Flagged and not yet corrected: its code is not shown, shared or billed. */
  needs_recoding: boolean;
  is_primary: boolean;
  noted_at: string;
  status: DiagnosisStatus;
  verification_status: DiagnosisVerification;
  clinical_notes: string;
  diagnostic_criteria_met: string;
  error_reason: string;
}

/** "6A70.0 — …", or the recorded text alone while the code is under review. */
export function diagnosisLabel(
  d: Pick<Diagnosis, "icd11_code" | "icd11_description" | "needs_recoding">,
) {
  return d.needs_recoding
    ? `${d.icd11_description} (ICD-11 code under review)`
    : `${d.icd11_code} — ${d.icd11_description}`;
}

export function listDiagnosesForPatient(accessToken: string, patientId: string) {
  return apiRequest<Paginated<Diagnosis>>(`/diagnoses/?patient=${patientId}`, { accessToken });
}

export function createDiagnosis(
  accessToken: string,
  payload: { encounter: string; icd11_code: string } & Partial<Diagnosis>,
) {
  return apiRequest<Diagnosis>("/diagnoses/", { method: "POST", body: payload, accessToken });
}

/** Recorded against the wrong client or with the wrong code — R4 entered-in-error. */
export function markDiagnosisInError(accessToken: string, id: string, reason: string) {
  return apiRequest<Diagnosis>(`/diagnoses/${id}/entered-in-error/`, {
    method: "POST",
    body: { reason },
    accessToken,
  });
}

export function updateDiagnosis(accessToken: string, id: string, payload: Partial<Diagnosis>) {
  return apiRequest<Diagnosis>(`/diagnoses/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}
