import { apiRequest } from "./apiClient";

// Mirrors apps/ipd_ward serializers — docs/07-CLINICAL-MODULES-SPEC.md §7.7.

export interface Paginated<T> {
  count: number;
  results: T[];
}

// The API pages at 25 rows (DRF PageNumberPagination). Screens that need the
// whole set — every bed, every current admission — walk the pages.
async function fetchAllPages<T>(accessToken: string, path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const rows: T[] = [];
  for (let page = 1; ; page += 1) {
    const data = await apiRequest<Paginated<T>>(`${path}${separator}page=${page}`, {
      accessToken,
    });
    rows.push(...data.results);
    if (data.results.length === 0 || rows.length >= data.count) return rows;
  }
}

export function listAllWards(accessToken: string) {
  return fetchAllPages<Ward>(accessToken, "/ipd/wards/");
}

export function listAllBeds(accessToken: string, wardId?: string) {
  return fetchAllPages<Bed>(accessToken, `/ipd/beds/${wardId ? `?ward=${wardId}` : ""}`);
}

export interface Ward {
  id: string;
  name: string;
  branch: string | null;
  ward_type: string;
  bed_count: number;
}

export function listWards(accessToken: string, branchId?: string) {
  return apiRequest<Paginated<Ward>>(`/ipd/wards/${branchId ? `?branch=${branchId}` : ""}`, {
    accessToken,
  });
}

export function createWard(
  accessToken: string,
  payload: { name: string; branch?: string; ward_type?: string },
) {
  return apiRequest<Ward>("/ipd/wards/", { method: "POST", body: payload, accessToken });
}

export type BedStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE";

export interface Bed {
  id: string;
  ward: string;
  bed_number: string;
  status: BedStatus;
  occupant_name: string | null;
}

export function listBeds(accessToken: string, wardId?: string) {
  return apiRequest<Paginated<Bed>>(`/ipd/beds/${wardId ? `?ward=${wardId}` : ""}`, {
    accessToken,
  });
}

export function createBed(
  accessToken: string,
  payload: { ward: string; bed_number: string; status?: BedStatus },
) {
  return apiRequest<Bed>("/ipd/beds/", { method: "POST", body: payload, accessToken });
}

export function updateBed(accessToken: string, bedId: string, payload: Partial<Bed>) {
  return apiRequest<Bed>(`/ipd/beds/${bedId}/`, { method: "PATCH", body: payload, accessToken });
}

export interface WardBedSummary {
  beds_by_status: Record<BedStatus, number>;
  wards: Ward[];
}

export function getWardSummary(accessToken: string, branchId?: string) {
  return apiRequest<WardBedSummary>(`/ipd/wards/summary/${branchId ? `?branch=${branchId}` : ""}`, {
    accessToken,
  });
}

export type AdmissionType = "VOLUNTARY" | "INVOLUNTARY";
export type ObservationLevel = "ROUTINE" | "ENHANCED" | "CLOSE" | "CONTINUOUS";
export type ConsentStatus = "" | "PENDING" | "OBTAINED" | "DECLINED";
export type NokNotification = "NOT_NOTIFIED" | "NOTIFIED" | "NOT_APPLICABLE" | "UNABLE_TO_REACH";

export type ClinicalPriority = "" | "RED" | "ORANGE" | "YELLOW" | "GREEN";

export interface Admission {
  id: string;
  patient: string;
  patient_name: string;
  bed: string;
  bed_label: string;
  status: string;
  admitted_at: string;
  discharged_at: string | null;
  discharge_summary: string;
  follow_up_date: string | null;
  admission_type: AdmissionType;
  admission_source: string;
  priority: "ROUTINE" | "URGENT" | "EMERGENCY";
  reason_for_admission: string;
  clinical_summary: string;
  primary_diagnosis: string;
  associated_conditions: string;
  risk_self_harm: boolean;
  risk_to_others: boolean;
  risk_absconding: boolean;
  risk_medical: boolean;
  observation_level: ObservationLevel;
  safety_actions: string;
  risk_summary: string;
  primary_care_team: string;
  consultant: string | null;
  initial_care_priorities: string;
  consent_status: ConsentStatus;
  consent_at: string | null;
  consent_obtained_by: string | null;
  capacity_assessed: boolean | null;
  consent_notes: string;
  legal_status: string;
  legal_order_reference: string;
  legal_order_date: string | null;
  legal_review_due_date: string | null;
  authorizing_professional: string;
  legal_rationale: string;
  oversight_notes: string;
  next_of_kin_notification: NokNotification;
  next_of_kin_notes: string;
  handover_note: string;
  /** Triage-scale priority recorded on admission (docs/15 §1.10); "" when not set. */
  clinical_priority: ClinicalPriority;
  /** EpisodeOfCare the admission sits inside — set by the server. */
  episode: string | null;
  consultant_name: string;
  patient_citramac_number: string;
}

export function listAdmissions(
  accessToken: string,
  params?: { admissionType?: AdmissionType; patient?: string; status?: string },
) {
  const query = new URLSearchParams();
  if (params?.admissionType) query.set("admission_type", params.admissionType);
  if (params?.patient) query.set("patient", params.patient);
  if (params?.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<Paginated<Admission>>(`/ipd/admissions/${suffix}`, { accessToken });
}

/** Every admission currently holding a bed (status ADMITTED or TRANSFERRED). */
export async function listCurrentAdmissions(accessToken: string) {
  const [admitted, transferred] = await Promise.all([
    fetchAllPages<Admission>(accessToken, "/ipd/admissions/?status=ADMITTED"),
    fetchAllPages<Admission>(accessToken, "/ipd/admissions/?status=TRANSFERRED"),
  ]);
  return [...admitted, ...transferred].sort((a, b) => b.admitted_at.localeCompare(a.admitted_at));
}

export function admitPatient(
  accessToken: string,
  payload: { patient: string; bed: string } & Partial<Admission>,
) {
  return apiRequest<Admission>("/ipd/admissions/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

/** PATCH an admission — e.g. the legal / consent fields from the Client Record. */
export function updateAdmission(
  accessToken: string,
  admissionId: string,
  payload: Partial<Admission>,
) {
  return apiRequest<Admission>(`/ipd/admissions/${admissionId}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export interface EligiblePatient {
  id: string;
  first_name: string;
  last_name: string;
  middle_other_names?: string;
  uhid_number: string;
  citramac_number?: string;
  gender: string;
  date_of_birth: string;
  age: number;
}

/** `all: true` lists every registered, non-admitted client (the v3 admission form,
 * docs/15 §1.10); without it, only Inpatient-category clients. */
export function listEligibleAdmissionPatients(accessToken: string, options?: { all?: boolean }) {
  return apiRequest<EligiblePatient[]>(
    `/ipd/admissions/eligible-patients/${options?.all ? "?all=true" : ""}`,
    { accessToken },
  );
}

export function getAdmissionFhirBundle(accessToken: string, admissionId: string) {
  return apiRequest<Record<string, unknown>>(`/ipd/admissions/${admissionId}/fhir/`, {
    accessToken,
  });
}

export function dischargeAdmission(accessToken: string, admissionId: string, summary: string) {
  return apiRequest<Admission>(`/ipd/admissions/${admissionId}/discharge/`, {
    method: "POST",
    body: { discharge_summary: summary },
    accessToken,
  });
}

export function transferAdmission(accessToken: string, admissionId: string, newBedId: string) {
  return apiRequest<Admission>(`/ipd/admissions/${admissionId}/transfer/`, {
    method: "POST",
    body: { bed: newBedId },
    accessToken,
  });
}

// Psychiatric Nursing — MAR + nursing notes, docs/07-CLINICAL-MODULES-SPEC.md §7.7.

export type MarStatus = "SCHEDULED" | "ADMINISTERED" | "MISSED" | "REFUSED";

export interface MedicationAdministration {
  id: string;
  admission: string;
  prescription_item: string | null;
  scheduled_time: string;
  status: MarStatus;
  administered_by: string | null;
  administered_at: string | null;
  notes: string;
}

export function listMarEntries(accessToken: string, admissionId: string) {
  return apiRequest<Paginated<MedicationAdministration>>(`/ipd/mar/?admission=${admissionId}`, {
    accessToken,
  });
}

export function scheduleMarEntry(
  accessToken: string,
  payload: { admission: string; scheduled_time: string; notes?: string },
) {
  return apiRequest<MedicationAdministration>("/ipd/mar/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function administerMarEntry(
  accessToken: string,
  entryId: string,
  status: MarStatus,
  notes?: string,
) {
  return apiRequest<MedicationAdministration>(`/ipd/mar/${entryId}/administer/`, {
    method: "POST",
    body: { status, notes },
    accessToken,
  });
}

export interface NursingNote {
  id: string;
  admission: string;
  author: string | null;
  /** Author's display name; "" when not recorded. */
  author_name: string;
  shift: "DAY" | "NIGHT";
  note: string;
  recorded_at: string;
}

export function listNursingNotes(accessToken: string, admissionId: string) {
  return apiRequest<Paginated<NursingNote>>(`/ipd/nursing-notes/?admission=${admissionId}`, {
    accessToken,
  });
}

export function addNursingNote(
  accessToken: string,
  payload: { admission: string; shift: "DAY" | "NIGHT"; note: string },
) {
  return apiRequest<NursingNote>("/ipd/nursing-notes/", {
    method: "POST",
    body: payload,
    accessToken,
  });
}
