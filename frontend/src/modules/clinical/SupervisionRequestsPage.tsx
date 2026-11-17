import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { listSupervisionRequests, type SupervisionRequest } from "../../lib/mhpExtrasApi";
import { formatDateTime } from "../care/shared/format";
import { PageHeader } from "../care/shared/ui";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";

const STATUS_TINT: Record<SupervisionRequest["status"], string> = {
  OPEN: "bg-status-amber-tint text-status-amber",
  SCHEDULED: "bg-brand-green-tint text-brand-green-dark",
  COMPLETED: "bg-surface-border text-ink-500",
};
const STATUS_LABEL: Record<SupervisionRequest["status"], string> = {
  OPEN: "Open",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
};

const PAGE_SIZE = 25;

export function SupervisionRequestsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<SupervisionRequest[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [completedQuery, setCompletedQuery] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ query: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<SupervisionRequest["status"] | "ALL">("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const queryKey = JSON.stringify([accessToken ?? null, page, statusFilter, debouncedSearch]);
  const loaded = completedQuery === queryKey;
  const error = actionError ?? (loadError?.query === queryKey ? loadError.message : null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    listSupervisionRequests(accessToken, {
      page,
      status: statusFilter,
      q: debouncedSearch,
    })
      .then((res) => {
        if (!active) return;
        setRequests(res.results);
        setCount(res.count);
      })
      .catch(() => {
        if (active)
          setLoadError({ query: queryKey, message: "Couldn't load supervision requests." });
      })
      .finally(() => {
        if (active) setCompletedQuery(queryKey);
      });
    return () => {
      active = false;
    };
  }, [accessToken, page, statusFilter, debouncedSearch, queryKey]);

  const openRequest = (request: SupervisionRequest) => {
    navigate(`/clinical/mhp/supervision/${request.id}`);
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const errorBlock = error ? (
    <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Supervision requests"
        subtitle="Raised by therapists and clinicians from a psychotherapy self-assessment."
      />

      <div className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink-900">Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-500">
              Status
              <select
                className={FIELD_CLASS}
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as SupervisionRequest["status"] | "ALL");
                  setPage(1);
                  setActionError(null);
                }}
              >
                <option value="ALL">All</option>
                <option value="OPEN">Open</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </label>
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                className={`${FIELD_CLASS} pl-8`}
                placeholder="Search client, requester, topic…"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                  setActionError(null);
                }}
              />
            </label>
            {loaded && (
              <span className="text-xs text-ink-500">
                {count} {count === 1 ? "request" : "requests"}
              </span>
            )}
          </div>
        </div>

        {requests.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg/60 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Requested by</th>
                  <th className="px-5 py-3">Requested on</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Scheduled session</th>
                  <th className="px-5 py-3 text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {requests.map((request) => (
                  <tr
                    key={request.id}
                    onClick={() => openRequest(request)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openRequest(request);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open supervision request for ${
                      request.patient_name || "unknown client"
                    }`}
                    className="cursor-pointer transition-colors hover:bg-surface-bg focus:bg-surface-bg focus:outline-none"
                  >
                    <td className="px-5 py-3 text-ink-700">
                      {request.requested_by_name || "Unknown clinician"}
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {formatDateTime(request.requested_at)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-sm px-2 py-0.5 text-[11px] font-semibold ${
                          STATUS_TINT[request.status]
                        }`}
                      >
                        {STATUS_LABEL[request.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {request.status === "COMPLETED" && request.completed_at
                        ? `Completed ${formatDateTime(request.completed_at)}`
                        : request.scheduled_for
                          ? `${formatDateTime(request.scheduled_for)} · ${request.patient_name || "client"}`
                          : request.supervisor_name
                            ? `Supervisor ${request.supervisor_name}`
                            : "Awaiting a supervisor"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ChevronRight className="inline h-4 w-4 text-ink-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          loaded && (
            <p className="px-5 py-8 text-center text-sm text-ink-500">
              {debouncedSearch || statusFilter !== "ALL"
                ? "No requests match these filters."
                : "No supervision requests yet."}
            </p>
          )
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-surface-border px-5 py-3 text-xs text-ink-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {errorBlock}
    </div>
  );
}
