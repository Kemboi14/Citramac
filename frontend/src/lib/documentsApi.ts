import { apiRequest } from "./apiClient";

// Mirrors backend/apps/documents (master prompt §6 Document Generation).
// Nothing here touches browser storage (CLAUDE.md §5).

export type DocStatus = "DRAFT" | "IN_REVIEW" | "SIGNED" | "RELEASED" | "FILED" | "BLOCKED_CONSENT";

export type DocAction =
  | "edit"
  | "submit"
  | "return"
  | "approve"
  | "sign"
  | "release"
  | "file"
  | "recheck_consent"
  | "amend";

export interface CatalogueCategory {
  code: string;
  name: string;
  count: number;
}

export interface TemplateSummary {
  documentId: string;
  name: string;
  category: string;
  categoryName: string;
  tags: string[];
  trigger: string;
  highRisk: boolean;
  contentStatus: "READY" | "VERIFY";
  recipientTypes: string[];
  can_generate: boolean;
}

export interface Catalogue {
  version: string;
  total: number;
  categories: CatalogueCategory[];
  results: TemplateSummary[];
  data_classes: { code: string; name: string }[];
  recipient_types: Record<string, string>;
  referral_destinations: Record<string, string[]>;
}

export interface UserField {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "datetime" | "valueset" | "classes" | "monitoring";
  required: boolean;
  valueset?: string;
}

export interface RecipientRule {
  label: string;
  external: boolean;
  consentType: string;
  defaultClasses: string[];
  authorizableClasses: string[];
  excludedClasses: string[];
  alternativeBases: string[];
}

export interface TemplateSpec {
  documentId: string;
  name: string;
  category: string;
  categoryName: string;
  tags: string[];
  trigger: string;
  autoPopulated: { key: string; class: string; label: string }[];
  userEntered: UserField[];
  conditionalRules: { id: string; rule: string }[];
  disclosureRules: {
    recipientTypes: string[];
    defaultRecipient: string;
    perRecipient: Record<string, RecipientRule>;
    neverDisclosed: string[];
    sensitiveClasses: string[];
    releaseBlockedWhen: string;
  };
  authorization: Record<string, unknown>;
  outputs: string[];
  filingAudit: Record<string, unknown>;
  highRisk: boolean;
  contentStatus: "READY" | "VERIFY";
  verifyNote: string;
  permissions: Record<"generate" | "review" | "approve" | "sign" | "release", boolean>;
}

export interface ContentItem {
  key: string;
  label: string;
  value: string | string[] | null;
  source: string;
  recorded_at: string | null;
  origin: string;
}

export interface MonitoringGroup {
  item_id: string;
  medication: string;
  indication: string;
  configured_codes: string[];
  codes: string[];
  latest_results?: string[];
}

export interface DocumentContent {
  title: string;
  template_id: string;
  category: string;
  organized_at: string;
  organizer: string;
  facility: Record<string, string | null>;
  author: { name: string | null; credentials: string | null };
  recipient: { type: string; type_label: string; name: string; organization: string };
  purpose: string;
  subject: ContentItem[];
  sections: { class: string; title: string; items: ContentItem[] }[];
  request: { key: string; label: string; value: string | string[] }[];
  monitoring: MonitoringGroup[];
  clinician_comment: string;
  legal_basis: string;
  legal_basis_reference: string;
  verify_notice: string;
}

export interface BlockInfo {
  rule: string;
  consent_type: string;
  message: string;
  prompt: string;
  missing_classes?: string[];
  alternative_bases?: string[];
}

export interface DynamicBlock {
  rule: string;
  destination?: string;
  recommended?: string[];
  available?: {
    item_id: string;
    medication: string;
    indication: string;
    configured_codes: string[];
  }[];
  groups?: MonitoringGroup[];
}

export interface DisclosureRow {
  id: string;
  document_number: string;
  version: number;
  template_id: string;
  recipient_type: string;
  recipient_name: string;
  recipient_organization: string;
  purpose: string;
  channel: string;
  legal_basis: string;
  legal_basis_reference: string;
  consent_record_id: string | null;
  classes_disclosed: string[];
  released_by: string;
  released_by_roles: string;
  released_at: string;
  content_hash: string;
}

export interface GeneratedDocumentRow {
  id: string;
  document_number: string;
  series_id: string;
  template_id: string;
  name: string;
  category: string;
  categoryName: string;
  version: number;
  status: DocStatus;
  status_label: string;
  patient_id: string;
  patient_name: string;
  recipient_type: string;
  recipient_name: string;
  recipient_organization: string;
  purpose: string;
  author: string;
  generated_at: string;
  signed_by: string;
  signed_at: string | null;
  high_risk: boolean;
  content_status: "READY" | "VERIFY";
}

export type DocInputs = Record<string, unknown>;

export interface GeneratedDocument extends GeneratedDocumentRow {
  episode_id: string | null;
  inputs: DocInputs;
  content: DocumentContent;
  rule_trace: { rule: string; fired: boolean; outcome: string; at: string }[];
  included_classes: string[];
  excluded_classes: { class: string; reason: string }[];
  security_labels: { confidentiality?: string; sensitivity?: string[]; note?: string };
  block: {
    missing?: string[];
    prompts?: string[];
    warnings?: string[];
    blocked?: BlockInfo | null;
    dynamic?: DynamicBlock[];
    required_fields?: string[];
  };
  blocked_from: string;
  consent_record_id: string | null;
  reviewed_by: string;
  reviewed_at: string | null;
  signer_credentials: string;
  content_hash: string;
  filed_at: string | null;
  correction_reason: string;
  supersedes_id: string | null;
  watermark: string;
  allowed_actions: DocAction[];
  user_fields: UserField[];
  disclosure_rules: Record<string, RecipientRule>;
  outputs: string[];
  verify_note: string;
  versions: { id: string; version: number; status: DocStatus; status_label: string }[];
  events: {
    id: string;
    action: string;
    from: string;
    to: string;
    actor: string;
    roles: string;
    at: string;
    reason: string;
  }[];
  disclosures: DisclosureRow[];
}

export interface ReleaseAuthorization {
  id: string;
  consent_type: string;
  consent_type_label: string;
  decision: string;
  decision_label: string;
  recipient: string;
  purpose: string;
  disclosure_scope: string[];
  valid_until: string | null;
  captured_at: string;
  captured_by: string;
  consent_text_version: string;
}

export function getDocumentCatalogue(accessToken: string, q = "", category = "") {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const query = params.toString();
  return apiRequest<Catalogue>(`/documents/catalogue/${query ? `?${query}` : ""}`, {
    accessToken,
  });
}

export function getDocumentTemplate(accessToken: string, templateId: string) {
  return apiRequest<TemplateSpec>(`/documents/catalogue/${encodeURIComponent(templateId)}/`, {
    accessToken,
  });
}

export function listGeneratedDocuments(accessToken: string, patientId?: string) {
  const query = patientId ? `?patient=${encodeURIComponent(patientId)}` : "";
  return apiRequest<{ results: GeneratedDocumentRow[] }>(`/documents/generated/${query}`, {
    accessToken,
  });
}

export interface GeneratePayload {
  template_id: string;
  patient_id: string;
  recipient_type: string;
  recipient_name: string;
  recipient_organization: string;
  purpose: string;
  inputs: DocInputs;
}

export function generateDocument(accessToken: string, payload: GeneratePayload) {
  return apiRequest<GeneratedDocument>(`/documents/generated/`, {
    method: "POST",
    accessToken,
    body: payload,
  });
}

export function getGeneratedDocument(accessToken: string, id: string) {
  return apiRequest<GeneratedDocument>(`/documents/generated/${id}/`, { accessToken });
}

export function editGeneratedDocument(
  accessToken: string,
  id: string,
  payload: Partial<Omit<GeneratePayload, "template_id" | "patient_id">>,
) {
  return apiRequest<GeneratedDocument>(`/documents/generated/${id}/`, {
    method: "PATCH",
    accessToken,
    body: payload,
  });
}

export function transitionDocument(
  accessToken: string,
  id: string,
  action: Exclude<DocAction, "edit">,
  extra: { reason?: string; channel?: string } = {},
) {
  return apiRequest<GeneratedDocument>(`/documents/generated/${id}/transition/`, {
    method: "POST",
    accessToken,
    body: { action, ...extra },
  });
}

export function listReleaseAuthorizations(accessToken: string, patientId: string) {
  return apiRequest<{ results: ReleaseAuthorization[] }>(
    `/documents/authorizations/?patient=${encodeURIComponent(patientId)}`,
    { accessToken },
  );
}

export interface AuthorizationPayload {
  patient_id: string;
  consent_type: string;
  decision: "YES" | "NO";
  recipient: string;
  purpose: string;
  disclosure_scope: string[];
  valid_until: string;
  evidence: string;
}

export function recordReleaseAuthorization(accessToken: string, payload: AuthorizationPayload) {
  return apiRequest<ReleaseAuthorization>(`/documents/authorizations/`, {
    method: "POST",
    accessToken,
    body: payload,
  });
}
