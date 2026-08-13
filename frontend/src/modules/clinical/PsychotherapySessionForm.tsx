import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useEnsureEncounter } from "../../clinical/useEnsureEncounter";
import { usePatientContext } from "../../clinical/PatientContext";
import { ApiError } from "../../lib/apiClient";
import { createPsychotherapySession } from "../../lib/clinicalApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";

type SessionType = "INDIVIDUAL" | "FAMILY" | "GROUP";

/**
 * Shared form for all three psychotherapy session types — docs/07-CLINICAL-MODULES-SPEC.md
 * §7.14.3. Same backend model (session_type discriminates), same core
 * fields; only the eyebrow/title and one or two labels differ, matching
 * how the three mockup pages share the same underlying structure.
 */
export function PsychotherapySessionForm({
  sessionType,
  eyebrow,
  title,
  extraFieldsLabel,
}: {
  sessionType: SessionType;
  eyebrow: string;
  title: string;
  extraFieldsLabel: string;
}) {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();
  const { error: encounterError, patientName } = useEnsureEncounter();

  const [form, setForm] = useState({
    goals: "",
    session_notes: "",
    trauma_processing_stage: "",
    progress_rating: "",
    extra_notes: "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (encounterError) return <p className="text-status-red">{encounterError}</p>;
  if (!selected) return <p className="text-ink-500">Loading…</p>;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setSaving(true);
    try {
      await createPsychotherapySession(accessToken, {
        patient: selected.patientId,
        session_type: sessionType,
        goals: form.goals,
        session_notes: form.session_notes,
        trauma_processing_stage: form.trauma_processing_stage,
        progress_rating: form.progress_rating ? Number(form.progress_rating) : null,
        extra: { notes: form.extra_notes },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this session.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
        {eyebrow}
      </div>
      <h1 className="mb-5 font-display text-2xl font-bold text-ink-900">
        {title} — {patientName}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="max-w-2xl rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4">
          <label className={LABEL_CLASS}>
            Goals
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={form.goals}
              onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Session Notes / Summary
            <textarea
              className={FIELD_CLASS}
              rows={4}
              value={form.session_notes}
              onChange={(e) => setForm((f) => ({ ...f, session_notes: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={LABEL_CLASS}>
              Trauma Processing Stage
              <input
                className={FIELD_CLASS}
                value={form.trauma_processing_stage}
                onChange={(e) =>
                  setForm((f) => ({ ...f, trauma_processing_stage: e.target.value }))
                }
              />
            </label>
            <label className={LABEL_CLASS}>
              Progress Rating (1-5)
              <input
                className={FIELD_CLASS}
                value={form.progress_rating}
                onChange={(e) => setForm((f) => ({ ...f, progress_rating: e.target.value }))}
              />
            </label>
          </div>
          <label className={LABEL_CLASS}>
            {extraFieldsLabel}
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={form.extra_notes}
              onChange={(e) => setForm((f) => ({ ...f, extra_notes: e.target.value }))}
            />
          </label>
        </div>

        {saved && (
          <p className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
            Session saved.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-status-red">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Session"}
        </button>
      </form>
    </div>
  );
}
