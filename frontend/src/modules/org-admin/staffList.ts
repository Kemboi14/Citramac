import type { Branch } from "../../lib/branchesApi";
import type { Department } from "../../lib/departmentsApi";
import type { Staff } from "../../lib/governanceApi";

export interface StaffFilters {
  search: string;
  role: string;
  branch: string;
  department: string;
  duty: "" | "on" | "off";
  status: string;
}

/** The roster's status / action states — one staff member can be in several. */
export const STATUS_FILTERS = [
  { key: "active", label: "Active" },
  { key: "invite_pending", label: "Invite pending (never signed in)" },
  { key: "deactivated", label: "Deactivated" },
  { key: "locked", label: "Locked out" },
  { key: "time_limited", label: "Time-limited access" },
  { key: "access_expired", label: "Access expired" },
  { key: "unlimited", label: "Unlimited access" },
  { key: "nacada_attention", label: "NACADA licence needs attention" },
  { key: "profile_submitted", label: "Professional profile awaiting verification" },
  { key: "profile_incomplete", label: "Professional profile not submitted" },
  { key: "profile_returned", label: "Professional profile returned" },
  { key: "licence_attention", label: "Practising licence expired or expiring" },
] as const;

export function staffStatusKeys(s: Staff): string[] {
  const keys: string[] = [];
  if (s.is_active) keys.push("active");
  else keys.push(s.last_login ? "deactivated" : "invite_pending");
  if (s.is_locked) keys.push("locked");
  if (s.access_status) keys.push("time_limited");
  else keys.push("unlimited");
  if (s.access_status === "expired") keys.push("access_expired");
  if (s.nacada_status && s.nacada_status !== "VALID") keys.push("nacada_attention");
  const profile = s.professional_profile;
  if (profile?.credentials_required && s.is_active) {
    if (profile.status === "SUBMITTED") keys.push("profile_submitted");
    if (profile.status === "DRAFT") keys.push("profile_incomplete");
    if (profile.status === "RETURNED") keys.push("profile_returned");
  }
  if (profile?.licence_status === "EXPIRED" || profile?.licence_status === "EXPIRING")
    keys.push("licence_attention");
  return keys;
}

/** The active filters in words, printed at the top of the staff list so a
 * printout says what it is a list of. */
export function describeFilters({
  filters,
  branches,
  departments,
}: {
  filters: StaffFilters;
  branches: Branch[];
  departments: Department[];
}) {
  const described: string[] = [];
  if (filters.search) described.push(`matching “${filters.search}”`);
  if (filters.role) described.push(`role: ${filters.role}`);
  if (filters.branch)
    described.push(`branch: ${branches.find((b) => b.id === filters.branch)?.name ?? ""}`);
  if (filters.department)
    described.push(
      `department: ${departments.find((d) => d.id === filters.department)?.name ?? ""}`,
    );
  if (filters.duty) described.push(filters.duty === "on" ? "on duty" : "off duty");
  if (filters.status) {
    const label = filtersLabel(filters.status);
    if (label) described.push(`status: ${label}`);
  }
  return described.join(" · ");
}

function filtersLabel(key: string) {
  return STATUS_FILTERS.find((f) => f.key === key)?.label;
}
