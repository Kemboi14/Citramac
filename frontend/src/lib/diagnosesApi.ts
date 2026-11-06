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
  icd11_description: string;
  is_primary: boolean;
  noted_at: string;
  status: DiagnosisStatus;
  verification_status: DiagnosisVerification;
  clinical_notes: string;
  diagnostic_criteria_met: string;
  error_reason: string;
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
