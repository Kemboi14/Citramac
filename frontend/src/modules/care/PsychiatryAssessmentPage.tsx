import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileText, Save } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  getIntakeSchema,
  openPsychiatryAssessment,
  savePsychiatryAssessment,
  signPsychiatryAssessment,
  type IntakeSchema,
  type PsychiatryFormat,
  type PsychiatryMse,
  type PsychiatrySaveBody,
  type PsychiatryWorkspace,
} from "../../lib/carePathwayApi";
import { EmptyState } from "../../components/EmptyState";
import { AutoResizeTextarea } from "./shared/AutoResizeTextarea";
import { Breadcrumbs } from "./shared/Breadcrumbs";
import { formatDateTime } from "./shared/format";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN, BTN_GHOST, BTN_SM } from "./shared/styles";
import { Callout, Card, ErrorNote, Field, Tag } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { useValueSets } from "./shared/useValueSets";
import { MseSection } from "./record/intake/MseSection";
import { RiskSection } from "./record/intake/RiskSection";
import type { SectionValues } from "./record/intake/fields";
import { IntakeDiagnosisTab } from "./record/IntakeDiagnosisTab";
import { PrescribingModule } from "./record/modules/PrescribingModule";
import { clientRecordPath } from "./shared/recordRoutes";

const STRUCTURED_FIELDS: { key: string; label: string; hint: string; required?: boolean }[] = [
  {
    key: "presenting_concern",
    label: "Presenting concern",
    hint: "The client's own words, onset, duration and course.",
  },
  {
    key: "history",
    label: "History",
    hint: "Relevant psychiatric, medical, substance-use, social and family history.",
  },
  {
    key: "risk",
    label: "Clinical Risk Assessment",
    hint: "Suicide / self-harm, harm to others, vulnerability and protective factors.",
    required: true,
  },
];

const LEGACY_STRUCTURED_FIELDS = [
  { key: "formulation", label: "Formulation" },
  { key: "plan", label: "Plan" },
];

const EMPTY_RISK = {
  rows: {} as Record<string, string[]>,
  other: "",
  details: "",
  actions: [] as string[],
  static: "",
  dynamic: "",
  protective: "",
  change_72h: "",
  summary: "",
  plan: "",
  review_by: "",
  concern_level: "",
  formulation_signed_at: "",
  formulation_signed_by: "",
};

function normalizeRiskValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return { ...EMPTY_RISK, summary: value.trim() };
  }
  if (value && typeof value === "object") {
    const next = value as Record<string, unknown>;
    return {
      ...EMPTY_RISK,
      rows:
        typeof next.rows === "object" && next.rows && !Array.isArray(next.rows)
          ? next.rows
          : EMPTY_RISK.rows,
      other: typeof next.other === "string" ? next.other : "",
      details: typeof next.details === "string" ? next.details : "",
      actions: Array.isArray(next.actions) ? next.actions : [],
      static: typeof next.static === "string" ? next.static : "",
      dynamic: typeof next.dynamic === "string" ? next.dynamic : "",
      protective: typeof next.protective === "string" ? next.protective : "",
      change_72h: typeof next.change_72h === "string" ? next.change_72h : "",
      summary: typeof next.summary === "string" ? next.summary : "",
      plan: typeof next.plan === "string" ? next.plan : "",
      review_by: typeof next.review_by === "string" ? next.review_by : "",
      concern_level: typeof next.concern_level === "string" ? next.concern_level : "",
      formulation_signed_at:
        typeof next.formulation_signed_at === "string" ? next.formulation_signed_at : "",
      formulation_signed_by:
        typeof next.formulation_signed_by === "string" ? next.formulation_signed_by : "",
    };
  }
  return { ...EMPTY_RISK };
}

function riskValueText(
  value: unknown,
  riskRows: IntakeSchema["riskRows"],
  vs: ReturnType<typeof useValueSets>,
): string {
  const risk = normalizeRiskValue(value);
  const rows = risk.rows as Record<string, string[]> | undefined;
  const lines: string[] = [];
  for (const row of riskRows) {
    const picked = rows?.[row.key] ?? [];
    if (picked.length) {
      lines.push(`${row.label}: ${picked.join(", ")}`);
    }
  }
  for (const field of ["static", "dynamic", "protective", "change_72h", "summary"] as const) {
    // Field keys are a fixed local allow-list.
    // eslint-disable-next-line security/detect-object-injection
    const text = String(risk[field] ?? "").trim();
    if (text) {
      lines.push(
        field === "summary"
          ? `Risk formulation: ${text}`
          : `${field === "static" ? "Static factors" : field === "dynamic" ? "Dynamic factors" : field === "protective" ? "Protective factors" : "What could change in the next 24-72 hours?"}: ${text}`,
      );
    }
  }
  for (const [field, label] of [
    ["other", "Other acute risk"],
    ["details", "Immediate actions already taken"],
    ["plan", "Risk management plan"],
    ["review_by", "Review by"],
  ] as const) {
    // Field keys are a fixed local allow-list.
    // eslint-disable-next-line security/detect-object-injection
    const text = String(risk[field] ?? "").trim();
    if (text) lines.push(`${label}: ${text}`);
  }
  const actions = risk.actions as string[];
  if (actions.length) {
    lines.push(
      `Actions: ${actions.map((code) => vs.label("intake-risk-actions", code)).join(", ")}`,
    );
  }
  const concernLevel = String(risk.concern_level ?? "");
  if (concernLevel) {
    lines.push(`Level of concern: ${vs.label("intake-concern-level", concernLevel)}`);
  }
  return lines.join("\n");
}

const SECTIONS = [
  { id: "psych-assessment", label: "Assessment" },
  { id: "psych-mse", label: "MSE" },
  { id: "psych-diagnosis", label: "Diagnosis" },
  { id: "psych-medication", label: "Medication" },
  { id: "psych-previous", label: "Previous" },
];

/** The structured sections as one narrative, under their headings, so switching
 * to free text keeps what was written. */
function sectionsAsNarrative(
  structured: Record<string, unknown>,
  riskRows: IntakeSchema["riskRows"],
  vs: ReturnType<typeof useValueSets>,
) {
  return [...STRUCTURED_FIELDS, ...LEGACY_STRUCTURED_FIELDS]
    .map((field) => {
      const raw =
        field.key === "risk"
          ? riskValueText(structured[field.key], riskRows, vs)
          : String(structured[field.key] ?? "").trim();
      return [field.label, raw] as const;
    })
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}\n${value}`)
    .join("\n\n");
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function signedLocked(workspace: PsychiatryWorkspace | null) {
  return workspace?.assessment?.status === "SIGNED" || workspace?.assessment?.can_edit === false;
}

function inferMseFormat(mse: PsychiatryMse): "STRUCTURED" | "FREE_TEXT" {
  const text = typeof mse?.free_text === "string" ? mse.free_text : "";
  if (text.trim()) return "FREE_TEXT";
  const summary = typeof mse?.summary === "string" ? mse.summary : "";
  const structuredKeys = Object.keys(mse ?? {}).filter(
    (key) => !["findings", "free_text", "summary"].includes(key),
  );
  if (summary.trim() && structuredKeys.length === 0) return "FREE_TEXT";
  return "STRUCTURED";
}

function mseNarrative(mse: PsychiatryMse): string {
  if (typeof mse?.free_text === "string" && mse.free_text.trim()) {
    return mse.free_text.trim();
  }
  if (typeof mse?.summary === "string" && mse.summary.trim()) {
    return mse.summary.trim();
  }
  const parts = Object.entries(mse ?? {})
    .filter(
      ([key, value]) =>
        !["findings", "free_text", "summary"].includes(key) &&
        typeof value === "string" &&
        value.trim(),
    )
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value).trim()}`);
  return parts.join("\n");
}

/**
 * Psychiatry — one client's assessment workspace. Assessment notes use the one
 * note store (ProgressNote type PSYCHIATRY), the MSE uses the one MSE store,
 * diagnosis uses ICD-11 DiagnosisCode and medication uses the structured
 * prescribing module. The format switch changes how each note is captured, and
 * the free-text mode is a single narrative field with no structured questions.
 */
export function PsychiatryAssessmentPage() {
  const { patientId = "" } = useParams<{ patientId: string }>();
  const { accessToken } = useAuth();
  const { banner, error: bannerError } = useClientBanner(patientId);
  const vs = useValueSets();

  const [workspace, setWorkspace] = useState<PsychiatryWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const [format, setFormat] = useState<PsychiatryFormat>("STRUCTURED");
  const [freeText, setFreeText] = useState("");
  const [structured, setStructured] = useState<Record<string, unknown>>({});
  const [mse, setMse] = useState<PsychiatryMse>({});
  const [mseFormat, setMseFormat] = useState<"STRUCTURED" | "FREE_TEXT">("STRUCTURED");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    openPsychiatryAssessment(accessToken, patientId)
      .then((state) => {
        if (cancelled) return;
        setWorkspace(state);
        const assessment = state.assessment;
        setFormat(assessment?.format ?? "STRUCTURED");
        setFreeText(assessment?.free_text ?? "");
        setStructured(assessment?.structured ?? {});
        setMse(state.mse ?? {});
        setMseFormat(inferMseFormat(state.mse ?? {}));
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(errorText(error, "Couldn't open this client's psychiatric assessment."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getIntakeSchema(accessToken)
      .then((loaded) => {
        if (!cancelled) {
          setSchema(loaded);
          setSchemaError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSchemaError(errorText(error, "Couldn't load the mental state examination options."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const locked = signedLocked(workspace);
  const canEdit = Boolean(workspace?.assessment?.can_edit ?? !locked);
  const readOnly = locked || !canEdit;

  const body = useMemo<PsychiatrySaveBody>(
    () => ({ format, free_text: freeText, structured, mse }),
    [format, freeText, structured, mse],
  );
  const riskValue = useMemo(() => normalizeRiskValue(structured.risk), [structured.risk]);

  const withRiskPatch = (current: Record<string, unknown>, patch: Record<string, unknown>) => {
    const nextRisk = normalizeRiskValue(current.risk);
    const rows = {
      ...((nextRisk.rows as Record<string, string[]>) ?? {}),
      ...((patch.rows as Record<string, string[]>) ?? {}),
    };
    return { ...current, risk: { ...nextRisk, ...patch, rows } };
  };

  const setRiskField = (patch: Record<string, unknown>) => {
    setStructured((current) => withRiskPatch(current, patch));
  };

  const updateRisk = (patch: Record<string, unknown>) => {
    const nextStructured = withRiskPatch(structured, patch);
    setStructured(nextStructured);
    if (patch.formulation_signed_at === "sign") {
      void run("save", { ...body, structured: nextStructured });
    }
  };

  const switchFormat = (next: PsychiatryFormat) => {
    if (next === format) return;
    if (next === "FREE_TEXT") {
      const carried = sectionsAsNarrative(structured, schema?.riskRows ?? [], vs);
      if (carried) setFreeText((current) => [current.trim(), carried].filter(Boolean).join("\n\n"));
      setStructured({});
    } else {
      if (
        freeText.trim() &&
        !window.confirm(
          "Switching to structured discards the free-text narrative, because it can't be split into sections. Copy it first if you need it. Switch to structured?",
        )
      ) {
        return;
      }
      setFreeText("");
    }
    setFormat(next);
  };

  const switchMseFormat = (next: "STRUCTURED" | "FREE_TEXT") => {
    if (next === mseFormat) return;
    if (next === "FREE_TEXT") {
      const narrative = mseNarrative(mse);
      setMse({ free_text: narrative });
    } else {
      if (
        mseNarrative(mse).trim() &&
        !window.confirm(
          "Switching to structured MSE discards the free-text narrative. Copy it first if you need it. Switch to structured?",
        )
      ) {
        return;
      }
      setMse({});
    }
    setMseFormat(next);
  };

  const run = async (action: "save" | "sign", payload = body) => {
    if (!accessToken || !patientId) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const state =
        action === "save"
          ? await savePsychiatryAssessment(accessToken, patientId, payload)
          : await signPsychiatryAssessment(accessToken, patientId, payload);
      setWorkspace(state);
      if (state.assessment) {
        setFormat(state.assessment.format);
        setFreeText(state.assessment.free_text);
        setStructured(state.assessment.structured);
      }
      setMse(state.mse);
      setMseFormat(inferMseFormat(state.mse));
      setNotice(
        action === "save"
          ? "Draft saved. You can return to it from the Psychiatry list."
          : "Assessment signed. The note is now read-only; a correction is a new assessment.",
      );
    } catch (error) {
      setActionError(
        errorText(
          error,
          action === "save" ? "Couldn't save the draft." : "Couldn't sign the assessment.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workspace) {
    return (
      <div>
        <Breadcrumbs
          items={[{ label: "Psychiatry", to: "/clinical/psychiatry" }, { label: "Assessment" }]}
        />
        <p className="text-[13px] text-ink-500">Opening the psychiatric assessment…</p>
      </div>
    );
  }

  if (loadError || !workspace) {
    return (
      <div>
        <Breadcrumbs
          items={[{ label: "Psychiatry", to: "/clinical/psychiatry" }, { label: "Assessment" }]}
        />
        <ErrorNote>{loadError ?? "This client's psychiatric assessment is unavailable."}</ErrorNote>
        <Link to="/clinical/psychiatry" className={`${BTN_GHOST} ${BTN_SM} mt-3`}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back to Psychiatry
        </Link>
      </div>
    );
  }

  const assessment = workspace.assessment;
  const signed = assessment?.status === "SIGNED";
  const riskSpec = schema?.sections.find((section) => section.key === "risk");

  return (
    <div className="clinical-readable flex flex-col gap-4">
      <SafetyBanner banner={banner} error={bannerError} />
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/clinical/psychiatry" className={`${BTN_GHOST} ${BTN_SM}`}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Psychiatry list
        </Link>
        <Link to={clientRecordPath(patientId, "snapshot")} className={`${BTN_GHOST} ${BTN_SM}`}>
          <FileText aria-hidden className="h-4 w-4" />
          Full client record
        </Link>
      </div>
      <ErrorNote>{actionError ?? schemaError}</ErrorNote>
      {notice && <Callout tone="success">{notice}</Callout>}

      {workspace.review && (
        <Callout
          tone={workspace.review.status === "PENDING" ? "info" : "warning"}
          label={workspace.review.status === "PENDING" ? "In review" : "Review requested"}
        >
          <strong>{workspace.review.label}</strong>
          {workspace.review.priority ? ` · ${workspace.review.priority}` : ""}
        </Callout>
      )}

      {locked && (
        <Callout tone={signed ? "success" : "warning"}>
          {signed
            ? "This assessment is signed and cannot be edited. A correction or follow-up is a new assessment."
            : "This draft belongs to another clinician and is read-only for you."}
        </Callout>
      )}

      <nav
        role="tablist"
        aria-label="Assessment sections"
        className="sticky top-14 z-10 -mx-1 rounded-xl border border-surface-border bg-surface-card/95 p-1 shadow-sm backdrop-blur"
      >
        <div className="flex gap-1 overflow-x-auto">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              id={`${section.id}-tab`}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                activeSection === section.id
                  ? "bg-brand-green text-on-primary"
                  : "text-ink-900 hover:bg-surface-bg"
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      <div
        id="psych-assessment"
        role="tabpanel"
        aria-labelledby="psych-assessment-tab"
        className={`min-w-0 ${activeSection === "psych-assessment" ? "" : "hidden"}`}
      >
        <Card
          title="Assessment"
          aside={
            <div
              role="group"
              aria-label="Assessment format"
              className="flex rounded-xl border border-surface-border bg-surface-bg p-1"
            >
              {(
                [
                  ["STRUCTURED", "Structured"],
                  ["FREE_TEXT", "Free text"],
                ] as [PsychiatryFormat, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={format === value}
                  disabled={readOnly}
                  onClick={() => switchFormat(value)}
                  className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    format === value
                      ? "bg-brand-green text-on-primary"
                      : "text-ink-900 hover:bg-surface-card"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <p className="mb-3 text-[12.5px] leading-5 text-ink-700">
            {format === "STRUCTURED"
              ? "Clinical risk assessment is required to sign."
              : "Record the assessment as a narrative."}{" "}
            {assessment && `Last saved ${formatDateTime(assessment.updated_at)}.`}
          </p>
          {format === "STRUCTURED" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {STRUCTURED_FIELDS.map((field) => {
                if (field.key === "risk") {
                  return (
                    <div key={field.key} className="lg:col-span-2" id="psych-risk-assessment">
                      {!schema || !riskSpec ? (
                        <ErrorNote>
                          {schemaError ?? "Loading clinical risk assessment options…"}
                        </ErrorNote>
                      ) : (
                        <>
                          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-700">
                            {field.label}
                          </h3>
                          <RiskSection
                            spec={riskSpec}
                            riskRows={schema.riskRows}
                            values={riskValue as SectionValues}
                            vs={vs}
                            onChange={(key, value) => setRiskField({ [key]: value })}
                            onPatch={updateRisk}
                            showFormulation={false}
                          />
                        </>
                      )}
                    </div>
                  );
                }

                return (
                  <Field
                    key={field.key}
                    label={
                      field.required ? (
                        <>
                          {field.label}{" "}
                          <span className="font-normal text-ink-500">(needed to sign)</span>
                        </>
                      ) : (
                        field.label
                      )
                    }
                    hint={field.hint}
                  >
                    <AutoResizeTextarea
                      className="min-h-[112px]"
                      rows={4}
                      value={String(structured[field.key] ?? "")}
                      disabled={readOnly}
                      onChange={(event) =>
                        setStructured((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                );
              })}
            </div>
          ) : (
            <Field label="Free text" hint="Record the assessment in narrative form.">
              <AutoResizeTextarea
                className="min-h-[280px]"
                rows={12}
                value={freeText}
                disabled={readOnly}
                onChange={(event) => setFreeText(event.target.value)}
              />
            </Field>
          )}
        </Card>
      </div>

      <div
        id="psych-mse"
        role="tabpanel"
        aria-labelledby="psych-mse-tab"
        className={`min-w-0 ${activeSection === "psych-mse" ? "" : "hidden"}`}
      >
        <Card
          title="MSE"
          aside={
            <div
              role="group"
              aria-label="MSE format"
              className="flex rounded-xl border border-surface-border bg-surface-bg p-1"
            >
              {(
                [
                  ["STRUCTURED", "Structured"],
                  ["FREE_TEXT", "Free text"],
                ] as ["STRUCTURED" | "FREE_TEXT", string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mseFormat === value}
                  disabled={readOnly}
                  onClick={() => switchMseFormat(value)}
                  className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    mseFormat === value
                      ? "bg-brand-green text-on-primary"
                      : "text-ink-900 hover:bg-surface-card"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {!schema ? (
            schemaError ? (
              <ErrorNote>{schemaError}</ErrorNote>
            ) : (
              <p className="text-[13px] text-ink-500">Loading MSE options…</p>
            )
          ) : mseFormat === "FREE_TEXT" ? (
            <Field label="Free text" hint="Enter the MSE in narrative form.">
              <AutoResizeTextarea
                className="min-h-[180px]"
                rows={8}
                value={typeof mse.free_text === "string" ? mse.free_text : ""}
                disabled={readOnly}
                onChange={(event) =>
                  setMse((current) => ({ ...current, free_text: event.target.value }))
                }
              />
            </Field>
          ) : (
            <MseSection
              schema={schema}
              values={mse as Record<string, unknown>}
              vs={vs}
              onChange={(key, value) => setMse((current) => ({ ...current, [key]: value }))}
              onPatch={(patch) => setMse((current) => ({ ...current, ...patch }))}
            />
          )}
        </Card>
      </div>

      <div
        id="psych-diagnosis"
        role="tabpanel"
        aria-labelledby="psych-diagnosis-tab"
        className={`min-w-0 ${activeSection === "psych-diagnosis" ? "" : "hidden"}`}
      >
        <IntakeDiagnosisTab
          patientId={patientId}
          encounterId={workspace.encounter_id}
          onChanged={() => undefined}
        />
      </div>

      <div
        id="psych-medication"
        role="tabpanel"
        aria-labelledby="psych-medication-tab"
        className={`min-w-0 ${activeSection === "psych-medication" ? "" : "hidden"}`}
      >
        <Card title="Medication" aside={<Tag>MedicationRequest</Tag>} bodyClassName="">
          <div className="p-[18px]">
            <PrescribingModule patientId={patientId} />
          </div>
        </Card>
        {!readOnly && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-surface-border bg-surface-card/95 p-3 shadow-sm backdrop-blur">
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              disabled={saving}
              onClick={() => void run("save")}
            >
              <Save aria-hidden className="h-4 w-4" />
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={saving}
              onClick={() => void run("sign")}
            >
              <CheckCircle2 aria-hidden className="h-4 w-4" />
              {saving ? "Signing…" : "Sign assessment"}
            </button>
          </div>
        )}
      </div>

      <div
        id="psych-previous"
        role="tabpanel"
        aria-labelledby="psych-previous-tab"
        className={`min-w-0 ${activeSection === "psych-previous" ? "" : "hidden"}`}
      >
        <Card title="Previous psychiatric assessments">
          {workspace.history.length === 0 ? (
            <EmptyState title="No previous signed assessments">
              Signed assessments for this client will appear here with their author and time.
            </EmptyState>
          ) : (
            <ol className="flex flex-col gap-2">
              {workspace.history.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-lg border border-surface-border bg-surface-bg"
                >
                  <details>
                    <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold text-ink-900">
                      {formatDateTime(entry.signed_at)} · {entry.author} ·{" "}
                      {entry.format === "FREE_TEXT" ? "Free text" : "Structured"}
                    </summary>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-surface-border px-3.5 py-3 font-system text-[12.5px] leading-5 text-ink-700">
                      {entry.text}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
