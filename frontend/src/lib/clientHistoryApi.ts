import { apiRequest } from "./apiClient";

// Mirrors apps/ccp_program's BiopsychosocialAssessment/SubstanceUseEntry/
// ReviewOfSystemEntry — docs/07-CLINICAL-MODULES-SPEC.md §7.14.1. Also the
// "Client History" / CIF intake form from mockups/citramac_clinical_workspace.html.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export interface SubstanceUseEntry {
  id: string;
  assessment: string;
  substance: string;
  first_use: string | null;
  last_use: string | null;
  frequency: string;
  route: string;
}

export interface ReviewOfSystemEntry {
  id: string;
  assessment: string;
  category: string;
  notes: string;
  review_date: string | null;
  clinician: string | null;
}

export type RiskLevel = "" | "NONE" | "LOW" | "MODERATE" | "HIGH";
export type IntakeStatus = "DRAFT" | "SUBMITTED";
export type LevelOfCare = "" | "INPATIENT" | "OUTPATIENT" | "PARTIAL" | "RESIDENTIAL";

export interface ClientHistoryRecord {
  id: string;
  patient: string;
  patient_name: string;
  developmental_history: string;
  social_history: string;
  psychological_history: string;
  family_history: string;
  presenting_problem: string;
  risk_factors: string;
  author: string | null;
  author_name: string;
  created_at: string;
  status: IntakeStatus;
  date_of_intake: string | null;
  hpi_onset_date: string | null;
  hpi_duration: string;
  hpi_severity: string;
  main_drug_problem: string;
  other_main_drug_problem: string;
  injecting_drug_use: boolean;
  treatment_before: boolean;
  substance_use_details: string;
  substance_use_entries: SubstanceUseEntry[];
  past_medical_surgical_history: string;
  current_medications: string;
  family_psychiatric_history: string;
  forensic_history: string;
  premorbid_history: string;
  collateral_history: string;
  vegetative_history: string;
  withdrawal_risk: string;
  suicide_risk_level: RiskLevel;
  self_harm_risk_level: RiskLevel;
  violence_risk_level: RiskLevel;
  plan_details: string;
  admission_type_at_intake: "NEW" | "READMISSION";
  level_of_care: LevelOfCare;
  next_steps: string;
  review_of_systems: ReviewOfSystemEntry[];
}

/** "existence only" shape returned to clinicians without full CCP access — §7.14.7. */
export type ClientHistoryRestricted = Pick<ClientHistoryRecord, "id" | "patient" | "status"> & {
  created_at: string;
};

export function listClientHistory(accessToken: string, patientId: string) {
  return apiRequest<Paginated<ClientHistoryRecord | ClientHistoryRestricted>>(
    `/ccp/biopsychosocial-assessments/?patient=${patientId}`,
    { accessToken },
  );
}

export function createClientHistory(
  accessToken: string,
  payload: Partial<ClientHistoryRecord> & { patient: string },
) {
  return apiRequest<ClientHistoryRecord>("/ccp/biopsychosocial-assessments/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function updateClientHistory(
  accessToken: string,
  id: string,
  payload: Partial<ClientHistoryRecord>,
) {
  return apiRequest<ClientHistoryRecord>(`/ccp/biopsychosocial-assessments/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function addSubstanceUseEntry(accessToken: string, payload: Omit<SubstanceUseEntry, "id">) {
  return apiRequest<SubstanceUseEntry>("/ccp/substance-use-entries/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function addReviewOfSystemEntry(
  accessToken: string,
  payload: Omit<ReviewOfSystemEntry, "id" | "clinician">,
) {
  return apiRequest<ReviewOfSystemEntry>("/ccp/review-of-systems/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}
