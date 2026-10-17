import type { GroupClient } from "../../../lib/groupProgrammeApi";
import { BTN, BTN_GHOST, TABLE, TD, TH } from "../shared/styles";
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

/** The mockup's "Review before confirmation" card. Nothing is saved until Confirm. */
export function ReviewPanel({
  summary,
  rows,
  attendanceLabel,
  confirming,
  onConfirm,
  onReturn,
}: {
  summary: ReviewSummary;
  rows: { client: GroupClient; entry: DraftAttendance }[];
  attendanceLabel: (code: string) => string;
  confirming: boolean;
  onConfirm: () => void;
  onReturn: () => void;
}) {
  const anyRisk = rows.some((row) => row.entry.riskDisclosure);
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
                  {entry.riskDisclosure ? "Individual clinical review required" : "None flagged"}
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
        <button type="button" className={BTN} onClick={onConfirm} disabled={confirming}>
          {confirming ? "Saving…" : "Confirm and save session"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onReturn} disabled={confirming}>
          Return to edit
        </button>
      </div>
    </section>
  );
}
