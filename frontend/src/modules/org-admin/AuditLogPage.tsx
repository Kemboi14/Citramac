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
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";

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
  { value: "ARCHIVE", label: "Archive" },
  { value: "RESTORE", label: "Restore" },
  { value: "LEGAL_HOLD", label: "Legal Hold" },
  { value: "SUPPORT_ACCESS", label: "Support Access" },
  { value: "EXPORT", label: "Export" },
];

const ACTION_TINT: Partial<Record<AuditAction, string>> = {
  CREATE: "bg-brand-green-tint text-brand-green-dark",
  LOGIN: "bg-brand-green-tint text-brand-green-dark",
  RESTORE: "bg-brand-green-tint text-brand-green-dark",
  UPDATE: "bg-status-amber-tint text-status-amber",
  ARCHIVE: "bg-status-amber-tint text-status-amber",
  LEGAL_HOLD: "bg-status-amber-tint text-status-amber",
  EXPORT: "bg-status-amber-tint text-status-amber",
  DELETE: "bg-status-red-tint text-status-red",
  LOGIN_FAILED: "bg-status-red-tint text-status-red",
  ERASURE: "bg-status-red-tint text-status-red",
  SUPPORT_ACCESS: "bg-status-red-tint text-status-red",
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

/**
 * The organisation's audit trail — docs/09-SECURITY-COMPLIANCE.md §9.4.
 * Only Org Admins and Auditors reach this screen (the server enforces it; a
 * clinician gets a 403). Rows show which fields changed but never their old
 * or new values, which can contain clinical text. Read-only: there are
 * deliberately no mutation actions anywhere on this page.
 */
export function OrgAuditLogPage() {
  const { accessToken } = useAuth();
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return listAuditLog(accessToken, {
        q: queryText || undefined,
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
        page: pageNumber,
      })
        .then(setPage)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 403) {
            setForbidden(true);
            return;
          }
          setError(err instanceof ApiError ? err.message : "Couldn't load the audit log.");
        })
        .finally(() => setIsLoading(false));
    });
  }, [accessToken, queryText, action, from, to, pageNumber]);

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

  const columns: ResponsiveTableColumn<AuditLogEntry>[] = [
    {
      key: "timestamp",
      header: "Timestamp",
      className: "whitespace-nowrap px-4 py-3 text-ink-700",
      cell: (entry) => new Date(entry.timestamp).toLocaleString(),
    },
    {
      key: "actor",
      header: "Actor",
      cardTitle: true,
      cell: (entry) => (
        <span>
          {entry.actor_name || "—"}
          {entry.actor_role ? (
            <span className="block text-xs text-ink-500">{entry.actor_role}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      cardBadge: true,
      cell: (entry) => <ActionBadge action={entry.action} />,
    },
    {
      key: "model",
      header: "Record type",
      cardSubtitle: true,
      cell: (entry) => entry.model || "—",
    },
    {
      key: "object_id",
      header: "Object ID",
      className: "max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-ink-500",
      cell: (entry) => entry.object_id,
    },
    {
      key: "changed_fields",
      header: "Fields changed",
      className: "max-w-[16rem] px-4 py-3 text-xs text-ink-700",
      cell: (entry) => (entry.changed_fields.length ? entry.changed_fields.join(", ") : "—"),
    },
    {
      key: "source_ip",
      header: "Source IP",
      cell: (entry) => entry.source_ip || "—",
    },
  ];

  if (forbidden) {
    return (
      <div className="flex flex-col gap-3 animate-fade-in" role="alert">
        <h1 className="font-display text-2xl font-bold text-ink-900">Audit Log</h1>
        <p className="rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-status-amber">
          You don&apos;t have access to the audit log. It is limited to Organisation Admins and
          Auditors.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Audit Log</h1>
        <p className="mt-1 text-sm text-ink-500">
          Who did what, and when, in your organisation. Changed values are not shown.
        </p>
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
                placeholder="Role, record type, object ID…"
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
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              From
              <input
                type="date"
                className={FIELD_CLASS}
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  setPageNumber(1);
                  setFrom(e.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              To
              <input
                type="date"
                className={FIELD_CLASS}
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setPageNumber(1);
                  setTo(e.target.value);
                }}
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark"
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
        <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      {isLoading && entries.length === 0 && <p className="text-sm text-ink-500">Loading…</p>}

      <ResponsiveTable
        columns={columns}
        rows={entries}
        rowKey={(entry) => entry.id}
        emptyMessage="No audit log entries found."
      />

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
