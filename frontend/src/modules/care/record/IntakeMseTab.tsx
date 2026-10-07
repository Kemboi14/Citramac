import { useId, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { submitMse } from "../../../lib/clinicalApi";
import { BTN, INPUT } from "../shared/styles";
import { Callout, Card, ErrorNote, Field } from "../shared/ui";

/** The four MSE items the Assessment tab also shows — one value, shown in both. */
export interface SharedMse {
  mse_appearance: string;
  mse_behaviour: string;
  mse_mood: string;
  mse_affect: string;
}

const EXTRA_FIELDS = [
  ["speech", "Speech"],
  ["thought_process", "Thought process"],
  ["thought_content", "Thought content"],
  ["perception", "Perception"],
  ["cognition", "Cognition"],
  ["insight", "Insight"],
  ["judgment", "Judgment"],
  ["plan", "Plan"],
] as const;
type ExtraKey = (typeof EXTRA_FIELDS)[number][0];

const SHARED_FIELDS = [
  ["mse_appearance", "Appearance"],
  ["mse_behaviour", "Behavior"],
  ["mse_mood", "Mood"],
  ["mse_affect", "Affect"],
] as const;

/** Full Mental Status Exam, saved against the psychiatry encounter. */
export function IntakeMseTab({
  encounterId,
  shared,
  onSharedChange,
}: {
  encounterId: string | null;
  shared: SharedMse;
  onSharedChange: (patch: Partial<SharedMse>) => void;
}) {
  const { accessToken } = useAuth();
  const baseId = useId();
  const [extra, setExtra] = useState<Record<ExtraKey, string>>({
    speech: "",
    thought_process: "",
    thought_content: "",
    perception: "",
    cognition: "",
    insight: "",
    judgment: "",
    plan: "",
  });
  const [suicidal, setSuicidal] = useState(false);
  const [homicidal, setHomicidal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ escalated: boolean } | null>(null);

  if (!encounterId) {
    return (
      <Callout role="status">
        Open the review from the Psychiatric queue first — the Mental Status Exam is recorded
        against the psychiatry encounter.
      </Callout>
    );
  }

  const save = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await submitMse(accessToken, encounterId, {
        appearance: shared.mse_appearance,
        behavior: shared.mse_behaviour,
        mood: shared.mse_mood,
        affect: shared.mse_affect,
        ...extra,
        risk_assessment: { suicidal_ideation: suicidal, homicidal_ideation: homicidal },
      });
      setSaved({ escalated: Boolean(result.risk_escalated_to_supervisor) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the MSE.");
    } finally {
      setSaving(false);
    }
  };

  const check = "h-[17px] w-[17px] flex-shrink-0 accent-[var(--green)]";

  return (
    <Card title="Mental Status Examination">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {SHARED_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`${baseId}-${key}`}>
            <input
              id={`${baseId}-${key}`}
              className={INPUT}
              // eslint-disable-next-line security/detect-object-injection -- fixed key list.
              value={shared[key]}
              onChange={(e) => onSharedChange({ [key]: e.target.value })}
            />
          </Field>
        ))}
        {EXTRA_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`${baseId}-${key}`}>
            <textarea
              id={`${baseId}-${key}`}
              rows={2}
              className={INPUT}
              // eslint-disable-next-line security/detect-object-injection -- fixed key list.
              value={extra[key]}
              onChange={(e) => setExtra((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <div className="mb-2 mt-[18px] text-[11px] font-bold uppercase tracking-wide text-ink-500">
        Risk
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <label className="flex items-center gap-2 py-1 text-[13px] text-ink-900">
          <input
            type="checkbox"
            className={check}
            checked={suicidal}
            onChange={(e) => setSuicidal(e.target.checked)}
          />
          Suicidal ideation
        </label>
        <label className="flex items-center gap-2 py-1 text-[13px] text-ink-900">
          <input
            type="checkbox"
            className={check}
            checked={homicidal}
            onChange={(e) => setHomicidal(e.target.checked)}
          />
          Homicidal ideation
        </label>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Appearance, behaviour, mood and affect are the same values as on the Assessment tab.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <ErrorNote>{error}</ErrorNote>
        {saved &&
          (saved.escalated ? (
            <Callout tone="danger" role="alert">
              MSE saved. Risk flagged — the supervisor on-call has been notified.
            </Callout>
          ) : (
            <Callout tone="success" role="status">
              MSE saved.
            </Callout>
          ))}
        <div>
          <button type="button" className={BTN} disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save MSE"}
          </button>
        </div>
      </div>
    </Card>
  );
}
