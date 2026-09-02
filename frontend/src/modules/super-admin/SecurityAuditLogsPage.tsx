import { useEffect, useState } from "react";
import { Lock, Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listAuditLog, type AuditLogEntry, type AuditLogPage } from "../../lib/auditApi";

const ACTION_TINT: Record<string, string> = {
  LOGIN: "bg-brand-green-tint text-brand-green-dark",
  LOGIN_FAILED: "bg-status-red-tint text-status-red",
  ERASURE: "bg-status-red-tint text-status-red",
};

export function SecurityAuditLogsPage() {
  const { accessToken } = useAuth();
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    listAuditLog(accessToken, { category: "security", q: q || undefined, page: pageNum })
      .then(setPage)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the security audit log."),
      )
      .finally(() => setLoading(false));
  }, [accessToken, q, pageNum]);

  const totalPages = page ? Math.max(1, Math.ceil(page.count / page.page_size)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Governance · Security
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Security Audit Logs</h1>
        </div>
        <span className="flex items-center gap-1 rounded-sm bg-surface-bg px-2.5 py-1 text-xs font-semibold text-ink-500">
          <Lock className="h-3 w-3" />
          Read-only · immutable
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-3 py-2 shadow-sm sm:w-96">
        <Search className="h-4 w-4 text-ink-400" />
        <input
          className="w-full text-sm text-ink-900 outline-none"
          placeholder="Search actor, tenant, action…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPageNum(1);
          }}
        />
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {loading && !page && <p className="text-sm text-ink-500">Loading security audit log…</p>}

      {page && (
        <>
          <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Source IP</th>
                </tr>
              </thead>
              <tbody>
                {page.results.map((entry: AuditLogEntry) => (
                  <tr key={entry.id} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-3 text-ink-700">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900">{entry.actor_name}</td>
                    <td className="px-4 py-3 text-ink-700">{entry.organization_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                          ACTION_TINT[entry.action] ?? "bg-surface-bg text-ink-700"
                        }`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{entry.model}</td>
                    <td className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-ink-500">
                      {entry.object_id}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{entry.source_ip || "—"}</td>
                  </tr>
                ))}
                {page.results.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                      No security audit events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-ink-500">
            <span>
              Page {page.page} of {totalPages} · {page.count} events
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pageNum <= 1}
                onClick={() => setPageNum((p) => Math.max(1, p - 1))}
                className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={pageNum >= totalPages}
                onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
