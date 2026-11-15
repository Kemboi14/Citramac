import { apiDownload, apiRequest } from "./apiClient";

// Mirrors apps.tenancy's BranchRegulatoryRecordSerializer — a branch's
// regulatory documents (Org Admin → Branch Settings), each with many files.
// Organisation administration, not patient data: no FHIR.

/** Display labels only (VERIFY, guide.md §6) — the server's choice list. */
export type BranchRegulator = "KMPDC" | "NACADA" | "PPB" | "OTHER";

export const BRANCH_REGULATOR_OPTIONS: { value: BranchRegulator; label: string }[] = [
  { value: "KMPDC", label: "Kenya Medical Practitioners and Dentists Council (KMPDC)" },
  { value: "NACADA", label: "NACADA" },
  { value: "PPB", label: "Pharmacy and Poisons Board (PPB)" },
  { value: "OTHER", label: "Other (name it)" },
];

export type BranchRegulatoryStatus = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED";

export interface BranchRegulatoryFile {
  id: string;
  original_name: string;
  size: number;
  uploaded_at: string;
  uploaded_by_email: string;
}

export interface BranchRegulatoryRecord {
  id: string;
  branch: string;
  regulator: BranchRegulator;
  regulator_label: string;
  regulator_name: string;
  /** The regulator's label, or the name written in for "Other". */
  regulator_display: string;
  document_type: string;
  number: string;
  issued_on: string | null;
  valid_until: string | null;
  status: BranchRegulatoryStatus;
  days_remaining: number | null;
  created_at: string;
  created_by_email: string;
  files: BranchRegulatoryFile[];
}

export interface BranchRegulatoryFields {
  regulator: BranchRegulator;
  regulator_name: string;
  document_type: string;
  number: string;
  /** ISO date, or "" when not on the document. */
  issued_on: string;
  valid_until: string;
}

/** Same rule as the server (apps.accounts.practitioner_profile.check_upload). */
export const REGULATORY_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
export const REGULATORY_FILE_MAX_BYTES = 10 * 1024 * 1024;

const base = (branchId: string) => `/platform/branches/${branchId}/regulatory-records/`;

export function listBranchRegulatoryRecords(accessToken: string, branchId: string) {
  return apiRequest<BranchRegulatoryRecord[]>(base(branchId), { accessToken });
}

export function addBranchRegulatoryRecord(
  accessToken: string,
  branchId: string,
  fields: BranchRegulatoryFields,
  files: File[],
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  for (const file of files) body.append("files", file);
  return apiRequest<BranchRegulatoryRecord[]>(base(branchId), {
    method: "POST",
    body,
    accessToken,
  });
}

export function removeBranchRegulatoryRecord(
  accessToken: string,
  branchId: string,
  recordId: string,
) {
  return apiRequest<BranchRegulatoryRecord[]>(`${base(branchId)}${recordId}/`, {
    method: "DELETE",
    accessToken,
  });
}

export function addBranchRegulatoryFiles(
  accessToken: string,
  branchId: string,
  recordId: string,
  files: File[],
) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return apiRequest<BranchRegulatoryRecord[]>(`${base(branchId)}${recordId}/files/`, {
    method: "POST",
    body,
    accessToken,
  });
}

export function removeBranchRegulatoryFile(
  accessToken: string,
  branchId: string,
  recordId: string,
  fileId: string,
) {
  return apiRequest<BranchRegulatoryRecord[]>(`${base(branchId)}${recordId}/files/${fileId}/`, {
    method: "DELETE",
    accessToken,
  });
}

/** Authenticated, audited download — never a public media URL. */
export function downloadBranchRegulatoryFile(
  accessToken: string,
  branchId: string,
  recordId: string,
  fileId: string,
) {
  return apiDownload(`${base(branchId)}${recordId}/files/${fileId}/`, accessToken);
}
