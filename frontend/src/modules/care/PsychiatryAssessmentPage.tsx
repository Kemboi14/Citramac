import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, FileText, Save } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  completePsychiatricReview,
  decidePlanAction,
  getCarePlanCatalogue,
  getIntakeSchema,
  getPlanWorkspace,
  getPsychiatryPlanSchedule,
  openPsychiatryAssessment,
  schedulePsychiatrySession,
  savePsychiatryAssessment,
  signPsychiatryAssessment,
  // listIntakeAssessments, IntakeAssessment removed
  type IntakeSchema,
  type PlanCatalogueItem,
  type PlanWorkspace,
  type PsychiatryAmendsRef,
  type PsychiatryAssessment,
  type PsychiatryCompleted,
  type PsychiatryFormat,
  type PsychiatryMse,
  type PsychiatryPlanSchedule,
  type PsychiatrySaveBody,
  type PsychiatryWorkspace,
} from "../../lib/carePathwayApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { AutoResizeTextarea } from "./shared/AutoResizeTextarea";
import { Breadcrumbs } from "./shared/Breadcrumbs";
import { formatDateTime } from "./shared/format";
import { SafetyBanner } from "./shared/SafetyBanner";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "./shared/styles";
import { Callout, Card, ErrorNote, Field, SelectChoices, Tag } from "./shared/ui";
import { useClientBanner } from "./shared/useClientBanner";
import { useValueSets } from "./shared/useValueSets";
import { MseSection } from "./record/intake/MseSection";
import { RiskSection } from "./record/intake/RiskSection";
import type { SectionValues } from "./record/intake/fields";
import { IntakeDiagnosisTab } from "./record/IntakeDiagnosisTab";
import { PsychiatryMedicationPanel } from "./psychiatry/MedicationPanel";
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

const LEGACY_STRUCTURED_FIELDS = [{ key: "plan", label: "Plan" }];

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
  { id: "psych-formulation-diagnosis", label: "Formulation & diagnosis" },
  { id: "psych-medication", label: "Medication" },
  { id: "psych-plan-schedule", label: "Plan & Schedule" },
];

/** Tabs that edit the assessment and so end in the save bar. Plan &
 * Schedule saves each action as it is taken; Previous is read-only. */
const EDIT_SECTIONS = new Set([
  "psych-assessment",
  "psych-mse",
  "psych-formulation-diagnosis",
  "psych-medication",
]);

const snapshot = (body: PsychiatrySaveBody) => JSON.stringify(body);

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
          : field.key === "form"
            ? formulationDiagnosisText(structured[field.key])
            : String(structured[field.key] ?? "").trim();
      return [field.label, raw] as const;
    })
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}\n${value}`)
    .join("\n\n");
}

function formulationDiagnosisText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const section = value as Record<string, unknown>;
  return [
    ["Integrated clinical summary / formulation", section.summary],
    ["Differential diagnoses / conditions to rule out", section.differential],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1].trim())
    .map(([label, text]) => `${label}\n${text.trim()}`)
    .join("\n\n");
}

function normalizedStructuredAssessment(value: Record<string, unknown>) {
  const structured = { ...value };
  if (!structured.form && typeof structured.formulation === "string") {
    structured.form = { summary: structured.formulation, differential: "" };
    delete structured.formulation;
  }
  return structured;
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
  const [confirmingSign, setConfirmingSign] = useState(false);
  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [planSchedule, setPlanSchedule] = useState<PsychiatryPlanSchedule | null>(null);
  const [planScheduleError, setPlanScheduleError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<PlanCatalogueItem[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [planWorkspace, setPlanWorkspace] = useState<PlanWorkspace | null>(null);
  const [selectedCarePlan, setSelectedCarePlan] = useState("");
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [sessionMode, setSessionMode] = useState<"IN_PERSON" | "PHONE" | "VIDEO">("IN_PERSON");
  const [sessionDuration, setSessionDuration] = useState(30);
  const [sessionNote, setSessionNote] = useState("");
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [scheduleRequestId, setScheduleRequestId] = useState(() => crypto.randomUUID());
  const [scheduling, setScheduling] = useState(false);
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
  // The module opens on the list of signed assessments (or the draft in progress);
  // a signed one opens section by section; "edit" is the draft tabs.
  const [view, setView] = useState<{ mode: "auto" | "list" | "edit" | "detail"; id?: string }>({
    mode: "auto",
  });
  // Set while the draft amends a signed assessment (never edits it).
  const [amend, setAmend] = useState<PsychiatryAmendsRef | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The draft as last loaded or saved, to tell the clinician what isn't saved.
  const [savedSnapshot, setSavedSnapshot] = useState("");

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    openPsychiatryAssessment(accessToken, patientId)
      .then((state) => {
        if (cancelled) return;
        setWorkspace(state);
        const assessment = state.assessment;
        setAmend(assessment?.status === "DRAFT" ? (assessment.amends ?? null) : null);
        setFormat(assessment?.format ?? "STRUCTURED");
        setFreeText(assessment?.free_text ?? "");
        const structuredAssessment = normalizedStructuredAssessment(assessment?.structured ?? {});
        if (!assessment && state.carried_forward_presenting_concern) {
          structuredAssessment.presenting_concern = state.carried_forward_presenting_concern.text;
        }
        setStructured(structuredAssessment);
        setMse(state.mse ?? {});
        setMseFormat(inferMseFormat(state.mse ?? {}));
        setSavedSnapshot(
          snapshot({
            format: assessment?.format ?? "STRUCTURED",
            free_text: assessment?.free_text ?? "",
            structured: normalizedStructuredAssessment(assessment?.structured ?? {}),
            mse: state.mse ?? {},
          }),
        );
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
  }, [accessToken, patientId, reloadKey]);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getPsychiatryPlanSchedule(accessToken, patientId)
      .then((data) => {
        if (!cancelled) {
          setPlanSchedule(data);
          setPlanScheduleError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPlanScheduleError(errorText(error, "Couldn't load the current care plan."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getCarePlanCatalogue(accessToken)
      .then(({ results }) => {
        if (!cancelled) {
          setCatalogue(results);
          setCatalogueError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCatalogueError(errorText(error, "Couldn't load the care plan catalogue."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getPlanWorkspace(accessToken, patientId)
      .then((data) => {
        if (!cancelled) setPlanWorkspace(data);
      })
      .catch(() => {
        // The catalogue and schedule remain usable; confirmation reloads this.
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
    () => ({
      format,
      free_text: freeText,
      structured,
      mse,
      ...(amend ? { amends: amend.id, amend_reason: amend.reason } : {}),
    }),
    [format, freeText, structured, mse, amend],
  );
  const dirty = Boolean(savedSnapshot) && snapshot(body) !== savedSnapshot;
  // Leaving with unsaved draft changes asks first.
  useEffect(() => {
    if (!dirty || readOnly) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, readOnly]);
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

  const run = async (action: "save" | "sign", payload = body): Promise<boolean> => {
    if (!accessToken || !patientId) return false;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const state =
        action === "save"
          ? await savePsychiatryAssessment(accessToken, patientId, payload)
          : await signPsychiatryAssessment(accessToken, patientId, payload);
      setWorkspace(state);
      const saved: PsychiatrySaveBody = state.assessment
        ? {
            format: state.assessment.format,
            free_text: state.assessment.free_text,
            structured: normalizedStructuredAssessment(state.assessment.structured),
            mse: state.mse,
          }
        : { ...payload, mse: state.mse };
      setFormat(saved.format);
      setFreeText(saved.free_text);
      setStructured(saved.structured);
      setMse(state.mse);
      setMseFormat(inferMseFormat(state.mse));
      setSavedSnapshot(snapshot(saved));
      if (action === "sign" && state.completed) {
        setAmend(null);
        setView({ mode: "detail", id: state.completed.id });
      }
      // A save shows only "Saved <time>" in the save bar.
      setNotice(action === "save" ? null : "Assessment signed.");
      return true;
    } catch (error) {
      setActionError(
        errorText(
          error,
          action === "save" ? "Couldn't save the assessment." : "Couldn't sign the assessment.",
        ),
      );
      return false;
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
      </div>
    );
  }

  const assessment = workspace.assessment;
  const signed = assessment?.status === "SIGNED";
  const draftInProgress = Boolean(assessment) && !signed;
  const mode =
    view.mode !== "auto"
      ? view.mode
      : draftInProgress || workspace.history.length === 0
        ? "edit"
        : "list";
  const detail =
    mode === "detail" ? (workspace.history.find((entry) => entry.id === view.id) ?? null) : null;
  const detailChain = detail
    ? (assessmentChains(workspace.history).find((chain) =>
        chain.versions.some((entry) => entry.id === detail.id),
      ) ?? null)
    : null;
  const startNewAssessment = () => {
    setView({ mode: "edit" });
    setAmend(null);
    setActiveSection(SECTIONS[0].id);
    setNotice(null);
    // The signed note is still loaded after signing here; reopening gives a blank draft.
    if (signed) setReloadKey((key) => key + 1);
  };
  const amendAssessment = (entry: PsychiatryCompleted) => {
    // A new draft, filled from what was signed. The signed note itself never changes.
    setWorkspace({ ...workspace, assessment: null });
    setAmend({ id: entry.id, signed_at: entry.signed_at, author: entry.author, reason: "" });
    setFormat(entry.format);
    setFreeText(entry.free_text);
    setStructured(normalizedStructuredAssessment(entry.structured));
    setMse(entry.mse ?? {});
    setMseFormat(inferMseFormat(entry.mse ?? {}));
    setSavedSnapshot(snapshot({ format: "STRUCTURED", free_text: "", structured: {}, mse: {} }));
    setNotice(null);
    setActiveSection(SECTIONS[0].id);
    setView({ mode: "edit" });
  };
  const riskSpec = schema?.sections.find((section) => section.key === "risk");
  const scheduledActivityIds = new Set(
    (planSchedule?.scheduled_sessions ?? []).map((session) => session.care_plan_activity_id),
  );
  const acceptedCarePlans = new Set(
    (planWorkspace?.actions ?? [])
      .filter((action) => ["ACCEPTED", "MODIFIED", "ADDED"].includes(action.decision))
      .map((action) => action.key),
  );
  const recommendedCarePlans = new Set(
    (planWorkspace?.recommendations ?? []).map((recommendation) => recommendation.key),
  );
  const selectedCatalogueItem = catalogue.find((item) => item.key === selectedCarePlan) ?? null;
  const selectedCarePlanAccepted = acceptedCarePlans.has(selectedCarePlan);
  const selectedCarePlanNote =
    planWorkspace?.actions.find((action) => action.key === selectedCarePlan)?.note ?? null;
  const canScheduleCarePlan = selectedCarePlan === "psych_review" && selectedCarePlanAccepted;
  const psychReviewActivity =
    planSchedule?.plan?.activities.find(
      (activity) =>
        activity.action_key === "psych_review" &&
        activity.available_to_psychiatry &&
        activity.status === "PLANNED" &&
        !scheduledActivityIds.has(activity.id),
    ) ?? null;

  const carePlanState = (key: string) =>
    acceptedCarePlans.has(key)
      ? "Confirmed"
      : recommendedCarePlans.has(key)
        ? "Recommended"
        : "Not selected";

  const confirmCarePlan = async () => {
    if (!accessToken || !selectedCarePlan || selectedCarePlanAccepted) return;
    setConfirmingPlan(true);
    setConfirmError(null);
    setConfirmMessage(null);
    try {
      const updatedWorkspace = await decidePlanAction(accessToken, patientId, selectedCarePlan, {
        decision: "ACCEPTED",
        ...(confirmNote.trim() ? { note: confirmNote.trim() } : {}),
      });
      setPlanWorkspace(updatedWorkspace);
      setPlanSchedule(await getPsychiatryPlanSchedule(accessToken, patientId));
      setConfirmMessage(
        `“${selectedCatalogueItem?.name ?? "Care plan"}” confirmed for this client — it now appears in Interventions.`,
      );
      setConfirmNote("");
      // Keep Psychiatric review selected so its scheduling panel opens; other
      // plans are done once confirmed.
      if (selectedCarePlan !== "psych_review") setSelectedCarePlan("");
    } catch (error) {
      setConfirmError(errorText(error, "Couldn't confirm the care plan."));
    } finally {
      setConfirmingPlan(false);
    }
  };

  const scheduleNextSession = async () => {
    if (!accessToken || !psychReviewActivity || !scheduledFor) return;
    setScheduling(true);
    setPlanScheduleError(null);
    setScheduleMessage(null);
    try {
      const updated = await schedulePsychiatrySession(accessToken, patientId, {
        care_plan_activity: psychReviewActivity.id,
        scheduled_for: new Date(scheduledFor).toISOString(),
        duration_minutes: sessionDuration,
        mode: sessionMode,
        notes: sessionNote.trim(),
        client_request_id: scheduleRequestId,
      });
      setPlanSchedule(updated);
      setScheduledFor("");
      setSessionNote("");
      setScheduleRequestId(crypto.randomUUID());
      setScheduleMessage("Next psychiatry session scheduled.");
    } catch (error) {
      setPlanScheduleError(errorText(error, "Couldn't schedule the next session."));
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="clinical-readable flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Psychiatry", to: "/clinical/psychiatry" },
          // The client's assessments, then the one open — so Back closes a
          // summary or draft to the list, the way the user came.
          {
            label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Assessments",
            onClick:
              mode !== "list" && workspace.history.length > 0
                ? () => setView({ mode: "list" })
                : undefined,
          },
          ...(mode === "detail" && detail
            ? [{ label: `Assessment signed ${formatDateTime(detail.signed_at)}` }]
            : mode === "edit" && workspace.history.length > 0
              ? [
                  {
                    label: amend
                      ? "Amendment"
                      : draftInProgress
                        ? "Assessment in progress"
                        : "New assessment",
                  },
                ]
              : []),
        ]}
      />
      <SafetyBanner banner={banner} error={bannerError} />
      <div className="flex flex-wrap items-center gap-2">
        <Link to={clientRecordPath(patientId, "snapshot")} className={`${BTN_GHOST} ${BTN_SM}`}>
          <FileText aria-hidden className="h-4 w-4" />
          Full client record
        </Link>
      </div>
      <ErrorNote>{schemaError}</ErrorNote>
      {/* While editing, save results show in the save bar; after signing, here. */}
      {notice && readOnly && <Callout tone="success">{notice}</Callout>}

      {workspace.review && (
        <Callout
          tone={workspace.review.status === "PENDING" ? "info" : "warning"}
          label={workspace.review.status === "PENDING" ? "In review" : "Review requested"}
        >
          <strong>{workspace.review.label}</strong>
          {workspace.review.priority ? ` · ${workspace.review.priority}` : ""}
          {workspace.review.triage_priority ? ` · triage ${workspace.review.triage_priority}` : ""}
          {workspace.review.needs_outcome && (
            <ReviewOutcome
              reviewId={workspace.review.id}
              onSaved={() => {
                setNotice("Review outcome recorded.");
                setReloadKey((key) => key + 1);
              }}
            />
          )}
        </Callout>
      )}

      {mode === "list" ? (
        <AssessmentList
          history={workspace.history}
          draft={draftInProgress ? assessment : null}
          onOpen={(id) => setView({ mode: "detail", id })}
          onContinue={() => setView({ mode: "edit" })}
          onStartNew={startNewAssessment}
        />
      ) : mode === "detail" && detail ? (
        <CompletedAssessment
          completed={detail}
          history={workspace.history}
          versions={detailChain?.versions ?? [detail]}
          onOpenVersion={(id) => setView({ mode: "detail", id })}
          patientId={patientId}
          planSchedule={planSchedule}
          canAmend={!draftInProgress}
          onBack={() => setView({ mode: "list" })}
          onAmend={() => amendAssessment(detailChain?.latest ?? detail)}
        />
      ) : (
        <>
          {workspace.history.length > 0 && (
            <div>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={() => setView({ mode: "list" })}
              >
                ← All assessments
              </button>
            </div>
          )}
          {amend && !readOnly && (
            <Callout tone="info" label="Amendment">
              <p>
                Amending the assessment signed {formatDateTime(amend.signed_at)} by {amend.author}.
                That signed assessment stays on record unchanged; this amendment is signed as a new
                version.
              </p>
              <label className="mt-2 block">
                <span className={FIELD_LABEL}>Reason for the amendment (required)</span>
                <AutoResizeTextarea
                  className={INPUT}
                  value={amend.reason}
                  onChange={(event) => setAmend({ ...amend, reason: event.target.value })}
                />
              </label>
            </Callout>
          )}
          {locked && (
            <Callout tone={signed ? "success" : "warning"}>
              {signed
                ? "This assessment is signed and cannot be edited. A correction or follow-up is a new assessment."
                : "This unsigned assessment belongs to another clinician and is read-only for you."}
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
                    const carriedConcern =
                      field.key === "presenting_concern" && !assessment
                        ? workspace?.carried_forward_presenting_concern
                        : null;
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
                        hint={
                          carriedConcern
                            ? `Carried forward from signed ${carriedConcern.source}. Review or update as needed.`
                            : field.hint
                        }
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
            id="psych-formulation-diagnosis"
            role="tabpanel"
            aria-labelledby="psych-formulation-diagnosis-tab"
            className={`min-w-0 ${activeSection === "psych-formulation-diagnosis" ? "" : "hidden"}`}
          >
            <Card title="Formulation & diagnosis">
              <div className="grid gap-3">
                <Field
                  label="Integrated clinical summary / formulation"
                  htmlFor="psychiatry-formulation-summary"
                >
                  <AutoResizeTextarea
                    id="psychiatry-formulation-summary"
                    className="min-h-[112px]"
                    rows={5}
                    value={String(
                      (structured.form as Record<string, unknown> | undefined)?.summary ?? "",
                    )}
                    disabled={readOnly}
                    onChange={(event) =>
                      setStructured((current) => ({
                        ...current,
                        form: {
                          ...((current.form as Record<string, unknown> | undefined) ?? {}),
                          summary: event.target.value,
                        },
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Differential diagnoses / conditions to rule out"
                  htmlFor="psychiatry-formulation-differential"
                >
                  <AutoResizeTextarea
                    id="psychiatry-formulation-differential"
                    className="min-h-[72px]"
                    rows={3}
                    value={String(
                      (structured.form as Record<string, unknown> | undefined)?.differential ?? "",
                    )}
                    disabled={readOnly}
                    onChange={(event) =>
                      setStructured((current) => ({
                        ...current,
                        form: {
                          ...((current.form as Record<string, unknown> | undefined) ?? {}),
                          differential: event.target.value,
                        },
                      }))
                    }
                  />
                </Field>
              </div>
            </Card>
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
            <PsychiatryMedicationPanel patientId={patientId} />
          </div>

          <div
            id="psych-plan-schedule"
            role="tabpanel"
            aria-labelledby="psych-plan-schedule-tab"
            className={`min-w-0 ${activeSection === "psych-plan-schedule" ? "" : "hidden"}`}
          >
            <ErrorNote>{planScheduleError ?? catalogueError ?? confirmError}</ErrorNote>
            {(scheduleMessage ?? confirmMessage) && (
              <Callout tone="success">{scheduleMessage ?? confirmMessage}</Callout>
            )}
            <Card title="Plan & Schedule">
              <div className="flex flex-col gap-4">
                <section aria-labelledby="psychiatry-select-plan-title">
                  <h3 id="psychiatry-select-plan-title" className="text-sm font-bold text-ink-900">
                    Care plans
                  </h3>
                  <p className="mt-1 text-xs text-ink-700">
                    Select a care plan and confirm it for this client. A confirmed plan appears in
                    Interventions. Confirm Psychiatric review to schedule the next session.
                  </p>
                  <label className={`${FIELD_LABEL} mt-3`}>
                    Care plan
                    <select
                      className={INPUT}
                      value={selectedCarePlan}
                      onChange={(event) => {
                        setSelectedCarePlan(event.target.value);
                        setConfirmMessage(null);
                        setConfirmError(null);
                        setConfirmNote("");
                      }}
                    >
                      <option value="">Select a care plan…</option>
                      {catalogue.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.name} — {carePlanState(item.key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {catalogueError && catalogue.length === 0 && (
                    <p className="mt-2 text-xs text-ink-500">Care plans are unavailable.</p>
                  )}
                  {selectedCatalogueItem && (
                    <div className="mt-3 rounded-md border border-surface-border bg-surface-bg px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-[13px] text-ink-900">
                          {selectedCatalogueItem.name}
                        </strong>
                        <Tag tone={selectedCarePlanAccepted ? "brand" : "neutral"}>
                          {selectedCarePlanAccepted
                            ? "Confirmed for this client"
                            : "Not yet confirmed"}
                        </Tag>
                      </div>
                      {selectedCatalogueItem.tasks.length > 0 && (
                        <ul className="mt-1.5 list-disc pl-5 text-xs text-ink-700">
                          {selectedCatalogueItem.tasks.map((task) => (
                            <li key={task}>{task}</li>
                          ))}
                        </ul>
                      )}
                      {selectedCarePlanAccepted && selectedCarePlanNote && (
                        <div className="mt-2 rounded border-l-2 border-brand-green bg-surface-card px-3 py-2">
                          <p className="whitespace-pre-wrap text-xs text-ink-900">
                            {selectedCarePlanNote.text}
                          </p>
                          <p className="mt-1 text-[11px] text-ink-500">
                            {selectedCarePlanNote.author || "Clinician"} ·{" "}
                            {formatDateTime(selectedCarePlanNote.at)}
                          </p>
                        </div>
                      )}
                      {!selectedCarePlanAccepted && (
                        <>
                          <label className={`${FIELD_LABEL} mt-3`}>
                            Note for the record (optional)
                            <AutoResizeTextarea
                              rows={3}
                              aria-label="Note for the record"
                              placeholder="Why this plan, what was agreed, the client's preference…"
                              maxLength={4000}
                              value={confirmNote}
                              onChange={(event) => setConfirmNote(event.target.value)}
                            />
                          </label>
                          <p className="mt-1 text-[11px] text-ink-500">
                            Saved to the client&apos;s record and shown in Interventions.
                          </p>
                          <button
                            type="button"
                            className={`${BTN} ${BTN_SM} mt-2`}
                            disabled={confirmingPlan}
                            onClick={() => void confirmCarePlan()}
                          >
                            {confirmingPlan ? "Confirming…" : "Confirm for this client"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </section>

                {planSchedule?.plan ? (
                  <section
                    aria-labelledby="psychiatry-current-plan-title"
                    className="border-t border-surface-border pt-4"
                  >
                    <h3
                      id="psychiatry-current-plan-title"
                      className="text-sm font-bold text-ink-900"
                    >
                      Current episode care plan
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700">
                      {planSchedule.plan.goals || "No plan goals recorded."}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {planSchedule.plan.confirmed ? "Confirmed care plan" : "Not yet confirmed"}
                    </p>
                    <ul className="mt-3 divide-y divide-surface-border rounded-md border border-surface-border">
                      {planSchedule.plan.activities.map((activity) => (
                        <li
                          key={activity.id}
                          className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
                        >
                          <div>
                            <span className="text-[13px] font-medium text-ink-900">
                              {activity.title}
                            </span>
                            {activity.goal && (
                              <span className="mt-0.5 block text-xs text-ink-700">
                                {activity.goal}
                              </span>
                            )}
                          </div>
                          <Tag>{activity.status_display}</Tag>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="border-t border-surface-border pt-4 text-xs text-ink-500">
                    No care plan exists for this client&apos;s open episode yet. Confirming a plan
                    above creates one.
                  </p>
                )}

                {canScheduleCarePlan &&
                  (psychReviewActivity ? (
                    <section
                      aria-labelledby="psychiatry-schedule-session-title"
                      className="border-t border-surface-border pt-4"
                    >
                      <h3
                        id="psychiatry-schedule-session-title"
                        className="text-sm font-bold text-ink-900"
                      >
                        Schedule next psychiatry session
                      </h3>
                      <p className="mt-1 text-xs text-ink-700">
                        Psychiatric review is confirmed for this client. Book the next session now;
                        it will appear in the appointment and Interventions views.
                      </p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className={FIELD_LABEL}>
                          Date and time
                          <input
                            className={INPUT}
                            type="datetime-local"
                            step={900}
                            value={scheduledFor}
                            onChange={(event) => setScheduledFor(event.target.value)}
                          />
                        </label>
                        <label className={FIELD_LABEL}>
                          Session mode
                          <select
                            className={INPUT}
                            value={sessionMode}
                            onChange={(event) =>
                              setSessionMode(event.target.value as "IN_PERSON" | "PHONE" | "VIDEO")
                            }
                          >
                            <option value="IN_PERSON">In person</option>
                            <option value="PHONE">Phone</option>
                            <option value="VIDEO">Video</option>
                          </select>
                        </label>
                        <label className={FIELD_LABEL}>
                          Duration (minutes)
                          <input
                            className={INPUT}
                            type="number"
                            min={5}
                            max={240}
                            step={5}
                            value={sessionDuration}
                            onChange={(event) =>
                              setSessionDuration(Number(event.target.value) || 30)
                            }
                          />
                        </label>
                        <label className={`${FIELD_LABEL} md:col-span-2`}>
                          Brief scheduling note (optional)
                          <textarea
                            className={`${INPUT} min-h-20`}
                            maxLength={500}
                            value={sessionNote}
                            onChange={(event) => setSessionNote(event.target.value)}
                            placeholder="Logistics only"
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-ink-500">
                        This note appears in the shared appointment and Interventions views. Do not
                        include psychiatric details; record clinical content in the appropriate
                        signed note.
                      </p>
                      <button
                        type="button"
                        className={`${BTN} ${BTN_SM} mt-3`}
                        disabled={
                          scheduling ||
                          !scheduledFor ||
                          sessionDuration < 5 ||
                          sessionDuration > 240
                        }
                        onClick={() => void scheduleNextSession()}
                      >
                        {scheduling ? "Scheduling…" : "Schedule next session"}
                      </button>
                    </section>
                  ) : (
                    <Callout tone="info">
                      Psychiatric review is confirmed, but there is no planned, unscheduled
                      psychiatry action to book. An action already in progress or already scheduled
                      cannot be scheduled again.
                    </Callout>
                  ))}
              </div>
            </Card>

            {planSchedule && planSchedule.scheduled_sessions.length > 0 && (
              <Card title="Upcoming psychiatry sessions" className="mt-3">
                <ul className="divide-y divide-surface-border">
                  {planSchedule.scheduled_sessions.map((session) => (
                    <li key={session.id} className="py-2 first:pt-0 last:pb-0">
                      <strong className="block text-[13px] text-ink-900">
                        {session.activity_title}
                      </strong>
                      <span className="text-xs text-ink-700">
                        {formatDateTime(session.scheduled_for)}
                        {session.provider_name ? ` · ${session.provider_name}` : ""}
                      </span>
                      {session.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-700">
                          Scheduling note: {session.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {(EDIT_SECTIONS.has(activeSection) || activeSection === "psych-plan-schedule") &&
            !readOnly && (
              <SaveBar
                signHere={activeSection === "psych-plan-schedule"}
                saving={saving}
                dirty={dirty}
                savedAt={assessment?.updated_at ?? null}
                error={actionError}
                notice={notice}
                onSave={() => void run("save")}
                onSign={() => setConfirmingSign(true)}
              />
            )}
        </>
      )}
      <ConfirmDialog
        open={confirmingSign}
        title="Sign the psychiatric assessment?"
        confirmLabel="Sign assessment"
        busyLabel="Signing…"
        busy={saving}
        error={actionError}
        onConfirm={async () => {
          if (await run("sign")) setConfirmingSign(false);
        }}
        onCancel={() => setConfirmingSign(false)}
      >
        Check that the assessment, MSE, formulation &amp; diagnosis, medication and plan are
        complete. Once signed, the assessment is read-only; a correction is a new assessment.
      </ConfirmDialog>
    </div>
  );
}

/** The bottom of every editing tab: what is saved, and Save. The assessment is one
 * draft record, so Save on any tab keeps all of it and the clinician can stop (e.g. send
 * the client to the lab) and continue later in any order. Signing is offered only on
 * Plan & Schedule, the last step, behind a confirmation. */
function SaveBar({
  signHere,
  saving,
  dirty,
  savedAt,
  error,
  notice,
  onSave,
  onSign,
}: {
  signHere: boolean;
  saving: boolean;
  dirty: boolean;
  savedAt: string | null;
  error: string | null;
  notice: string | null;
  onSave: () => void;
  onSign: () => void;
}) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-surface-border bg-surface-card/95 p-3 shadow-sm backdrop-blur">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[12.5px] text-ink-700" aria-live="polite">
          {saving
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : notice && !error
                ? notice
                : savedAt
                  ? `Saved ${formatDateTime(savedAt)}`
                  : "Not saved yet"}
        </p>
        {(!signHere || dirty) && (
          <button
            type="button"
            className={`${signHere ? BTN_GHOST : BTN} ${BTN_SM}`}
            disabled={saving}
            onClick={onSave}
          >
            <Save aria-hidden className="h-4 w-4" />
            Save
          </button>
        )}
        {signHere && (
          <button type="button" className={`${BTN} ${BTN_SM}`} disabled={saving} onClick={onSign}>
            <CheckCircle2 aria-hidden className="h-4 w-4" />
            Sign assessment
          </button>
        )}
      </div>
    </div>
  );
}

/** One assessment as the clinician sees it: its signed versions, oldest first. An
 * amendment is stored as its own signed note (the signed original is never
 * overwritten, guide.md §3 item 7) but shown as a later version of the same
 * assessment, not as another assessment. */
type AssessmentChain = { versions: PsychiatryCompleted[]; latest: PsychiatryCompleted };

function assessmentChains(history: PsychiatryCompleted[]): AssessmentChain[] {
  const byId = new Map(history.map((entry) => [entry.id, entry]));
  const rootOf = (entry: PsychiatryCompleted): string => {
    let current = entry;
    while (current.amends && byId.has(current.amends.id)) current = byId.get(current.amends.id)!;
    return current.id;
  };
  const groups = new Map<string, PsychiatryCompleted[]>();
  for (const entry of history) {
    const root = rootOf(entry);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  }
  return [...groups.values()]
    .map((versions) => {
      const sorted = [...versions].sort((a, b) =>
        String(a.signed_at).localeCompare(String(b.signed_at)),
      );
      return { versions: sorted, latest: sorted[sorted.length - 1] };
    })
    .sort((a, b) => String(b.latest.signed_at).localeCompare(String(a.latest.signed_at)));
}

const ROW =
  "rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-[13.5px] text-ink-900";

/** Every psychiatric assessment for the client, newest first: the draft in
 * progress (if any) and each signed one, with what kind it is and its headline
 * diagnosis and medication. Opening one shows it section by section. */
function AssessmentList({
  history,
  draft,
  onOpen,
  onContinue,
  onStartNew,
}: {
  history: PsychiatryCompleted[];
  draft: PsychiatryAssessment | null;
  onOpen: (id: string) => void;
  onContinue: () => void;
  onStartNew: () => void;
}) {
  const chains = assessmentChains(history);
  const oldest = [...chains].sort((a, b) =>
    String(a.versions[0].signed_at).localeCompare(String(b.versions[0].signed_at)),
  )[0]?.versions[0].id;
  return (
    <Card title="Psychiatric assessments">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-[12.5px] text-ink-500">
            {chains.length} {chains.length === 1 ? "assessment" : "assessments"}
          </p>
          {!draft && (
            <button type="button" className={`${BTN} ${BTN_SM}`} onClick={onStartNew}>
              Start a new assessment
            </button>
          )}
        </div>
        {draft && (
          <button
            type="button"
            onClick={onContinue}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--green)] bg-surface-card px-3.5 py-3 text-left"
          >
            <span className="mr-auto">
              <span className="block text-[14px] font-semibold text-ink-900">
                {draft.amends ? "Amendment in progress" : "Assessment in progress"}
              </span>
              <span className="text-[12.5px] text-ink-500">
                Last saved {formatDateTime(draft.updated_at)} by {draft.author}
              </span>
            </span>
            <Tag tone="warn">Draft</Tag>
            <span className="text-[13px] font-semibold text-[var(--green)]">Continue →</span>
          </button>
        )}
        <ol className="flex flex-col gap-2">
          {chains.map(({ versions, latest: entry }) => {
            const first = versions[0];
            const amended = versions.length > 1;
            const primary = entry.diagnoses.find((dx) => dx.primary) ?? entry.diagnoses[0] ?? null;
            const kind = first.id === oldest ? "Initial assessment" : "Follow-up assessment";
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-surface-border bg-surface-bg px-3.5 py-3 text-left hover:border-[var(--green)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink-900">{kind}</span>
                      {amended && <Tag tone="warn">Amended</Tag>}
                    </span>
                    <span className="block text-[12.5px] text-ink-500">
                      Signed {formatDateTime(first.signed_at)} by {first.author}
                      {amended
                        ? ` · last amended ${formatDateTime(entry.signed_at)} by ${entry.author}`
                        : ""}
                    </span>
                    <span className="mt-1 block text-[13px] text-ink-700">
                      {primary
                        ? `${primary.code ? `${primary.code} ` : ""}${primary.display}`
                        : "No diagnosis recorded"}
                      {" · "}
                      {entry.medications.length === 0
                        ? "no medication"
                        : `${entry.medications.length} medication${entry.medications.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <Tag tone="brand">Signed</Tag>
                  <span className="text-[13px] font-semibold text-[var(--green)]">Open →</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}

/** One signed psychiatric assessment, section by section. It is never edited:
 * Amend starts a new version that points at it. */
function CompletedAssessment({
  completed,
  history,
  versions,
  onOpenVersion,
  patientId,
  planSchedule,
  canAmend,
  onBack,
  onAmend,
}: {
  completed: PsychiatryCompleted;
  history: PsychiatryCompleted[];
  versions: PsychiatryCompleted[];
  onOpenVersion: (id: string) => void;
  patientId: string;
  planSchedule: PsychiatryPlanSchedule | null;
  canAmend: boolean;
  onBack: () => void;
  onAmend: () => void;
}) {
  const activities = planSchedule?.plan?.activities ?? [];
  const sessions = planSchedule?.scheduled_sessions ?? [];
  const section = (key: string) => completed.sections.find((entry) => entry.key === key);
  const has = (key: string) => (section(key)?.items.length ?? 0) > 0;
  const items = (key: string) => (
    <dl className="flex flex-col gap-3">
      {(section(key)?.items ?? []).map((item, index) => (
        <div key={`${item.label}-${index}`}>
          {item.label && (
            <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
              {item.label}
            </dt>
          )}
          <dd className="whitespace-pre-wrap text-[13.5px] leading-6 text-ink-900">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
  const nothing = (text: string) => <p className="text-[13px] italic text-ink-500">{text}</p>;
  const chains = assessmentChains(history);
  const interventionsLink = (module: string, record: string) =>
    `${clientRecordPath(patientId, "interventions")}?${new URLSearchParams({ module, record }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onBack}>
          ← All assessments
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
        <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-[var(--green)]" />
        <div className="mr-auto min-w-0">
          <p className="text-[15px] font-semibold text-ink-900">
            Psychiatric assessment
            {versions.length > 1
              ? ` · version ${versions.findIndex((v) => v.id === completed.id) + 1} of ${versions.length}`
              : ""}
          </p>
          <p className="text-[12.5px] text-ink-500">
            Signed{completed.signed_at ? ` ${formatDateTime(completed.signed_at)}` : ""}
            {completed.author ? ` by ${completed.author}` : ""}
          </p>
        </div>
        <button
          type="button"
          className={`${BTN} ${BTN_SM}`}
          disabled={!canAmend}
          title={canAmend ? undefined : "Finish the assessment in progress first."}
          onClick={onAmend}
        >
          Amend
        </button>
      </div>
      {versions.length > 1 && (
        <Card title="Versions">
          <ol className="flex flex-col gap-1.5">
            {[...versions].reverse().map((version, index) => {
              const current = version.id === completed.id;
              const number = versions.length - index;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => onOpenVersion(version.id)}
                    aria-current={current ? "true" : undefined}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                      current
                        ? "border-[var(--green)] bg-surface-card"
                        : "border-surface-border bg-surface-bg"
                    }`}
                  >
                    <span className="font-semibold text-ink-900">
                      Version {number}
                      {index === 0 ? " (current)" : ""}
                    </span>
                    <span className="text-ink-500">
                      {formatDateTime(version.signed_at)} · {version.author}
                    </span>
                    {version.amends?.reason && (
                      <span className="basis-full text-ink-700">
                        Reason: {version.amends.reason}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
      {versions.length > 1 && completed.id !== versions[versions.length - 1].id && (
        <Callout tone="warning" label="Earlier version">
          You are viewing an earlier version, kept as it was signed. The current version is at the
          top of Versions.
        </Callout>
      )}

      <Card title="1 · Assessment">
        {has("assessment") ? items("assessment") : nothing("Nothing recorded.")}
      </Card>

      <Card title="2 · Mental state examination">
        {has("mse") ? items("mse") : nothing("No MSE recorded.")}
      </Card>

      <Card title="3 · Formulation & diagnosis">
        <div className="flex flex-col gap-3">
          {has("formulation") && items("formulation")}
          {completed.diagnoses.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {completed.diagnoses.map((dx, index) => (
                <li
                  key={`${dx.code}-${index}`}
                  className={`${ROW} flex flex-wrap items-center gap-2`}
                >
                  {dx.code && <span className="font-mono font-semibold">{dx.code}</span>}
                  <span>{dx.display}</span>
                  {dx.primary && <Tag tone="brand">Primary</Tag>}
                  {dx.verification && <Tag>{dx.verification}</Tag>}
                </li>
              ))}
            </ul>
          ) : (
            nothing("No diagnosis recorded.")
          )}
        </div>
      </Card>

      <Card title="4 · Medication">
        {completed.medications.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {completed.medications.map((med, index) => (
              <li key={`${med.drug}-${index}`} className={ROW}>
                <p className="font-semibold">
                  {med.drug}
                  {med.prn ? " · PRN" : ""}
                </p>
                <p className="text-ink-700">
                  {[med.dose, med.route, med.frequency, med.duration].filter(Boolean).join(" · ")}
                  {med.indication ? ` — for ${med.indication}` : ""}
                </p>
                <p className="text-[12px] text-ink-500">
                  {med.prescribed_by}
                  {med.prescribed_at ? ` · ${formatDateTime(med.prescribed_at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          nothing("No medication prescribed.")
        )}
      </Card>

      <Card title="5 · Plan & schedule (current care plan)">
        <div className="flex flex-col gap-3">
          {activities.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {activities.map((activity) => {
                // A psychiatric review is done by signing an assessment here; every other
                // action by a delivery recorded in its Interventions module.
                const reviews =
                  activity.action_key === "psych_review"
                    ? chains.filter(
                        (chain) =>
                          !activity.created_at ||
                          String(chain.versions[0].signed_at) >= activity.created_at,
                      )
                    : [];
                const done = reviews.length + activity.deliveries.length;
                const last = [
                  ...reviews.map((chain) => chain.latest.signed_at),
                  ...activity.deliveries.map((record) => record.performed_at),
                ]
                  .filter(Boolean)
                  .sort()
                  .pop();
                const heading = (
                  <>
                    <span className="mr-auto min-w-0">
                      <span className="block font-medium text-ink-900">{activity.title}</span>
                      <span className="block text-[12px] text-ink-500">
                        Added {formatDateTime(activity.created_at)}
                        {activity.created_by ? ` by ${activity.created_by}` : ""}
                        {activity.due_at ? ` · due ${formatDateTime(activity.due_at)}` : ""}
                        {last ? ` · last done ${formatDateTime(last)}` : " · nothing done yet"}
                      </span>
                    </span>
                    {done > 0 && (
                      <span className="text-[12px] text-ink-500">
                        {done} {done === 1 ? "record" : "records"}
                      </span>
                    )}
                    <Tag>{activity.status_display}</Tag>
                  </>
                );
                if (done === 0) {
                  return (
                    <li
                      key={activity.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-bg px-3 py-2.5 text-[13.5px]"
                    >
                      {heading}
                    </li>
                  );
                }
                return (
                  <li
                    key={activity.id}
                    className="rounded-lg border border-surface-border bg-surface-bg"
                  >
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 text-[13.5px]">
                        {heading}
                      </summary>
                      <ol className="flex flex-col gap-1.5 border-t border-surface-border px-3 py-2.5">
                        {reviews.map((chain) => (
                          <li key={chain.latest.id}>
                            <button
                              type="button"
                              onClick={() => onOpenVersion(chain.latest.id)}
                              className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-900 hover:bg-surface-card"
                            >
                              <span className="font-medium">
                                {formatDateTime(chain.versions[0].signed_at)}
                              </span>
                              <span>Psychiatric assessment · {chain.versions[0].author}</span>
                              {chain.versions.length > 1 && <Tag tone="warn">Amended</Tag>}
                              <span className="ml-auto font-semibold text-[var(--green)]">
                                Open summary →
                              </span>
                            </button>
                          </li>
                        ))}
                        {activity.deliveries.map((record) => (
                          <li key={record.id}>
                            <Link
                              to={interventionsLink(
                                record.module || activity.open_module,
                                record.id,
                              )}
                              className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-900 hover:bg-surface-card"
                            >
                              <span className="font-medium">
                                {formatDateTime(record.performed_at)}
                              </span>
                              <span>
                                {record.intervention}
                                {record.provider ? ` · ${record.provider}` : ""}
                                {record.completes_activity ? " · completed the action" : ""}
                              </span>
                              <span className="ml-auto font-semibold text-[var(--green)]">
                                Open record →
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            nothing("No care plan actions.")
          )}
          {sessions.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
                Scheduled sessions
              </p>
              <ul className="flex flex-col gap-1.5">
                {sessions.map((session) => (
                  <li key={session.id} className={ROW}>
                    {formatDateTime(session.scheduled_for)} · {session.duration_minutes} min ·{" "}
                    {session.mode === "IN_PERSON"
                      ? "In person"
                      : session.mode === "PHONE"
                        ? "Phone"
                        : "Video"}
                    {session.provider_name ? ` · ${session.provider_name}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/** The withdrawal review is completed only with its coded outcome (served
 * `psychiatric-review-outcome`), recorded here where the review task opens. */
function ReviewOutcome({ reviewId, onSaved }: { reviewId: string; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!accessToken || !outcome) return;
    setBusy(true);
    setError(null);
    try {
      await completePsychiatricReview(accessToken, reviewId, outcome, note.trim());
      onSaved();
    } catch (err) {
      setError(errorText(err, "Couldn't record the outcome."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">Outcome of this review:</span>
      <div className="min-w-[220px]">
        <SelectChoices
          id={`review-outcome-${reviewId}`}
          options={vs.options("psychiatric-review-outcome")}
          placeholder="— choose outcome —"
          value={outcome}
          onChange={setOutcome}
        />
      </div>
      <input
        className={`${INPUT} min-w-[200px] flex-1`}
        aria-label="Outcome note (optional)"
        placeholder="Note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button
        type="button"
        className={`${BTN} ${BTN_SM}`}
        disabled={!outcome || busy}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Record outcome"}
      </button>
      {error && <span className="basis-full text-[12.5px] text-priority-red">{error}</span>}
    </div>
  );
}
