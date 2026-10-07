import { apiRequest } from "./apiClient";
import type { PriorityOrBlank } from "./carePathwayApi";

// Mirrors apps/client_registry CaseloadView — docs/15-CLINICAL-WORKSPACE-V3.md §1.12.

export interface CaseloadRow {
  id: string;
  name: string;
  citramac_number: string;
  uhid_number: string;
  care_setting: "INPATIENT" | "OUTPATIENT";
  ward: string | null;
  bed: string | null;
  status: string;
  diagnosis: { code: string; description: string } | null;
  next_appointment: { scheduled_for: string; appointment_type: string } | null;
  /** Latest signed triage priority; "" when the client has not been triaged. */
  priority: PriorityOrBlank;
}

export function getCaseload(accessToken: string) {
  return apiRequest<{ results: CaseloadRow[] }>("/clinical/caseload/", { accessToken });
}
