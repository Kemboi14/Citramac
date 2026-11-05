import { apiDownload, apiRequest } from "./apiClient";
import type { StatusTone } from "../modules/care/shared/ui";

// Mirrors apps.accounts.practitioner_profile — a staff member's professional
// profile (registration, practising licence, qualifications, documents), the
// submit → verify / return workflow, and the reviewer's side of it.

export type ProfileStatus = "DRAFT" | "SUBMITTED" | "VERIFIED" | "RETURNED";
export type CredentialState = "EXPIRED" | "UNVERIFIED" | "EXPIRING" | "VALID" | null;
export type DocumentKind = "registration" | "licence" | "qualification" | "indemnity" | "nacada";

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
  qualifications: string;
  licence_number: string;
  licence_issued_on: string | null;
  licence_expires_on: string | null;
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
    licence_at: string | null;
    licence_by: string;
    nacada_at: string | null;
    nacada_by: string;
  };
  documents: Record<DocumentKind, { label: string; uploaded: boolean }>;
  reviews: {
    action: "SUBMITTED" | "VERIFIED" | "RETURNED";
    actor: string;
    at: string;
    reason: string;
  }[];
  /** Reviewer view only: false when it is the reviewer's own profile. */
  can_review?: boolean;
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

export function submitMyProfessionalProfile(accessToken: string) {
  return apiRequest<ProfessionalProfile>("/me/professional-profile/submit/", {
    method: "POST",
    accessToken,
  });
}

export function uploadMyProfessionalDocument(accessToken: string, kind: DocumentKind, file: File) {
  const body = new FormData();
  body.set("file", file);
  return apiRequest<ProfessionalProfile>(`/me/professional-profile/documents/${kind}/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export function downloadMyProfessionalDocument(accessToken: string, kind: DocumentKind) {
  return apiDownload(`/me/professional-profile/documents/${kind}/`, accessToken);
}

// ── reviewers (Org Admin, staff.credentials.verify) ──

export function getStaffCredential(accessToken: string, userId: string) {
  return apiRequest<ProfessionalProfile>(`/staff-credentials/${userId}/`, { accessToken });
}

export function downloadStaffDocument(accessToken: string, userId: string, kind: DocumentKind) {
  return apiDownload(`/staff-credentials/${userId}/documents/${kind}/`, accessToken);
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
