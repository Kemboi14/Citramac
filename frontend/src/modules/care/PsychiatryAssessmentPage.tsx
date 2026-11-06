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
import { clientRecordPath } from "./shared/recordRoutes";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "./shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { useValueSets } from "./shared/useValueSets";
import { MseSection } from "./record/intake/MseSection";
import { IntakeDiagnosisTab } from "./record/IntakeDiagnosisTab";
import { PrescribingModule } from "./record/modules/PrescribingModule";

const STRUCTURED_FIELDS: { key: string; label: string; hint: string }[] = [
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
    label: "Risk",
    hint: "Suicide / self-harm, harm to others, vulnerability and protective factors.",
  },
  {
    key: "formulation",
    label: "Formulation",
    hint: "Predisposing, precipitating, perpetuating and protective factors; working explanation.",
  },
  {
    key: "plan",
    label: "Plan",
    hint: "Investigations, psychological treatment, medication, follow-up and safety plan.",
  },
];

const SECTIONS = [
  { id: "psych-format", label: "Format" },
  { id: "psych-assessment", label: "Assessment" },
  { id: "psych-mse", label: "MSE" },
  { id: "psych-diagnosis", label: "Diagnosis" },
  { id: "psych-medication", label: "Medication" },
  { id: "psych-previous", label: "Previous" },
];

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function signedLocked(workspace: PsychiatryWorkspace | null) {
  return workspace?.assessment?.status === "SIGNED" || workspace?.assessment?.can_edit === false;
}

/**
 * Psychiatry — one client's assessment workspace. Assessment notes use the one
 * note store (ProgressNote type PSYCHIATRY), the MSE uses the one MSE store,
 * diagnosis uses ICD-11 DiagnosisCode and medication uses the structured
 * prescribing module. The format switch only changes how the assessment note is
 * captured; the clinical stores are the same either way.
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
  const [structured, setStructured] = useState<Record<string, string>>({});
  const [mse, setMse] = useState<PsychiatryMse>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(SECTIONS[1].id);

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

  const run = async (action: "save" | "sign") => {
    if (!accessToken || !patientId) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const state =
        action === "save"
          ? await savePsychiatryAssessment(accessToken, patientId, body)
          : await signPsychiatryAssessment(accessToken, patientId, body);
      setWorkspace(state);
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

  return (
    <div className="clinical-readable flex flex-col gap-4">
      <SafetyBanner banner={banner} error={bannerError} />
      <Breadcrumbs
        items={[
          { label: "Psychiatry", to: "/clinical/psychiatry" },
          { label: banner?.name.trim() || "Client" },
          { label: "Assessment" },
        ]}
      />
      <PageHeader
        eyebrow="Psychiatry module"
        title={signed ? "Psychiatric assessment — signed" : "Psychiatric assessment"}
        subtitle="Assessment, mental state examination, diagnosis and medication in one clinical encounter. The MSE and diagnosis are shared with the client record — they are not a second copy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/clinical/psychiatry" className={`${BTN_GHOST} ${BTN_SM}`}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
              Psychiatry list
            </Link>
            <Link to={clientRecordPath(patientId, "intake")} className={`${BTN_GHOST} ${BTN_SM}`}>
              <FileText aria-hidden className="h-4 w-4" />
              Full client record
            </Link>
          </div>
        }
      />
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
        id="psych-format"
        role="tabpanel"
        aria-labelledby="psych-format-tab"
        className={`min-w-0 ${activeSection === "psych-format" ? "" : "hidden"}`}
      >
      <Card
        title="Assessment format"
        aside={
          <span className="text-[12px] text-ink-500">
            {assessment ? `Last saved ${formatDateTime(assessment.updated_at)}` : "New assessment"}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={FIELD_LABEL}>Choose how to record this assessment</span>
          <div
            role="group"
            aria-label="Assessment format"
            className="ml-auto flex rounded-xl border border-surface-border bg-surface-bg p-1"
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
                onClick={() => setFormat(value)}
                className={`rounded-[9px] px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                  format === value
                    ? "bg-brand-green text-on-primary"
                    : "text-ink-900 hover:bg-surface-card"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12.5px] leading-5 text-ink-700">
          Structured mode separates presenting concern, history, risk, formulation and plan. Free
          text mode records the same assessment as one narrative. The mental state examination,
          diagnosis and orders stay structured either way.
        </p>
      </Card>
      </div>

      <div
        id="psych-assessment"
        role="tabpanel"
        aria-labelledby="psych-assessment-tab"
        className={`min-w-0 ${activeSection === "psych-assessment" ? "" : "hidden"}`}
      >
      <Card
        title="Assessment"
        aside={
          <Tag tone={format === "STRUCTURED" ? "brand" : "neutral"}>
            {format === "STRUCTURED" ? "Structured" : "Free text"}
          </Tag>
        }
      >
        {format === "STRUCTURED" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {STRUCTURED_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <AutoResizeTextarea
                  className={`${INPUT} min-h-[112px]`}
                  rows={4}
                  value={structured[field.key] ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    setStructured((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
        ) : (
          <Field
            label="Psychiatric assessment — free text"
            hint="History, mental state, risk, formulation and plan in your own structure."
          >
            <AutoResizeTextarea
              className={`${INPUT} min-h-[280px]`}
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
      <Card title="Mental state examination (MSE)" aside={<Tag tone="brand">One MSE store</Tag>}>
        {!schema ? (
          schemaError ? (
            <ErrorNote>{schemaError}</ErrorNote>
          ) : (
            <p className="text-[13px] text-ink-500">Loading MSE options…</p>
          )
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
              <li key={entry.id} className="rounded-lg border border-surface-border bg-surface-bg">
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

      {!readOnly && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-surface-border bg-surface-card/95 p-3 shadow-sm backdrop-blur">
          <span className="mr-auto text-[12.5px] text-ink-500">
            {signed
              ? "Signed assessments are read-only."
              : "Save a draft at any time. Signing locks the assessment note."}
          </span>
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
  );
}
