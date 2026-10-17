import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  getInstruments,
  getWithdrawal,
  recordUnableToScore,
  type InstrumentDef,
  type WithdrawalScale,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { AssessmentForm } from "../intake/AssessmentForm";
import { WithdrawalHistory, WithdrawalTrend } from "./WithdrawalChart";

const REASONS: [string, string][] = [
  ["SEDATED", "Too drowsy / sedated"],
  ["AGITATED", "Too agitated"],
  ["DECLINED", "Declined"],
  ["COMMUNICATION", "Language / communication barrier"],
  ["CONFUSED", "Confused — possible delirium"],
];

/** Withdrawal charting. Scores go to the shared outcome store; the facility's
 * thresholds and re-score intervals come from configuration, so with none set
 * this shows the score and band only — it never suggests a dose. The scale the
 * intake's main substance suggests is shown first; any other can still be chosen. */
export function WithdrawalModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [defs, setDefs] = useState<InstrumentDef[]>([]);
  const [scales, setScales] = useState<WithdrawalScale[]>([]);
  const [recommended, setRecommended] = useState<string | null>(null);
  const [substance, setSubstance] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [scoring, setScoring] = useState<string | null>(null);
  const [unable, setUnable] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    getWithdrawal(accessToken, patientId).then((r) => { setScales(r.scales); setRecommended(r.recommended); setSubstance(r.substance); }).catch((e) => setError(errorText(e, "Couldn't load the withdrawal chart.")));
  }, [accessToken, patientId]);
  useEffect(() => {
    load();
    if (accessToken) getInstruments(accessToken).then((r) => setDefs(r.results.filter((d) => d.withdrawal))).catch(() => undefined);
  }, [accessToken, load]);

  async function saveUnable(code: string) {
    if (!accessToken || !reason) return;
    try {
      await recordUnableToScore(accessToken, patientId, code, reason);
      setUnable(null);
      setReason("");
      load();
    } catch (e) {
      setError(errorText(e, "Couldn't record that."));
    }
  }

  const shown = recommended && !showAll ? defs.filter((d) => d.code === recommended) : defs;
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {!recommended && (
        <Callout>
          {substance ? `Main substance recorded as “${substance}”.` : "No main substance is recorded yet."} Set alcohol or opioids in Intake → Substance use to open the matching scale; you can still choose a scale below.
        </Callout>
      )}
      <Callout tone="warning">
        Scoring only. Item wording is from the owner’s mockup and is not yet clinically approved. Medicines and doses follow the facility’s withdrawal protocol, not this screen.
      </Callout>
      {shown.map((def) => {
        const scale = scales.find((s) => s.instrument === def.code);
        return (
          <div key={def.code} className="rounded-lg border border-surface-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm">{def.name}</strong>
              {recommended === def.code && <Tag tone="brand">Suggested for this client</Tag>}
              {scale?.latest && (
                <Tag>
                  {scale.latest.score}/{def.max} · {scale.latest.band} · {formatDateTime(scale.latest.at)}
                </Tag>
              )}
              {scale?.nextDueAt && (
                <Tag tone={scale.overdue ? "risk" : "neutral"}>
                  {scale.overdue ? "Overdue since " : "Next due "}
                  {formatDateTime(scale.nextDueAt)}
                </Tag>
              )}
            </div>
            {scale?.flags.map((f) => (
              <Callout key={f} tone="warning" className="mt-2">
                {f}
              </Callout>
            ))}
            {scale?.lastAttempt && (
              <Callout tone="warning" role="alert" className="mt-2">
                Last attempt could not be scored ({REASONS.find(([v]) => v === scale.lastAttempt?.reason)?.[1] ?? scale.lastAttempt.reason}). Consider delirium — use a delirium screen (e.g. 4AT), check glucose and request medical review. Re-attempt in 1 hour.
              </Callout>
            )}
            {scale && <WithdrawalTrend scale={scale} max={def.max} />}
            {scale && !scale.protocolConfigured && (
              <p className="mt-1 text-xs text-ink-muted">No facility thresholds are configured, so no due time or threshold alert is shown.</p>
            )}
            {scoring === def.code ? (
              <AssessmentForm
                patientId={patientId}
                def={def}
                context="WITHDRAWAL"
                onSaved={() => {
                  setScoring(null);
                  load();
                }}
                onCancel={() => setScoring(null)}
              />
            ) : unable === def.code ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why it could not be scored">
                  <option value="">Why couldn’t it be scored?</option>
                  {REASONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!reason} onClick={() => void saveUnable(def.code)}>
                  Record
                </button>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setUnable(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setScoring(def.code)}>
                  Score now
                </button>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setUnable(def.code)}>
                  Unable to score
                </button>
              </div>
            )}
            {scale && <WithdrawalHistory scale={scale} />}
          </div>
        );
      })}
      {recommended && (
        <button type="button" className={`${BTN_GHOST} ${BTN_SM} self-start`} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show only the suggested scale" : "Score a different scale"}
        </button>
      )}
    </div>
  );
}
