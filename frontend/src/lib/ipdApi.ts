import { apiRequest } from "./apiClient";

// Mirrors apps/ipd_ward serializers — docs/07-CLINICAL-MODULES-SPEC.md §7.7.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export interface Ward {
  id: string;
  name: string;
  ward_type: string;
}

export function listWards(accessToken: string) {
  return apiRequest<Paginated<Ward>>("/ipd/wards/", { accessToken });
}

export interface Bed {
  id: string;
  ward: string;
  bed_number: string;
  status: string;
}

export function listBeds(accessToken: string) {
  return apiRequest<Paginated<Bed>>("/ipd/beds/", { accessToken });
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
