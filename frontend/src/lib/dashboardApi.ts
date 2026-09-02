import { apiRequest } from "./apiClient";
import type { Appointment } from "./appointmentsApi";
import type { PatientListRow } from "./clinicalApi";

// Mirrors client_registry.ClinicalDashboardSummaryView — real, directly
// derivable counts only (no fabricated "documentation completeness %").

export interface ClinicalDashboardSummary {
  registered_clients: number;
  appointments_today: number;
  active_admissions: number;
  attachments_total: number;
  recent_patients: PatientListRow[];
  recent_appointments: Appointment[];
}

export function getClinicalDashboardSummary(accessToken: string) {
  return apiRequest<ClinicalDashboardSummary>("/clinical/dashboard-summary/", { accessToken });
}
