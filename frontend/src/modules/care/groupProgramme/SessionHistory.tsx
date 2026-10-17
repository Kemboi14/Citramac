import type { GroupSessionRow } from "../../../lib/groupProgrammeApi";
import { BTN_GHOST, BTN_SM } from "../shared/styles";
import { Card } from "../shared/ui";
import { DETAILS, DETAILS_SUMMARY, NOTE } from "./styles";

/** The mockup's "Session history and corrections". Shared facts and counts only —
 * individual observations are never shown in this shared list. */
export function SessionHistory({
  sessions,
  onCorrectDetails,
  onCorrectEntry,
}: {
  sessions: GroupSessionRow[];
  onCorrectDetails: (id: string) => void;
  onCorrectEntry: (id: string) => void;
}) {
  const recent = [...sessions]
    .sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at))
    .slice(0, 10);
  return (
    <details className={DETAILS}>
      <summary className={DETAILS_SUMMARY}>Session history and corrections</summary>
      <div className="p-3.5">
        <Card title="Recent sessions and attendance">
          {recent.length ? (
            <div className="grid gap-2.5">
              {recent.map((session) => (
                <article
                  key={session.id}
                  className="rounded-[9px] border border-surface-border bg-surface-card p-3.5"
                >
                  <h3 className="mb-1 text-sm font-bold text-ink-900">
                    {session.category} · {session.topic}
                  </h3>
                  <div className="mb-2 text-[11px] text-ink-500">
                    {session.session_date} · {session.start_time}–{session.end_time} · Facilitator:{" "}
                    {session.facilitator} · Documented by {session.documented_by}
                  </div>
                  <div className="mb-2 text-[11px] text-ink-500">
                    {session.entry_count} client records linked · {session.present_count} present ·{" "}
                    {session.not_present_count} not present
                  </div>
                  <div className="mb-2 text-[11px] text-ink-500">
                    {session.follow_ups_outstanding} individual follow-up task(s) outstanding.
                    Individual observations are not displayed in this shared session list.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      onClick={() => onCorrectDetails(session.id)}
                    >
                      Correct session details
                    </button>
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      onClick={() => onCorrectEntry(session.id)}
                    >
                      Correct a client entry
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={NOTE}>No group sessions have been confirmed.</div>
          )}
        </Card>
      </div>
    </details>
  );
}
