import { apiDownload, apiRequest } from "./apiClient";
import type { StatusTone } from "../modules/care/shared/ui";

// Mirrors apps.accounts.practitioner_profile — a staff member's professional
// profile (registration, practising licences, degrees / diplomas /
// certificates, documents), the submit → verify / return workflow, and the
// reviewer's side of it. A person may hold registrations with several
// regulators, many licences and qualifications — each an entry — and every
// document slot takes as many files as they upload.

export type ProfileStatus = "DRAFT" | "SUBMITTED" | "VERIFIED" | "RETURNED";
export type CredentialState = "EXPIRED" | "UNVERIFIED" | "EXPIRING" | "VALID" | null;
/** The profile's own document slots. Entries carry their own files. */
export type DocumentKind = "registration" | "indemnity" | "nacada";
export type ItemKind = "REGISTRATION" | "LICENCE" | "DEGREE" | "DIPLOMA" | "CERTIFICATE" | "OTHER";

/** One uploaded file (PractitionerCredentialDocument). */
export interface CredentialFile {
  id: string;
  name: string;
  size: number;
  uploaded_at: string | null;
  uploaded_by: string;
}

/** A further registration, practising licence, degree, diploma or certificate (PractitionerCredentialItem). */
export interface CredentialItem {
  id: string;
  kind: ItemKind;
  label: string;
  /** A registration or licence: the regulator picked from the list ("" if typed). */
  regulator: string;
  title: string;
  /** The regulator that issued a registration or licence, or the awarding institution. */
  issuer: string;
  number: string;
  issued_on: string | null;
  expires_on: string | null;
  document_uploaded: boolean;
  files: CredentialFile[];
  verified_at: string | null;
  verified_by: string;
  /** Licences only: whether it is the one in force from its regulator. */
  in_force: boolean | null;
  licence_status: CredentialState;
}

export interface CredentialItemFields {
  regulator?: string;
  title?: string;
  issuer?: string;
  number?: string;
  issued_on?: string | null;
  expires_on?: string | null;
}

/** The compact status (practitioner_profile.summary) — on /me/profile/ and each staff row. */
export interface ProfessionalProfileSummary {
  credentials_required: boolean;
  suggested_regulators: string[];
  /** Null when the person's roles need no registration. */
  status: ProfileStatus | null;
  submitted_at: string | null;
  returned_reason: string;
  missing_items: { key: string; label: string }[];
  needs_action: boolean;
  licence_expires_on: string | null;
  licence_status: CredentialState;
  nacada_status: CredentialState;
  /** Why the person can't sign clinical records now (an expired licence), or "". */
  signing_block: string;
}

export interface ProfessionalProfileFields {
  regulator: string;
  registration_body: string;
  registration_number: string;
  indemnity_number: string;
  indemnity_expires_on: string | null;
  nacada_number: string;
  nacada_category: string;
  nacada_issued_on: string | null;
  nacada_expires_on: string | null;
}

export interface ProfessionalProfile extends ProfessionalProfileSummary {
  name: string;
  phone: string;
  regulator_choices: { value: string; label: string }[];
  fields: ProfessionalProfileFields;
  verified: {
    registration_at: string | null;
    registration_by: string;
    nacada_at: string | null;
    nacada_by: string;
  };
  documents: Record<DocumentKind, { label: string; uploaded: boolean; files: CredentialFile[] }>;
  item_kinds: { value: ItemKind; label: string }[];
  items: CredentialItem[];
  reviews: {
    action: "SUBMITTED" | "VERIFIED" | "RETURNED";
    actor: string;
    at: string;
    reason: string;
  }[];
  /** Reviewer view only: false when it is the reviewer's own profile. */
  can_review?: boolean;
  /** The specimen signature printed on documents they sign (2026-11-26). */
  signature_specimen: {
    current: { id: string; recorded_at: string; image: string } | null;
    versions: number;
  };
}

export type ProfessionalProfileUpdate = Partial<
  Omit<
    ProfessionalProfileFields,
    "nacada_number" | "nacada_category" | "nacada_issued_on" | "nacada_expires_on"
  >
> & {
  phone?: string;
  nacada?: {
    number?: string;
    category?: string;
    issued_on?: string | null;
    expires_on?: string | null;
  };
};

// ── the staff member's own profile ──

export function getMyProfessionalProfile(accessToken: string) {
  return apiRequest<ProfessionalProfile>("/me/professional-profile/", { accessToken });
}

export function updateMyProfessionalProfile(accessToken: string, body: ProfessionalProfileUpdate) {
  return apiRequest<ProfessionalProfile>("/me/professional-profile/", {
    method: "PUT",
    body,
    accessToken,
  });
}

/** Record a new specimen signature (a drawn PNG). It replaces the one in use;
 * earlier ones are kept, and each document prints the one in use when signed. */
export function recordMySignatureSpecimen(accessToken: string, image: string) {
  return apiRequest<ProfessionalProfile>("/me/professional-profile/signature/", {
    method: "POST",
    body: { image },
    accessToken,
  });
}

export function submitMyProfessionalProfile(accessToken: string) {
  return apiRequest<ProfessionalProfile>("/me/professional-profile/submit/", {
    method: "POST",
    accessToken,
  });
}

function filesBody(files: File[]) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return body;
}

/** Add one or more files to one of the profile's own slots. */
export function uploadMyProfessionalDocuments(
  accessToken: string,
  kind: DocumentKind,
  files: File[],
) {
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/documents/${kind}/`, {
    method: "POST",
    body: filesBody(files),
    accessToken,
  });
}

export function downloadMyProfessionalFile(accessToken: string, fileId: string) {
  return apiDownload(`/me/professional-profile/files/${fileId}/`, accessToken);
}

/** Take one file off the profile (it is kept, hidden). */
export function removeMyProfessionalFile(accessToken: string, fileId: string) {
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/files/${fileId}/`, {
    method: "DELETE",
    accessToken,
  });
}

export function addMyCredentialItem(
  accessToken: string,
  kind: ItemKind,
  fields: CredentialItemFields,
  files: File[] = [],
) {
  const body = filesBody(files);
  body.set("kind", kind);
  for (const [key, value] of Object.entries(fields)) body.set(key, value ?? "");
  return apiRequest<ProfessionalProfile>("/me/professional-profile/items/", {
    method: "POST",
    body,
    accessToken,
  });
}

export function updateMyCredentialItem(
  accessToken: string,
  itemId: string,
  fields: CredentialItemFields,
) {
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/items/${itemId}/`, {
    method: "PATCH",
    body: fields,
    accessToken,
  });
}

export function removeMyCredentialItem(accessToken: string, itemId: string) {
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/items/${itemId}/`, {
    method: "DELETE",
    accessToken,
  });
}

/** Add one or more files to an entry. */
export function uploadMyCredentialItemDocuments(
  accessToken: string,
  itemId: string,
  files: File[],
) {
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/items/${itemId}/documents/`, {
    method: "POST",
    body: filesBody(files),
    accessToken,
  });
}

// ── reviewers (Org Admin, staff.credentials.verify) ──

export function getStaffCredential(accessToken: string, userId: string) {
  return apiRequest<ProfessionalProfile>(`/staff-credentials/${userId}/`, { accessToken });
}

export function downloadStaffFile(accessToken: string, userId: string, fileId: string) {
  return apiDownload(`/staff-credentials/${userId}/files/${fileId}/`, accessToken);
}

export function verifyStaffCredential(accessToken: string, userId: string) {
  return apiRequest<ProfessionalProfile>(`/staff-credentials/${userId}/verify/`, {
    method: "POST",
    accessToken,
  });
}

export function returnStaffCredential(accessToken: string, userId: string, reason: string) {
  return apiRequest<ProfessionalProfile>(`/staff-credentials/${userId}/return/`, {
    method: "POST",
    body: { reason },
    accessToken,
  });
}

/** Open a downloaded document in a new tab (the blob URL is released after a minute). */
export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const STATUS_LABEL: Record<ProfileStatus, string> = {
  DRAFT: "Not submitted",
  SUBMITTED: "Awaiting verification",
  VERIFIED: "Verified",
  RETURNED: "Returned for changes",
};

export const STATUS_TONE: Record<ProfileStatus, StatusTone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  VERIFIED: "success",
  RETURNED: "warning",
};
