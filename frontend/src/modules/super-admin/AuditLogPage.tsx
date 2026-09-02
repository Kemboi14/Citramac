import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  listAuditLog,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogPage,
} from "../../lib/auditApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";

const ACTION_OPTIONS: { value: AuditAction | ""; label: string }[] = [
  { value: "", label: "All Actions" },
  { value: "CREATE", label: "Create" },
  { value: "UPDATE", label: "Update" },
  { value: "DELETE", label: "Delete" },
  { value: "VIEW", label: "View" },
  { value: "ERASURE", label: "Erasure" },
  { value: "LOGIN", label: "Login" },
  { value: "LOGIN_FAILED", label: "Login Failed" },
  { value: "LOGOUT", label: "Logout" },
];

const ACTION_TINT: Record<AuditAction, string> = {
  CREATE: "bg-brand-green-tint text-brand-green-dark",
  LOGIN: "bg-brand-green-tint text-brand-green-dark",
  UPDATE: "bg-status-amber-tint text-status-amber",
  DELETE: "bg-status-red-tint text-status-red",
  LOGIN_FAILED: "bg-status-red-tint text-status-red",
  ERASURE: "bg-status-red-tint text-status-red",
  VIEW: "bg-surface-bg text-ink-500",
  LOGOUT: "bg-surface-bg text-ink-500",
};

function ActionBadge({ action }: { action: AuditAction }) {
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `action` is the compile-time-checked `AuditAction` prop union, not user input.
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_TINT[action] ?? ""}`}
    >
      {action.replaceAll("_", " ")}
    </span>
  );
}

/** Initials for an avatar badge, e.g. "System" -> "S", "Jane Doe" -> "JD". */
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

function ActorAvatar({ name }: { name: string }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-[10px] font-semibold text-brand-green-dark">
      {initialsFromName(name)}
    </span>
  );
}

/**
 * Immutable, read-only, cross-tenant audit trail —
 * docs/09-SECURITY-COMPLIANCE.md §9.4. This data can never be edited or
 * deleted; there are deliberately no mutation actions anywhere on this page.
 */
export function AuditLogPage() {
  const { accessToken } = useAuth();
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return listAuditLog(accessToken, {
        q: queryText || undefined,
        action: action || undefined,
        page: pageNumber,
      })
        .then(setPage)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load the audit log."),
        )
        .finally(() => setIsLoading(false));
    });
  }, [accessToken, queryText, action, pageNumber]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPageNumber(1);
    setQueryText(search);
  };

  const entries: AuditLogEntry[] = page?.results ?? [];
  const count = page?.count ?? 0;
  const pageSize = page?.page_size ?? 0;
  const canGoPrevious = pageNumber > 1;
  const canGoNext = pageSize > 0 && pageNumber * pageSize < count;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Console
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Audit Log</h1>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Search
              <input
                className={`${FIELD_CLASS} w-64`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Actor, model, object ID…"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Action
              <select
                className={FIELD_CLASS}
                value={action}
                onChange={(e) => {
                  setPageNumber(1);
                  setAction(e.target.value as AuditAction | "");
                }}
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark"
            >
              Search
            </button>
          </form>

          <span className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-bg px-3 py-1 text-xs text-ink-500">
            <Lock className="h-3 w-3" />
            Read-only · immutable
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {isLoading && entries.length === 0 && <p className="text-sm text-ink-500">Loading…</p>}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Object ID</th>
              <th className="px-4 py-3">Source IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-surface-border last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-medium text-ink-900">
                  <span className="flex items-center gap-2">
                    <ActorAvatar name={entry.actor_name || "?"} />
                    {entry.actor_name || "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700">{entry.organization_name || "Platform"}</td>
                <td className="px-4 py-3">
                  <ActionBadge action={entry.action} />
                </td>
                <td className="px-4 py-3 text-ink-700">{entry.model}</td>
                <td className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-ink-500">
                  {entry.object_id}
                </td>
                <td className="px-4 py-3 text-ink-700">{entry.source_ip || "—"}</td>
              </tr>
            ))}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  No audit log entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {page && count > 0 && (
        <div className="flex items-center justify-between text-sm text-ink-700">
          <span>
            Page {pageNumber} · {count} {count === 1 ? "entry" : "entries"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canGoPrevious}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => setPageNumber((p) => p + 1)}
              className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
