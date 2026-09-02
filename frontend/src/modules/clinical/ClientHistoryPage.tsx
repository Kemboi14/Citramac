import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  addReviewOfSystemEntry,
  addSubstanceUseEntry,
  createClientHistory,
  listClientHistory,
  type ClientHistoryRecord,
  type ClientHistoryRestricted,
  type RiskLevel,
} from "../../lib/clientHistoryApi";

const FIELD_CLASS =
  "w-full rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const SECTION_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE = "mb-4 font-display text-base font-semibold text-ink-900";

const CLINICAL_HISTORY_FIELDS: { key: keyof typeof INITIAL_FORM; label: string }[] = [
  { key: "past_medical_surgical_history", label: "Past Medical and Surgical History" },
  { key: "current_medications", label: "Pre or Current Medications" },
  { key: "family_psychiatric_history", label: "Family Psychiatric History" },
  { key: "family_history", label: "Family History" },
  { key: "developmental_history", label: "Developmental History" },
  { key: "social_history", label: "Personal and Social History" },
  { key: "forensic_history", label: "Forensic History" },
  { key: "premorbid_history", label: "Premorbid History" },
  { key: "collateral_history", label: "Collaborative Collateral History" },
  { key: "vegetative_history", label: "Vegetative History" },
];

const RISK_OPTIONS: RiskLevel[] = ["", "NONE", "LOW", "MODERATE", "HIGH"];

const FREQUENCY_OPTIONS = ["Daily", "Weekly", "Monthly", "Occasionally", "Rarely"];
const ROUTE_OPTIONS = [
  "Oral",
  "Intravenous (IV)",
  "Intramuscular (IM)",
  "Inhalation",
  "Smoking",
  "Snorting",
  "Other",
];
const ROS_CATEGORIES = [
  "General",
  "Eyes, Ears, Nose, Mouth and Head",
  "Cardiovascular System",
  "Respiratory System",
  "Gastrointestinal System",
  "Musculoskeletal System",
  "Genital Urinary System",
  "Neurological System",
  "Integumentary System",
  "Psychiatric",
];

interface DraftSubstanceEntry {
  substance: string;
  first_use: string;
  last_use: string;
  frequency: string;
  route: string;
}
const EMPTY_SUBSTANCE_DRAFT: DraftSubstanceEntry = {
  substance: "",
  first_use: "",
  last_use: "",
  frequency: "",
  route: "",
};

interface DraftRosEntry {
  category: string;
  review_date: string;
  notes: string;
}
const EMPTY_ROS_DRAFT: DraftRosEntry = { category: "", review_date: "", notes: "" };

const INITIAL_FORM = {
  presenting_problem: "",
  hpi_onset_date: "",
  hpi_duration: "",
  hpi_severity: "",
  main_drug_problem: "",
  other_main_drug_problem: "",
  injecting_drug_use: false,
  treatment_before: false,
  substance_use_details: "",
  past_medical_surgical_history: "",
  current_medications: "",
  family_psychiatric_history: "",
  family_history: "",
  developmental_history: "",
  social_history: "",
  forensic_history: "",
  premorbid_history: "",
  collateral_history: "",
  vegetative_history: "",
  withdrawal_risk: "",
  suicide_risk_level: "" as RiskLevel,
  self_harm_risk_level: "" as RiskLevel,
  violence_risk_level: "" as RiskLevel,
  plan_details: "",
  level_of_care: "" as ClientHistoryRecord["level_of_care"],
  next_steps: "",
};

function hasFullAccess(
  record: ClientHistoryRecord | ClientHistoryRestricted,
): record is ClientHistoryRecord {
  return "presenting_problem" in record;
}

/** Client History intake (CIF-style form) — mockups/citramac_clinical_workspace.html. */
export function ClientHistoryPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [records, setRecords] = useState<(ClientHistoryRecord | ClientHistoryRestricted)[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [substanceEntries, setSubstanceEntries] = useState<DraftSubstanceEntry[]>([]);
  const [substanceDraft, setSubstanceDraft] = useState<DraftSubstanceEntry>(EMPTY_SUBSTANCE_DRAFT);
  const [rosEntries, setRosEntries] = useState<DraftRosEntry[]>([]);
  const [rosDraft, setRosDraft] = useState<DraftRosEntry>(EMPTY_ROS_DRAFT);

  const addSubstanceDraft = () => {
    if (!substanceDraft.substance.trim()) return;
    setSubstanceEntries((prev) => [...prev, substanceDraft]);
    setSubstanceDraft(EMPTY_SUBSTANCE_DRAFT);
  };
  const removeSubstanceDraft = (index: number) =>
    setSubstanceEntries((prev) => prev.filter((_, i) => i !== index));

  const addRosDraft = () => {
    if (!rosDraft.category) return;
    setRosEntries((prev) => [...prev, rosDraft]);
    setRosDraft(EMPTY_ROS_DRAFT);
  };
  const removeRosDraft = (index: number) =>
    setRosEntries((prev) => prev.filter((_, i) => i !== index));

  const refresh = () => {
    if (!accessToken || !selected) return;
    listClientHistory(accessToken, selected.patientId)
      .then((data) => setRecords(data.results))
      .catch(() => setError("Couldn't load client history."));
  };

  useEffect(refresh, [accessToken, selected]);

  const set = <K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (status: "DRAFT" | "SUBMITTED") => {
    if (!accessToken || !selected) return;
    setError(null);
    setBusy(true);
    try {
      const record = await createClientHistory(accessToken, {
        patient: selected.patientId,
        date_of_intake: new Date().toISOString(),
        status,
        ...form,
      });
      await Promise.all([
        ...substanceEntries.map((entry) =>
          addSubstanceUseEntry(accessToken, {
            assessment: record.id,
            substance: entry.substance,
            first_use: entry.first_use || null,
            last_use: entry.last_use || null,
            frequency: entry.frequency,
            route: entry.route,
          }),
        ),
        ...rosEntries.map((entry) =>
          addReviewOfSystemEntry(accessToken, {
            assessment: record.id,
            category: entry.category,
            review_date: entry.review_date || null,
            notes: entry.notes,
          }),
        ),
      ]);
      setForm(INITIAL_FORM);
      setSubstanceEntries([]);
      setSubstanceDraft(EMPTY_SUBSTANCE_DRAFT);
      setRosEntries([]);
      setRosDraft(EMPTY_ROS_DRAFT);
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the intake record.");
    } finally {
      setBusy(false);
    }
  };

  if (!selected) {
    return (
      <p className="text-ink-500">
        Select a client from the{" "}
        <Link to="/clinical/registry" className="font-semibold text-brand-green hover:underline">
          Client Registry
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Clinical documentation
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            Client History — {selected.patientName}
          </h1>
        </div>
        <button type="button" className={BUTTON_CLASS} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close form" : "+ New Intake"}
        </button>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {showForm && (
        <div className="flex animate-scale-in flex-col gap-4">
          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>History of Presenting Problem</h2>
            <div className="flex flex-col gap-3">
              <label className={LABEL_CLASS}>
                Narrative
                <textarea
                  className={FIELD_CLASS}
                  rows={3}
                  value={form.presenting_problem}
                  onChange={(e) => set("presenting_problem", e.target.value)}
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className={LABEL_CLASS}>
                  Onset date
                  <input
                    type="date"
                    className={FIELD_CLASS}
                    value={form.hpi_onset_date}
                    onChange={(e) => set("hpi_onset_date", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Duration
                  <input
                    className={FIELD_CLASS}
                    value={form.hpi_duration}
                    onChange={(e) => set("hpi_duration", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Severity
                  <select
                    className={FIELD_CLASS}
                    value={form.hpi_severity}
                    onChange={(e) => set("hpi_severity", e.target.value)}
                  >
                    <option value="">Select severity</option>
                    <option>Mild</option>
                    <option>Moderate</option>
                    <option>Severe</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>Substance Use History</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL_CLASS}>
                Main drug problem
                <input
                  className={FIELD_CLASS}
                  value={form.main_drug_problem}
                  onChange={(e) => set("main_drug_problem", e.target.value)}
                  placeholder="Alcohol"
                />
              </label>
              <label className={LABEL_CLASS}>
                Other main drug problem
                <input
                  className={FIELD_CLASS}
                  value={form.other_main_drug_problem}
                  onChange={(e) => set("other_main_drug_problem", e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={form.injecting_drug_use}
                  onChange={(e) => set("injecting_drug_use", e.target.checked)}
                />
                Injecting drug use
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={form.treatment_before}
                  onChange={(e) => set("treatment_before", e.target.checked)}
                />
                Prior substance treatment
              </label>
              <label className={`${LABEL_CLASS} col-span-2`}>
                Details
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={form.substance_use_details}
                  onChange={(e) => set("substance_use_details", e.target.value)}
                />
              </label>
            </div>

            <div className="mt-4 border-t border-surface-border pt-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
                Substance use entries
              </h3>
              {substanceEntries.length > 0 && (
                <div className="mb-3 flex flex-col gap-2">
                  {substanceEntries.map((entry, index) => (
                    <div
                      key={`${entry.substance}-${index}`}
                      className="flex items-center justify-between rounded-sm border border-surface-border px-3 py-2 text-xs text-ink-700"
                    >
                      <span>
                        <strong>{entry.substance}</strong>
                        {entry.frequency && ` · ${entry.frequency}`}
                        {entry.route && ` · ${entry.route}`}
                        {entry.first_use && ` · first use ${entry.first_use}`}
                        {entry.last_use && ` · last use ${entry.last_use}`}
                      </span>
                      <button
                        type="button"
                        className="font-semibold text-status-red"
                        onClick={() => removeSubstanceDraft(index)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-5 gap-2">
                <input
                  className={FIELD_CLASS}
                  placeholder="Substance"
                  value={substanceDraft.substance}
                  onChange={(e) =>
                    setSubstanceDraft((prev) => ({ ...prev, substance: e.target.value }))
                  }
                />
                <input
                  type="date"
                  className={FIELD_CLASS}
                  title="First use"
                  value={substanceDraft.first_use}
                  onChange={(e) =>
                    setSubstanceDraft((prev) => ({ ...prev, first_use: e.target.value }))
                  }
                />
                <input
                  type="date"
                  className={FIELD_CLASS}
                  title="Last use"
                  value={substanceDraft.last_use}
                  onChange={(e) =>
                    setSubstanceDraft((prev) => ({ ...prev, last_use: e.target.value }))
                  }
                />
                <select
                  className={FIELD_CLASS}
                  value={substanceDraft.frequency}
                  onChange={(e) =>
                    setSubstanceDraft((prev) => ({ ...prev, frequency: e.target.value }))
                  }
                >
                  <option value="">Frequency</option>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
                <select
                  className={FIELD_CLASS}
                  value={substanceDraft.route}
                  onChange={(e) =>
                    setSubstanceDraft((prev) => ({ ...prev, route: e.target.value }))
                  }
                >
                  <option value="">Route</option>
                  {ROUTE_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-brand-green"
                onClick={addSubstanceDraft}
              >
                + Add substance entry
              </button>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>Review of Systems</h2>
            {rosEntries.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {rosEntries.map((entry, index) => (
                  <div
                    key={`${entry.category}-${index}`}
                    className="flex items-center justify-between rounded-sm border border-surface-border px-3 py-2 text-xs text-ink-700"
                  >
                    <span>
                      <strong>{entry.category}</strong>
                      {entry.review_date && ` · ${entry.review_date}`}
                      {entry.notes && ` · ${entry.notes}`}
                    </span>
                    <button
                      type="button"
                      className="font-semibold text-status-red"
                      onClick={() => removeRosDraft(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <select
                className={FIELD_CLASS}
                value={rosDraft.category}
                onChange={(e) => setRosDraft((prev) => ({ ...prev, category: e.target.value }))}
              >
                <option value="">Select system</option>
                {ROS_CATEGORIES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <input
                type="date"
                className={FIELD_CLASS}
                title="Review date"
                value={rosDraft.review_date}
                onChange={(e) => setRosDraft((prev) => ({ ...prev, review_date: e.target.value }))}
              />
              <input
                className={FIELD_CLASS}
                placeholder="Notes"
                value={rosDraft.notes}
                onChange={(e) => setRosDraft((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-brand-green"
              onClick={addRosDraft}
            >
              + Add review of systems entry
            </button>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>Clinical History</h2>
            <div className="grid grid-cols-2 gap-3">
              {CLINICAL_HISTORY_FIELDS.map(({ key, label }) => (
                <label key={key} className={LABEL_CLASS}>
                  {label}
                  <textarea
                    className={FIELD_CLASS}
                    rows={2}
                    // eslint-disable-next-line security/detect-object-injection -- `key` is iterated from the fixed `CLINICAL_HISTORY_FIELDS` const array, not user input.
                    value={form[key] as string}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>Risk Assessment</h2>
            <div className="grid grid-cols-3 gap-3">
              <label className={`${LABEL_CLASS} col-span-3`}>
                Risk for withdrawal
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={form.withdrawal_risk}
                  onChange={(e) => set("withdrawal_risk", e.target.value)}
                />
              </label>
              {(
                [
                  ["suicide_risk_level", "Suicide risk"],
                  ["self_harm_risk_level", "Self-harm risk"],
                  ["violence_risk_level", "Violence risk"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={LABEL_CLASS}>
                  {label}
                  <select
                    className={FIELD_CLASS}
                    // eslint-disable-next-line security/detect-object-injection -- `key` is destructured from a fixed local literal-tuple array, not user input.
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value as RiskLevel)}
                  >
                    {RISK_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option || "Select"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE}>Plan</h2>
            <div className="flex flex-col gap-3">
              <label className={LABEL_CLASS}>
                Plan
                <textarea
                  className={FIELD_CLASS}
                  rows={3}
                  value={form.plan_details}
                  onChange={(e) => set("plan_details", e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={LABEL_CLASS}>
                  Level of care
                  <select
                    className={FIELD_CLASS}
                    value={form.level_of_care}
                    onChange={(e) =>
                      set("level_of_care", e.target.value as ClientHistoryRecord["level_of_care"])
                    }
                  >
                    <option value="">Select level</option>
                    <option value="INPATIENT">Inpatient</option>
                    <option value="OUTPATIENT">Outpatient</option>
                    <option value="PARTIAL">Partial</option>
                    <option value="RESIDENTIAL">Residential</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Next steps
                  <input
                    className={FIELD_CLASS}
                    value={form.next_steps}
                    onChange={(e) => set("next_steps", e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-brand-green-tint-2"
                onClick={() => submit("DRAFT")}
              >
                Save draft
              </button>
              <button
                type="button"
                disabled={busy}
                className={BUTTON_CLASS}
                onClick={() => submit("SUBMITTED")}
              >
                Submit
              </button>
            </div>
          </section>
        </div>
      )}

      <section className={SECTION_CLASS}>
        <h2 className={SECTION_TITLE}>Intake history</h2>
        {records.length === 0 && <p className="text-sm text-ink-500">No history captured yet.</p>}
        <div className="flex flex-col">
          {records.map((record) => (
            <div key={record.id} className="border-t border-surface-bg py-3 first:border-t-0">
              <div className="flex items-center justify-between">
                <strong className="text-sm text-ink-900">
                  {record.status === "SUBMITTED" ? "Intake History" : "Draft Intake"}
                </strong>
                <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-[10px] font-semibold text-brand-green-dark">
                  {record.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {new Date(record.created_at).toLocaleString()}
              </p>
              {hasFullAccess(record) && record.presenting_problem && (
                <p className="mt-2 text-sm text-ink-700">{record.presenting_problem}</p>
              )}
              {hasFullAccess(record) &&
                (record.substance_use_entries.length > 0 ||
                  record.review_of_systems.length > 0) && (
                  <p className="mt-1 text-xs text-ink-500">
                    {record.substance_use_entries.length} substance entries ·{" "}
                    {record.review_of_systems.length} systems reviewed
                  </p>
                )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
