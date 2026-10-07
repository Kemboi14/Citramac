import { useId, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  decideSupportGrant,
  listSupportGrants,
  type SupportGrant,
  type SupportGrantStatus,
} from "../../lib/complianceApi";
import { formatDateTime } from "../care/shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../care/shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "../care/shared/ui";
import { useRecordData } from "../care/record/useRecordData";

// Org Admin — platform support access to this facility's clinical records
// (legal opinion of 2 Oct 2026 §4.2, §6). Platform staff can reach clinical
// records only through a grant the facility's Org Admin approves, for the
// requested number of hours; the server enforces the window and logs every
// request made under it.

const STATUS: Record<
  SupportGrantStatus,
  { label: string; tone: "neutral" | "risk" | "brand" | "warn" }
> = {
  REQUESTED: { label: "Awaiting your decision", tone: "warn" },
  APPROVED: { label: "Active", tone: "brand" },
  DECLINED: { label: "Declined", tone: "neutral" },
  REVOKED: { label: "Revoked", tone: "risk" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

function hours(n: number) {
  return `${n} hour${n === 1 ? "" : "s"}`;
}

function errorText(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  const detail = err.fields ? Object.values(err.fields).map(String).join(" ") : "";
  return detail && detail !== err.message ? `${err.message} — ${detail}` : err.message;
}

function StatusTag({ grant }: { grant: SupportGrant }) {
  const status = STATUS[grant.status];
  return <Tag tone={status.tone}>{status.label}</Tag>;
}

function PendingRequest({ grant, onDecided }: { grant: SupportGrant; onDecided: () => void }) {
  const { accessToken } = useAuth();
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "APPROVE" | "DECLINE") => {
    if (!accessToken) return;
    const question =
      decision === "APPROVE"
        ? `Approve ${grant.requested_by || grant.requested_by_email}'s access to your facility's clinical records for ${hours(grant.duration_hours)}? Access ends automatically when the time runs out, and you can revoke it sooner.`
        : `Decline this request from ${grant.requested_by || grant.requested_by_email}?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      await decideSupportGrant(accessToken, grant.id, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDecided();
    } catch (err) {
      setError(errorText(err, "Couldn't record your decision."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={`Support access request from ${grant.requested_by_email}`}
      className="rounded-lg border border-l-[3px] border-priority-orange border-l-priority-orange bg-surface-card p-3.5"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-ink-900">
          {grant.requested_by || "Platform staff"}{" "}
          <span className="font-normal text-ink-500">({grant.requested_by_email})</span>
        </div>
        <StatusTag grant={grant} />
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
        <div className="sm:col-span-3">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Reason</dt>
          <dd className="whitespace-pre-wrap break-words text-ink-900">{grant.reason}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Ticket reference
          </dt>
          <dd className="text-ink-900">{grant.reference || "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Duration requested
          </dt>
          <dd className="text-ink-900">{hours(grant.duration_hours)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Requested
          </dt>
          <dd className="font-mono text-xs text-ink-900">{formatDateTime(grant.requested_at)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-col gap-2">
        <Field label="Note (optional)" htmlFor={`${id}-note`}>
          <input
            id={`${id}-note`}
            className={INPUT}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() => void decide("APPROVE")}
          >
            Approve for {hours(grant.duration_hours)}
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            disabled={busy}
            onClick={() => void decide("DECLINE")}
          >
            Decline
          </button>
        </div>
      </div>
    </section>
  );
}

function RevokeButton({
  grant,
  onDone,
}: {
  grant: SupportGrant;
  onDone: (error: string | null) => void;
}) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!accessToken) return;
    if (
      !window.confirm(
        `Revoke ${grant.requested_by || grant.requested_by_email}'s access now? Their access to your clinical records ends immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await decideSupportGrant(accessToken, grant.id, { decision: "REVOKE" });
      onDone(null);
    } catch (err) {
      onDone(errorText(err, "Couldn't revoke this access."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`${BTN_GHOST} ${BTN_SM} !border-priority-red !text-priority-red`}
      disabled={busy}
      onClick={() => void revoke()}
    >
      Revoke
    </button>
  );
}

export function SupportAccessPage() {
  const [version, setVersion] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error } = useRecordData(
    "support-grants",
    version,
    (token) => listSupportGrants(token),
    "Couldn't load support access requests.",
  );
  const refresh = () => setVersion((v) => v + 1);
  const grants = data?.results ?? null;
  const pending = grants?.filter((g) => g.status === "REQUESTED") ?? [];
  const active = grants?.filter((g) => g.is_active) ?? [];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <PageHeader
        eyebrow="Organization · Data protection"
        title="Platform Support Access"
        subtitle="Approve, decline or revoke platform staff access to your clinical records."
        actions={
          <button type="button" className={BTN_GHOST} onClick={refresh}>
            Refresh
          </button>
        }
      />

      <Callout>
        Platform staff can only reach your facility&apos;s clinical records with your approval, for
        a limited time, and every request they make while access is open is logged. Access ends
        automatically when the approved time runs out, and you can revoke it at any point.
      </Callout>

      <ErrorNote>{error}</ErrorNote>
      <ErrorNote>{actionError}</ErrorNote>

      {active.length > 0 && (
        <Callout tone="warning" role="status">
          Platform support currently has access to your clinical records
          {active.length > 1 ? ` under ${active.length} grants` : ""} — until{" "}
          {active.map((g) => formatDateTime(g.expires_at)).join(", ")}.
        </Callout>
      )}

      {pending.length > 0 && (
        <Card
          title="Requests awaiting your decision"
          aside={<Tag tone="warn">{pending.length} pending</Tag>}
        >
          <div className="flex flex-col gap-3">
            {pending.map((grant) => (
              <PendingRequest key={grant.id} grant={grant} onDecided={refresh} />
            ))}
          </div>
        </Card>
      )}

      <Card title="All requests" bodyClassName="p-0">
        {grants === null ? (
          !error && <p className="px-5 py-8 text-sm text-ink-500">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-500">
            Platform support has not requested access to your facility&apos;s records.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[960px]`}>
              <thead>
                <tr>
                  <th className={TH}>Requested by</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Ticket</th>
                  <th className={TH}>Duration</th>
                  <th className={TH}>Requested</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Expires</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr
                    key={grant.id}
                    className={grant.status === "REQUESTED" ? "bg-priority-orange-tint" : ""}
                  >
                    <td className={TD}>
                      <div className="font-semibold">{grant.requested_by || "—"}</div>
                      <div className="text-xs text-ink-500">{grant.requested_by_email}</div>
                    </td>
                    <td className={`${TD} max-w-[280px] whitespace-pre-wrap break-words`}>
                      {grant.reason}
                      {grant.decision_note && (
                        <div className="mt-1 text-xs text-ink-500">Note: {grant.decision_note}</div>
                      )}
                    </td>
                    <td className={TD}>{grant.reference || "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{hours(grant.duration_hours)}</td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {formatDateTime(grant.requested_at)}
                    </td>
                    <td className={TD}>
                      <StatusTag grant={grant} />
                      {grant.decided_by && (
                        <div className="mt-1 text-xs text-ink-500">
                          by {grant.decided_by}
                          {grant.decided_at ? ` · ${formatDateTime(grant.decided_at)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {grant.revoked_at
                        ? `Revoked ${formatDateTime(grant.revoked_at)}`
                        : grant.expires_at
                          ? formatDateTime(grant.expires_at)
                          : "—"}
                    </td>
                    <td className={TD}>
                      {grant.is_active && (
                        <RevokeButton
                          grant={grant}
                          onDone={(message) => {
                            setActionError(message);
                            refresh();
                          }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
