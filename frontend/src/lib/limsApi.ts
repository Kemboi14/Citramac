import { apiRequest } from "./apiClient";

// Mirrors apps/lims serializers — docs/07-CLINICAL-MODULES-SPEC.md §7.4.

export interface LoincCode {
  code: string;
  description: string;
}

export function searchLoinc(accessToken: string, query: string) {
  return apiRequest<LoincCode[]>(`/terminology/loinc/search/?q=${encodeURIComponent(query)}`, {
    accessToken,
  });
}

export interface LabOrder {
  id: string;
  encounter: string;
  loinc_code: string;
  status: string;
  ordered_at: string;
}

export function createLabOrder(accessToken: string, encounterId: string, loincCode: string) {
  return apiRequest<LabOrder>("/lab/orders/", {
    method: "POST",
    body: { encounter: encounterId, loinc_code: loincCode },
    accessToken,
  });
}

export interface LabSpecimen {
  id: string;
  lab_order: string;
  barcode: string;
  specimen_type: string;
  collected_at: string;
}

export function collectSpecimen(accessToken: string, labOrderId: string, specimenType: string) {
  return apiRequest<LabSpecimen>("/lab/specimens/", {
    method: "POST",
    body: { lab_order: labOrderId, specimen_type: specimenType },
    accessToken,
  });
}

export interface LabResult {
  id: string;
  lab_order: string;
  specimen: string | null;
  result_value?: string;
  unit?: string;
  reference_range?: string;
  is_abnormal?: boolean;
  is_validated: boolean;
  validated_at?: string | null;
}

export function recordLabResult(
  accessToken: string,
  labOrderId: string,
  specimenId: string,
  payload: { result_value: string; unit: string; reference_range: string; is_abnormal: boolean },
) {
  return apiRequest<LabResult>("/lab/results/", {
    method: "POST",
    body: { lab_order: labOrderId, specimen: specimenId, ...payload },
    accessToken,
  });
}

export function validateLabResult(accessToken: string, resultId: string) {
  return apiRequest<LabResult>(`/lab/results/${resultId}/validate/`, {
    method: "POST",
    accessToken,
  });
}

export interface Paginated<T> {
  count: number;
  results: T[];
}

export function listLabResults(accessToken: string) {
  return apiRequest<Paginated<LabResult>>("/lab/results/", { accessToken });
}
