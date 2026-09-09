import { apiRequest } from "./apiClient";
import type { Appointment } from "./appointmentsApi";
import type { PatientListRow } from "./clinicalApi";

// Mirrors client_registry.ClinicalDashboardSummaryView — real, directly
// derivable counts only (no fabricated "documentation completeness %").

export interface WardOccupancyRow {
  ward: string;
  occupied: number;
  total: number;
}

export interface FhirTransmissionStatus {
  configured: boolean;
  status: string | null;
  resource_type: string | null;
  last_transmitted_at: string | null;
}

export interface ClinicalDashboardSummary {
  registered_clients: number;
  appointments_today: number;
  appointments_remaining_today: number;
  active_admissions: number;
  beds_occupied: number;
  beds_total: number;
  ward_occupancy: WardOccupancyRow[];
  attachments_total: number;
  fhir_status: FhirTransmissionStatus;
  recent_patients: PatientListRow[];
  recent_appointments: Appointment[];
}

export function getClinicalDashboardSummary(accessToken: string) {
  return apiRequest<ClinicalDashboardSummary>("/clinical/dashboard-summary/", { accessToken });
}
