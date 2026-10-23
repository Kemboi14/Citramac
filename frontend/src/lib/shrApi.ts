import { apiRequest } from "./apiClient";

// Mirrors backend/apps/dha_interop (views.py PatientShrView / ShrConsentActionView,
// shr.py) — the DHA national Shared Health Record. Care team only: every call
// 403s for anyone without full access to the client. Sending is irreversible —
// once a bundle is in the national record it cannot be recalled — so the UI
// always previews first. Nothing here touches browser storage (CLAUDE.md §5).

export type ShrVisitType = "OP" | "IP";
export type ShrConsentStatus = "PENDING" | "APPROVED" | "REJECTED" | "CLOSING" | "CLOSED";

/** DHA's published representative relationships, offered exactly as given. */
export const REPRESENTATIVE_RELATIONSHIPS = [
  "Healthcare Proxy",
  "Sibling",
  "Principal",
  "Other",
] as const;

/** Resource types the backend lets a care team member read from the national record. */
export const SHR_READABLE_RESOURCES = [
  "Encounter",
  "EpisodeOfCare",
  "Observation",
  "Condition",
  "Procedure",
  "Medication",
  "MedicationRequest",
  "MedicationDispense",
  "MedicationAdministration",
  "Immunization",
  "ServiceRequest",
  "AllergyIntolerance",
] as const;

/** One FHIR OperationOutcome issue returned for a send. */
export interface ShrIssue {
  severity?: string;
  code?: string;
  expression?: string[] | string;
  diagnostics?: string;
}

export interface ShrSend {
  id: string;
  status: string;
  status_label: string;
  detail: string;
  issues: ShrIssue[];
  at: string;
}

export interface ShrConsent {
  id: string;
  branch: { id: string; name: string };
  episode: string;
  visit_type: ShrVisitType;
  status: ShrConsentStatus;
  status_label: string;
  emergency: boolean;
  representative_cr_id: string;
  rejection_reason: string;
  visit_id: string;
  detail: string;
  requested_at: string;
  decided_at: string | null;
  closed_at: string | null;
  sends: ShrSend[];
}

export interface ShrPreview {
  bundle: Record<string, unknown> | null;
  omissions: string[];
  problems: string[];
  substance_use: boolean;
  resources: { type: string; id: string }[];
}

/** A FHIR searchset bundle, as DHA returns it — only the parts the table reads are typed. */
export interface ShrSearchset {
  resourceType?: string;
  total?: number;
  entry?: { fullUrl?: string; resource?: Record<string, unknown> }[];
  [key: string]: unknown;
}

export interface RequestShrConsentPayload {
  branch: string;
  episode: string;
  visit_type: ShrVisitType;
  emergency?: boolean;
  incapacity_reason?: string;
  patient_capable?: boolean;
  representative_cr_id?: string;
  representative_relationship?: string;
}

export function listShrConsents(accessToken: string, patientId: string) {
  return apiRequest<{ consents: ShrConsent[] }>(`/shr/clients/${patientId}/`, { accessToken });
}

/** Opens an SHR visit by asking the client (usually by OTP) to consent. */
export function requestShrConsent(
  accessToken: string,
  patientId: string,
  payload: RequestShrConsentPayload,
) {
  return apiRequest<ShrConsent>(`/shr/clients/${patientId}/`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

function consentAction<T = ShrConsent>(
  accessToken: string,
  consentId: string,
  action: string,
  body: Record<string, unknown> = {},
) {
  return apiRequest<T>(`/shr/consents/${consentId}/${action}/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export const verifyShrConsent = (accessToken: string, consentId: string, otp: string) =>
  consentAction(accessToken, consentId, "verify", { otp });

/** Records the client's refusal — a refusal is kept, not dropped. */
export const refuseShrConsent = (
  accessToken: string,
  consentId: string,
  rejectionReason: string,
  otp?: string,
) =>
  consentAction(accessToken, consentId, "refuse", {
    rejection_reason: rejectionReason,
    ...(otp ? { otp } : {}),
  });

export const resendShrOtp = (accessToken: string, consentId: string) =>
  consentAction(accessToken, consentId, "resend-otp");

export const refreshShrToken = (accessToken: string, consentId: string) =>
  consentAction(accessToken, consentId, "refresh");

export const closeShrVisit = (
  accessToken: string,
  consentId: string,
  body: { patient_incapable?: boolean; incapacity_reason?: string } = {},
) => consentAction(accessToken, consentId, "close", body);

export const previewShrSend = (accessToken: string, consentId: string) =>
  consentAction<ShrPreview>(accessToken, consentId, "preview");

/** Irreversible: the bundle enters the national record and cannot be recalled. */
export const sendShrVisit = (accessToken: string, consentId: string) =>
  consentAction(accessToken, consentId, "send");

export const readShrRecords = (accessToken: string, consentId: string, resources: string[]) =>
  consentAction<{ records: ShrSearchset }>(accessToken, consentId, "records", { resources });
