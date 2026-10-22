import type { GroupClient, RiskFlag } from "../../../lib/groupProgrammeApi";
import { BTN, BTN_GHOST, INPUT, TABLE, TD, TH } from "../shared/styles";
import { clientLabel, type DraftAttendance } from "./model";

export interface ReviewSummary {
  category: string;
  topic: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  location: string;
  facilitator: string;
  documentedBy: string;
}

const OVERRIDE_MIN = 5;

/** The passage with the matched words emphasised. */
function Passage({ flag }: { flag: RiskFlag }) {
  const at = flag.passage.toLowerCase().indexOf(flag.matched.toLowerCase());
  if (at < 0) return <q className="italic">{flag.passage}</q>;
  return (
    <q className="italic">
      {flag.passage.slice(0, at)}
      <mark className="rounded bg-priority-red-tint px-0.5 not-italic text-priority-red">
        {flag.passage.slice(at, at + flag.matched.length)}
      </mark>
      {flag.passage.slice(at + flag.matched.length)}
    </q>
  );
}

/** The mockup's "Review before confirmation" card. Nothing is saved until
 * Confirm. Observations the served lexicon flags arrive pre-ticked as a risk
 * disclosure (individual alert + follow-up on that client's record only); the
 * clinician may untick one only by saying why — the reason is kept in the audit. */
export function ReviewPanel({
  summary,
  rows,
  riskFlags,
  onEntryChange,
  attendanceLabel,
  confirming,
  onConfirm,
  onReturn,
}: {
  summary: ReviewSummary;
  rows: { client: GroupClient; entry: DraftAttendance }[];
  riskFlags: Record<string, RiskFlag[]>;
  onEntryChange: (clientId: string, updates: DraftAttendance) => void;
  attendanceLabel: (code: string) => string;
  confirming: boolean;
  onConfirm: () => void;
  onReturn: () => void;
}) {
  const anyRisk = rows.some((row) => row.entry.riskDisclosure);
  const flagMap = new Map(Object.entries(riskFlags));
  const flagsFor = (id: string) => flagMap.get(id) ?? [];
  const unresolved = rows.some(
    ({ client, entry }) =>
      flagsFor(client.id).length > 0 &&
      !entry.riskDisclosure &&
      (entry.riskOverrideReason?.trim().length ?? 0) < OVERRIDE_MIN,
  );
  return (
    <section
      id="group-session-review"
      className="grid scroll-mt-4 gap-3 rounded-lg border border-surface-border bg-surface-card p-4"
      aria-labelledby="group-review-title"
    >
      <h3 id="group-review-title" className="text-[15px] font-bold text-ink-900">
        Review before confirmation
      </h3>
      <div className="text-[13px] text-ink-900">
        <strong>
          {summary.category} · {summary.topic}
        </strong>
        <br />
        {summary.sessionDate} · {summary.startTime}–{summary.endTime} · {summary.location}
        <br />
        Facilitator: {summary.facilitator} · Documenting staff: {summary.documentedBy}
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Client</th>
              <th className={TH}>Attendance</th>
              <th className={TH}>Individual note</th>
              <th className={TH}>Review flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ client, entry }) => (
              <tr key={client.id}>
                <td className={TD}>{clientLabel(client)}</td>
                <td className={TD}>{attendanceLabel(entry.attendance ?? "")}</td>
                <td className={TD}>
                  {entry.observation?.trim()
                    ? "Recorded in this client entry"
                    : "No observation recorded"}
                </td>
                <td className={TD}>
                  {flagsFor(client.id).length > 0 ? (
                    <div className="flex flex-col gap-1.5 text-xs">
                      <span className="font-semibold text-priority-red">
                        Possible risk language detected
                      </span>
                      {flagsFor(client.id).map((flag) => (
                        <Passage key={`${flag.matched}-${flag.passage}`} flag={flag} />
                      ))}
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(entry.riskDisclosure)}
                          onChange={(e) =>
                            onEntryChange(client.id, {
                              riskDisclosure: e.target.checked,
                              followUp: e.target.checked || entry.followUp,
                            })
                          }
                        />
                        Risk disclosure — alert and follow-up on this client’s record
                      </label>
                      {!entry.riskDisclosure && (
                        <label className="flex flex-col gap-1">
                          <span>Why this is not a risk disclosure (kept in the audit)</span>
                          <textarea
                            rows={2}
                            maxLength={500}
                            className={INPUT}
                            value={entry.riskOverrideReason ?? ""}
                            onChange={(e) =>
                              onEntryChange(client.id, { riskOverrideReason: e.target.value })
                            }
                          />
                        </label>
                      )}
                    </div>
                  ) : entry.riskDisclosure ? (
                    "Individual clinical review required"
                  ) : (
                    "None flagged"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyRisk && (
        <div className="rounded-lg border border-priority-orange bg-priority-orange-tint px-3.5 py-3 text-xs text-ink-900">
          At least one individual risk disclosure is flagged. Follow-up is tracked only in the
          relevant client entry; no disclosure text appears in the shared session summary.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {unresolved && (
          <span role="status" className="w-full text-xs text-priority-red">
            Give the reason for each flagged observation you are not recording as a risk disclosure.
          </span>
        )}
        <button type="button" className={BTN} onClick={onConfirm} disabled={confirming || unresolved}>
          {confirming ? "Saving…" : "Confirm and save session"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onReturn} disabled={confirming}>
          Return to edit
        </button>
      </div>
    </section>
  );
}
