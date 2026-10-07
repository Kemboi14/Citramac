import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  evaluateTriage,
  registerTriageTasks,
  saveTriageDraft,
  signTriage,
  type CareTask,
  type ClientBanner,
  type Priority,
  type PriorityOrBlank,
  type TriageAnswers,
  type TriageAssessmentRecord,
  type TriageEncounterDetail,
  type TriageEvaluation,
} from "../../../lib/carePathwayApi";
import { SafetyBanner, type BannerOverrides } from "../shared/SafetyBanner";
import { formatDateTime, formatTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, GROUP_LABEL, INPUT, TABLE, TD, TH } from "../shared/styles";
import {
  Callout,
  CheckChoices,
  ErrorNote,
  Field,
  PageHeader,
  RadioChoices,
  SelectChoices,
  Tag,
} from "../shared/ui";
import { useValueSets, type ValueSetsApi } from "../shared/useValueSets";
import { EncounterContext } from "./EncounterContext";
import { FIELDGRID, errorText } from "./helpers";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.6 — mockup triage(), organizeTriageSections(),
// initTriage() and recompute(). The recommendation itself is computed on the
// server (backend/apps/care_pathway/triage_rules.py) from the draft answers;
// this screen only displays what `evaluate()` returns. Answers are keyed by the
// backend's stable item codes.

const NOT_ASSESSED = "— not assessed —";
const SIGN_BLOCKED =
  "Complete the required safety screens and select a final priority before signing.";
const DRAFT_FAILED = "Draft not saved — check your connection";

/** The six core screens (triage_rules.CORE_SCREENS): [section, control id, answer key]. */
const CORE: [string, string, string][] = [
  ["d", "t-d-suicidal", "d_suicidal"],
  ["e", "t-e-thoughts", "e_thoughts"],
  ["f", "t-f-change", "f_change"],
  ["h", "t-h-concern", "h_concern"],
  ["i", "t-i-safe", "i_safe"],
  ["j", "t-j-concern", "j_concern"],
];

const SUMMARY_EDGE: Record<Priority | "pending", string> = {
  RED: "border-l-priority-red",
  ORANGE: "border-l-priority-orange",
  YELLOW: "border-l-priority-yellow",
  GREEN: "border-l-priority-green",
  pending: "border-l-priority-orange",
};

const PRIORITY_GUIDE: {
  key: Priority;
  title: string;
  meaning: string;
  action: string;
  card: string;
  tone: string;
}[] = [
  {
    key: "RED",
    title: "RED — Emergency / Immediate",
    meaning: "Immediate or potentially life-threatening safety, medical or behavioural concern.",
    action:
      "Do not wait for routine intake. Begin immediate safety/medical action and emergency assessment or transfer where required.",
    card: "border-l-priority-red bg-priority-red-tint",
    tone: "text-priority-red",
  },
  {
    key: "ORANGE",
    title: "ORANGE — Urgent",
    meaning: "Significant concern that could deteriorate or requires prompt clinician assessment.",
    action: "Place ahead of routine work; review as soon as possible under the urgent process.",
    card: "border-l-priority-orange bg-priority-orange-tint",
    tone: "text-priority-orange",
  },
  {
    key: "YELLOW",
    title: "YELLOW — Priority",
    meaning: "Currently stable but should not simply wait through the normal routine pathway.",
    action: "Arrange timely assessment; escalate if the condition changes.",
    card: "border-l-priority-yellow bg-priority-yellow-tint",
    tone: "text-priority-yellow",
  },
  {
    key: "GREEN",
    title: "GREEN — Routine",
    meaning: "Stable; no immediate safety or medical concern identified.",
    action: "Proceed through the normal intake or appointment pathway.",
    card: "border-l-priority-green bg-priority-green-tint",
    tone: "text-priority-green",
  },
];

function answerText(answers: TriageAnswers, key: string): string {
  const value = new Map(Object.entries(answers)).get(key);
  return typeof value === "string" ? value : "";
}

function answerList(answers: TriageAnswers, key: string): string[] {
  const value = new Map(Object.entries(answers)).get(key);
  return Array.isArray(value) ? value : [];
}

function toDecision(value: string): "CONFIRM" | "OVERRIDE" {
  return value === "OVERRIDE" ? "OVERRIDE" : "CONFIRM";
}

function toPriority(value: string): PriorityOrBlank {
  return (["RED", "ORANGE", "YELLOW", "GREEN"] as const).find((p) => p === value) ?? "";
}

function toTaskStatus(value: string): CareTask["status"] {
  return (["INITIATED", "PENDING", "COMPLETED"] as const).find((p) => p === value) ?? "INITIATED";
}

function hasAnswer(answers: TriageAnswers, key: string) {
  return Object.prototype.hasOwnProperty.call(answers, key);
}

function splitAllergies(text: string) {
  return text
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Mockup organizeTriageSections(): each card becomes a collapsible panel. */
function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string, open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      id={`triage-section-${id}`}
      open={open}
      onToggle={(e) => onToggle(id, e.currentTarget.open)}
      className="mb-2.5 overflow-clip rounded-lg border border-surface-border bg-surface-card shadow-sm [&[open]>summary]:border-b [&[open]>summary]:border-surface-border"
    >
      <summary className="min-h-12 cursor-pointer list-inside px-[18px] py-[13px] text-[13px] font-bold text-ink-900 marker:text-ink-500">
        {title}
      </summary>
      <div className="px-[18px] py-4">{children}</div>
    </details>
  );
}

interface FormCtxValue {
  answers: TriageAnswers;
  setAnswer: (key: string, value: string | string[]) => void;
  vs: ValueSetsApi;
}

const FormCtx = createContext<FormCtxValue | null>(null);

function useFormCtx() {
  const ctx = useContext(FormCtx);
  if (!ctx) throw new Error("Triage controls must be rendered inside the triage form.");
  return ctx;
}

/** <select> bound to an answer key and a served value set. */
function Sel({
  id,
  label,
  k,
  set,
  blank,
}: {
  id: string;
  label: string;
  k: string;
  set: string;
  blank?: boolean;
}) {
  const { answers, setAnswer, vs } = useFormCtx();
  return (
    <Field label={label} htmlFor={id}>
      <SelectChoices
        id={id}
        options={vs.options(set)}
        value={answerText(answers, k)}
        placeholder={blank ? NOT_ASSESSED : undefined}
        required={blank}
        onChange={(value) => setAnswer(k, value)}
      />
    </Field>
  );
}

function Txt({
  id,
  label,
  k,
  placeholder,
  rows,
}: {
  id: string;
  label: string;
  k: string;
  placeholder?: string;
  rows?: number;
}) {
  const { answers, setAnswer } = useFormCtx();
  const value = answerText(answers, k);
  return (
    <Field label={label} htmlFor={id}>
      {rows ? (
        <textarea
          id={id}
          rows={rows}
          placeholder={placeholder}
          className={`${INPUT} resize-y`}
          value={value}
          onChange={(e) => setAnswer(k, e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          className={INPUT}
          value={value}
          onChange={(e) => setAnswer(k, e.target.value)}
        />
      )}
    </Field>
  );
}

function Radios({ legend, k, set }: { legend: string; k: string; set: string }) {
  const { answers, setAnswer, vs } = useFormCtx();
  return (
    <fieldset>
      <legend className={GROUP_LABEL}>{legend}</legend>
      <RadioChoices
        name={k}
        options={vs.options(set)}
        value={answerText(answers, k)}
        onChange={(value) => setAnswer(k, value)}
      />
    </fieldset>
  );
}

function Checks({ legend, k, set }: { legend?: string; k: string; set: string }) {
  const { answers, setAnswer, vs } = useFormCtx();
  return (
    <fieldset className={legend ? "" : "mt-2"}>
      {legend ? (
        <legend className={GROUP_LABEL}>{legend}</legend>
      ) : (
        <legend className="sr-only">Areas of concern</legend>
      )}
      <CheckChoices
        options={vs.options(set)}
        value={answerList(answers, k)}
        onChange={(codes) => setAnswer(k, codes)}
      />
    </fieldset>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  const id = `ro-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} type="text" readOnly className={INPUT} value={value} />
    </Field>
  );
}

function Trigger({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <Callout className="mt-2.5">{children}</Callout>;
}

export function TriageForm({
  detail,
  banner,
  bannerError,
  onSigned,
}: {
  detail: TriageEncounterDetail;
  banner: ClientBanner | null;
  bannerError: string | null;
  onSigned: () => void;
}) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const vs = useValueSets();

  const editable = detail.status === "AWAITING" || detail.status === "IN_TRIAGE";
  const stored = editable ? detail.draft : detail.signed;

  const [loadedAt] = useState(() => new Date().toISOString());
  const [answers, setAnswers] = useState<TriageAnswers>(() => {
    const base: TriageAnswers = { ...detail.defaults, ...(stored?.answers ?? {}) };
    if (!hasAnswer(base, "c_concern")) base.c_concern = detail.presenting_concern;
    // Sections M and N live in the draft answers too (m_* / n_* keys), so every
    // control restores. Records signed before those keys existed fall back to
    // the record's own fields.
    if (!hasAnswer(base, "m_decision"))
      base.m_decision = (!editable && detail.signed?.decision) || "CONFIRM";
    if (!hasAnswer(base, "m_final_priority")) {
      base.m_final_priority = !editable
        ? (detail.signed?.final_priority ?? "")
        : detail.evaluation.ready && detail.draft
          ? detail.evaluation.priority
          : !detail.draft && detail.triage_version > 0
            ? detail.priority
            : "";
    }
    if (!hasAnswer(base, "m_override_reason")) {
      base.m_override_reason = editable ? "" : (detail.signed?.override_reason ?? "");
    }
    if (!hasAnswer(base, "n_actions")) base.n_actions = [];
    if (!hasAnswer(base, "n_owner")) base.n_owner = "Psychiatry / Nursing";
    if (!hasAnswer(base, "n_status")) base.n_status = "INITIATED";
    return base;
  });
  const answersRef = useRef(answers);
  const [touched, setTouched] = useState(Boolean(stored));
  const [evaluation, setEvaluation] = useState<TriageEvaluation>(() =>
    !editable && detail.signed
      ? {
          ...detail.evaluation,
          recommendation: detail.signed.recommendation,
          reasons: detail.signed.recommendation_reasons,
          findings: detail.signed.findings,
          triggers: [],
        }
      : detail.evaluation,
  );
  const [evaluatedAt, setEvaluatedAt] = useState(
    (editable ? detail.draft?.draft_saved_at : detail.signed?.signed_at) ?? loadedAt,
  );

  const decision = toDecision(answerText(answers, "m_decision"));
  const finalPriority = toPriority(answerText(answers, "m_final_priority"));
  const overrideReason = answerText(answers, "m_override_reason");

  const [open, setOpen] = useState<Set<string>>(() => new Set(["b", "c"]));
  const [tasks, setTasks] = useState<CareTask[]>(detail.tasks);
  const actions = answerList(answers, "n_actions");
  const owner = answerText(answers, "n_owner");
  const taskStatus = toTaskStatus(answerText(answers, "n_status"));
  const [taskError, setTaskError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const [draftStatus, setDraftStatus] = useState(
    editable && detail.draft?.draft_saved_at
      ? `Draft saved ${formatTime(detail.draft.draft_saved_at)}`
      : "Draft not saved",
  );
  const [signMsg, setSignMsg] = useState<{
    tone: "info" | "success" | "danger";
    text: string;
  } | null>(null);
  const [signed, setSigned] = useState<TriageAssessmentRecord | null>(
    editable ? null : detail.signed,
  );
  const [signing, setSigning] = useState(false);
  const readOnly = !editable || signed !== null;

  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);
  const seq = useRef(0);
  const closed = useRef(!editable);

  // A signed record opened later: the stored findings and recommendation are
  // authoritative; ask the server only which trigger callouts apply.
  useEffect(() => {
    if (editable || !accessToken || !detail.signed) return;
    let cancelled = false;
    const record = detail.signed;
    evaluateTriage(accessToken, detail.id, record.answers)
      .then((result) => {
        if (cancelled) return;
        setEvaluation({
          ...result,
          recommendation: record.recommendation,
          reasons: record.recommendation_reasons,
          findings: record.findings,
        });
      })
      .catch(() => {
        // Trigger callouts stay hidden; the signed findings above remain shown.
      });
    return () => {
      cancelled = true;
    };
  }, [editable, accessToken, detail.id, detail.signed]);

  // Leaving the screen with an unsaved change flushes it rather than dropping it.
  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
      if (pending.current && !closed.current && accessToken) {
        saveTriageDraft(accessToken, detail.id, answersRef.current).catch(() => undefined);
      }
    };
  }, [accessToken, detail.id]);

  function saveNow() {
    window.clearTimeout(timer.current);
    if (!accessToken || closed.current) return;
    pending.current = false;
    const mine = ++seq.current;
    saveTriageDraft(accessToken, detail.id, answersRef.current)
      .then((result) => {
        if (mine !== seq.current || closed.current) return;
        setEvaluation(result.evaluation);
        setEvaluatedAt(new Date().toISOString());
        setDraftStatus(`Draft saved ${formatTime(result.draft_saved_at)}`);
        // Recommendation final + Confirm → fill the final priority (mockup recompute()).
        const current = answersRef.current;
        if (
          result.evaluation.ready &&
          toDecision(answerText(current, "m_decision")) === "CONFIRM" &&
          answerText(current, "m_final_priority") !== result.evaluation.priority
        ) {
          setAnswer("m_final_priority", result.evaluation.priority);
        }
      })
      .catch(() => {
        if (mine !== seq.current || closed.current) return;
        pending.current = true;
        setDraftStatus(DRAFT_FAILED);
      });
  }

  function setAnswer(key: string, value: string | string[]) {
    if (readOnly) return;
    const next = { ...answersRef.current, [key]: value };
    answersRef.current = next;
    setAnswers(next);
    setTouched(true);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 500);
  }

  function toggleSection(id: string, isOpen: boolean) {
    setOpen((prev) => {
      if (prev.has(id) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openAndFocus(section: string, controlId: string) {
    toggleSection(section, true);
    window.setTimeout(() => {
      const el = document.getElementById(controlId);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    }, 0);
  }

  function changeDecision(next: string) {
    setAnswer("m_decision", next);
    if (toDecision(next) === "CONFIRM" && evaluation.ready) {
      setAnswer("m_final_priority", evaluation.priority);
    }
  }

  async function onRegisterTasks() {
    if (!accessToken || readOnly || actions.length === 0 || registering) return;
    setRegistering(true);
    setTaskError(null);
    try {
      const list = await registerTriageTasks(accessToken, detail.id, {
        actions,
        owner: owner.trim(),
        status: taskStatus,
      });
      setTasks(list);
      setAnswer("n_actions", []);
    } catch (err) {
      setTaskError(
        errorText(err, "Tasks not registered — couldn't reach the server. Check your connection."),
      );
    } finally {
      setRegistering(false);
    }
  }

  async function onSign() {
    if (!accessToken || readOnly || signing) return;
    const missing = CORE.find(([, , key]) => answerText(answersRef.current, key) === "");
    if (missing || !finalPriority) {
      if (missing) openAndFocus(missing[0], missing[1]);
      else openAndFocus("m", "final-priority");
      setSignMsg({ tone: "info", text: SIGN_BLOCKED });
      return;
    }
    if (decision === "OVERRIDE" && !overrideReason.trim()) {
      openAndFocus("m", "override-reason");
      setSignMsg({ tone: "info", text: SIGN_BLOCKED });
      return;
    }
    window.clearTimeout(timer.current);
    closed.current = true;
    setSigning(true);
    setSignMsg(null);
    try {
      const record = await signTriage(accessToken, detail.id, {
        answers: answersRef.current,
        decision,
        final_priority: finalPriority,
        override_reason: decision === "OVERRIDE" ? overrideReason.trim() : undefined,
      });
      pending.current = false;
      setSigned(record);
      setSignMsg({
        tone: "success",
        text: `Triage signed. ${banner?.name.trim() || "Client"} has been added to the Psychiatry queue with ${record.final_priority} priority. You can continue here or open Psychiatric from the left menu.`,
      });
      onSigned();
    } catch (err) {
      closed.current = false;
      // A server-side rejection names the missing core screens by answer key.
      const missingKeys =
        err instanceof ApiError && Array.isArray(err.fields?.missing_keys)
          ? err.fields.missing_keys.map(String)
          : [];
      const first = CORE.find(([, , key]) => missingKeys.includes(key));
      if (first) openAndFocus(first[0], first[1]);
      setSignMsg({
        tone: "danger",
        text: errorText(
          err,
          "Triage not signed — couldn't reach the server. Your answers are still on this page; check your connection and sign again.",
        ),
      });
    } finally {
      setSigning(false);
    }
  }

  const text = (key: string) => answerText(answers, key);
  const ctx: FormCtxValue = { answers, setAnswer, vs };

  // ── Derived display values ──

  const isOpen = (id: string) => open.has(id);
  const triggered = (letter: string) => evaluation.triggers.includes(letter);
  const present = text("b_present") !== "no";
  const identified = banner?.identity_status === "IDENTIFIED";

  const bannerAllergyDetail = banner?.allergy.items.map((item) => item.substance).join(", ") ?? "";
  const allergyStatus = hasAnswer(answers, "a_allergy_status")
    ? text("a_allergy_status")
    : (banner?.allergy.state ?? "");
  const allergyDetail = hasAnswer(answers, "a_allergy_detail")
    ? text("a_allergy_detail")
    : bannerAllergyDetail;
  const allergyEdited =
    hasAnswer(answers, "a_allergy_status") || hasAnswer(answers, "a_allergy_detail");

  const overrides: BannerOverrides = {};
  if (banner && allergyEdited) {
    const state = (["known", "none", "unknown"] as const).find((s) => s === allergyStatus);
    const items = splitAllergies(allergyDetail).map((substance) => {
      const existing = banner.allergy.items.find(
        (item) => item.substance.toLowerCase() === substance.toLowerCase(),
      );
      return existing ?? { substance, reaction: "", verification_status: "CONFIRMED" };
    });
    overrides.allergy = {
      state: state ?? banner.allergy.state,
      items: state === "known" ? items : [],
    };
  }
  if (signed?.final_priority) overrides.priority = signed.final_priority;

  const sexLabel = banner?.sex ? vs.label("sex", banner.sex) : "";
  const identityLine = banner
    ? `${banner.name.trim() || "Temporary client (unnamed)"} — ${banner.identity_label || "Identified"} — ${banner.citramac_number || "Not recorded"} (${banner.mrn || "MRN not recorded"})`
    : "Loading…";
  const previouslySigned = detail.triage_version > 0 || Boolean(detail.last_triaged_at);

  const summaryLabel = touched ? evaluation.recommendation : "Screen in progress";
  const summaryEdge = touched ? evaluation.summary_priority : "pending";
  // eslint-disable-next-line security/detect-object-injection -- `summaryEdge` is a typed union.
  const summaryEdgeClass = SUMMARY_EDGE[summaryEdge];
  const findingsTime = formatTime(evaluatedAt);
  const clinicianLine = signed
    ? `${signed.signed_by} · ${formatDateTime(signed.signed_at)}`
    : `${detail.clinician} · ${formatDateTime(loadedAt)}`;

  return (
    <div className="mx-auto max-w-[1600px]">
      <SafetyBanner banner={banner} error={bannerError} overrides={overrides} />
      <EncounterContext detail={detail} banner={banner} />

      <PageHeader
        title="Initial triage"
        subtitle="Safety screen and immediate disposition · Not the full assessment"
        actions={
          <button type="button" className={BTN_GHOST} onClick={() => navigate("/clinical/triage")}>
            Back to queue
          </button>
        }
      />
      {vs.error && (
        <div className="mb-3">
          <ErrorNote>{vs.error}</ErrorNote>
        </div>
      )}

      <div
        id="triage-live-summary"
        role="status"
        aria-live="polite"
        className={`mb-3.5 rounded-lg border border-l-4 border-surface-border bg-surface-bg px-3.5 py-3 ${summaryEdgeClass}`}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[13px] font-bold text-ink-900">
          Live safety summary <span>{summaryLabel}</span>
        </div>
        <p className="text-xs text-ink-500">{evaluation.reasons}</p>
      </div>

      <FormCtx.Provider value={ctx}>
        <form onSubmit={(e) => e.preventDefault()} aria-label="Initial triage">
          <fieldset disabled={readOnly} className="min-w-0">
            <Section
              id="a"
              title="Section A — Automatic Information (retrieved, not re-asked)"
              open={isOpen("a")}
              onToggle={toggleSection}
            >
              <div className={FIELDGRID}>
                <ReadOnlyField label="Client identity / temporary ID" value={identityLine} />
                {banner && !identified && (
                  <ReadOnlyField
                    label="Identity / distinguishing description"
                    value={banner.identity_description || "Not yet known"}
                  />
                )}
                <ReadOnlyField
                  label="DOB / Age / Sex"
                  value={`${banner?.date_of_birth || "Not recorded"} · ${banner?.age ?? "Unknown"} yrs · ${sexLabel || "Unknown"}`}
                />
                <ReadOnlyField label="Contact details" value={banner?.phone || "Not recorded"} />
                <ReadOnlyField
                  label="Emergency contact / NOK"
                  value={banner?.next_of_kin || "Not recorded — confirm"}
                />
                <ReadOnlyField
                  label="Referral source"
                  value={detail.referral_source || banner?.referral_source || "Self-presented"}
                />
                {previouslySigned && (
                  <ReadOnlyField
                    label="Previous signed triage priority"
                    value={detail.priority || "Not recorded"}
                  />
                )}
                <Field label="Allergy status" htmlFor="t-allergy-status">
                  <SelectChoices
                    id="t-allergy-status"
                    options={vs.options("triage-allergy-status")}
                    value={allergyStatus}
                    placeholder={allergyStatus ? undefined : ""}
                    onChange={(value) => setAnswer("a_allergy_status", value)}
                  />
                </Field>
                <Field
                  label="Allergy detail — updates the central allergy record"
                  htmlFor="t-allergy-detail"
                >
                  <input
                    id="t-allergy-detail"
                    type="text"
                    className={INPUT}
                    value={allergyDetail}
                    onChange={(e) => setAnswer("a_allergy_detail", e.target.value)}
                  />
                </Field>
              </div>
              {banner && !identified && (
                <div className="mt-3">
                  <Link
                    to={`/clinical/registration?resolve=${detail.patient_id}`}
                    className={`${BTN_GHOST} ${BTN_SM}`}
                  >
                    Resolve identity
                  </Link>
                </div>
              )}
              <Callout className="mt-3">
                <strong>Existing critical alerts:</strong>{" "}
                {banner && banner.alerts.length
                  ? banner.alerts.map((alert) => alert.label).join(" · ")
                  : "None documented"}
                . Alerts follow the client until resolved or updated.
              </Callout>
            </Section>

            <Section
              id="b"
              title="Section B — Triage Encounter"
              open={isOpen("b")}
              onToggle={toggleSection}
            >
              <div className={FIELDGRID}>
                <ReadOnlyField
                  label="Date / time"
                  value={formatDateTime(detail.triage_started_at ?? loadedAt)}
                />
                <ReadOnlyField label="Triage clinician" value={`${detail.clinician} (signed in)`} />
                <ReadOnlyField label="Tenant / location" value={detail.tenant_location} />
                <Txt
                  id="t-b-third-party"
                  label="Name / relationship if third party"
                  k="b_third_party"
                  placeholder="e.g. Sister — Jane"
                />
              </div>
              <Radios legend="Encounter type" k="b_encounter_type" set="triage-encounter-type" />
              <Radios
                legend="Who is providing the information?"
                k="b_informant"
                set="triage-informant"
              />
              <Radios legend="Is the client physically present?" k="b_present" set="yes-no" />
              <Callout className="mt-2.5">
                <strong>Branching rule:</strong> YES → direct observation/safety screen. NO →
                telephone/third-party screen (Section K); observation-only fields are hidden.
              </Callout>
            </Section>

            <Section
              id="c"
              title="Section C — What Is Happening Right Now?"
              open={isOpen("c")}
              onToggle={toggleSection}
            >
              <Txt
                id="t-c-concern"
                label="Main concern in client's/informant's own words"
                k="c_concern"
                rows={2}
                placeholder="Not yet recorded — ask client or informant"
              />
              <Radios
                legend="When did this begin or become worse?"
                k="c_onset"
                set="triage-onset"
              />
              <div className="mt-3">
                <Txt id="t-c-description" label="Brief description" k="c_description" rows={1} />
              </div>
            </Section>

            <Section
              id="d"
              title="Section D — Immediate Safety: Suicide / Self-Harm"
              open={isOpen("d")}
              onToggle={toggleSection}
            >
              <Sel
                id="t-d-suicidal"
                label="Currently having thoughts of killing yourself or seriously harming yourself?"
                k="d_suicidal"
                set="no-yes-unable"
                blank
              />
              <div className={`${FIELDGRID} mt-2`}>
                <Sel
                  id="t-d-actnow"
                  label="Thinking about acting on these thoughts now?"
                  k="d_act_now"
                  set="no-yes-unsure"
                />
                <Sel
                  id="t-d-attempt"
                  label="Anything recently done to kill or seriously harm yourself?"
                  k="d_attempt"
                  set="no-yes"
                />
                <Sel
                  id="t-d-means"
                  label="Known access to means of serious self-harm?"
                  k="d_means"
                  set="no-yes-unknown"
                />
                <Sel
                  id="t-d-safety"
                  label="Can the client currently maintain their own safety?"
                  k="d_safety"
                  set="yes-no-uncertain"
                />
              </div>
              <div className="mt-2">
                <Txt id="t-d-what-happened" label="What happened and when?" k="d_what_happened" />
              </div>
              <Trigger show={triggered("d")}>
                <strong>AUTO-TRIGGER:</strong> SUICIDE/SELF-HARM RISK alert → Suicide Risk
                Assessment + Safety Planning workflow. Triage does not duplicate the full
                assessment.
              </Trigger>
            </Section>

            <Section
              id="e"
              title="Section E — Risk of Harm to Others"
              open={isOpen("e")}
              onToggle={toggleSection}
            >
              <div className={FIELDGRID}>
                <Sel
                  id="t-e-thoughts"
                  label="Current thoughts of seriously harming someone else?"
                  k="e_thoughts"
                  set="no-yes-unable"
                  blank
                />
                <Sel
                  id="t-e-behaviour"
                  label="Recent threatening/aggressive/violent behaviour?"
                  k="e_behaviour"
                  set="no-yes-unknown"
                />
                <Sel id="t-e-act" label="Recent violent act?" k="e_act" set="no-yes" />
                <Sel
                  id="t-e-means"
                  label="Known access to means of serious harm?"
                  k="e_means"
                  set="no-yes-unknown"
                />
                <Sel
                  id="t-e-danger"
                  label="Current behaviour suggests immediate danger?"
                  k="e_danger"
                  set="no-yes-uncertain"
                />
                <Txt id="t-e-concern" label="Who/what is the concern?" k="e_concern" />
              </div>
              <Trigger show={triggered("e")}>
                <strong>AUTO-TRIGGER:</strong> RISK OF HARM TO OTHERS → violence/risk assessment and
                escalation pathway.
              </Trigger>
            </Section>

            <Section
              id="f"
              title="Section F — Acute Mental State"
              open={isOpen("f")}
              onToggle={toggleSection}
            >
              <Sel
                id="t-f-change"
                label="Major change in mental state now?"
                k="f_change"
                set="no-yes-unable"
                blank
              />
              <Checks legend="Observed features" k="f_features" set="triage-mental-state-feature" />
              {present && (
                <div className={`${FIELDGRID} mt-3`}>
                  <Sel
                    id="t-f-loc"
                    label="Level of consciousness"
                    k="f_consciousness"
                    set="triage-consciousness"
                  />
                  <Sel
                    id="t-f-ori"
                    label="Orientation"
                    k="f_orientation"
                    set="triage-orientation"
                  />
                  <Sel id="t-f-beh" label="Behaviour" k="f_behaviour" set="triage-behaviour" />
                  <Txt
                    id="t-f-observation"
                    label="Clinician observation"
                    k="f_observation"
                    placeholder="Free text"
                  />
                </div>
              )}
              <Trigger show={triggered("f")}>
                <strong>AUTO-FLAG:</strong> ACUTE MENTAL STATE CHANGE / PSYCHOSIS / ALTERED
                CONSCIOUSNESS as applicable.
              </Trigger>
            </Section>

            <Section
              id="g"
              title="Section G — Alcohol & Other Substances"
              open={isOpen("g")}
              onToggle={toggleSection}
            >
              <div className={FIELDGRID}>
                <Sel
                  id="t-g-use"
                  label="Recent alcohol or other substance use?"
                  k="g_use"
                  set="no-yes-unknown"
                />
                <Sel
                  id="t-g-intox"
                  label="Current intoxication"
                  k="g_intoxication"
                  set="triage-intoxication"
                />
                <Sel
                  id="t-g-stopped"
                  label="Recently stopped / reduced heavy use?"
                  k="g_stopped"
                  set="no-yes-unknown"
                />
                <Sel
                  id="t-g-seizure"
                  label="Previous withdrawal seizure?"
                  k="g_seizure"
                  set="no-yes-unknown"
                />
              </div>
              <Checks
                legend="Current withdrawal symptoms"
                k="g_withdrawal"
                set="triage-withdrawal-symptom"
              />
              <Trigger show={triggered("g")}>
                <strong>SYSTEM TRIGGERS:</strong> Alcohol dependence / recent cessation + withdrawal
                risk → PAWSS. Current alcohol withdrawal → CIWA-Ar. Current opioid withdrawal →
                COWS.
              </Trigger>
            </Section>

            <Section
              id="h"
              title="Section H — Urgent Medical Screen"
              open={isOpen("h")}
              onToggle={toggleSection}
            >
              <Sel
                id="t-h-concern"
                label="Immediate physical/medical concern?"
                k="h_concern"
                set="no-yes-unknown"
                blank
              />
              <Checks legend="Immediate concerns" k="h_flags" set="triage-medical-concern" />
              <div className={GROUP_LABEL}>Vital signs when clinically indicated</div>
              <div className={FIELDGRID}>
                <Txt id="t-h-bp" label="BP" k="h_bp" placeholder="e.g. 128/82" />
                <Txt id="t-h-pulse" label="Pulse" k="h_pulse" placeholder="bpm" />
                <Txt id="t-h-rr" label="Resp. rate" k="h_rr" />
                <Txt id="t-h-temp" label="Temp" k="h_temp" />
                <Txt id="t-h-spo2" label="SpO₂" k="h_spo2" />
                <Txt id="t-h-glu" label="Blood glucose" k="h_glucose" />
              </div>
              <Trigger show={triggered("h")}>
                <strong>SYSTEM BEHAVIOUR:</strong> Configured abnormal/critical measurements create
                an ACUTE MEDICAL CONCERN alert and prompt medical review / escalation.
              </Trigger>
            </Section>

            <Section
              id="i"
              title="Section I — Safeguarding & Vulnerability"
              open={isOpen("i")}
              onToggle={toggleSection}
            >
              <Sel
                id="t-i-safe"
                label="Do you feel safe where you currently live/stay?"
                k="i_safe"
                set="triage-feels-safe"
                blank
              />
              <Checks legend="Concerns" k="i_flags" set="triage-safeguarding-concern" />
              <div className="mt-2.5">
                <Sel
                  id="t-i-return"
                  label="Safe to return to current environment?"
                  k="i_return"
                  set="yes-no-uncertain"
                />
              </div>
              <Trigger show={triggered("i")}>
                <strong>AUTO-TRIGGER:</strong> SAFEGUARDING CONCERN → tenant safeguarding pathway.
              </Trigger>
            </Section>

            <Section
              id="j"
              title="Section J — Immediate Functional Safety"
              open={isOpen("j")}
              onToggle={toggleSection}
            >
              <Sel
                id="t-j-concern"
                label="Immediate concern that the person cannot safely care for basic needs?"
                k="j_concern"
                set="no-yes-uncertain"
                blank
              />
              <Checks k="j_flags" set="triage-functional-area" />
              <Callout className="mt-2.5">
                <strong>Scope note:</strong> Brief at Triage. Detailed functioning belongs in
                Comprehensive Intake.
              </Callout>
            </Section>

            {!present && (
              <Section
                id="k"
                title="Section K — Client Not Physically Present: Telephone / Third-Party Screen"
                open={isOpen("k")}
                onToggle={toggleSection}
              >
                <div className={FIELDGRID}>
                  <Txt id="t-k-where" label="Where is the client now?" k="k_where" />
                  <Sel id="t-k-alone" label="Are they alone?" k="k_alone" set="yes-no-unknown" />
                  <Txt id="t-k-with" label="Who is physically with them?" k="k_with" />
                  <Txt
                    id="t-k-last-seen"
                    label="When did caller last see/speak with them?"
                    k="k_last_seen"
                  />
                  <Txt
                    id="t-k-cause"
                    label="What exactly is causing concern?"
                    k="k_cause"
                    rows={2}
                  />
                  <Sel
                    id="t-k-bring"
                    label="Can the person be brought safely for assessment?"
                    k="k_bring"
                    set="yes-no-uncertain"
                  />
                  <Sel
                    id="t-k-emergency"
                    label="Is emergency assistance required?"
                    k="k_emergency"
                    set="no-yes"
                  />
                </div>
                <Checks legend="Concern reported" k="k_flags" set="triage-telephone-concern" />
              </Section>
            )}

            <Section
              id="l"
              title="Section L — Automatic Triage Summary (generated, not retyped)"
              open={isOpen("l")}
              onToggle={toggleSection}
            >
              <div className="-mx-[18px] -my-4 overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>Finding / Alert</th>
                      <th className={TH}>Current status</th>
                      <th className={TH}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluation.findings.length ? (
                      evaluation.findings.map(([finding, status, source], index) => (
                        <tr key={`${finding}-${index}`}>
                          <td className={TD}>
                            <strong>{finding}</strong>
                          </td>
                          <td className={TD}>{status}</td>
                          <td className={TD}>
                            {source} <span className="text-ink-400">· {findingsTime}</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className={`${TD} !text-ink-500`}>
                          {touched
                            ? "No positive findings recorded. Complete all core safety screens; this is not an assessed negative screen."
                            : "No structured findings yet — complete the sections above."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section
              id="m"
              title="Section M — Triage Priority"
              open={isOpen("m")}
              onToggle={toggleSection}
            >
              <Callout>
                <strong>System recommendation:</strong> Review the live safety summary above.
                Unanswered or uncertain core screens do not count as negative findings. Confirm or
                override the recommendation before signing; the signed priority will then be
                available in the psychiatrist&apos;s client list.
              </Callout>
              <div className={`${FIELDGRID} mt-3`}>
                <fieldset className="flex min-w-0 flex-col gap-1">
                  <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Clinician decision
                  </legend>
                  <RadioChoices
                    name="m_decision"
                    options={vs.options("triage-decision")}
                    value={decision}
                    onChange={changeDecision}
                  />
                </fieldset>
                <Field label="Final selected priority" htmlFor="final-priority">
                  <SelectChoices
                    id="final-priority"
                    required
                    options={vs.options("triage-priority")}
                    placeholder="Select after review"
                    value={finalPriority}
                    onChange={(value) => setAnswer("m_final_priority", value)}
                  />
                </Field>
                <Field
                  label="Reason for override (required if overridden)"
                  htmlFor="override-reason"
                >
                  <input
                    id="override-reason"
                    type="text"
                    className={INPUT}
                    disabled={decision !== "OVERRIDE"}
                    required={decision === "OVERRIDE"}
                    value={overrideReason}
                    onChange={(e) => setAnswer("m_override_reason", e.target.value)}
                  />
                </Field>
                <ReadOnlyField label="Clinician / Date / time" value={clinicianLine} />
              </div>
              <div
                className="mt-4 grid grid-cols-1 gap-2.5 min-[601px]:grid-cols-2"
                aria-label="Triage priority definitions"
              >
                {PRIORITY_GUIDE.map((card) => (
                  <article
                    key={card.key}
                    className={`min-w-0 rounded-[10px] border border-l-4 border-surface-border px-3.5 py-[13px] ${card.card}`}
                  >
                    <h3 className={`mb-[7px] text-xs font-bold tracking-[.03em] ${card.tone}`}>
                      {card.title}
                    </h3>
                    <p className="text-[11.5px] leading-normal text-ink-900">
                      <strong className={card.tone}>Clinical meaning:</strong> {card.meaning}
                    </p>
                    <p className="mt-1.5 text-[11.5px] leading-normal text-ink-900">
                      <strong className={card.tone}>Expected action:</strong> {card.action}
                    </p>
                  </article>
                ))}
              </div>
            </Section>

            <Section
              id="n"
              title="Section N — Immediate Action / Disposition"
              open={isOpen("n")}
              onToggle={toggleSection}
            >
              <fieldset>
                <legend className="sr-only">Immediate actions</legend>
                <CheckChoices
                  options={vs.options("triage-action")}
                  value={actions}
                  onChange={(codes) => setAnswer("n_actions", codes)}
                />
              </fieldset>
              <div className={`${FIELDGRID} mt-3 items-end`}>
                <Field label="Responsible person/team" htmlFor="t-n-owner">
                  <input
                    id="t-n-owner"
                    type="text"
                    className={INPUT}
                    value={owner}
                    onChange={(e) => setAnswer("n_owner", e.target.value)}
                  />
                </Field>
                <Field label="Status" htmlFor="t-n-status">
                  <SelectChoices
                    id="t-n-status"
                    options={vs.options("task-status")}
                    value={taskStatus}
                    onChange={(value) => setAnswer("n_status", value)}
                  />
                </Field>
                <button
                  type="button"
                  className={`${BTN} justify-self-start`}
                  disabled={registering}
                  onClick={onRegisterTasks}
                >
                  Register as trackable tasks
                </button>
              </div>
              {taskError && (
                <div className="mt-2">
                  <ErrorNote>{taskError}</ErrorNote>
                </div>
              )}
              <div className="mt-3 overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>Action</th>
                      <th className={TH}>Owner</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Date / time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length ? (
                      tasks.map((task) => (
                        <tr key={task.id}>
                          <td className={TD}>
                            <strong>{task.action_label}</strong>
                          </td>
                          <td className={TD}>{task.owner}</td>
                          <td className={TD}>
                            <Tag>{vs.label("task-status", task.status)}</Tag>
                          </td>
                          <td className={TD}>{formatDateTime(task.created_at)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className={`${TD} !text-ink-500`}>
                          No actions registered yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          </fieldset>

          <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex flex-col items-start justify-between gap-3 border-t border-surface-border bg-surface-card/95 px-4 py-3 shadow-[0_-6px_18px_rgba(18,38,34,.06)] backdrop-blur min-[561px]:flex-row min-[561px]:items-center sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <span role="status" className="text-xs text-ink-500">
              {signed
                ? `Signed ${formatTime(signed.signed_at)}${signed.signed_by ? ` by ${signed.signed_by}` : ""} — read-only`
                : draftStatus}
            </span>
            <div aria-live="polite" className="min-w-0 flex-1">
              {signMsg && (
                <Callout tone={signMsg.tone} role={signMsg.tone === "danger" ? "alert" : "status"}>
                  {signMsg.text}
                </Callout>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 min-[561px]:w-auto [&>button]:flex-auto min-[561px]:[&>button]:flex-none">
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => navigate("/clinical/triage")}
              >
                Back
              </button>
              <button type="button" className={BTN_GHOST} disabled={readOnly} onClick={saveNow}>
                Save draft
              </button>
              <button type="button" className={BTN} disabled={readOnly || signing} onClick={onSign}>
                Sign triage
              </button>
            </div>
          </div>
        </form>
      </FormCtx.Provider>
    </div>
  );
}
