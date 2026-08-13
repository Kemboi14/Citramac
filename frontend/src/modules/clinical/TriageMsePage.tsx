import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useEnsureEncounter } from "../../clinical/useEnsureEncounter";
import { ApiError } from "../../lib/apiClient";
import { submitMse, submitVitals } from "../../lib/clinicalApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";

/**
 * Modules 2 — Triage (vitals, BMI/BSA/ESI computed server-side) and the
 * Mental Status Exam that replaces vitals-only triage for CCP tenants —
 * docs/07-CLINICAL-MODULES-SPEC.md §7.2, §7.14.2.
 */
export function TriageMsePage() {
  const { accessToken } = useAuth();
  const { encounterId, patientName, error: encounterError } = useEnsureEncounter();

  const [vitals, setVitals] = useState({
    systolic_bp: "",
    diastolic_bp: "",
    heart_rate: "",
    temperature_c: "",
    spo2: "",
    height_cm: "",
    weight_kg: "",
    esi_acuity_level: "",
  });
  const [vitalsResult, setVitalsResult] = useState<{ bmi: string; bsa: string } | null>(null);
  const [vitalsError, setVitalsError] = useState<string | null>(null);
  const [vitalsSaving, setVitalsSaving] = useState(false);

  const [mse, setMse] = useState({
    appearance: "",
    behavior: "",
    mood: "",
    affect: "",
    thought_process: "",
    perception: "",
    cognition: "",
    insight: "",
    judgment: "",
    plan: "",
  });
  const [suicidalIdeation, setSuicidalIdeation] = useState(false);
  const [homicidalIdeation, setHomicidalIdeation] = useState(false);
  const [mseSaved, setMseSaved] = useState<{ risk_escalated_to_supervisor: boolean } | null>(null);
  const [mseError, setMseError] = useState<string | null>(null);
  const [mseSaving, setMseSaving] = useState(false);

  if (encounterError) return <p className="text-status-red">{encounterError}</p>;
  if (!encounterId) return <p className="text-ink-500">Loading…</p>;

  const submitVitalsForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setVitalsError(null);
    setVitalsSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(vitals)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => [k, v]),
      );
      const result = await submitVitals(accessToken, encounterId, payload);
      setVitalsResult({ bmi: String(result.bmi ?? ""), bsa: String(result.bsa ?? "") });
    } catch (err) {
      setVitalsError(err instanceof ApiError ? err.message : "Couldn't save vitals.");
    } finally {
      setVitalsSaving(false);
    }
  };

  const submitMseForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setMseError(null);
    setMseSaving(true);
    try {
      const result = await submitMse(accessToken, encounterId, {
        ...mse,
        risk_assessment: {
          suicidal_ideation: suicidalIdeation,
          homicidal_ideation: homicidalIdeation,
        },
      });
      setMseSaved({ risk_escalated_to_supervisor: Boolean(result.risk_escalated_to_supervisor) });
    } catch (err) {
      setMseError(err instanceof ApiError ? err.message : "Couldn't save the MSE.");
    } finally {
      setMseSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 2 · Triage &amp; Biopsychosocial Assessment
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Triage &amp; MSE — {patientName}
        </h1>
      </div>

      <form
        onSubmit={submitVitalsForm}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Vital Signs</h2>
        <div className="grid grid-cols-4 gap-4">
          <label className={LABEL_CLASS}>
            Systolic BP
            <input
              className={FIELD_CLASS}
              value={vitals.systolic_bp}
              onChange={(e) => setVitals((v) => ({ ...v, systolic_bp: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Diastolic BP
            <input
              className={FIELD_CLASS}
              value={vitals.diastolic_bp}
              onChange={(e) => setVitals((v) => ({ ...v, diastolic_bp: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Heart Rate
            <input
              className={FIELD_CLASS}
              value={vitals.heart_rate}
              onChange={(e) => setVitals((v) => ({ ...v, heart_rate: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            SpO2
            <input
              className={FIELD_CLASS}
              value={vitals.spo2}
              onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Temperature (°C)
            <input
              className={FIELD_CLASS}
              value={vitals.temperature_c}
              onChange={(e) => setVitals((v) => ({ ...v, temperature_c: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Height (cm)
            <input
              className={FIELD_CLASS}
              value={vitals.height_cm}
              onChange={(e) => setVitals((v) => ({ ...v, height_cm: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Weight (kg)
            <input
              className={FIELD_CLASS}
              value={vitals.weight_kg}
              onChange={(e) => setVitals((v) => ({ ...v, weight_kg: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            ESI Acuity (1-5)
            <input
              className={FIELD_CLASS}
              value={vitals.esi_acuity_level}
              onChange={(e) => setVitals((v) => ({ ...v, esi_acuity_level: e.target.value }))}
            />
          </label>
        </div>
        {vitalsResult && (
          <p className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
            Computed BMI: {vitalsResult.bmi} · BSA: {vitalsResult.bsa} m²
          </p>
        )}
        {vitalsError && <p className="mt-4 text-sm text-status-red">{vitalsError}</p>}
        <button
          type="submit"
          disabled={vitalsSaving}
          className="mt-4 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60"
        >
          {vitalsSaving ? "Saving…" : "Save Vitals"}
        </button>
      </form>

      <form
        onSubmit={submitMseForm}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          Mental Status Exam
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["appearance", "Appearance"],
              ["behavior", "Behavior"],
              ["mood", "Mood"],
              ["affect", "Affect"],
              ["thought_process", "Thought Process"],
              ["perception", "Perception"],
              ["cognition", "Cognition"],
              ["insight", "Insight"],
              ["judgment", "Judgment"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className={LABEL_CLASS}>
              {label}
              <textarea
                className={FIELD_CLASS}
                rows={2}
                // key comes from the fixed literal tuple above, never user input.
                // eslint-disable-next-line security/detect-object-injection
                value={mse[key]}
                onChange={(e) => setMse((m) => ({ ...m, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label className={`${LABEL_CLASS} col-span-2`}>
            Plan
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={mse.plan}
              onChange={(e) => setMse((m) => ({ ...m, plan: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-4 flex gap-6 rounded-sm bg-status-red-tint px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium text-status-red">
            <input
              type="checkbox"
              checked={suicidalIdeation}
              onChange={(e) => setSuicidalIdeation(e.target.checked)}
            />
            Suicidal ideation present
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-status-red">
            <input
              type="checkbox"
              checked={homicidalIdeation}
              onChange={(e) => setHomicidalIdeation(e.target.checked)}
            />
            Homicidal ideation present
          </label>
        </div>

        {mseSaved?.risk_escalated_to_supervisor && (
          <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm font-semibold text-status-red">
            Risk flagged — the supervisor on-call has been notified.
          </p>
        )}
        {mseError && <p className="mt-4 text-sm text-status-red">{mseError}</p>}
        <button
          type="submit"
          disabled={mseSaving}
          className="mt-4 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60"
        >
          {mseSaving ? "Saving…" : "Save MSE"}
        </button>
      </form>
    </div>
  );
}
