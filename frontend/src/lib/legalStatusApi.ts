import { apiDownload, apiRequest } from "./apiClient";

/** Legal admission status — master prompt §7A (LGL-*). Statutory wording comes from
 * the server's versioned jurisdiction config and is rendered verbatim. */

export type LegalCategory = "VOLUNTARY" | "INVOLUNTARY";

export interface LegalBanner {
  id: string;
  category: LegalCategory;
  status: string;
  decision: string;
  label: string;
  max_expiry_at: string | null;
  pending_conversion: boolean;
  notice: { given_at: string; earliest_departure_at: string; notice_period_hours: number } | null;
}

export interface ConfigText {
  text: string;
  verbatim?: boolean;
  note?: string;
}

export interface LegalDocumentRow {
  id: string;
  document_number: string;
  template_id: string;
  title: string;
  version: number;
  status: "DRAFT" | "SIGNED";
  supersedes: string | null;
  superseded: boolean;
  amendment_reason: string;
  application: string | null;
  content: Record<string, unknown>;
  signer_kind: string;
  signer_name: string;
  signature_method: string;
  signed_at: string | null;
  captured_by: string;
  created_by: string;
  created_at: string;
  examination_encounter_id: string | null;
}

export interface EvidenceItem {
  label: string;
  value: string;
  source: string;
  record: string;
  recorded_at: string | null;
  recorded_by: string;
}

export interface RelatedPersonRow {
  id: string;
  name: string;
  relationship: string;
  relationship_detail: string;
  phone: string;
  address: string;
  id_number_masked: string;
  id_number_present: boolean;
  is_guardian: boolean;
}

/** The only regulators the DHA Health Worker Registry accepts a lookup for. */
export const HWR_REGULATORS = ["KMPDC", "COC", "NCK", "PPB"] as const;
export type HwrRegulator = "" | (typeof HWR_REGULATORS)[number];

/** The Health Worker Registry's record for a practitioner, as last checked — the registry's own words. */
export interface HealthWorkerRegistrySummary {
  /** False with a `checked_at` means the registry had no record for the number. */
  found: boolean;
  checked_at: string | null;
  full_name: string;
  registration_id: string;
  licensing_body: string;
  is_active: boolean | null;
  cadre: string;
  specialty: string;
  licenses: { type: string; start: string; end: string }[];
  /** Practitioner Unique Identifier, typed by a person from the registry record — never derived. */
  puid: string;
}

export interface Credential {
  name: string;
  registration_number: string;
  registration_body: string;
  registration_verified_at: string | null;
  qualifications: string;
  mha_recommendation_approved: boolean;
  hwr_regulator: HwrRegulator;
  /** Null when no credential has been recorded for this practitioner. */
  health_worker_registry: HealthWorkerRegistrySummary | null;
  nacada: NacadaCredential;
  can_sign: boolean;
  reason: string;
}

/** NACADA accreditation / licence held by the practitioner. */
export interface NacadaCredential {
  number: string;
  /** As written on the certificate — NACADA's category list is not encoded here (VERIFY). */
  category: string;
  issued_on: string | null;
  expires_on: string | null;
  verified_at: string | null;
  verified_by: string;
  has_evidence: boolean;
  status: "UNVERIFIED" | "EXPIRED" | "EXPIRING" | "VALID" | null;
}

export interface NacadaUpdate {
  number?: string;
  category?: string;
  issued_on?: string | null;
  expires_on?: string | null;
  verified?: boolean;
}

export interface CredentialUpdate {
  registration_number?: string;
  registration_body?: string;
  qualifications?: string;
  registration_verified?: boolean;
  mha_recommendation_approved?: boolean;
  hwr_regulator?: HwrRegulator;
  hwr_puid?: string;
  nacada?: NacadaUpdate;
  /** Runs the Health Worker Registry lookup after saving the other fields. */
  check_registry?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LegalWorkspace {
  config: {
    version: string;
    provenance: string;
    forms: Record<string, any>;
    statutes: Record<string, { act: string; section: string; versionLabel: string }>;
    operational: Record<string, number>;
    rights: {
      formStatement: ConfigText;
      text: string;
      status: string;
      notConfiguredLabel: string;
      taskLabel: string;
    };
    privacy: { maskIdentityNumbers: boolean };
  };
  episode_id: string | null;
  legal_status: null | {
    id: string;
    category: LegalCategory;
    status: string;
    workflow_state: string;
    decision: "PENDING" | "ADMITTED" | "REJECTED";
    decision_by: string;
    decision_role: string;
    decision_at: string | null;
    decision_reason: string;
    effective_from: string | null;
    max_expiry_at: string | null;
    statutory_basis: { key: string; act: string; section: string; versionLabel: string }[];
    config_version: string;
    application_document: string | null;
    pending_application: string | null;
    recommendation_document_ids: string[];
    required_recommendations: number;
  };
  banner: LegalBanner | null;
  documents: LegalDocumentRow[];
  notice: null | {
    id: string;
    given_at: string;
    given_to: string;
    earliest_departure_at: string;
    notice_period_hours: number;
    written_notice_document: string;
    risk_review_required: boolean;
    risk_review_prompt: string;
  };
  tasks: {
    id: string;
    code: string;
    label: string;
    priority: string;
    due_at: string | null;
    assignee: string;
    owner: string;
    completed_at: string | null;
    completed_by: string;
  }[];
  history: {
    event: string;
    from_state: string;
    to_state: string;
    actor: string;
    actor_role: string;
    at: string;
    detail: Record<string, unknown>;
  }[];
  client: {
    full_name: string;
    address: string;
    id_kind: string;
    id_number_masked: string;
    id_number_present: boolean;
    gender: string;
    gender_form: string;
    gender_other_detail: string;
    pronoun: string;
    age: number | null;
  };
  related_persons: RelatedPersonRow[];
  next_of_kin_id: string | null;
  facility: Record<string, string>;
  evidence: Record<string, EvidenceItem[]>;
  capacity: {
    required: boolean;
    text: string;
    reasons: string[];
    confirmation: { outcome: string; assessed_at: string; assessed_by: string } | null;
  };
  encounters: { id: string; type: string; opened_at: string }[];
  me: { is_admitting_officer: boolean; can_unmask: boolean; credential: Credential };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function getPractitionerCredential(accessToken: string, userId: string) {
  return apiRequest<Credential>(`/care/legal/practitioners/${userId}/credential/`, { accessToken });
}

export function uploadNacadaEvidence(accessToken: string, userId: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  return apiRequest<Credential>(
    `/care/legal/practitioners/${userId}/credential/nacada-evidence/`,
    { method: "POST", body, accessToken },
  );
}

export function downloadNacadaEvidence(accessToken: string, userId: string) {
  return apiDownload(`/care/legal/practitioners/${userId}/credential/nacada-evidence/`, accessToken);
}

export function updatePractitionerCredential(
  accessToken: string,
  userId: string,
  body: CredentialUpdate,
) {
  return apiRequest<Credential>(`/care/legal/practitioners/${userId}/credential/`, {
    method: "PUT",
    body,
    accessToken,
  });
}

export function getLegalWorkspace(accessToken: string, patientId: string) {
  return apiRequest<LegalWorkspace>(`/care/clients/${patientId}/legal-status/`, { accessToken });
}

export function startLegalApplication(accessToken: string, patientId: string, category: LegalCategory) {
  return apiRequest<LegalDocumentRow>(`/care/clients/${patientId}/legal-status/applications/`, {
    method: "POST",
    accessToken,
    body: { category },
  });
}

export function saveLegalDraft(accessToken: string, docId: string, body: Record<string, unknown>) {
  return apiRequest<LegalDocumentRow>(`/care/legal/documents/${docId}/`, {
    method: "PUT",
    accessToken,
    body,
  });
}

export function signLegalDocument(accessToken: string, docId: string, body: Record<string, unknown>) {
  return apiRequest<LegalDocumentRow>(`/care/legal/documents/${docId}/sign/`, {
    method: "POST",
    accessToken,
    body,
  });
}

export function amendLegalDocument(accessToken: string, docId: string, reason: string) {
  return apiRequest<LegalDocumentRow>(`/care/legal/documents/${docId}/amend/`, {
    method: "POST",
    accessToken,
    body: { reason },
  });
}

export function startRecommendation(accessToken: string, applicationId: string) {
  return apiRequest<LegalDocumentRow>(`/care/legal/documents/${applicationId}/recommendations/`, {
    method: "POST",
    accessToken,
  });
}

export function recordLegalDecision(
  accessToken: string,
  legalStatusId: string,
  decision: "ADMITTED" | "REJECTED",
  reason: string,
) {
  return apiRequest<LegalBanner>(`/care/legal/${legalStatusId}/decision/`, {
    method: "POST",
    accessToken,
    body: { decision, reason },
  });
}

export function endInvoluntary(accessToken: string, legalStatusId: string, reason: string) {
  return apiRequest<LegalBanner>(`/care/legal/${legalStatusId}/end/`, {
    method: "POST",
    accessToken,
    body: { reason },
  });
}

export function giveDischargeNotice(accessToken: string, legalStatusId: string, body: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`/care/legal/${legalStatusId}/notices/`, {
    method: "POST",
    accessToken,
    body,
  });
}

export function withdrawDischargeNotice(accessToken: string, noticeId: string) {
  return apiRequest<{ id: string }>(`/care/legal/notices/${noticeId}/withdraw/`, {
    method: "POST",
    accessToken,
  });
}

export function recordNoticeDeparture(accessToken: string, noticeId: string) {
  return apiRequest<{ admission_id: string | null; against_medical_advice: boolean }>(
    `/care/legal/notices/${noticeId}/depart/`,
    { method: "POST", accessToken },
  );
}

export function completeLegalTask(accessToken: string, taskId: string) {
  return apiRequest<{ id: string }>(`/care/legal/tasks/${taskId}/complete/`, {
    method: "POST",
    accessToken,
  });
}

/** LGL-DOC-06: one unmasked identity number; the server logs every call. */
export function unmaskIdentity(
  accessToken: string,
  legalStatusId: string,
  subject: "client" | "applicant",
  relatedPersonId?: string,
) {
  const q = new URLSearchParams({ subject, ...(relatedPersonId ? { related_person_id: relatedPersonId } : {}) });
  return apiRequest<{ value: string }>(`/care/legal/${legalStatusId}/identity/?${q}`, { accessToken });
}

/** The printable form (server-rendered HTML), held in memory only. */
export function fetchLegalPrint(accessToken: string, docId: string) {
  return apiDownload(`/care/legal/documents/${docId}/print/`, accessToken);
}
