import { useRef, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { markAppointmentMissed } from "../../../../lib/carePathwayApi";
import {
  completeFollowUp,
  rebookMissedFollowUp,
  type ClientFollowUpRow,
  type ClientFollowUps,
} from "../../../../lib/carePlanOutcomesApi";
import { BookingForm } from "../../FollowUpPage";
import { formatDate, formatDateTime, newRequestId } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";

const STATUS: Record<string, { label: string; tone: "brand" | "neutral" | "risk" | "warn" }> = {
  SCHEDULED: { label: "Due", tone: "neutral" },
  CHECKED_IN: { label: "Due", tone: "neutral" },
  COMPLETED: { label: "Done", tone: "brand" },
  NO_SHOW: { label: "Missed appointment", tone: "risk" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const ORIGIN: Record<ClientFollowUpRow["origin"], string> = {
  MANUAL: "Added by clinician",
  DISCHARGE: "Facility schedule at discharge",
  CARE_PLAN: "Care plan",
};

/** Due / Overdue / Completed / Missed counts and the next follow-up due. */
export function FollowUpStats({ data }: { data: ClientFollowUps }) {
  const stats = [
    ["Due", data.counts.due],
    ["Overdue", data.counts.overdue],
    ["Completed", data.counts.completed],
    ["Missed", data.counts.missed],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, count]) => (
          <div key={label} className="rounded-lg border border-surface-border px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
            <dd className={`font-display text-xl font-bold ${label === "Overdue" && count > 0 ? "text-priority-red" : "text-ink-900"}`}>{count}</dd>
          </div>
        ))}
      </dl>
      {data.next_due && (
        <p className="text-[13px] text-ink-900">
          Next due: <strong>{data.next_due.reason_label || "Follow-up"}</strong> · {formatDateTime(data.next_due.scheduled_for)}
          {data.next_due.provider_name ? ` · ${data.next_due.provider_name}` : ""}
          {data.next_due.overdue && <span className="font-semibold text-priority-red"> · Overdue</span>}
        </p>
      )}
    </div>
  );
}

/** Follow-up in the client record — the same appointments as the follow-up
 * worklist: mark done with a contact note, missed with a reason, rebook a missed
 * one, or add a new one. Missed with active risk escalates the same day. */
export function FollowUpPanel({
  patientId,
  clientName,
  data,
  onChanged,
}: {
  patientId: string;
  clientName: string;
  data: ClientFollowUps | null;
  onChanged: (next?: ClientFollowUps) => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [rebookAt, setRebookAt] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One stable id per missed row, so a retried rebook never double-books.
  const rebookIds = useRef(new Map<string, string>());
  const [openedAt] = useState(() => Date.now());

  async function run(work: () => Promise<ClientFollowUps | undefined>, failure: string, done: string) {
    setError(null);
    setNotice(null);
    try {
      const next = await work();
      setNotice(done);
      onChanged(next);
    } catch (e) {
      setError(errorText(e, failure));
    }
  }

  function defaultRebook(row: ClientFollowUpRow) {
    // Mockup: next day when a risk is active, a week otherwise — a starting point the clinician changes.
    const at = new Date(openedAt + (data?.active_risk ? 1 : 7) * 24 * 60 * 60 * 1000);
    at.setHours(9, 0, 0, 0);
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return rebookAt[row.id] ?? local;
  }

  if (!data) return <p className="text-[13px] text-ink-500">Loading follow-up…</p>;
  const rows = [...data.results].sort((a, b) => {
    const aDue = a.status === "SCHEDULED" || a.status === "CHECKED_IN";
    const bDue = b.status === "SCHEDULED" || b.status === "CHECKED_IN";
    if (aDue !== bDue) return aDue ? -1 : 1;
    return a.scheduled_for.localeCompare(b.scheduled_for);
  });

  return (
    <div className="flex flex-col gap-3">
      <FollowUpStats data={data} />
      <ErrorNote>{error}</ErrorNote>
      {notice && (
        <Callout tone="success" role="status">
          {notice}
        </Callout>
      )}
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-500">
          No follow-up scheduled yet. The facility schedule books it at a planned discharge, or add one now.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[860px]`} aria-label="Follow-up for this client">
            <thead>
              <tr>
                <th className={TH}>Follow-up</th>
                <th className={TH}>Due</th>
                <th className={TH}>With</th>
                <th className={TH}>Status</th>
                <th className={TH}>Note</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = STATUS[row.status] ?? { label: row.status, tone: "neutral" as const };
                const due = row.status === "SCHEDULED" || row.status === "CHECKED_IN";
                return (
                  <tr key={row.id}>
                    <td className={TD}>
                      <strong>{row.reason_label || "Follow-up"}</strong>
                      <div className="text-[11px] text-ink-500">{ORIGIN[row.origin]}</div>
                      {row.notes && <div className="text-[11px] text-ink-500">{row.notes}</div>}
                    </td>
                    <td className={TD}>
                      {formatDate(row.scheduled_for)}
                      {row.overdue && <span className="ml-1"><Tag tone="risk">overdue</Tag></span>}
                    </td>
                    <td className={TD}>{row.provider_name || "—"}</td>
                    <td className={TD}>
                      <Tag tone={status.tone}>{status.label}</Tag>
                    </td>
                    <td className={TD}>
                      {due ? (
                        <input
                          className={INPUT}
                          aria-label={`Contact note for ${row.reason_label || "follow-up"}`}
                          placeholder="Contact note (required for Done)"
                          value={notes[row.id] ?? ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                        />
                      ) : (
                        <>
                          {row.contact_note ? row.contact_note.text : "—"}
                          {row.contact_note && (
                            <div className="text-[11px] text-ink-500">
                              {row.contact_note.by} {formatDateTime(row.contact_note.at)}
                            </div>
                          )}
                          {row.missed_reason && <div className="text-[11px] text-ink-500">reason: {row.missed_reason_label}</div>}
                          {row.escalate && (
                            <div className="mt-1">
                              <Tag tone="risk">Active risk — contact client and next of kin today</Tag>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className={TD}>
                      {due && (
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            className={`${BTN} ${BTN_SM}`}
                            disabled={!(notes[row.id] ?? "").trim()}
                            onClick={() =>
                              accessToken &&
                              void run(
                                () => completeFollowUp(accessToken, row.id, notes[row.id] ?? ""),
                                "Couldn't record the contact.",
                                "Follow-up marked done.",
                              )
                            }
                          >
                            Done
                          </button>
                          <div className="flex gap-1.5">
                            <select
                              className={`${INPUT} !py-1 text-xs`}
                              aria-label="If missed — reason"
                              value={reasons[row.id] ?? ""}
                              onChange={(e) => setReasons((r) => ({ ...r, [row.id]: e.target.value }))}
                            >
                              <option value="">If missed — reason</option>
                              {vs.options("missed-appointment-reason").map((o) => (
                                <option key={o.code} value={o.code}>{o.display}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className={`${BTN_GHOST} ${BTN_SM}`}
                              disabled={!reasons[row.id]}
                              onClick={() =>
                                accessToken &&
                                void run(
                                  async () => {
                                    await markAppointmentMissed(accessToken, row.id, reasons[row.id] ?? "");
                                    return undefined;
                                  },
                                  "Couldn't mark the follow-up missed.",
                                  data.active_risk
                                    ? "Missed appointment recorded — active risk: contact the client and next of kin today."
                                    : "Missed appointment recorded.",
                                )
                              }
                            >
                              Missed appointment
                            </button>
                          </div>
                        </div>
                      )}
                      {row.status === "NO_SHOW" && !row.dna_actioned_at && (
                        <div className="flex flex-col gap-1.5">
                          <input
                            type="datetime-local"
                            className={`${INPUT} !py-1 text-xs`}
                            aria-label="Rebook for"
                            value={defaultRebook(row)}
                            onChange={(e) => setRebookAt((r) => ({ ...r, [row.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className={`${BTN_GHOST} ${BTN_SM}`}
                            onClick={() => {
                              if (!accessToken) return;
                              if (!rebookIds.current.has(row.id)) rebookIds.current.set(row.id, newRequestId());
                              void run(
                                () =>
                                  rebookMissedFollowUp(accessToken, row.id, {
                                    scheduled_for: new Date(defaultRebook(row)).toISOString(),
                                    client_request_id: rebookIds.current.get(row.id) ?? newRequestId(),
                                  }),
                                "Couldn't rebook the follow-up.",
                                "Contacted and rebooked.",
                              );
                            }}
                          >
                            Contacted &amp; rebooked
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <BookingForm
          target={{ patientId, name: clientName, defaultReason: "" }}
          onCancel={() => setAdding(false)}
          onBooked={async (message) => {
            setAdding(false);
            setNotice(message);
            onChanged();
          }}
        />
      ) : (
        <div>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setAdding(true)}>
            + Add follow-up
          </button>
        </div>
      )}
    </div>
  );
}
