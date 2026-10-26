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
  return keys;
}

function statusText(s: Staff) {
  const parts: string[] = [
    s.is_active ? "Active" : s.last_login ? "Deactivated" : "Invite pending",
  ];
  if (s.is_locked) parts.push("Locked");
  if (s.access_status === "expired") parts.push("Access expired");
  else if (s.access_status) parts.push("Time-limited");
  return parts.join(", ");
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Opens the filtered roster as a plain printable page and prints it — no app
 * chrome, and the active filters are stated at the top so a printout says
 * what it is a list of.
 */
export function printStaffList({
  organizationName,
  staff,
  filters,
  branches,
  departments,
}: {
  organizationName: string;
  staff: Staff[];
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
    described.push(`department: ${departments.find((d) => d.id === filters.department)?.name ?? ""}`);
  if (filters.duty) described.push(filters.duty === "on" ? "on duty" : "off duty");
  if (filters.status) {
    const label = filtersLabel(filters.status);
    if (label) described.push(`status: ${label}`);
  }

  const rows = staff
    .map((s, index) => {
      const assignments = s.assignments.length
        ? s.assignments
            .map((a) => escapeHtml(`${a.role_name ?? ""} — ${a.branch_name ?? "All branches"}`))
            .join("<br>")
        : escapeHtml(s.role_names.join(", "));
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(`${s.first_name} ${s.last_name}`)}<br><small>${escapeHtml(s.email)}</small></td>
        <td>${escapeHtml(s.staff_id || "—")}</td>
        <td>${assignments}</td>
        <td>${escapeHtml(s.department_name || "—")}</td>
        <td>${s.is_on_duty ? "On duty" : "Off duty"}</td>
        <td>${escapeHtml(statusText(s))}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Staff list — ${escapeHtml(organizationName)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;margin:24px}
  h1{font-size:18px;margin:0 0 4px} p{font-size:12px;color:#444;margin:0 0 12px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#eee} small{color:#555}
  @media print{body{margin:0}}
</style></head><body>
<h1>${escapeHtml(organizationName)} — Staff list</h1>
<p>${staff.length} staff${described.length ? ` · ${escapeHtml(described.join(" · "))}` : ""} · printed ${escapeHtml(new Date().toLocaleString())}</p>
<table><thead><tr><th>#</th><th>Name</th><th>Staff ID</th><th>Roles and branches</th><th>Department</th><th>Duty</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
<script>window.onload=function(){window.print()}</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function filtersLabel(key: string) {
  return STATUS_FILTERS.find((f) => f.key === key)?.label;
}
