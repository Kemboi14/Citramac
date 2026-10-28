// The shared clinical finding store (backend/apps/care_pathway/findings.py):
// one finding per domain, recorded at Triage and confirmed or updated by later
// stages — every change a new version, the earlier ones kept as history.
import { apiRequest } from "./apiClient";

export type FindingStatus = "PRESENT" | "ABSENT" | "UNKNOWN";

export interface ClinicalFinding {
  id: string;
  key: string;
  domain: string;
  title: string;
  status: FindingStatus;
  status_label: string;
  summary: string;
  note: string;
  action: "RECORDED" | "CONFIRMED" | "UPDATED";
  stage: string;
  source_code: string;
  source_label: string;
  source_detail: string;
  version: number;
  recorded_at: string;
  recorded_by: string;
}

export function getClientFindings(accessToken: string, patientId: string) {
  return apiRequest<{ results: ClinicalFinding[] }>(`/care/clients/${patientId}/findings/`, {
    accessToken,
  });
}

export function getFindingHistory(accessToken: string, patientId: string, key: string) {
  return apiRequest<{ results: ClinicalFinding[] }>(
    `/care/clients/${patientId}/findings/?key=${encodeURIComponent(key)}`,
    { accessToken },
  );
}

export function reviewFinding(
  accessToken: string,
  patientId: string,
  body: {
    key: string;
    action: "CONFIRMED" | "UPDATED";
    stage: string;
    status?: FindingStatus;
    note?: string;
  },
) {
  return apiRequest<ClinicalFinding>(`/care/clients/${patientId}/findings/review/`, {
    method: "POST",
    body,
    accessToken,
  });
}
