import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  decideAttachmentDownload,
  listAttachmentDownloadRequests,
  type AttachmentDownloadRequest,
} from "../../lib/attachmentsApi";

const FILTERS = [
  { value: "PENDING", label: "Waiting" },
  { value: "", label: "All" },
] as const;

const STATUS_LABEL: Record<AttachmentDownloadRequest["status"], string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  DECLINED: "Declined",
  USED: "Downloaded",
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "";
}

/**
 * Org Admin → Download requests. A copy of a client document (download or
 * print) needs an Org Admin's approval: one copy, within 24 hours. Nobody
 * approves their own request; a decline needs a reason. Every request,
 * decision and download is in the audit log.
 */
export function DownloadRequestsPage() {
  const { accessToken, claims } = useAuth();
  const [status, setStatus] = useState<string>("PENDING");
  const [rows, setRows] = useState<AttachmentDownloadRequest[]>([]);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    listAttachmentDownloadRequests(accessToken, status || undefined)
      .then((data) => setRows(data.results))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load download requests."),
      );
  }, [accessToken, status]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const decide = async (id: string, decision: "APPROVED" | "DECLINED") => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await decideAttachmentDownload(accessToken, id, decision, reason);
      setDeclining(null);
      setReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink-900">Download requests</h1>
        <p className="mt-1 text-[13px] text-ink-500">
          Staff can preview a client&rsquo;s documents; a download or print needs your approval —
          one copy, within 24 hours. You cannot approve your own request.
        </p>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatus(f.value)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${
              status === f.value
                ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                : "border-surface-border text-ink-700 hover:bg-surface-bg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm">
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-ink-500">
            {status === "PENDING" ? "No requests are waiting." : "No download requests yet."}
          </p>
        )}
        <ul>
          {rows.map((r) => {
            const own = r.requested_by_id === claims?.user_id;
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 border-b border-surface-border px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink-900">{r.document}</p>
                    <p className="text-[11.5px] text-ink-500">
                      Client: {r.patient_name} · Requested by {r.requested_by},{" "}
                      {when(r.requested_at)}
                    </p>
                    <p className="mt-1 text-[12.5px] text-ink-700">&ldquo;{r.reason}&rdquo;</p>
                    {r.status !== "PENDING" && (
                      <p className="mt-1 text-[11.5px] text-ink-500">
                        {STATUS_LABEL[r.status]}
                        {r.decided_by ? ` by ${r.decided_by}, ${when(r.decided_at)}` : ""}
                        {r.decision_reason ? ` — ${r.decision_reason}` : ""}
                        {r.used_at ? ` · downloaded ${when(r.used_at)}` : ""}
                      </p>
                    )}
                  </div>
                  {r.status === "PENDING" &&
                    (own ? (
                      <span className="text-[11.5px] text-ink-500">
                        Your own request — another Org Admin decides.
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void decide(r.id, "APPROVED")}
                          className="rounded-md bg-brand-green px-3 py-1.5 text-[12px] font-semibold text-on-primary hover:bg-brand-green-dark disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDeclining(declining === r.id ? null : r.id);
                            setReason("");
                          }}
                          className="rounded-md border border-surface-border px-3 py-1.5 text-[12px] font-semibold text-ink-700 hover:bg-surface-bg"
                        >
                          Decline
                        </button>
                      </div>
                    ))}
                </div>
                {declining === r.id && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="min-w-[240px] flex-1 rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-[12.5px] outline-none focus:border-brand-green"
                      placeholder="Why is the download declined?"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => void decide(r.id, "DECLINED")}
                      className="rounded-md border border-status-red px-3 py-1.5 text-[12px] font-semibold text-status-red disabled:opacity-60"
                    >
                      Decline request
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
