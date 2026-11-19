import { apiDownload, apiRequest, ApiError } from "./apiClient";

// Mirrors apps/client_registry's Attachment — global document manager +
// Document Insights, from mockups/citramac_clinical_workspace.html.

// Matches the backend's settings.UPLOAD_MAX_SIZE_BYTES — checked client-side
// too so a too-large file is rejected instantly, not after a full upload
// round-trip.
export const ATTACHMENT_MAX_SIZE_BYTES = 30 * 1024 * 1024;

export interface Paginated<T> {
  count: number;
  results: T[];
}

export type AttachmentCategory =
  | "IDENTITY"
  | "CLINICAL"
  | "ASSESSMENT"
  | "REFERRAL"
  | "LAB_RESULT"
  | "IMAGING"
  | "CONSENT"
  | "CORRESPONDENCE"
  | "OTHER";
export type AttachmentStatus = "ACTIVE" | "ARCHIVED";

export interface Attachment {
  id: string;
  patient: string;
  patient_name: string;
  admission: string | null;
  /** The name shown and used for a copy (never the storage path). */
  name: string;
  content_type: string;
  /** Set when the file is a copy of a statutory admission form. */
  legal_document: string | null;
  /** What this user can do with a copy (Org Admin approval, owner 2026-11-19). */
  access: AttachmentAccess | null;
  file_size: number | null;
  classification: "HISTORICAL" | "CURRENT";
  category: AttachmentCategory;
  document_type: string;
  document_date: string | null;
  tags: string[];
  is_favorite: boolean;
  doc_status: AttachmentStatus;
  description: string;
  uploaded_by: string | null;
  uploaded_by_name: string;
  uploaded_at: string;
}

export function listAttachments(
  accessToken: string,
  params?: {
    patient?: string;
    admission?: string;
    category?: AttachmentCategory;
    status?: AttachmentStatus;
    q?: string;
  },
) {
  const query = new URLSearchParams();
  if (params?.patient) query.set("patient", params.patient);
  if (params?.admission) query.set("admission", params.admission);
  if (params?.category) query.set("category", params.category);
  if (params?.status) query.set("status", params.status);
  if (params?.q) query.set("q", params.q);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<Paginated<Attachment>>(`/attachments/${suffix}`, { accessToken });
}

export function uploadAttachment(
  accessToken: string,
  payload: {
    patient: string;
    admission?: string;
    file: File;
    classification: "HISTORICAL" | "CURRENT";
    category: AttachmentCategory;
    document_type?: string;
    document_date?: string;
    description?: string;
  },
) {
  if (payload.file.size > ATTACHMENT_MAX_SIZE_BYTES) {
    throw new ApiError(400, {
      error: { code: "FILE_TOO_LARGE", message: "File must be 30MB or smaller." },
    });
  }
  const body = new FormData();
  body.set("patient", payload.patient);
  if (payload.admission) body.set("admission", payload.admission);
  body.set("file", payload.file);
  body.set("classification", payload.classification);
  body.set("category", payload.category);
  if (payload.document_type) body.set("document_type", payload.document_type);
  if (payload.document_date) body.set("document_date", payload.document_date);
  if (payload.description) body.set("description", payload.description);
  return apiRequest<Attachment>("/attachments/", { method: "POST", body, accessToken });
}

export type AttachmentAccess =
  | { download: "direct" }
  | { download: "request" }
  | { download: "pending"; requested_at: string }
  | { download: "approved"; expires_at: string }
  | { download: "declined"; reason: string };

/** The file to show in the page (inline). Audited. */
export function previewAttachment(accessToken: string, id: string) {
  return apiDownload(`/attachments/${id}/preview/`, accessToken);
}

/** A copy to download or print: Org Admin directly, anyone else once per approval. */
export function downloadAttachment(accessToken: string, id: string) {
  return apiDownload(`/attachments/${id}/download/`, accessToken);
}

export function requestAttachmentDownload(accessToken: string, id: string, reason: string) {
  return apiRequest<Attachment>(`/attachments/${id}/download-requests/`, {
    method: "POST",
    body: { reason },
    accessToken,
  });
}

export interface AttachmentDownloadRequest {
  id: string;
  attachment: string;
  document: string;
  patient_id: string;
  patient_name: string;
  requested_by: string;
  requested_by_id: string;
  requested_at: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "USED";
  decided_by: string;
  decided_at: string | null;
  decision_reason: string;
  expires_at: string | null;
  used_at: string | null;
}

export function listAttachmentDownloadRequests(accessToken: string, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest<{ results: AttachmentDownloadRequest[] }>(
    `/attachment-download-requests/${query}`,
    { accessToken },
  );
}

export function decideAttachmentDownload(
  accessToken: string,
  requestId: string,
  decision: "APPROVED" | "DECLINED",
  reason: string,
) {
  return apiRequest<{ id: string }>(`/attachment-download-requests/${requestId}/decide/`, {
    method: "POST",
    body: { decision, reason },
    accessToken,
  });
}

export function updateAttachment(accessToken: string, id: string, payload: Partial<Attachment>) {
  return apiRequest<Attachment>(`/attachments/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

// Documents are part of the clinical record and are never deleted — the
// backend refuses DELETE (405). Archiving takes a document out of the active
// list while keeping it in full; restoring brings it back.
export function archiveAttachment(accessToken: string, id: string) {
  return updateAttachment(accessToken, id, { doc_status: "ARCHIVED" });
}

export function restoreAttachment(accessToken: string, id: string) {
  return updateAttachment(accessToken, id, { doc_status: "ACTIVE" });
}

export interface AttachmentInsights {
  total: number;
  favourites: number;
  by_category: Partial<Record<AttachmentCategory, number>>;
  by_status: Partial<Record<AttachmentStatus, number>>;
  recent: Attachment[];
}

export function getAttachmentInsights(accessToken: string) {
  return apiRequest<AttachmentInsights>("/attachments/insights/", { accessToken });
}
