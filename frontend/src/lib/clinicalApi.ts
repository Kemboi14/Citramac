import { apiRequest } from "./apiClient";

// Mirrors apps/client_registry, apps/clinical_encounter, apps/triage,
// apps/ccp_program, apps/dha_interop serializers — docs/10-API-SPECIFICATION.md.

export interface PatientListRow {
  id: string;
  first_name: string;
  last_name: string;
  middle_other_names: string;
  photo: string | null;
  uhid_number: string;
  citramac_number: string;
  upi: string;
  national_id: string;
  gender: string;
  date_of_birth: string;
  age: number;
  registered_at: string;
  doctors_name: string;
  allergy_status: string;
  nationality: string;
  marital_status: string;
  patient_category: string;
  contact_phone: string;
  contact_email: string;
}

export interface EmergencyContact {
  id: string;
  patient: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  address: string;
}

export interface AllergyRecord {
  id: string;
  patient: string;
  substance: string;
  reaction: string;
  severity: string;
  noted_at: string;
}

export interface InsuranceCoverage {
  id: string;
  patient: string;
  scheme_type: string;
  policy_number: string;
  corporate_account: string;
  sha_verified: boolean;
  sha_member_status: string;
  sha_premium_compliant: boolean;
  sha_last_checked_at: string | null;
}

/** Mirrors `PatientDetailSerializer` in full — every registration-modal field. */
export interface PatientDetail {
  id: string;
  upi: string;
  uhid_number: string;
  citramac_number: string;
  first_name: string;
  last_name: string;
  middle_other_names: string;
  photo: string | null;
  gender: string;
  date_of_birth: string;
  age: number;
  marital_status: string;
  nationality: string;
  occupation: string;
  employment_status: string;
  living_with_disability: boolean;
  national_id: string;
  passport_number: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  county: string;
  next_of_kin: string | null;
  allergy_status: string;
  doctor: string | null;
  doctor_name: string;
  registered_at: string;
  registered_by: string | null;
  registered_by_name: string;
  referral_source: string;
  referral_mode: string;
  referral_date: string | null;
  patient_category: string;
  insurer_details: string;
  consent_data_sharing: boolean;
  consent_captured_at: string | null;
  emergency_contacts: EmergencyContact[];
  allergy_records: AllergyRecord[];
  insurance_coverages: InsuranceCoverage[];
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
  occupation?: string;
  employment_status?: string;
  living_with_disability?: boolean;
  uhid_number?: string;
  contact_phone?: string;
  contact_email?: string;
  address?: string;
  county?: string;
  allergy_status?: string;
  patient_category?: string;
  referral_source?: string;
  referral_mode?: string;
  referral_date?: string;
  insurer_details?: string;
  doctor?: string;
}

export function createPatient(accessToken: string, payload: NewPatientPayload) {
  return apiRequest<PatientDetail>("/patients/", { method: "POST", body: payload, accessToken });
}

export function updatePatient(
  accessToken: string,
  patientId: string,
  payload: Partial<NewPatientPayload>,
) {
  return apiRequest<PatientDetail>(`/patients/${patientId}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

const PATIENT_PHOTO_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** Separate multipart call — keeps `createPatient`/`updatePatient` plain-JSON. */
export function uploadPatientPhoto(accessToken: string, patientId: string, photo: File) {
  if (photo.size > PATIENT_PHOTO_MAX_SIZE_BYTES) {
    throw new Error("Client photo must be 5MB or smaller.");
  }
  const body = new FormData();
  body.set("photo", photo);
  return apiRequest<PatientDetail>(`/patients/${patientId}/`, {
    method: "PATCH",
    body,
    accessToken,
  });
}

export function getPatient(accessToken: string, patientId: string) {
  return apiRequest<PatientDetail>(`/patients/${patientId}/`, { accessToken });
}

export function createEmergencyContact(
  accessToken: string,
  patientId: string,
  payload: {
    name: string;
    relationship?: string;
    phone?: string;
    email?: string;
    address?: string;
  },
) {
  return apiRequest<EmergencyContact>(`/patients/${patientId}/emergency-contacts/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function createAllergyRecord(
  accessToken: string,
  patientId: string,
  payload: { substance: string; reaction?: string; severity?: string },
) {
  return apiRequest<AllergyRecord>(`/patients/${patientId}/allergy-records/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function createEncounter(accessToken: string, patientId: string, encounterType: string) {
  return apiRequest<{ id: string; status: string }>("/encounters/", {
    method: "POST",
    body: { patient: patientId, encounter_type: encounterType },
    accessToken,
  });
}

export interface EncounterRow {
  id: string;
  patient: string;
  encounter_type: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

export function listEncountersForPatient(accessToken: string, patientId: string) {
  return apiRequest<Paginated<EncounterRow>>(`/encounters/?patient=${patientId}`, { accessToken });
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

export function createLabOrder(accessToken: string, encounterId: string, details: string) {
  return apiRequest<Record<string, unknown>>(`/encounters/${encounterId}/orders/`, {
    method: "POST",
    body: { order_type: "LAB", details },
    accessToken,
  });
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

export interface PrescriptionItem {
  id: string;
  drug: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
}

export interface Prescription {
  id: string;
  items: PrescriptionItem[];
}

export function createPrescription(
  accessToken: string,
  encounterId: string,
  drugCode: string,
  dose: string,
  route: string,
  frequency: string,
  duration: string,
) {
  return apiRequest<Prescription>(`/encounters/${encounterId}/prescriptions/`, {
    method: "POST",
    body: { items: [{ drug: drugCode, dose, route, frequency, duration }] },
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
