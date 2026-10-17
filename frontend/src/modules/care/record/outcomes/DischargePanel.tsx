import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../../auth/useAuth";
import { closeEpisode, startNewEpisode } from "../../../../lib/carePathwayApi";
import {
  saveDischargeAnswers,
  type DischargeAnswers,
  type DischargeChecklist,
  type OutcomesOverview,
} from "../../../../lib/carePlanOutcomesApi";
import { bookFollowUp } from "../../../../lib/dischargeApi";
import { formatDateTime, newRequestId } from "../../shared/format";
import { clientRecordPath } from "../../shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, Card, ErrorNote, SelectChoices, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";

const HOURS_72 = 72 * 60 * 60 * 1000;

/** Episode & discharge: a planned discharge is gated by the same checklist as
 * an inpatient discharge (server-enforced); any other outcome needs a reason. */
export function DischargePanel({
  patientId,
  overview,
  checklist,
  onChanged,
}: {
  patientId: string;
  overview: OutcomesOverview;
  checklist: DischargeChecklist | null;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [outcome, setOutcome] = useState("PLANNED");
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable for the panel: a retried "book 72-hour contact" never double-books.
  const contactRequestId = useRef(newRequestId());

  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(errorText(e, failure));
    } finally {
      setBusy(false);
    }
  }

  const answer = (patch: DischargeAnswers) =>
    accessToken && void run(() => saveDischargeAnswers(accessToken, patientId, patch), "Couldn't save the checklist.");

  const done = overview.episode.outcome;
  if (!overview.episode.open) {
    return (
      <Card title="Episode & discharge">
        <ErrorNote>{error}</ErrorNote>
        {done ? (
          <Callout tone="success">
            <strong>{vs.label("episode-outcome", done.outcome)}</strong> · {formatDateTime(done.recorded_at)}
            {done.destination ? ` · ${vs.label("episode-destination", done.destination)}` : ""}
            {done.reason ? ` — ${done.reason}` : ""}
            {done.recorded_by ? ` · ${done.recorded_by}` : ""}
          </Callout>
        ) : (
          <p className="text-[13px] text-ink-500">There is no open episode.</p>
        )}
        <button
          type="button"
          className={`${BTN_GHOST} mt-3`}
          disabled={busy}
          onClick={() => accessToken && void run(() => startNewEpisode(accessToken, patientId), "Couldn't start a new episode.")}
        >
          Start a new episode of care
        </button>
      </Card>
    );
  }

  const items = checklist?.items ?? [];
  const complete = items.length > 0 && items.every((i) => i.ok);
  const answers = checklist?.answers ?? {};
  const editable = checklist?.source === "episode";
  const planned = outcome === "PLANNED";

  return (
    <Card title="Episode & discharge" aside={<span className="text-[11px] text-ink-500">planned discharge is gated by the checklist</span>}>
      <ErrorNote>{error}</ErrorNote>
      <div className={`rounded-lg border p-3 ${complete ? "border-brand-green bg-brand-green-tint" : "border-priority-orange bg-priority-orange-tint"}`}>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-900">
          Discharge checklist · {items.filter((i) => i.ok).length}/{items.length} complete
        </h3>
        {checklist?.source === "inpatient" && (
          <p className="mb-2 text-[12px] text-ink-500">Answers come from the signed inpatient discharge summary.</p>
        )}
        <ul className="flex flex-col gap-2 text-[13px]">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2">
              <Tag tone={item.ok ? "brand" : "warn"}>{item.ok ? "✓" : "○"} {item.label}</Tag>
              {!item.ok && editable && item.key === "meds" && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" disabled={busy} onChange={(e) => answer({ meds_reconciled: e.target.checked })} />
                  Mark medicines reconciled
                </label>
              )}
              {!item.ok && editable && item.key === "teach_back" && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" disabled={busy} onChange={(e) => answer({ teach_back: e.target.checked })} />
                  Teach-back done
                </label>
              )}
              {!item.ok && editable && item.key === "counter_referral" && (
                <select className={`${INPUT} !w-auto !py-1 text-xs`} aria-label="Counter-referral" disabled={busy} value={answers.counter_referral ?? ""} onChange={(e) => answer({ counter_referral: e.target.value as DischargeAnswers["counter_referral"] })}>
                  <option value="">Choose…</option>
                  <option value="SENT">Sent to the referring service</option>
                  <option value="NO_REFERRER">No referring service</option>
                </select>
              )}
              {!item.ok && editable && item.key === "naloxone" && (
                <select className={`${INPUT} !w-auto !py-1 text-xs`} aria-label="Naloxone" disabled={busy} value={answers.naloxone ?? ""} onChange={(e) => answer({ naloxone: e.target.value as DischargeAnswers["naloxone"] })}>
                  <option value="">Choose…</option>
                  <option value="OFFERED">Offered and accepted</option>
                  <option value="DECLINED">Offered and declined</option>
                </select>
              )}
              {!item.ok && item.key === "follow_up" && (
                <>
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() =>
                      accessToken &&
                      void run(
                        () =>
                          bookFollowUp(accessToken, {
                            patient: patientId,
                            reason: "CONTACT_72H",
                            scheduled_for: new Date(Date.now() + HOURS_72).toISOString(),
                            client_request_id: contactRequestId.current,
                          }),
                        "Couldn't book the contact.",
                      )
                    }
                  >
                    Book 72-hour contact
                  </button>
                  {editable && (
                    <input
                      className={`${INPUT} !w-auto !py-1 text-xs`}
                      aria-label="No follow-up needed because"
                      placeholder="…or why none is needed"
                      defaultValue={answers.no_follow_up_reason ?? ""}
                      onBlur={(e) => e.target.value.trim() && answer({ no_follow_up_reason: e.target.value })}
                    />
                  )}
                </>
              )}
              {!item.ok && item.key === "safety" && (
                <Link to={clientRecordPath(patientId, "care-plan")} className={`${BTN_GHOST} ${BTN_SM}`}>
                  Open safety plan
                </Link>
              )}
              {!item.ok && item.key === "inpatient" && (
                <span className="text-[12px] text-ink-500">Discharge the inpatient stay from Discharge planning first.</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Episode outcome</span>
          <SelectChoices options={vs.options("episode-outcome")} value={outcome} onChange={setOutcome} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Destination</span>
          <SelectChoices options={vs.options("episode-destination")} value={destination} placeholder="—" onChange={setDestination} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className={FIELD_LABEL}>Notes / reason {planned ? "" : "(required)"}</span>
          <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      {planned && !complete && (
        <p className="mt-2 text-[12px] text-priority-orange">
          Complete the discharge checklist before recording a planned discharge — or choose another outcome.
        </p>
      )}
      <button
        type="button"
        className={`${BTN} mt-3`}
        disabled={busy || (planned && !complete) || (!planned && !reason.trim())}
        onClick={() =>
          accessToken && void run(() => closeEpisode(accessToken, patientId, { outcome, destination, reason }), "Couldn't record the outcome.")
        }
      >
        Record episode outcome
      </button>
    </Card>
  );
}
