import { apiDownload, apiRequest } from "./apiClient";
import type { BillingOverview } from "./carePathwayApi";

// Client record → Billing stage: payer claims, pre-authorisation, invoice and
// payments. Mirrors apps/insurance_claims/workspace.py; every write returns the
// whole refreshed workspace so the screen never computes money itself.

export interface ChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ClaimPreauth {
  id: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED";
  status_label: string;
  approval_reference: string;
  /** SHA's own pre-authorisation state word, as posted by SHA. Blank for other payers. */
  sha_state: string;
}

export interface ClaimLine {
  id: string;
  charge_item: string;
  service: string;
  quantity: number;
  unit_price: string;
  amount: string;
  /** Blank when the payer has no code configured for the service. */
  payer_code: string;
  /** null: payer code not configured, so the requirement is unknown. */
  requires_preauth: boolean | null;
  pre_authorization: ClaimPreauth | null;
  /** The line is on SHA's copy of the visit claim. */
  sent_to_sha: boolean;
}

export interface ClaimHistoryEntry {
  status: string;
  at: string;
  by: string;
  note: string;
}

export interface ClaimAttachment {
  id: string;
  category: string;
  label: string;
  /** One of the client's filed documents (client registry attachment). */
  file: { id: string; name: string } | null;
  /** SHA document type (from `sha.document_types`); blank when not labelled. */
  sha_document_type: string;
  intervention_code: string;
  sent_to_sha: boolean;
}

export type ShaVisitStatus = "AWAITING_CONSENT" | "OPEN" | "SUBMITTED" | "CLOSED" | "REJECTED";

export interface ShaVisitIntervention {
  code: string;
  /** Blank when the intervention is not in the cached SHA catalogue. */
  name: string;
  needs_preauth: boolean | null;
  payment_mechanism: string;
  applicable_document_types: string[];
}

/** A consented SHA visit (apps.insurance_claims.sha_claims.visit_data). */
export interface ShaVisit {
  id: string;
  branch: { id: string; name: string; fr_code: string };
  cr_id: string;
  service_type: string;
  consent_method: "OTP" | "BIOMETRIC";
  status: ShaVisitStatus;
  status_label: string;
  intervention_codes: string[];
  interventions: ShaVisitIntervention[];
  authorization_state: string;
  authorization_reason: string;
  /** SHA rejected fingerprint consent but allows the OTP path instead. */
  otp_fallback_allowed: boolean;
  /** Fingerprint capture page — only while AWAITING_CONSENT; valid 10 minutes. */
  biometric_capture_url: string;
  consent_token: string;
  workflow_state: string;
  payer_workflow_state: string;
  opened_at: string | null;
  closed_at: string | null;
  status_history: { state: string; at: string; by: string; note: string }[];
}

export interface ShaEligibilityScheme {
  name: string;
  member_type: string;
  coverage_status: string;
  coverage_message: string;
  coverage_reason: string;
  possible_solution: string;
  coverage_end: string;
  policy_number: string;
}

export interface ShaEligibility {
  id: string;
  checked_at: string;
  identification_type: string;
  found: boolean;
  active: boolean;
  /** False until the facility configures which SHA coverage words mean "active". */
  active_rule_configured: boolean;
  is_alive: boolean | null;
  member_cr_number: string;
  whitelisted_for_otp: boolean | null;
  biometrics_enforced: boolean | null;
  pomsf: boolean;
  status_code: string;
  status_desc: string;
  schemes: ShaEligibilityScheme[];
}

export interface ShaBranch {
  id: string;
  name: string;
  fr_code: string;
}

/** Billing stage SHA section — present only for SHA-payer clients. Every enum
 * list is DHA's published value set, offered exactly as given. */
export interface ShaSection {
  cr_id: string | null;
  eligibility: ShaEligibility | null;
  visits: ShaVisit[];
  branches: ShaBranch[];
  service_types: string[];
  outpatient_discharge_reasons: string[];
  inpatient_discharge_reasons: string[];
  close_reasons: string[];
  otp_whitelist_reasons: string[];
  document_types: string[];
}

export interface PayerClaim {
  id: string;
  claim_number: string;
  payer: string;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "RETURNED"
    | "APPROVED"
    | "PARTIALLY_APPROVED"
    | "REJECTED";
  status_label: string;
  timeline_stage: number;
  total_claimed_amount: string;
  approved_amount: string | null;
  guarantor: string;
  submitted_at: string | null;
  adjudicated_at: string | null;
  status_history: ClaimHistoryEntry[];
  diagnoses: { system: string; code: string; is_primary: boolean }[];
  lines: ClaimLine[];
  attachments: ClaimAttachment[];
  sha_visit: ShaVisit | null;
  /** SHA document types the visit's interventions require that no attachment carries yet. */
  sha_missing_documents: string[];
  checklist: ChecklistItem[];
  remittances: { id: string; amount: string; reference: string; date: string }[];
}

export interface ClientInvoice {
  id: string;
  number: string;
  version: number;
  created_at: string;
  total: string;
  lines: { service: string; quantity: number; amount: string }[];
  /** Documented services changed since this invoice was issued. */
  stale: boolean;
}

export interface ClientPayment {
  id: string;
  amount: string;
  method: string;
  method_label: string;
  reference: string;
  paid_at: string;
  received_by: string;
}

export interface Option {
  value: string;
  label: string;
}

export interface BillingWorkspace {
  can_edit: boolean;
  currency: string;
  payer: {
    code: string;
    label: string;
    claimable: boolean;
    claim_payer: string | null;
    coverage: { scheme: string; verified: boolean; member_status: string } | null;
  };
  overview: BillingOverview;
  totals: { services: string; paid: string; outstanding: string };
  unclaimed_charges: string[];
  claims: PayerClaim[];
  invoice: ClientInvoice | null;
  payments: ClientPayment[];
  payment_methods: Option[];
  attachment_categories: Option[];
  excluded_attachment_categories: string[];
  timeline: string[];
  package_ceiling: null;
  emergency_fund_routing: null;
  sha: ShaSection | null;
}

const base = (patientId: string) => `/claims/clients/${patientId}/billing`;

export function getBillingWorkspace(accessToken: string, patientId: string) {
  return apiRequest<BillingWorkspace>(`${base(patientId)}/`, { accessToken });
}

export function createClaim(accessToken: string, patientId: string) {
  return apiRequest<BillingWorkspace>(`${base(patientId)}/claims/`, {
    method: "POST",
    body: {},
    accessToken,
  });
}

export function issueInvoice(accessToken: string, patientId: string) {
  return apiRequest<BillingWorkspace>(`${base(patientId)}/invoice/`, {
    method: "POST",
    body: {},
    accessToken,
  });
}

export interface PaymentInput {
  amount: string;
  method: string;
  reference: string;
  claim?: string;
  idempotency_key: string;
}

export function recordClientPayment(accessToken: string, patientId: string, input: PaymentInput) {
  return apiRequest<BillingWorkspace>(`${base(patientId)}/payments/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function downloadBillingCsv(accessToken: string, patientId: string) {
  return apiDownload(`${base(patientId)}/export/`, accessToken);
}

export function updateClaimGuarantor(accessToken: string, claimId: string, guarantor: string) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/`, {
    method: "PATCH",
    body: { guarantor },
    accessToken,
  });
}

/** SHA claims only: how the visit is discharged when the claim is dispatched. */
export interface ShaSubmitInput {
  discharge_reason: string;
  otp?: string;
  /** Fingerprint discharge authorisation — sent instead of an OTP. */
  discharge_auth_guid?: string;
  /** Outpatient (non-inpatient) visits only. */
  discharge_status?: "FULL" | "PARTIAL";
  notes?: string;
}

export function submitClaim(
  accessToken: string,
  claimId: string,
  linesChecked: boolean,
  sha?: ShaSubmitInput,
) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/submit/`, {
    method: "POST",
    body: sha ? { lines_checked: linesChecked, sha } : { lines_checked: linesChecked },
    accessToken,
  });
}

export function recordClaimStatus(
  accessToken: string,
  claimId: string,
  input: { status: string; approved_amount?: string; note?: string },
) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/status/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function removeClaimLine(accessToken: string, claimId: string, lineId: string) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/lines/${lineId}/`, {
    method: "DELETE",
    accessToken,
  });
}

/** SHA pre-authorisation needs the service window (ISO datetimes) and the email SHA notifies. */
export interface ShaPreauthInput {
  service_start: string;
  service_end: string;
  notification_email: string;
}

export function requestLinePreauth(
  accessToken: string,
  claimId: string,
  lineId: string,
  sha?: ShaPreauthInput,
) {
  return apiRequest<BillingWorkspace>(
    `/claims/billing-claims/${claimId}/lines/${lineId}/preauth/`,
    { method: "POST", body: sha ?? {}, accessToken },
  );
}

export function recordPreauthDecision(
  accessToken: string,
  preauthId: string,
  input: { status: string; approval_reference: string; note?: string },
) {
  return apiRequest<BillingWorkspace>(`/claims/billing-preauths/${preauthId}/decision/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function addClaimAttachment(
  accessToken: string,
  claimId: string,
  category: string,
  sha?: { file: string; sha_document_type: string; intervention_code?: string },
) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/attachments/`, {
    method: "POST",
    body: sha ? { category, ...sha } : { category },
    accessToken,
  });
}

export function removeClaimAttachment(accessToken: string, claimId: string, attachmentId: string) {
  return apiRequest<BillingWorkspace>(
    `/claims/billing-claims/${claimId}/attachments/${attachmentId}/`,
    { method: "DELETE", accessToken },
  );
}

// ── SHA through the DHA HIE (apps.insurance_claims sha_* views) ──
// Writes return the whole refreshed workspace unless noted. Errors carry the
// HIE's own words (often with a trace id) in `error.message` — show it as is.

const sha = (patientId: string) => `/claims/clients/${patientId}/sha`;

export function checkShaEligibility(accessToken: string, patientId: string, branch: string) {
  return apiRequest<BillingWorkspace>(`${sha(patientId)}/eligibility/`, {
    method: "POST",
    body: { branch },
    accessToken,
  });
}

export interface ShaIntervention {
  code: string;
  name: string;
  benefit_code: string;
  parent_benefit_code: string;
  parent_benefit_name: string;
  access_point: string;
  payment_mechanism: string;
  fund: string;
  needs_preauth: boolean;
  needs_manual_preauth_approval: boolean;
  applicable_document_types: string[];
  required_preauth_document_types: string[];
  levels_applicable: string[];
  overall_tariff: string | number | null;
  active: boolean | null;
}

export interface ShaInterventionPage {
  count: number;
  page: number;
  total_pages: number;
  results: ShaIntervention[];
}

/** Not the workspace: one page of SHA's intervention catalogue for the branch. */
export function searchShaInterventions(
  accessToken: string,
  patientId: string,
  params: { branch: string; search?: string; code?: string; page?: number },
) {
  const query = new URLSearchParams({ branch: params.branch });
  if (params.search) query.set("search", params.search);
  if (params.code) query.set("code", params.code);
  if (params.page) query.set("page", String(params.page));
  return apiRequest<ShaInterventionPage>(`${sha(patientId)}/interventions/?${query.toString()}`, {
    accessToken,
  });
}

export interface ShaContact {
  id: string;
  type: string;
  /** Masked by SHA. */
  value: string;
  confirmed: boolean;
  active: boolean;
}

export function listShaContacts(accessToken: string, patientId: string, branch: string) {
  return apiRequest<{ contacts: ShaContact[] }>(
    `${sha(patientId)}/contacts/?${new URLSearchParams({ branch }).toString()}`,
    { accessToken },
  );
}

/** Sends the visit OTP to the client → `{message}`. */
export function sendShaVisitOtp(
  accessToken: string,
  patientId: string,
  input: { branch: string; intervention_codes: string[]; contact_id?: string },
) {
  return apiRequest<{ message: string }>(`${sha(patientId)}/otp/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export type OpenShaVisitInput =
  | {
      consent_method: "OTP";
      branch: string;
      service_type: string;
      intervention_codes: string[];
      otp: string;
    }
  | {
      consent_method: "BIOMETRIC";
      branch: string;
      service_type: string;
      intervention_codes: string[];
      /** The biometrics agent's national ID — sent to SHA, not stored. */
      agent_id: string;
      work_station_id: string;
      device_os: "windows" | "android";
    };

export function openShaVisit(accessToken: string, patientId: string, input: OpenShaVisitInput) {
  return apiRequest<BillingWorkspace>(`${sha(patientId)}/visits/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function requestShaOtpWhitelist(
  accessToken: string,
  patientId: string,
  input: { branch: string; reason_type: string; reason: string; biometric_attempts: number },
) {
  return apiRequest<BillingWorkspace>(`${sha(patientId)}/otp-whitelist/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

export function refreshShaVisit(accessToken: string, visitId: string) {
  return apiRequest<BillingWorkspace>(`/claims/sha-visits/${visitId}/refresh/`, {
    method: "POST",
    body: {},
    accessToken,
  });
}

export function cancelShaVisit(accessToken: string, visitId: string) {
  return apiRequest<BillingWorkspace>(`/claims/sha-visits/${visitId}/cancel/`, {
    method: "POST",
    body: {},
    accessToken,
  });
}

export function closeShaVisit(
  accessToken: string,
  visitId: string,
  input: { reason_type: string; reason_text: string },
) {
  return apiRequest<BillingWorkspace>(`/claims/sha-visits/${visitId}/close/`, {
    method: "POST",
    body: input,
    accessToken,
  });
}

const claimSha = (claimId: string, action: string) =>
  `/claims/billing-claims/${claimId}/sha/${action}/`;

export function billClaimAgainstVisit(accessToken: string, claimId: string, visit: string) {
  return apiRequest<BillingWorkspace>(claimSha(claimId, "visit"), {
    method: "POST",
    body: { visit },
    accessToken,
  });
}

/** Push lines, diagnoses and documents to SHA's copy of the claim now. */
export function syncShaClaim(accessToken: string, claimId: string) {
  return apiRequest<BillingWorkspace>(claimSha(claimId, "sync"), {
    method: "POST",
    body: {},
    accessToken,
  });
}

/** → `{message}`. */
export function sendShaDischargeOtp(accessToken: string, claimId: string) {
  return apiRequest<{ message: string }>(claimSha(claimId, "discharge-otp"), {
    method: "POST",
    body: {},
    accessToken,
  });
}

/** → `{preview}`: SHA's own preview object, as returned by the HIE. */
export function previewShaClaim(accessToken: string, claimId: string) {
  return apiRequest<{ preview: unknown }>(claimSha(claimId, "preview"), {
    method: "POST",
    body: {},
    accessToken,
  });
}

/** Payer status and pre-authorisation decisions from SHA. */
export function refreshShaClaim(accessToken: string, claimId: string) {
  return apiRequest<BillingWorkspace>(claimSha(claimId, "refresh"), {
    method: "POST",
    body: {},
    accessToken,
  });
}

export function resubmitShaClaim(accessToken: string, claimId: string) {
  return apiRequest<BillingWorkspace>(claimSha(claimId, "resubmit"), {
    method: "POST",
    body: {},
    accessToken,
  });
}

export interface ShaRemittanceStatement {
  id: string;
  kind: string;
  kind_label: string;
  bank_reference: string;
  fetched_at: string;
  /** Kept exactly as the HIE returned it — DHA has not published its shape. */
  body: unknown;
}

export function listShaRemittances(accessToken: string) {
  return apiRequest<{ statements: ShaRemittanceStatement[] }>("/claims/sha-remittances/", {
    accessToken,
  });
}

export function fetchShaRemittance(
  accessToken: string,
  input: { branch: string; bank_reference?: string },
) {
  return apiRequest<ShaRemittanceStatement>("/claims/sha-remittances/", {
    method: "POST",
    body: input,
    accessToken,
  });
}
