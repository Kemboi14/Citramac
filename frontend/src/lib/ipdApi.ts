import { apiRequest } from "./apiClient";

// Mirrors apps/ipd_ward serializers — docs/07-CLINICAL-MODULES-SPEC.md §7.7.

export interface Paginated<T> {
  count: number;
  results: T[];
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

export interface Admission {
  id: string;
  patient: string;
  bed: string;
  status: string;
  admitted_at: string;
  discharged_at: string | null;
  discharge_summary: string;
}

export function listAdmissions(accessToken: string) {
  return apiRequest<Paginated<Admission>>("/ipd/admissions/", { accessToken });
}

export function admitPatient(accessToken: string, patientId: string, bedId: string) {
  return apiRequest<Admission>("/ipd/admissions/", {
    method: "POST",
    body: { patient: patientId, bed: bedId },
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
