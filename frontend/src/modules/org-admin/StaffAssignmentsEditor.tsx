import { Plus, X } from "lucide-react";
import type { Branch } from "../../lib/branchesApi";
import type { Role, RoleAssignment } from "../../lib/governanceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";

/** "" in the branch select = every branch of the organisation. */
export interface AssignmentRow {
  role: string;
  branch: string;
}

export const ORG_ADMIN_ROLE = "Org Admin";

export function rowsFromAssignments(assignments: RoleAssignment[]): AssignmentRow[] {
  return assignments.map((a) => ({ role: String(a.role), branch: a.branch ?? "" }));
}

export function assignmentsFromRows(rows: AssignmentRow[]): RoleAssignment[] {
  return rows
    .filter((row) => row.role)
    .map((row) => ({ role: Number(row.role), branch: row.branch || null }));
}

/** Branch ids these rows let the holder work at — null when any row is organisation-wide. */
export function coveredBranches(rows: AssignmentRow[], roles: Role[]): Set<string> | null {
  const covered = new Set<string>();
  for (const row of rows) {
    if (!row.role) continue;
    const role = roles.find((r) => String(r.id) === row.role);
    if (!row.branch || role?.name === ORG_ADMIN_ROLE) return null;
    covered.add(row.branch);
  }
  return covered;
}

/**
 * The roles a staff member holds and where: one row per role-at-branch. A
 * person can be a Nurse at one branch and a Cashier at another, or hold Org
 * Admin (always every branch) alongside a clinical role. The server checks
 * each role at the branch the person is working in.
 */
export function StaffAssignmentsEditor({
  rows,
  onChange,
  roles,
  branches,
}: {
  rows: AssignmentRow[];
  onChange: (rows: AssignmentRow[]) => void;
  roles: Role[];
  branches: Branch[];
}) {
  const update = (index: number, patch: Partial<AssignmentRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const isOrgAdmin = roles.find((r) => String(r.id) === row.role)?.name === ORG_ADMIN_ROLE;
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Role ${index + 1}`}
              className={`${FIELD_CLASS} min-w-0 flex-1`}
              value={row.role}
              onChange={(e) => update(index, { role: e.target.value })}
              required={index === 0}
            >
              <option value="">Select a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-500">at</span>
            <select
              aria-label={`Branch for role ${index + 1}`}
              className={`${FIELD_CLASS} min-w-0 flex-1`}
              value={isOrgAdmin ? "" : row.branch}
              onChange={(e) => update(index, { branch: e.target.value })}
              disabled={isOrgAdmin}
              title={isOrgAdmin ? "Org Admin covers every branch" : undefined}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove role ${index + 1}`}
              className="rounded-md p-1.5 text-ink-500 hover:bg-surface-bg hover:text-status-red disabled:opacity-40"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              disabled={rows.length === 1}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-brand-green hover:underline"
        onClick={() => onChange([...rows, { role: "", branch: "" }])}
      >
        <Plus size={14} />
        Add another role
      </button>
    </div>
  );
}
