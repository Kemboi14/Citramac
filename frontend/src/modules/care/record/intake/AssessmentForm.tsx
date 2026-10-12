import { useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { recordAssessment, type InstrumentDef, type OutcomeScore } from "../../../../lib/carePathwayApi";
import { errorText } from "../../triage/helpers";
import { BTN, BTN_GHOST, INPUT } from "../../shared/styles";
import { Callout, ErrorNote } from "../../shared/ui";

/** Record one completed assessment: item by item (total derived, items kept)
 * or as a total, depending on the instrument. Scores are stored as entered —
 * the form does not infer or estimate any answer. */
export function AssessmentForm({
  patientId,
  def,
  context,
  onSaved,
  onCancel,
}: {
  patientId: string;
  def: InstrumentDef;
  context: string;
  onSaved: (score: OutcomeScore) => void;
  onCancel: () => void;
}) {
  const { accessToken } = useAuth();
  const [answers, setAnswers] = useState<(number | null)[]>(() => def.items.map(() => null));
  const [total, setTotal] = useState("");
  const [positive, setPositive] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = answers.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const answered = answers.filter((a) => a !== null).length;
  const ready =
    def.kind === "items" ? answered === def.items.length : total.trim() !== "" && Number.isInteger(Number(total));

  async function save() {
    if (!accessToken || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await recordAssessment(accessToken, patientId, {
        instrument: def.code,
        ...(def.kind === "items" ? { answers: answers as number[] } : { total: Number(total) }),
        positive: def.hasPositiveFlag ? positive : undefined,
        context,
        note: note.trim() || undefined,
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
      {def.kind === "items" ? (
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
      {def.hasPositiveFlag && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={positive} onChange={(e) => setPositive(e.target.checked)} />
          Screen positive by the instrument’s own criteria
        </label>
      )}
      <input className={`${INPUT} mt-3`} aria-label="Note" placeholder="Brief note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Record score"}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel}>
          Cancel
        </button>
        {def.kind === "items" && (
          <span className="text-xs text-ink-500">
            {answered}/{def.items.length} answered · running total {running}/{def.max}
          </span>
        )}
      </div>
    </div>
  );
}
