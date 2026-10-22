import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  completeGroupFollowUp,
  getClientGroupEntries,
  type ClientGroupEntry,
} from "../../../lib/groupProgrammeApi";
import { BTN_GHOST, BTN_SM } from "../shared/styles";
import { Callout, Card } from "../shared/ui";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-surface-border py-[7px] text-xs text-ink-900">
      <strong>{label}:</strong> {children}
    </div>
  );
}

/** The mockup's renderGroupProgrammeRecordEntries: this client's own group entries
 * only, with the shared session facts. Rendered only when the client has entries. */
export function GroupRecordEntries({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState<ClientGroupEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getClientGroupEntries(accessToken, patientId)
      .then((data) => {
        if (cancelled) return;
        setEntries(data.results);
        setLoadError(null);
      })
      .catch(
        (err) =>
          !cancelled &&
          setLoadError(
            err instanceof ApiError
              ? err.message
              : "Group psychotherapy entries could not be loaded.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  const complete = (entryId: string) => {
    if (!accessToken) return;
    setBusy(entryId);
    setStatus("");
    completeGroupFollowUp(accessToken, entryId)
      .then((data) => setEntries(data.results))
      .catch((err) =>
        setStatus(err instanceof ApiError ? err.message : "The follow-up could not be updated."),
      )
      .finally(() => setBusy(null));
  };

  if (loadError) {
    return (
      <Callout tone="danger" role="alert" className="my-4">
        {loadError}
      </Callout>
    );
  }
  if (!entries.length) return null;

  return (
    <div className="my-4" aria-labelledby="group-record-title">
      <Card title={<span id="group-record-title">Group psychotherapy clinical entries</span>}>
        <div className="grid gap-2.5">
          {entries.map(({ session, ...entry }) => (
            <article
              key={entry.id}
              className="rounded-[9px] border border-surface-border bg-surface-card p-3.5"
            >
              <h3 className="mb-1 text-sm font-bold text-ink-900">
                {session.category} · {session.topic}
              </h3>
              <div className="mb-2 text-[11px] text-ink-500">
                {session.session_date} · {session.start_time}–{session.end_time} · Facilitator:{" "}
                {session.facilitator} · Documented by {session.documented_by}
              </div>
              <Row label="Session intervention">{session.description || "Not recorded"}</Row>
              <Row label="Location">{session.location || "Not recorded"}</Row>
              <Row label="Attendance">{entry.attendance_display}</Row>
              {entry.observation && <Row label="Individual observation">{entry.observation}</Row>}
              {entry.risk_disclosure && (
                <div
                  className="my-1 rounded-lg border border-priority-orange bg-priority-orange-tint px-3.5 py-3 text-xs text-ink-900"
                  role="status"
                >
                  Risk disclosure flagged for individual clinical review
                  {entry.follow_up_required ? "; follow-up task required" : ""}. Details are
                  restricted to this client record.
                </div>
              )}
              {!entry.risk_disclosure && entry.risk_override_reason && (
                <Row label="Risk screen">
                  Possible risk language was detected; not recorded as a disclosure —{" "}
                  {entry.risk_override_reason}
                </Row>
              )}
              {entry.follow_up_required && (
                <Row label="Follow-up">
                  {entry.follow_up_status}
                  {entry.follow_up_status !== "Completed" && (
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM} ml-1.5`}
                      disabled={busy === entry.id}
                      onClick={() => complete(entry.id)}
                    >
                      Mark completed
                    </button>
                  )}
                </Row>
              )}
              <div className="mt-2 text-[11px] text-ink-500">
                Linked session: {session.reference} · Version {entry.version}
              </div>
            </article>
          ))}
          <div role="status" aria-live="polite" className="text-xs text-ink-500">
            {status}
          </div>
        </div>
      </Card>
    </div>
  );
}
