import { useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { recordAssessment, type InstrumentDef, type OutcomeScore } from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, SelectChoices } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";

/** Record one completed assessment: item by item (total derived, items kept)
 * or as a total, depending on the instrument, plus any supplementary questions
 * (EPDS item 10, MDQ co-occurrence / impairment, PAWSS threshold) and the
 * timepoint. Scores are stored as entered — the form does not infer or estimate
 * any answer; a rule-based positive screen (MDQ) is derived by the server. */
export function AssessmentForm({
  patientId,
  def,
  context,
  hasPrevious = false,
  showProvenance = false,
  defaultTimepoint,
  onSaved,
  onCancel,
}: {
  patientId: string;
  def: InstrumentDef;
  /** Where it was recorded (intake, outcomes, …). */
  context: string;
  /** A score already exists — the timepoint defaults to "Repeat" rather than "Baseline". */
  hasPrevious?: boolean;
  /** Show who is recording it and allow an earlier assessment date (Outcomes). */
  showProvenance?: boolean;
  /** Overrides the baseline / repeat default (e.g. "DISCHARGE"). */
  defaultTimepoint?: string;
  onSaved: (score: OutcomeScore) => void;
  onCancel: () => void;
}) {
  const { accessToken, profile } = useAuth();
  const vs = useValueSets();
  const [answers, setAnswers] = useState<(number | null)[]>(() => def.items.map(() => null));
  const [total, setTotal] = useState("");
  const [positive, setPositive] = useState(false);
  const [detail, setDetail] = useState<Record<string, string | number>>({});
  const [timepoint, setTimepoint] = useState(defaultTimepoint ?? (hasPrevious ? "REPEAT" : "BASELINE"));
  const [note, setNote] = useState("");
  const [assessedAt, setAssessedAt] = useState("");
  // Latest allowed assessment time (local), fixed when the form opens.
  const [latestAllowed] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplementary = def.supplementary ?? [];
  const gated = Boolean(def.gate && detail[def.gate.key] === def.gate.value);
  const running = answers.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const answered = answers.filter((a) => a !== null).length;
  const extrasDone = supplementary.every((q) => q.key in detail);
  const ready =
    extrasDone &&
    (gated ||
      (def.kind === "items" ? answered === def.items.length : total.trim() !== "" && Number.isInteger(Number(total))));
  const selfHarm = (def.code === "PHQ9" && (answers[8] ?? 0) > 0) || (def.code === "EPDS" && Number(detail.item10 ?? 0) > 0);

  async function save() {
    if (!accessToken || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await recordAssessment(accessToken, patientId, {
        instrument: def.code,
        ...(gated ? {} : def.kind === "items" ? { answers: answers as number[] } : { total: Number(total) }),
        positive: def.hasPositiveFlag ? positive : undefined,
        detail: supplementary.length ? detail : undefined,
        timepoint: timepoint || undefined,
        context,
        note: note.trim() || undefined,
        assessed_at: assessedAt ? new Date(assessedAt).toISOString() : undefined,
      });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e, "Couldn't record the assessment."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-surface-border p-3">
      {def.approval === "illustrative" && (
        <Callout tone="warning" className="mb-2">
          Bands and change thresholds for {def.name} are illustrative until a clinician approves them.
        </Callout>
      )}
      <ErrorNote>{error}</ErrorNote>
      {def.gate &&
        supplementary
          .filter((q) => q.key === def.gate?.key)
          .map((q) => <SupplementaryQuestion key={q.key} code={def.code} question={q} value={detail[q.key]} onChange={(v) => setDetail((d) => ({ ...d, [q.key]: v }))} />)}
      {gated ? (
        <p className="text-[13px] text-ink-500">Threshold not met — the screen ends here with a total of 0.</p>
      ) : def.kind === "items" ? (
        <ol className="flex flex-col gap-3">
          {def.items.map((item, index) => (
            <li key={item.text} className="text-[13px]">
              <div className="mb-1 text-ink-900">
                {index + 1}. {item.text}
              </div>
              <div role="radiogroup" aria-label={`${def.name} item ${index + 1}`} className="flex flex-wrap gap-x-4 gap-y-1">
                {item.options.map((option) => (
                  <label key={option.points} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name={`${def.code}-${index}`}
                      checked={answers[index] === option.points}
                      onChange={() => setAnswers((prev) => prev.map((a, i) => (i === index ? option.points : a)))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <label className="flex max-w-xs flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
          {def.name} total (0–{def.max})
          <input type="number" min={0} max={def.max} className={INPUT} value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
      )}
      {supplementary
        .filter((q) => q.key !== def.gate?.key)
        .map((q) => (
          <SupplementaryQuestion key={q.key} code={def.code} question={q} value={detail[q.key]} onChange={(v) => setDetail((d) => ({ ...d, [q.key]: v }))} />
        ))}
      {def.positiveRule && (
        <p className="mt-2 text-xs text-ink-500">Positive or negative is derived from the screen’s published rule when recorded.</p>
      )}
      {selfHarm && (
        <Callout tone="danger" className="mt-2">
          Self-harm item positive — a risk proposal will be raised for your decision.
        </Callout>
      )}
      {def.hasPositiveFlag && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={positive} onChange={(e) => setPositive(e.target.checked)} />
          Screen positive by the instrument’s own criteria
        </label>
      )}
      <label className="mt-3 flex max-w-xs flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
        Timepoint
        <SelectChoices options={vs.options("assessment-timepoint")} value={timepoint} onChange={setTimepoint} />
      </label>
      {showProvenance && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
            Assessment date (if not now)
            <input
              type="datetime-local"
              className={INPUT}
              value={assessedAt}
              max={latestAllowed}
              onChange={(e) => setAssessedAt(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
            Provider
            <span className="py-2 text-[13px] font-normal normal-case text-ink-900">
              {profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email : "You"} — recorded under your sign-in
            </span>
          </div>
        </div>
      )}
      <input className={`${INPUT} mt-3`} aria-label="Note" placeholder="Brief note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Record score"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
        {def.kind === "items" && !gated && (
          <span className="text-xs text-ink-500">
            {answered}/{def.items.length} answered · running total {running}/{def.max}
          </span>
        )}
      </div>
    </div>
  );
}

function SupplementaryQuestion({
  code,
  question,
  value,
  onChange,
}: {
  code: string;
  question: NonNullable<InstrumentDef["supplementary"]>[number];
  value: string | number | undefined;
  onChange: (value: string | number) => void;
}) {
  return (
    <div className="mt-3 text-[13px]">
      <div className="mb-1 text-ink-900">{question.text}</div>
      <div role="radiogroup" aria-label={question.text} className="flex flex-wrap gap-x-4 gap-y-1">
        {question.options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-1.5">
            <input type="radio" name={`${code}-${question.key}`} checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
