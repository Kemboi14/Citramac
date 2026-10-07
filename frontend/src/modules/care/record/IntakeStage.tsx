import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getClientSnapshot,
  listIntakeAssessments,
  saveIntakeAssessment,
  type CarePlanActivity,
  type ClientBanner,
  type IntakeAssessment,
  type IntakePayload,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { clientRecordPath } from "../shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, GROUP_LABEL, INPUT } from "../shared/styles";
import {
  Callout,
  Card,
  CheckChoices,
  ErrorNote,
  Field,
  PageHeader,
  SelectChoices,
  Tag,
} from "../shared/ui";
import { useValueSets, type ValueSetsApi } from "../shared/useValueSets";
import { InformationTrail } from "./InformationTrail";
import { IntakeDiagnosisTab } from "./IntakeDiagnosisTab";
import { IntakeMseTab, type SharedMse } from "./IntakeMseTab";
import { scoreSeverity, severityTone, SCORE_SEVERITY_BANDS, type Instrument } from "./severity";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

type IntakeForm = Omit<IntakePayload, "gad7_score" | "phq9_score"> & {
  gad7: string;
  phq9: string;
};

const TABS = [
  { key: "assessment", label: "Assessment" },
  { key: "mse", label: "MSE" },
  { key: "risk", label: "Risk" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "formulation", label: "Formulation" },
  { key: "care-plan", label: "Care Plan" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function initialForm(latest: IntakeAssessment | undefined, presenting: string): IntakeForm {
  return {
    presenting_concern: latest?.presenting_concern || presenting,
    history: latest?.history ?? "",
    symptoms: latest?.symptoms ?? [],
    risk_level: latest?.risk_level ?? "",
    risk_notes: latest?.risk_notes ?? "",
    mse_appearance: latest?.mse_appearance ?? "",
    mse_behaviour: latest?.mse_behaviour ?? "",
    mse_mood: latest?.mse_mood ?? "",
    mse_affect: latest?.mse_affect ?? "",
    gad7: latest?.gad7_score != null ? String(latest.gad7_score) : "",
    phq9: latest?.phq9_score != null ? String(latest.phq9_score) : "",
    formulation: latest?.formulation ?? "",
    clinical_decision: latest?.clinical_decision ?? "",
    care_needs: latest?.care_needs ?? [],
  };
}

function newestFirst(rows: IntakeAssessment[]) {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Parses a score input: null when blank, NaN when not a whole number in range. */
function parseScore(raw: string, instrument: Instrument) {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  // eslint-disable-next-line security/detect-object-injection -- typed union key.
  const max = SCORE_SEVERITY_BANDS[instrument].max;
  return Number.isInteger(value) && value >= 0 && value <= max ? value : NaN;
}

/**
 * Intake & Clinical Assessment — docs/15-CLINICAL-WORKSPACE-V3.md §1.17;
 * mockup `clinical()`. Each save is a new version (IntakeAssessment).
 */
export function IntakeStage(props: RecordViewProps) {
  const [version, setVersion] = useState(0);
  const snapshot = useRecordData(
    props.patientId,
    0,
    (token) => getClientSnapshot(token, props.patientId),
    "Couldn't load the client snapshot.",
  );
  const intakes = useRecordData(
    props.patientId,
    version,
    (token) => listIntakeAssessments(token, props.patientId),
    "Couldn't load previous assessments.",
  );

  if (!snapshot.data || !intakes.data) {
    const error = snapshot.error ?? intakes.error;
    return (
      <div>
        <PageHeader
          title="Intake & Clinical Assessment"
          subtitle="Comprehensive clinical understanding — pre-populated from Registration & Triage"
        />
        {error ? (
          <ErrorNote>{error}</ErrorNote>
        ) : (
          <p className="text-[13px] text-ink-500">Loading assessment…</p>
        )}
      </div>
    );
  }

  return (
    <IntakeWorkspace
      key={props.patientId}
      {...props}
      presenting={snapshot.data.presenting_concern}
      activities={snapshot.data.care_plan_activities}
      intakes={newestFirst(intakes.data.results)}
      onSaved={() => setVersion((v) => v + 1)}
      trailVersion={version}
    />
  );
}

function IntakeWorkspace({
  patientId,
  banner,
  onRecordChanged,
  presenting,
  activities,
  intakes,
  onSaved,
  trailVersion,
}: RecordViewProps & {
  presenting: string;
  activities: CarePlanActivity[];
  intakes: IntakeAssessment[];
  onSaved: () => void;
  trailVersion: number;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const id = useId();
  const [form, setForm] = useState<IntakeForm>(() => initialForm(intakes[0], presenting));
  const [tab, setTab] = useState<TabKey>("assessment");
  const [showPrevious, setShowPrevious] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const patch = (changes: Partial<IntakeForm>) => {
    setForm((prev) => ({ ...prev, ...changes }));
    setSavedNote(null);
  };

  const save = async () => {
    if (!accessToken) return;
    const gad7 = parseScore(form.gad7, "GAD7");
    const phq9 = parseScore(form.phq9, "PHQ9");
    if (Number.isNaN(gad7) || Number.isNaN(phq9)) {
      setError("GAD-7 must be a whole number from 0 to 21 and PHQ-9 from 0 to 27.");
      setTab("assessment");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedNote(null);
    try {
      const saved = await saveIntakeAssessment(accessToken, patientId, {
        presenting_concern: form.presenting_concern,
        history: form.history,
        symptoms: form.symptoms,
        risk_level: form.risk_level,
        risk_notes: form.risk_notes,
        mse_appearance: form.mse_appearance,
        mse_behaviour: form.mse_behaviour,
        mse_mood: form.mse_mood,
        mse_affect: form.mse_affect,
        gad7_score: gad7,
        phq9_score: phq9,
        formulation: form.formulation,
        clinical_decision: form.clinical_decision,
        care_needs: form.care_needs,
      });
      setSavedNote(
        `Assessment saved as version ${intakes.length + 1} · ${formatDateTime(saved.created_at)}`,
      );
      onSaved();
      onRecordChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the assessment.");
    } finally {
      setSaving(false);
    }
  };

  const shared: SharedMse = {
    mse_appearance: form.mse_appearance,
    mse_behaviour: form.mse_behaviour,
    mse_mood: form.mse_mood,
    mse_affect: form.mse_affect,
  };

  return (
    <div>
      <PageHeader
        title="Intake & Clinical Assessment"
        subtitle="Comprehensive clinical understanding — pre-populated from Registration & Triage"
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              aria-expanded={showPrevious}
              onClick={() => setShowPrevious((v) => !v)}
            >
              Previous Assessments
            </button>
            <button type="button" className={BTN} disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save Assessment"}
            </button>
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2">
        <ErrorNote>{error ?? vs.error}</ErrorNote>
        {savedNote && (
          <Callout tone="success" role="status">
            {savedNote}
          </Callout>
        )}
      </div>

      {showPrevious && (
        <Card title="Previous Assessments" className="mb-4">
          {intakes.length === 0 ? (
            <p className="text-[13px] text-ink-500">
              No assessments have been saved for this client yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-surface-border">
              {intakes.map((intake, index) => {
                const open = viewing === intake.id;
                return (
                  <li key={intake.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[13px] text-ink-900">
                        <span className="font-semibold">Version {intakes.length - index}</span>
                        <span className="text-ink-500">
                          {" "}
                          · {formatDateTime(intake.created_at)} ·{" "}
                          {intake.author_name || "Author not recorded"}
                        </span>
                        {index === 0 && (
                          <span className="ml-2">
                            <Tag tone="brand">Latest</Tag>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        aria-expanded={open}
                        onClick={() => setViewing(open ? null : intake.id)}
                      >
                        {open ? "Hide" : "View"}
                      </button>
                    </div>
                    {open && <SavedAssessment intake={intake} vs={vs} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div
            role="tablist"
            aria-label="Intake sections"
            className="mb-4 flex flex-wrap gap-1.5 border-b border-surface-border"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`${id}-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`${id}-panel`}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-[9px] text-[13px] font-semibold transition-colors duration-150 ${
                  tab === t.key
                    ? "border-brand-green text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
            {tab === "assessment" && <AssessmentTab id={id} form={form} patch={patch} vs={vs} />}
            {tab === "mse" && (
              <IntakeMseTab
                encounterId={banner.psychiatry_encounter_id}
                shared={shared}
                onSharedChange={patch}
              />
            )}
            {tab === "risk" && (
              <RiskTab id={id} form={form} patch={patch} vs={vs} banner={banner} />
            )}
            {tab === "diagnosis" && (
              <IntakeDiagnosisTab
                patientId={patientId}
                encounterId={banner.psychiatry_encounter_id}
                onChanged={onRecordChanged}
              />
            )}
            {tab === "formulation" && (
              <Card title="Formulation">
                <Field label="Clinical formulation" htmlFor={`${id}-formulation`}>
                  <textarea
                    id={`${id}-formulation`}
                    rows={8}
                    className={INPUT}
                    value={form.formulation}
                    onChange={(e) => patch({ formulation: e.target.value })}
                  />
                </Field>
                <p className="mt-2 text-xs text-ink-500">
                  Saved with the assessment (Save Assessment).
                </p>
              </Card>
            )}
            {tab === "care-plan" && (
              <CarePlanTab patientId={patientId} activities={activities} form={form} vs={vs} />
            )}
          </div>
        </div>

        <InformationTrail patientId={patientId} version={trailVersion} />
      </div>
    </div>
  );
}

interface TabProps {
  id: string;
  form: IntakeForm;
  patch: (changes: Partial<IntakeForm>) => void;
  vs: ValueSetsApi;
}

const FIELDGRID = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2";

function ScoreField({
  id,
  instrument,
  value,
  onChange,
}: {
  id: string;
  instrument: Instrument;
  value: string;
  onChange: (value: string) => void;
}) {
  // eslint-disable-next-line security/detect-object-injection -- typed union key.
  const scale = SCORE_SEVERITY_BANDS[instrument];
  const parsed = parseScore(value, instrument);
  const severity = parsed === null ? "" : scoreSeverity(instrument, parsed);
  const invalid = Number.isNaN(parsed);
  return (
    <Field label={`${scale.label} Score`} htmlFor={id}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          min={0}
          max={scale.max}
          step={1}
          inputMode="numeric"
          className={`${INPUT} !w-20`}
          value={value}
          aria-invalid={invalid}
          aria-describedby={`${id}-severity`}
          onChange={(e) => onChange(e.target.value)}
        />
        <span id={`${id}-severity`}>
          {invalid ? (
            <Tag tone="risk">0–{scale.max} only</Tag>
          ) : severity ? (
            <Tag tone={severityTone(severity)}>{severity}</Tag>
          ) : (
            <Tag>Not scored</Tag>
          )}
        </span>
      </div>
    </Field>
  );
}

function AssessmentTab({ id, form, patch, vs }: TabProps) {
  return (
    <>
      <Card title="Clinical Assessment" className="mb-4">
        <Callout className="mb-4">
          <strong>Pre-populated:</strong> Registration and Triage information has been automatically
          imported. Clinician should confirm, update, or add new information.
        </Callout>
        <div className={FIELDGRID}>
          <Field label="Presenting Concern" htmlFor={`${id}-presenting`}>
            <textarea
              id={`${id}-presenting`}
              rows={2}
              className={INPUT}
              placeholder="Not yet recorded — ask client or informant"
              value={form.presenting_concern}
              onChange={(e) => patch({ presenting_concern: e.target.value })}
            />
          </Field>
          <Field label="History" htmlFor={`${id}-history`}>
            <textarea
              id={`${id}-history`}
              rows={2}
              className={INPUT}
              value={form.history}
              onChange={(e) => patch({ history: e.target.value })}
            />
          </Field>
          <Field label="Current Symptoms">
            <CheckChoices
              columns={2}
              options={vs.options("intake-symptom")}
              value={form.symptoms}
              onChange={(symptoms) => patch({ symptoms })}
            />
          </Field>
          <Field label="Risk Assessment" htmlFor={`${id}-risk`}>
            <SelectChoices
              id={`${id}-risk`}
              options={vs.options("intake-risk-level")}
              value={form.risk_level}
              placeholder="Select risk level"
              onChange={(code) => patch({ risk_level: code as IntakeForm["risk_level"] })}
            />
          </Field>
        </div>
        <div className={GROUP_LABEL}>Mental Status Examination</div>
        <div className={FIELDGRID}>
          {(
            [
              ["mse_appearance", "Appearance"],
              ["mse_behaviour", "Behavior"],
              ["mse_mood", "Mood"],
              ["mse_affect", "Affect"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`${id}-${key}`}>
              <input
                id={`${id}-${key}`}
                className={INPUT}
                // eslint-disable-next-line security/detect-object-injection -- fixed key list.
                value={form[key]}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <div className={GROUP_LABEL}>Assessment Tools</div>
        <div className={FIELDGRID}>
          <ScoreField
            id={`${id}-gad7`}
            instrument="GAD7"
            value={form.gad7}
            onChange={(gad7) => patch({ gad7 })}
          />
          <ScoreField
            id={`${id}-phq9`}
            instrument="PHQ9"
            value={form.phq9}
            onChange={(phq9) => patch({ phq9 })}
          />
        </div>
      </Card>

      <Card title="Clinical Decision">
        <div className={FIELDGRID}>
          <Field label="Decision" htmlFor={`${id}-decision`}>
            <SelectChoices
              id={`${id}-decision`}
              options={vs.options("intake-decision")}
              value={form.clinical_decision}
              placeholder="Select decision"
              onChange={(clinical_decision) => patch({ clinical_decision })}
            />
          </Field>
          <Field label="Identified Care Needs">
            <CheckChoices
              columns={2}
              options={vs.options("intake-care-need")}
              value={form.care_needs}
              onChange={(care_needs) => patch({ care_needs })}
            />
          </Field>
        </div>
      </Card>
    </>
  );
}

function RiskTab({ id, form, patch, vs, banner }: TabProps & { banner: ClientBanner }) {
  return (
    <Card title="Risk Assessment">
      <div className="flex flex-col gap-3">
        <Field label="Risk level" htmlFor={`${id}-risk-level`}>
          <SelectChoices
            id={`${id}-risk-level`}
            options={vs.options("intake-risk-level")}
            value={form.risk_level}
            placeholder="Select risk level"
            onChange={(code) => patch({ risk_level: code as IntakeForm["risk_level"] })}
          />
        </Field>
        <Field label="Risk notes" htmlFor={`${id}-risk-notes`}>
          <textarea
            id={`${id}-risk-notes`}
            rows={5}
            className={INPUT}
            value={form.risk_notes}
            onChange={(e) => patch({ risk_notes: e.target.value })}
          />
        </Field>
        <div>
          <div className={GROUP_LABEL}>Critical clinical alerts from triage</div>
          {banner.alerts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {banner.alerts.map((alert) => (
                <Tag key={alert.id} tone="warn">
                  {alert.label}
                </Tag>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-ink-500">No critical alerts</p>
          )}
        </div>
        <p className="text-xs text-ink-500">Saved with the assessment (Save Assessment).</p>
      </div>
    </Card>
  );
}

function CarePlanTab({
  patientId,
  activities,
  form,
  vs,
}: {
  patientId: string;
  activities: CarePlanActivity[];
  form: IntakeForm;
  vs: ValueSetsApi;
}) {
  return (
    <Card title="Care Plan">
      <div className="flex flex-col gap-3 text-[13px] text-ink-900">
        <div>
          <div className={GROUP_LABEL}>Identified care needs</div>
          {form.care_needs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {form.care_needs.map((code) => (
                <Tag key={code}>{vs.label("intake-care-need", code)}</Tag>
              ))}
            </div>
          ) : (
            <p className="text-ink-500">None selected on the Assessment tab.</p>
          )}
        </div>
        <div>
          <div className={GROUP_LABEL}>Documented care plan actions</div>
          {activities.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {activities.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.title}</span>
                  <Tag tone={a.status === "ACTIVE" ? "risk" : "neutral"}>
                    {vs.label("care-activity-status", a.status)}
                  </Tag>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-500">No care plan actions documented yet.</p>
          )}
        </div>
        <div>
          <Link to={clientRecordPath(patientId, "care-plan")} className={`${BTN_GHOST} ${BTN_SM}`}>
            Open Care Plan
          </Link>
        </div>
      </div>
    </Card>
  );
}

function SavedAssessment({ intake, vs }: { intake: IntakeAssessment; vs: ValueSetsApi }) {
  const rows: [string, ReactNode][] = [
    ["Presenting Concern", intake.presenting_concern],
    ["History", intake.history],
    [
      "Current Symptoms",
      intake.symptoms.map((code) => vs.label("intake-symptom", code)).join(", "),
    ],
    ["Risk Assessment", vs.label("intake-risk-level", intake.risk_level)],
    ["Risk notes", intake.risk_notes],
    ["Appearance", intake.mse_appearance],
    ["Behavior", intake.mse_behaviour],
    ["Mood", intake.mse_mood],
    ["Affect", intake.mse_affect],
    [
      "GAD-7 Score",
      intake.gad7_score != null
        ? `${intake.gad7_score} · ${scoreSeverity("GAD7", intake.gad7_score)}`
        : "",
    ],
    [
      "PHQ-9 Score",
      intake.phq9_score != null
        ? `${intake.phq9_score} · ${scoreSeverity("PHQ9", intake.phq9_score)}`
        : "",
    ],
    ["Formulation", intake.formulation],
    ["Decision", vs.label("intake-decision", intake.clinical_decision)],
    [
      "Identified Care Needs",
      intake.care_needs.map((code) => vs.label("intake-care-need", code)).join(", "),
    ],
  ];
  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2.5 rounded-lg bg-surface-bg p-3.5 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            {label}
          </dt>
          <dd className="whitespace-pre-wrap break-words text-[13px] text-ink-900">
            {value || <span className="text-ink-400">Not recorded</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
