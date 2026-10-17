import { ApiError } from "./apiClient";
import type { Branch, LicenseStatus } from "./branchesApi";

// Per-branch registered-health-provider identifiers (apps.tenancy Branch):
// KMPDC registration number, the yearly facility licence, and the SHA FR
// code — form state and display helpers shared by Org Admin Branch
// Settings, Org Admin Branches & Departments and Super Admin Branches
// (components/BranchIdentifierFields.tsx).

export interface BranchIdentifierValues {
  kmpdc_registration_number: string;
  facility_license_number: string;
  facility_license_valid_until: string;
  sha_fr_code: string;
}

export const EMPTY_IDENTIFIERS: BranchIdentifierValues = {
  kmpdc_registration_number: "",
  facility_license_number: "",
  facility_license_valid_until: "",
  sha_fr_code: "",
};

export function identifiersFromBranch(branch: Branch): BranchIdentifierValues {
  return {
    kmpdc_registration_number: branch.kmpdc_registration_number,
    facility_license_number: branch.facility_license_number,
    facility_license_valid_until: branch.facility_license_valid_until ?? "",
    sha_fr_code: branch.sha_fr_code,
  };
}

/** The API shape: a blank expiry date is null, not "". */
export function identifierPayload(values: BranchIdentifierValues) {
  return {
    ...values,
    facility_license_valid_until: values.facility_license_valid_until || null,
  };
}

/** Per-field messages from a refused save, keyed by API field name. */
export function identifierFieldErrors(
  err: unknown,
): Partial<Record<keyof BranchIdentifierValues, string>> {
  if (!(err instanceof ApiError) || !err.fields) return {};
  const out: Partial<Record<keyof BranchIdentifierValues, string>> = {};
  for (const key of Object.keys(EMPTY_IDENTIFIERS) as (keyof BranchIdentifierValues)[]) {
    const messages = err.fields[key];
    if (Array.isArray(messages) && messages.length) out[key] = String(messages[0]);
  }
  return out;
}

export function licenseStatusLabel(status: LicenseStatus, days: number | null) {
  if (status === "MISSING") return "No licence recorded";
  if (status === "EXPIRED") return "Licence expired";
  if (status === "EXPIRING") {
    if (days === 0) return "Licence expires today";
    return `Licence expires in ${days} day${days === 1 ? "" : "s"}`;
  }
  return "Licence valid";
}

const MISSING_LABEL: Record<Branch["missing_identifiers"][number], string> = {
  kmpdc_registration_number: "KMPDC registration number",
  sha_fr_code: "SHA FR code",
};

/** What needs an Org Admin's attention on a branch: missing required identifiers, and a licence that is expiring or expired. */
export function branchIdentifierIssues(branch: Branch): string[] {
  const issues = branch.missing_identifiers.map((f) => `${MISSING_LABEL[f]} missing`);
  if (branch.license_status === "EXPIRED" || branch.license_status === "EXPIRING") {
    issues.push(licenseStatusLabel(branch.license_status, branch.license_days_remaining));
  }
  return issues;
}
