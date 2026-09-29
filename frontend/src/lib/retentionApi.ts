import { apiRequest } from "./apiClient";
import type { Paginated } from "./organizationsApi";

// Mirrors apps.retention (backend/apps/retention/serializers.py) — records
// retention & archive. Clinical records are archived at the end of their
// retention period, never deleted; an archived client record is read-only
// and can be restored by an Org Admin.

export interface RetentionYears {
  clinical: number;
  mental_health: number;
  financial: number;
}

/** Super Admin only. `floor_verified` gates every archive approval platform-wide. */
export interface RetentionPlatformSettings {
  clinical_floor_years: number;
  mental_health_floor_years: number;
  financial_floor_years: number;
  minor_clock_start_age: number | null;
  floor_verified: boolean;
  floor_source: string;
  verified_by_name: string | null;
  verified_at: string | null;
  forecast_windows_days: number[];
  updated_at: string;
}

/** Org Admin: their own organization's periods (null = use the platform floor). */
export interface OrganizationRetentionPolicy {
  clinical_years: number | null;
  mental_health_years: number | null;
  financial_years: number | null;
  scan_enabled: boolean;
  effective: RetentionYears;
  floor: RetentionYears & {
    minor_clock_start_age: number | null;
    verified: boolean;
    source: string;
  };
  updated_at: string;
}

export interface RetentionScanRun {
  id: string;
  created_at: string;
  outcome: "OK" | "SKIPPED_DISABLED" | "FAILED";
  due_count: number;
  /** Days-ahead window (as a string key, e.g. "90") → records coming due within it. */
  forecast: Record<string, number>;
  batch: string | null;
  batch_reference: string | null;
  floor_verified: boolean;
  error: string;
}

export type ArchiveBatchStatus = "PENDING_APPROVAL" | "ARCHIVED" | "REJECTED";

export interface ArchiveBatch {
  id: string;
  reference: string;
  reason: "RETENTION_EXPIRED";
  status: ArchiveBatchStatus;
  item_count: number;
  archived_count: number;
  skipped_count: number;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
}

export interface ArchiveBatchItem {
  id: string;
  patient: string;
  patient_name: string;
  uhid_number: string;
  citramac_number: string;
  last_activity_at: string;
  retention_years: number;
  retention_ends_on: string;
  outcome: "PENDING" | "ARCHIVED" | "SKIPPED";
  skip_reason: string;
}

export interface ArchivedPatient {
  id: string;
  full_name: string;
  uhid_number: string;
  citramac_number: string;
  archived_at: string | null;
  archived_by_name: string | null;
  archive_reason: string;
  legal_hold: boolean;
}

/** GET /retention/patients/<id>/ — readable by any staff member (chart header). */
export interface PatientRetentionStatus {
  patient: string;
  state: "ACTIVE" | "ARCHIVED" | "LEGAL_HOLD" | "IN_CARE_OR_PENDING";
  archived_at: string | null;
  archive_reason: string;
  legal_hold: boolean;
  legal_hold_reason: string;
  retention_ends_on: string | null;
  retention_years?: number;
  last_activity_at?: string;
}

export interface PatientLifecycleEvent {
  action: "ARCHIVE" | "RESTORE" | "LEGAL_HOLD";
  timestamp: string;
  actor_name: string | null;
  detail: Record<string, unknown>;
}

export function getRetentionPlatformSettings(accessToken: string) {
  return apiRequest<RetentionPlatformSettings>("/retention/platform-settings/", { accessToken });
}

export function updateRetentionPlatformSettings(
  accessToken: string,
  payload: Partial<
    Pick<
      RetentionPlatformSettings,
      | "clinical_floor_years"
      | "mental_health_floor_years"
      | "financial_floor_years"
      | "minor_clock_start_age"
      | "floor_verified"
      | "floor_source"
      | "forecast_windows_days"
    >
  >,
) {
  return apiRequest<RetentionPlatformSettings>("/retention/platform-settings/", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function getRetentionPolicy(accessToken: string) {
  return apiRequest<OrganizationRetentionPolicy>("/retention/policy/", { accessToken });
}

export function updateRetentionPolicy(
  accessToken: string,
  payload: Partial<
    Pick<
      OrganizationRetentionPolicy,
      "clinical_years" | "mental_health_years" | "financial_years" | "scan_enabled"
    >
  >,
) {
  return apiRequest<OrganizationRetentionPolicy>("/retention/policy/", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function listRetentionScans(accessToken: string) {
  return apiRequest<Paginated<RetentionScanRun>>("/retention/scans/", { accessToken });
}

export function runRetentionScan(accessToken: string) {
  return apiRequest<RetentionScanRun>("/retention/scans/run/", { method: "POST", accessToken });
}

export function listArchiveBatches(accessToken: string, status?: ArchiveBatchStatus) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<Paginated<ArchiveBatch>>(`/retention/batches/${query}`, { accessToken });
}

export function listArchiveBatchItems(accessToken: string, batchId: string, page = 1) {
  return apiRequest<Paginated<ArchiveBatchItem>>(
    `/retention/batches/${batchId}/items/?page=${page}`,
    { accessToken },
  );
}

export function approveArchiveBatch(accessToken: string, batchId: string, note: string) {
  return apiRequest<ArchiveBatch>(`/retention/batches/${batchId}/approve/`, {
    method: "POST",
    body: { note },
    accessToken,
  });
}

export function rejectArchiveBatch(accessToken: string, batchId: string, note: string) {
  return apiRequest<ArchiveBatch>(`/retention/batches/${batchId}/reject/`, {
    method: "POST",
    body: { note },
    accessToken,
  });
}

export function listArchivedPatients(accessToken: string, q = "", page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  return apiRequest<Paginated<ArchivedPatient>>(`/retention/archived/?${params}`, {
    accessToken,
  });
}

export function getPatientRetentionStatus(accessToken: string, patientId: string) {
  return apiRequest<PatientRetentionStatus>(`/retention/patients/${patientId}/`, {
    accessToken,
  });
}

export function restorePatient(accessToken: string, patientId: string, reason: string) {
  return apiRequest<ArchivedPatient>(`/retention/patients/${patientId}/restore/`, {
    method: "POST",
    body: { reason },
    accessToken,
  });
}

export function setPatientLegalHold(
  accessToken: string,
  patientId: string,
  on: boolean,
  reason: string,
) {
  return apiRequest<ArchivedPatient>(`/retention/patients/${patientId}/legal-hold/`, {
    method: "POST",
    body: { on, reason },
    accessToken,
  });
}

export function getPatientLifecycleHistory(accessToken: string, patientId: string) {
  return apiRequest<PatientLifecycleEvent[]>(`/retention/patients/${patientId}/history/`, {
    accessToken,
  });
}
