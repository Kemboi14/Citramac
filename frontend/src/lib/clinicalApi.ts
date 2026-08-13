import { apiRequest } from "./apiClient";

// Mirrors apps/client_registry, apps/clinical_encounter, apps/triage,
// apps/ccp_program, apps/dha_interop serializers — docs/10-API-SPECIFICATION.md.

export interface PatientListRow {
  id: string;
  first_name: string;
  last_name: string;
  middle_other_names: string;
  uhid_number: string;
  citramac_number: string;
  gender: string;
  date_of_birth: string;
  age: number;
  registered_at: string;
  doctors_name: string;
  allergy_status: string;
  nationality: string;
  marital_status: string;
  patient_category: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export function listPatients(accessToken: string) {
  return apiRequest<Paginated<PatientListRow>>("/patients/", { accessToken });
}

export interface NewPatientPayload {
  first_name: string;
  last_name: string;
  middle_other_names?: string;
  gender: string;
  date_of_birth: string;
  marital_status?: string;
  nationality?: string;
  uhid_number?: string;
  contact_phone?: string;
  contact_email?: string;
  address?: string;
  county?: string;
  allergy_status?: string;
  patient_category?: string;
  referral_source?: string;
}

export function createPatient(accessToken: string, payload: NewPatientPayload) {
  return apiRequest<{ id: string }>("/patients/", { method: "POST", body: payload, accessToken });
}

export function getPatient(accessToken: string, patientId: string) {
  return apiRequest<Record<string, unknown>>(`/patients/${patientId}/`, { accessToken });
}

export function createEncounter(accessToken: string, patientId: string, encounterType: string) {
  return apiRequest<{ id: string; status: string }>("/encounters/", {
    method: "POST",
    body: { patient: patientId, encounter_type: encounterType },
    accessToken,
  });
}

export function submitVitals(
  accessToken: string,
  encounterId: string,
  payload: Record<string, unknown>,
) {
  return apiRequest<Record<string, unknown>>(`/encounters/${encounterId}/vitals/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function submitMse(
  accessToken: string,
  encounterId: string,
  payload: Record<string, unknown>,
) {
  return apiRequest<Record<string, unknown>>(`/encounters/${encounterId}/mse/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function submitSoapNote(
  accessToken: string,
  encounterId: string,
  payload: Record<string, unknown>,
) {
  return apiRequest<{ id: string }>(`/encounters/${encounterId}/soap-notes/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function signSoapNote(accessToken: string, encounterId: string, noteId: string) {
  return apiRequest<Record<string, unknown>>(
    `/encounters/${encounterId}/soap-notes/${noteId}/sign/`,
    {
      method: "POST",
      accessToken,
    },
  );
}

export function addDiagnosis(
  accessToken: string,
  encounterId: string,
  icd11Code: string,
  isPrimary: boolean,
) {
  return apiRequest<Record<string, unknown>>(`/encounters/${encounterId}/diagnoses/`, {
    method: "POST",
    body: { icd11_code: icd11Code, is_primary: isPrimary },
    accessToken,
  });
}

export interface Icd11Code {
  code: string;
  description: string;
}

export function searchIcd11(accessToken: string, query: string) {
  return apiRequest<Icd11Code[]>(`/terminology/icd11/search/?q=${encodeURIComponent(query)}`, {
    accessToken,
  });
}

export function createPsychotherapySession(accessToken: string, payload: Record<string, unknown>) {
  return apiRequest<Record<string, unknown>>("/ccp/psychotherapy-sessions/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function createBiopsychosocialAssessment(
  accessToken: string,
  payload: Record<string, unknown>,
) {
  return apiRequest<Record<string, unknown>>("/ccp/biopsychosocial-assessments/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}
