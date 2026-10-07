import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  SUPPORT_GRANT_MAX_HOURS,
  listSupportGrants,
  listTenantCompliance,
  requestSupportGrant,
  type SupportGrant,
  type SupportGrantStatus,
} from "../../lib/complianceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_GHOST =
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-bg transition-colors duration-150";

const DEFAULT_HOURS = 4;
const REFRESH_MS = 60_000;

const STATUS_TINT: Record<SupportGrantStatus, string> = {
  REQUESTED: "bg-status-amber-tint text-status-amber",
  APPROVED: "bg-brand-green-tint text-brand-green-dark",
  DECLINED: "bg-status-red-tint text-status-red",
  REVOKED: "bg-status-red-tint text-status-red",
  EXPIRED: "bg-surface-bg text-ink-500 border border-surface-border",
};

const STATUS_LABEL: Record<SupportGrantStatus, string> = {
  REQUESTED: "Awaiting facility",
  APPROVED: "Approved",
  DECLINED: "Declined",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function PlatformSupportAccessPage() {
  const { accessToken } = useAuth();
  const [grants, setGrants] = useState<SupportGrant[] | null>(null);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [organization, setOrganization] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [hours, setHours] = useState(String(DEFAULT_HOURS));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const now = useNow(30_000);

  const load = useCallback(() => {
    if (!accessToken) return;
    listSupportGrants(accessToken)
      .then((data) => {
        setGrants(data.results);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Couldn't load your access requests.")));
  }, [accessToken]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!accessToken) return;
    listTenantCompliance(accessToken)
      .then((data) =>
        setFacilities(
          data.results.map((row) => ({ id: row.organization_id, name: row.organization_name })),
        ),
      )
      .catch((err) => setError(errorMessage(err, "Couldn't load the facility list.")));
  }, [accessToken]);

  const submit = async () => {
    if (!accessToken) return;
    setFormError(null);
    const duration = Number(hours);
    if (!organization) {
      setFormError("Choose the facility.");
      throw new Error("validation");
    }
    if (!reason.trim()) {
      setFormError("State why access is needed.");
      throw new Error("validation");
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > SUPPORT_GRANT_MAX_HOURS) {
      setFormError(
        `Duration must be a whole number of hours between 1 and ${SUPPORT_GRANT_MAX_HOURS}.`,
      );
      throw new Error("validation");
    }
    try {
      await requestSupportGrant(accessToken, {
        organization,
        reason: reason.trim(),
        reference: reference.trim() || undefined,
        duration_hours: duration,
      });
      setOrganization("");
      setReason("");
      setReference("");
      setHours(String(DEFAULT_HOURS));
      load();
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't send the access request."));
      throw err;
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      setError("Couldn't copy to the clipboard — select the grant id and copy it manually.");
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Governance · Data protection
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Support Access</h1>
        </div>
        <button type="button" className={BUTTON_GHOST} onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-5 text-sm text-ink-700 shadow-sm">
        <div className="mb-2 flex items-center gap-2 font-semibold text-ink-900">
          <KeyRound className="h-4 w-4 text-brand-green" />
          How support access works
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Platform staff cannot reach a facility&rsquo;s clinical records unless that facility has
            approved a support access request.
          </li>
          <li>
            While a grant is active, every API request must carry the header{" "}
            <code className="rounded-sm bg-surface-bg px-1 py-0.5 font-mono text-xs">
              X-Support-Grant: &lt;grant id&gt;
            </code>
            . Requests without it are refused.
          </li>
          <li>
            A grant reaches only the facility that approved it, ends when it expires or the facility
            revokes it, and every request made under it is written to the audit log.
          </li>
        </ul>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <form
        onSubmit={(e) => e.preventDefault()}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-1 font-display text-base font-semibold text-ink-900">Request access</h2>
        <p className="mb-4 text-sm text-ink-500">
          The facility&rsquo;s Org Admins are notified and decide. The time window starts when they
          approve.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={LABEL_CLASS}>
            Facility
            <select
              className={FIELD_CLASS}
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              required
            >
              <option value="">Select a facility…</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Ticket reference
            <input
              className={FIELD_CLASS}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className={`${LABEL_CLASS} md:col-span-2`}>
            Reason
            <textarea
              className={`${FIELD_CLASS} min-h-[80px]`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <span className="text-xs font-normal text-ink-500">
              Shown to the facility when it decides. Say what you need to do and why.
            </span>
          </label>
          <label className={LABEL_CLASS}>
            Duration (hours)
            <input
              type="number"
              min={1}
              max={SUPPORT_GRANT_MAX_HOURS}
              step={1}
              className={FIELD_CLASS}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
            <span className="text-xs font-normal text-ink-500">
              1 to {SUPPORT_GRANT_MAX_HOURS} hours.
            </span>
          </label>
        </div>
        {formError && (
          <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
            {formError}
          </p>
        )}
        <div className="mt-5">
          <SaveButton onSave={submit} savingLabel="Sending…" savedLabel="Requested">
            Request access
          </SaveButton>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="border-b border-surface-border px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink-900">My requests</h2>
        </div>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Facility</th>
              <th className="px-4 py-3 font-semibold">Requested</th>
              <th className="px-4 py-3 font-semibold">Reason</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Expires</th>
              <th className="px-4 py-3 font-semibold">Decision</th>
              <th className="px-4 py-3 font-semibold">Grant id</th>
            </tr>
          </thead>
          <tbody>
            {grants === null && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  Loading requests…
                </td>
              </tr>
            )}
            {grants?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  You have not requested support access.
                </td>
              </tr>
            )}
            {grants?.map((grant) => {
              const remaining = grant.expires_at
                ? new Date(grant.expires_at).getTime() - now
                : null;
              return (
                <tr
                  key={grant.id}
                  className="border-b border-surface-border align-top last:border-0"
                >
                  <td className="px-4 py-3 font-medium text-ink-900">{grant.organization_name}</td>
                  <td className="px-4 py-3 text-ink-700">
                    <div>{formatDateTime(grant.requested_at)}</div>
                    <div className="text-xs text-ink-500">{grant.duration_hours}h requested</div>
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-ink-700">
                    <div className="whitespace-pre-wrap">{grant.reason}</div>
                    {grant.reference && (
                      <div className="text-xs text-ink-500">Ticket {grant.reference}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${STATUS_TINT[grant.status]}`}
                    >
                      {STATUS_LABEL[grant.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    <div>{formatDateTime(grant.expires_at)}</div>
                    {grant.is_active && remaining !== null && remaining > 0 && (
                      <div className="text-xs font-semibold text-brand-green-dark">
                        {formatDuration(remaining)} left
                      </div>
                    )}
                    {grant.revoked_at && (
                      <div className="text-xs text-status-red">
                        Revoked {formatDateTime(grant.revoked_at)}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 text-ink-700">
                    {grant.decided_at ? (
                      <>
                        <div className="text-xs text-ink-500">
                          {grant.decided_by || "—"} · {formatDateTime(grant.decided_at)}
                        </div>
                        {grant.decision_note && (
                          <div className="whitespace-pre-wrap">{grant.decision_note}</div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {grant.is_active ? (
                      <div className="flex flex-col gap-1.5">
                        <code className="select-all break-all font-mono text-xs text-ink-700">
                          {grant.id}
                        </code>
                        <button
                          type="button"
                          className={BUTTON_GHOST}
                          onClick={() => void copyId(grant.id)}
                        >
                          {copiedId === grant.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-brand-green" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy grant id
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
