import { apiRequest } from "./apiClient";

// Mirrors apps/client_registry's Appointment — docs/07-CLINICAL-MODULES-SPEC.md
// §7.1. Appointments Calendar — mockups/citramac_clinical_workspace.html.

export interface Paginated<T> {
  count: number;
  results: T[];
}

export type AppointmentStatus = "SCHEDULED" | "CHECKED_IN" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type AppointmentMode = "IN_PERSON" | "PHONE" | "VIDEO";

export interface Appointment {
  id: string;
  patient: string;
  patient_name: string;
  branch: string | null;
  provider: string | null;
  provider_name: string;
  scheduled_for: string;
  duration_minutes: number;
  location: string;
  mode: AppointmentMode;
  appointment_type: string;
  status: AppointmentStatus;
  notes: string;
}

export function listAppointments(
  accessToken: string,
  params?: { from?: string; to?: string; status?: AppointmentStatus; patient?: string },
) {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.status) query.set("status", params.status);
  if (params?.patient) query.set("patient", params.patient);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<Paginated<Appointment>>(`/appointments/${suffix}`, { accessToken });
}

export function createAppointment(
  accessToken: string,
  payload: { patient: string } & Partial<Appointment>,
) {
  return apiRequest<Appointment>("/appointments/", { method: "POST", body: payload, accessToken });
}

export function updateAppointment(accessToken: string, id: string, payload: Partial<Appointment>) {
  return apiRequest<Appointment>(`/appointments/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}
