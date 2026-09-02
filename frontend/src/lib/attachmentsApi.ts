import { apiRequest } from "./apiClient";

// Mirrors apps/client_registry's Attachment — global document manager +
// Document Insights, from mockups/citramac_clinical_workspace.html.

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
  file: string;
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
    category?: AttachmentCategory;
    status?: AttachmentStatus;
    q?: string;
  },
) {
  const query = new URLSearchParams();
  if (params?.patient) query.set("patient", params.patient);
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
    file: File;
    classification: "HISTORICAL" | "CURRENT";
    category: AttachmentCategory;
    document_type?: string;
    document_date?: string;
    description?: string;
  },
) {
  const body = new FormData();
  body.set("patient", payload.patient);
  body.set("file", payload.file);
  body.set("classification", payload.classification);
  body.set("category", payload.category);
  if (payload.document_type) body.set("document_type", payload.document_type);
  if (payload.document_date) body.set("document_date", payload.document_date);
  if (payload.description) body.set("description", payload.description);
  return apiRequest<Attachment>("/attachments/", { method: "POST", body, accessToken });
}

export function updateAttachment(accessToken: string, id: string, payload: Partial<Attachment>) {
  return apiRequest<Attachment>(`/attachments/${id}/`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function deleteAttachment(accessToken: string, id: string) {
  return apiRequest<void>(`/attachments/${id}/`, { method: "DELETE", accessToken });
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
