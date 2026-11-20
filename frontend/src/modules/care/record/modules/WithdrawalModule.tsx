import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  completeWithdrawalManagement,
  getInstruments,
  getWithdrawal,
  recordUnableToScore,
  type InstrumentDef,
  type WithdrawalScale,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
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
  const [benzodiazepine, setBenzodiazepine] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [scoring, setScoring] = useState<string | null>(null);
  const [unable, setUnable] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [management, setManagement] = useState<"open" | "completed" | "none">("none");
  const [finishing, setFinishing] = useState(false);
  const [finishNote, setFinishNote] = useState("");
  const [finishBusy, setFinishBusy] = useState(false);

  const load = useCallback(() => {
    if (!accessToken) return;
    getWithdrawal(accessToken, patientId)
      .then((r) => {
        setScales(r.scales);
        setRecommended(r.recommended);
        setSubstance(r.substance);
        setBenzodiazepine(r.benzodiazepine);
        setManagement(r.management);
      })
      .catch((e) => setError(errorText(e, "Couldn't load the withdrawal chart.")));
  }, [accessToken, patientId]);
  useEffect(() => {
    load();
    if (accessToken)
      getInstruments(accessToken)
        .then((r) => setDefs(r.results.filter((d) => d.withdrawal)))
        .catch(() => undefined);
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

  async function finish() {
    if (!accessToken) return;
    setFinishBusy(true);
    setError(null);
    try {
      await completeWithdrawalManagement(accessToken, patientId, finishNote);
      setFinishing(false);
      load();
    } catch (e) {
      setError(errorText(e, "Couldn't complete withdrawal management."));
    } finally {
      setFinishBusy(false);
    }
  }

  const shown = recommended && !showAll ? defs.filter((d) => d.code === recommended) : defs;
  const lead = scales.find((s) => s.instrument === (recommended ?? shown[0]?.code));
  const leadDef = defs.find((d) => d.code === lead?.instrument);
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {/* At a glance: what is being withdrawn from, which scale, where it stands. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-surface-border bg-surface-card px-4 py-2.5 text-[13px] shadow-sm">
        <span>
          <span className="text-ink-500">Substance </span>
          <strong className="text-ink-900">{substance || "Not recorded"}</strong>
        </span>
        <span>
          <span className="text-ink-500">Scale </span>
          <strong className="text-ink-900">
            {defs.find((d) => d.code === recommended)?.name ?? "Choose below"}
          </strong>
        </span>
        <span>
          <span className="text-ink-500">Last score </span>
          <strong className="text-ink-900">
            {lead?.latest && leadDef
              ? `${lead.latest.score}/${leadDef.max} · ${lead.latest.band} · ${formatDateTime(lead.latest.at)}`
              : "None yet"}
          </strong>
        </span>
        {lead?.nextDueAt && (
          <span className={lead.overdue ? "font-semibold text-priority-red" : ""}>
            <span className={lead.overdue ? "" : "text-ink-500"}>
              {lead.overdue ? "Overdue since " : "Next due "}
            </span>
            <strong>{formatDateTime(lead.nextDueAt)}</strong>
          </span>
        )}
        <span className="ml-auto">
          {management === "completed" ? (
            <Tag tone="brand">Withdrawal management completed</Tag>
          ) : management === "open" ? (
            <Tag tone="warn">In care plan · in progress</Tag>
          ) : null}
        </span>
      </div>
      {benzodiazepine && (
        <Callout tone="warning">
          {recommended
            ? "Benzodiazepine withdrawal: the scale shown is the one your organisation approved for benzodiazepines. A psychiatric review is flagged."
            : "Benzodiazepine withdrawal: no withdrawal scale is approved for benzodiazepines in your organisation (an Org Admin approves one under Clinical Assessments). Use clinical review — a psychiatric review is flagged."}
        </Callout>
      )}
      {!recommended && !benzodiazepine && (
        <p className="text-[12.5px] text-ink-500">
          Set alcohol or opioids as the main substance in Intake → Substance use to open the
          matching scale, or choose a scale below.
        </p>
      )}
      {shown.map((def) => {
        const scale = scales.find((s) => s.instrument === def.code);
        return (
          <div key={def.code} className="rounded-lg border border-surface-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm">{def.name}</strong>
              {recommended === def.code && <Tag tone="brand">Suggested for this client</Tag>}
              {scale?.latest && (
                <Tag>
                  {scale.latest.score}/{def.max} · {scale.latest.band} ·{" "}
                  {formatDateTime(scale.latest.at)}
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
                Last attempt could not be scored (
                {REASONS.find(([v]) => v === scale.lastAttempt?.reason)?.[1] ??
                  scale.lastAttempt.reason}
                ). Consider delirium — use a delirium screen (e.g. 4AT), check glucose and request
                medical review. Re-attempt in 1 hour.
              </Callout>
            )}
            {scale && <WithdrawalTrend scale={scale} max={def.max} />}
            {scale && !scale.protocolConfigured && (
              <p className="mt-1 text-xs text-ink-muted">
                No facility thresholds are configured, so no due time or threshold alert is shown.
              </p>
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
                <select
                  className={INPUT}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Why it could not be scored"
                >
                  <option value="">Why couldn’t it be scored?</option>
                  {REASONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={!reason}
                  onClick={() => void saveUnable(def.code)}
                >
                  Record
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => setUnable(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={`${BTN} ${BTN_SM}`}
                  onClick={() => setScoring(def.code)}
                >
                  Score now
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => setUnable(def.code)}
                >
                  Unable to score
                </button>
              </div>
            )}
            {scale && scale.history.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-700 hover:text-ink-900">
                  History ({scale.history.length})
                </summary>
                <WithdrawalHistory scale={scale} />
              </details>
            )}
          </div>
        );
      })}
      {recommended && (
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM} self-start`}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show only the suggested scale" : "Score a different scale"}
        </button>
      )}
      {management === "open" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-4 py-3">
          {finishing ? (
            <>
              <input
                className={`${INPUT} min-w-[240px] flex-1`}
                aria-label="Closing note (optional)"
                placeholder="Closing note (optional) — e.g. scores settled, no further monitoring"
                value={finishNote}
                onChange={(event) => setFinishNote(event.target.value)}
              />
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={finishBusy}
                onClick={() => void finish()}
              >
                {finishBusy ? "Saving…" : "Confirm complete"}
              </button>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={() => setFinishing(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="mr-auto text-[13px] text-ink-700">
                When withdrawal has settled and no more scoring is needed, close it: the care-plan
                action and its tasks are completed.
              </span>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={() => setFinishing(true)}
              >
                Withdrawal management complete
              </button>
            </>
          )}
        </div>
      )}
      <p className="text-[11.5px] text-ink-500">
        Scoring only — item wording is not yet clinically approved. Medicines and doses follow the
        facility’s withdrawal protocol, not this screen.
      </p>
    </div>
  );
}
