import { useEffect, useId, useState, type ReactNode } from "react";
import { FileText, Printer } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import {
  addBreachEvent,
  downloadBreachRegister,
  downloadBreachReport,
  getBreachOptions,
  updateBreachIncident,
  type BreachAssessment,
  type BreachIncident,
  type BreachOptions,
} from "../lib/complianceApi";

const INPUT =
  "w-full rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const HELP = "text-xs font-normal text-ink-500";
const SECTION = "flex flex-col gap-3 border-t border-surface-border pt-4";
const BTN =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark disabled:opacity-60";
const BTN_GHOST =
  "flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60";

const ASSESSMENT_KEYS: (keyof BreachAssessment)[] = [
  "cause",
  "how_it_occurred",
  "identifies_subjects",
  "schedule_categories",
  "credentials_exposed",
  "publicly_available_only",
  "notifiability_reasoning",
  "likelihood",
  "impact",
  "likely_harm",
  "remedy_actions",
  "subject_guidance",
  "unauthorised_party",
  "other_entities_affected",
  "other_reports",
  "rectification_timeline",
  "subjects_exemption",
  "subjects_exemption_grounds",
];

function assessmentOf(incident: BreachIncident): BreachAssessment {
  return Object.fromEntries(ASSESSMENT_KEYS.map((k) => [k, incident[k]])) as unknown as BreachAssessment;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

async function openHtml(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function TextArea({
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={LABEL}>
      {label}
      <textarea
        id={id}
        rows={2}
        className={INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {help && <span className={HELP}>{help}</span>}
    </label>
  );
}

/**
 * Everything the Kenyan breach notices need beyond the incident's basic facts,
 * shared by the Org Admin and Super Admin breach screens:
 *
 * - the notifiability test of the Data Protection (General) Regulations 2021,
 *   reg. 37 — a client's name or ID together with mental-health or addiction
 *   treatment data is notifiable by definition (Second Schedule, item 16);
 * - the content of the notice to the Data Commissioner (reg. 38), DHA Form
 *   HMIS 1 and its 72-hour follow-up (DH(HIMP) Regulations 2025, reg. 11),
 *   and the letter to data subjects (DPA s.43(5));
 * - any lawful ground for not telling the data subjects (s.43(1)(b), (4), (6));
 * - the chronology of steps taken (reg. 38(1)(b)), and the printable notices.
 */
export function BreachAssessmentPanel({
  incident,
  canEdit,
  onChanged,
}: {
  incident: BreachIncident;
  canEdit: boolean;
  onChanged: (incident: BreachIncident) => void;
}) {
  const { accessToken } = useAuth();
  const [options, setOptions] = useState<BreachOptions | null>(null);
  const [form, setForm] = useState<BreachAssessment>(() => assessmentOf(incident));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stepNote, setStepNote] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getBreachOptions(accessToken)
      .then((o) => {
        if (!cancelled) setOptions(o);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const set = (patch: Partial<BreachAssessment>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };
  const disabled = !canEdit || saving;

  const save = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateBreachIncident(accessToken, incident.id, form);
      setForm(assessmentOf(updated));
      setSaved(true);
      onChanged(updated);
    } catch (err) {
      setError(errorText(err, "Couldn't save the assessment."));
    } finally {
      setSaving(false);
    }
  };

  const addStep = async () => {
    if (!accessToken || !stepNote.trim()) return;
    setStepError(null);
    try {
      onChanged(await addBreachEvent(accessToken, incident.id, { note: stepNote.trim() }));
      setStepNote("");
    } catch (err) {
      setStepError(errorText(err, "Couldn't add the step."));
    }
  };

  const openReport = async (kind: string) => {
    if (!accessToken) return;
    setReportError(null);
    try {
      await openHtml(await downloadBreachReport(accessToken, incident.id, kind));
    } catch (err) {
      setReportError(errorText(err, "Couldn't build the notice."));
    }
  };

  const toggleCategory = (code: string, on: boolean) =>
    set({
      schedule_categories: on
        ? [...form.schedule_categories, code]
        : form.schedule_categories.filter((c) => c !== code),
    });

  const score = form.likelihood && form.impact ? form.likelihood * form.impact : null;

  return (
    <div className="flex flex-col gap-4">
      <div className={SECTION}>
        <h3 className="text-sm font-semibold text-ink-900">Is it notifiable?</h3>
        <p
          className={`w-fit rounded-sm px-2 py-1 text-xs font-semibold ${
            incident.real_risk_of_harm
              ? "bg-status-red-tint text-status-red"
              : "bg-surface-bg text-ink-700"
          }`}
        >
          {incident.is_notifiable
            ? "Notifiable data breach — Data Protection (General) Regulations 2021, reg. 37"
            : incident.real_risk_of_harm
              ? "Real risk of harm assessed — notify under DPA s.43"
              : "Not notifiable on the facts recorded — keep it in the breach register (s.43(8))"}
        </p>
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand-green"
            checked={form.identifies_subjects}
            onChange={(e) => set({ identifies_subjects: e.target.checked })}
            disabled={disabled}
          />
          Clients&apos; names or identification numbers were involved
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium text-ink-700">
            Kinds of data involved (Second Schedule)
          </legend>
          {options?.schedule_categories.map((c) => (
            <label key={c.code} className="flex items-start gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-green"
                checked={form.schedule_categories.includes(c.code)}
                onChange={(e) => toggleCategory(c.code, e.target.checked)}
                disabled={disabled}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand-green"
            checked={form.credentials_exposed}
            onChange={(e) => set({ credentials_exposed: e.target.checked })}
            disabled={disabled}
          />
          Account identifiers with passwords, access codes or biometric data
        </label>
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand-green"
            checked={form.publicly_available_only}
            onChange={(e) => set({ publicly_available_only: e.target.checked })}
            disabled={disabled}
          />
          Only publicly available data, or data disclosed as written law requires (reg. 37(3))
        </label>
        <TextArea
          label="Your assessment and reasoning"
          help="Goes into the notice to the Data Commissioner (reg. 38(1)(b))."
          value={form.notifiability_reasoning}
          onChange={(v) => set({ notifiability_reasoning: v })}
          disabled={disabled}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(["likelihood", "impact"] as const).map((key) => (
            <label key={key} className={LABEL}>
              {key === "likelihood" ? "Likelihood (1–5)" : "Impact (1–5)"}
              <select
                className={INPUT}
                value={form[key] ?? ""}
                onChange={(e) => set({ [key]: e.target.value ? Number(e.target.value) : null })}
                disabled={disabled}
              >
                <option value="">Not scored</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className={LABEL}>
            Risk score
            <span className="py-2 text-sm text-ink-900">{score ?? "—"}</span>
          </div>
        </div>
        <p className={HELP}>
          Scored as in the ODPC&apos;s DPIA guidance risk register. The statutory test is the one above.
        </p>
      </div>

      <div className={SECTION}>
        <h3 className="text-sm font-semibold text-ink-900">What happened and what is being done</h3>
        <label className={LABEL}>
          Primary cause
          <select
            className={INPUT}
            value={form.cause}
            onChange={(e) => set({ cause: e.target.value as BreachAssessment["cause"] })}
            disabled={disabled}
          >
            <option value="">Not recorded</option>
            {options?.causes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <TextArea label="How it occurred" value={form.how_it_occurred} onChange={(v) => set({ how_it_occurred: v })} disabled={disabled} />
        <TextArea label="Potential harm to the data subjects" value={form.likely_harm} onChange={(v) => set({ likely_harm: v })} disabled={disabled} />
        <TextArea label="Remedying the cause and preventing recurrence" value={form.remedy_actions} onChange={(v) => set({ remedy_actions: v })} disabled={disabled} />
        <TextArea label="Timelines for rectifying the breach" help="Asked for in the DHA follow-up (reg. 11(2)(b))." value={form.rectification_timeline} onChange={(v) => set({ rectification_timeline: v })} disabled={disabled} />
        <TextArea label="What the data subjects should do to protect themselves" value={form.subject_guidance} onChange={(v) => set({ subject_guidance: v })} disabled={disabled} />
        <TextArea label="Who obtained the data, where known" value={form.unauthorised_party} onChange={(v) => set({ unauthorised_party: v })} disabled={disabled} />
        <TextArea label="Other organisations affected" value={form.other_entities_affected} onChange={(v) => set({ other_entities_affected: v })} disabled={disabled} />
        <TextArea label="Police or other regulators told" value={form.other_reports} onChange={(v) => set({ other_reports: v })} disabled={disabled} />
      </div>

      <div className={SECTION}>
        <h3 className="text-sm font-semibold text-ink-900">Telling the data subjects</h3>
        <label className={LABEL}>
          Ground for not telling them (leave blank if they will be told)
          <select
            className={INPUT}
            value={form.subjects_exemption}
            onChange={(e) =>
              set({ subjects_exemption: e.target.value as BreachAssessment["subjects_exemption"] })
            }
            disabled={disabled}
          >
            <option value="">They will be told in writing</option>
            {options?.subjects_exemptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {form.subjects_exemption && (
          <TextArea
            label="Grounds"
            help="Required — stated in the notice to the Data Commissioner (reg. 38(2))."
            value={form.subjects_exemption_grounds}
            onChange={(v) => set({ subjects_exemption_grounds: v })}
            disabled={disabled}
          />
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save assessment"}
          </button>
          {saved && <span className="text-sm text-brand-green-dark">Saved — deadlines updated.</span>}
          {error && <span className="text-sm text-status-red">{error}</span>}
        </div>
      )}

      <div className={SECTION}>
        <h3 className="text-sm font-semibold text-ink-900">Steps taken</h3>
        {incident.events.length === 0 ? (
          <p className="text-sm text-ink-500">No steps recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-1.5 text-sm text-ink-900">
            {incident.events.map((e) => (
              <li key={e.id}>
                <span className="text-ink-500">{new Date(e.occurred_at).toLocaleString()}</span> —{" "}
                {e.note}
                {e.recorded_by && <span className="text-ink-500"> ({e.recorded_by})</span>}
              </li>
            ))}
          </ol>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-start gap-2">
            <input
              className={`${INPUT} min-w-0 flex-1`}
              placeholder="Add a step, e.g. “Revoked the shared password”"
              value={stepNote}
              onChange={(e) => setStepNote(e.target.value)}
              aria-label="New step"
            />
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => void addStep()}
              disabled={!stepNote.trim()}
            >
              Add step
            </button>
          </div>
        )}
        {stepError && <span className="text-sm text-status-red">{stepError}</span>}
      </div>

      <div className={SECTION}>
        <h3 className="text-sm font-semibold text-ink-900">Notices</h3>
        <p className={HELP}>
          Built from this record. Check every entry, then submit the ODPC notice through the ODPC
          online breach form. DHA has not published how Form HMIS 1 is lodged — confirm with the
          Agency.
        </p>
        <div className="flex flex-wrap gap-2">
          {options?.report_kinds.map((k) => (
            <button key={k.code} type="button" className={BTN_GHOST} onClick={() => void openReport(k.code)}>
              <FileText size={14} />
              {k.label}
            </button>
          ))}
        </div>
        {reportError && <span className="text-sm text-status-red">{reportError}</span>}
      </div>
    </div>
  );
}

/** Opens the breach register (DPA s.43(8)) for printing. */
export function BreachRegisterButton({ organizationId }: { organizationId?: string }) {
  const { accessToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={BTN_GHOST}
        onClick={() => {
          if (!accessToken) return;
          setError(null);
          downloadBreachRegister(accessToken, organizationId)
            .then(openHtml)
            .catch((err) => setError(errorText(err, "Couldn't open the register.")));
        }}
      >
        <Printer size={14} />
        Breach register
      </button>
      {error && <span className="text-xs text-status-red">{error}</span>}
    </span>
  );
}
