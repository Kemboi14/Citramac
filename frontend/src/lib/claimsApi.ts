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
}

export interface ClaimHistoryEntry {
  status: string;
  at: string;
  by: string;
  note: string;
}

export interface PayerClaim {
  id: string;
  claim_number: string;
  payer: string;
  status: "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED";
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
  attachments: { id: string; category: string; label: string }[];
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

export function submitClaim(accessToken: string, claimId: string, linesChecked: boolean) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/submit/`, {
    method: "POST",
    body: { lines_checked: linesChecked },
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

export function requestLinePreauth(accessToken: string, claimId: string, lineId: string) {
  return apiRequest<BillingWorkspace>(
    `/claims/billing-claims/${claimId}/lines/${lineId}/preauth/`,
    { method: "POST", body: {}, accessToken },
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

export function addClaimAttachment(accessToken: string, claimId: string, category: string) {
  return apiRequest<BillingWorkspace>(`/claims/billing-claims/${claimId}/attachments/`, {
    method: "POST",
    body: { category },
    accessToken,
  });
}

export function removeClaimAttachment(accessToken: string, claimId: string, attachmentId: string) {
  return apiRequest<BillingWorkspace>(
    `/claims/billing-claims/${claimId}/attachments/${attachmentId}/`,
    { method: "DELETE", accessToken },
  );
}
