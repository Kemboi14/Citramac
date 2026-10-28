import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  registerTriageTasks,
  saveTriageDraft,
  signTriage,
  type CareTask,
  type ClientBanner,
  type Priority,
  type TriageAnswers,
  type TriageAssessmentRecord,
  type TriageEncounterDetail,
} from "../../../lib/carePathwayApi";
import { getClientFindings, type ClinicalFinding } from "../../../lib/findingsApi";
import {
  getTriageV4Config,
  type TriageV4Config,
  type TriageV4Evaluation,
} from "../../../lib/triageV4Api";
import { Breadcrumbs } from "../shared/Breadcrumbs";
import { SafetyBanner } from "../shared/SafetyBanner";
import { formatDateTime, formatTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, GROUP_LABEL, INPUT, TABLE, TD, TH } from "../shared/styles";
import {
  Callout,
  CheckChoices,
  ErrorNote,
  Field,
  PageHeader,
  PriorityPill,
  SelectChoices,
  Tag,
} from "../shared/ui";
import { useValueSets, type ValueSetsApi } from "../shared/useValueSets";
import { EncounterContext } from "./EncounterContext";
import { FIELDGRID, errorText } from "./helpers";

// Triage v5 — the "Comprehensive Triage & Initial Risk Screen" developer
// specification, sections A–N (backend/apps/care_pathway/triage_v5.py). Each
// question is asked once: what Registration or an earlier stage already holds
// is shown and confirmed, not re-entered. The recommendation is computed on the
// server (rule set approved by the project owner, 2026-10-28); hidden
// branches are not rendered and the server drops their answers on signing.

const PRIORITIES: Priority[] = ["RED", "ORANGE", "YELLOW", "GREEN"];
const RANK: Record<Priority, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
const MEANING: Record<Priority, { title: string; action: string }> = {
  RED: {
    title: "Emergency / Immediate",
    action:
      "Do not wait for routine intake. Begin immediate safety/medical action and emergency assessment or transfer where required.",
  },
  ORANGE: {
    title: "Urgent",
    action: "Place ahead of routine work; review as soon as possible under the urgent process.",
  },
  YELLOW: { title: "Priority", action: "Timely assessment; escalate if the condition changes." },
  GREEN: { title: "Routine", action: "Proceed through the normal intake / appointment pathway." },
};
const CHIP_TONE: Record<Priority, string> = {
  RED: "border-priority-red text-priority-red",
  ORANGE: "border-priority-orange text-priority-orange",
  YELLOW: "border-priority-yellow text-priority-yellow",
  GREEN: "border-priority-green text-priority-green",
};
const VITALS: { key: string; label: string }[] = [
  { key: "v_hr", label: "Pulse" },
  { key: "v_rr", label: "Resp. rate" },
  { key: "v_temp", label: "Temp." },
  { key: "v_spo2", label: "SpO₂" },
  { key: "v_glucose", label: "Blood glucose" },
];
const SUBSTANCE_ROWS = [
  "alcohol",
  "opioids",
  "sedatives",
  "stimulants",
  "cannabis",
  "khat",
  "other",
];
const DRAFT_FAILED = "Draft not saved — check your connection";

function str(answers: TriageAnswers, key: string): string {
  const value = new Map(Object.entries(answers)).get(key);
  return typeof value === "string" ? value : "";
}

function list(answers: TriageAnswers, key: string): string[] {
  const value = new Map(Object.entries(answers)).get(key);
  return Array.isArray(value) ? value : [];
}

function asPriority(value: string): Priority | "" {
  return PRIORITIES.find((p) => p === value) ?? "";
}

interface Ctx {
  answers: TriageAnswers;
  set: (key: string, value: string | string[]) => void;
  vs: ValueSetsApi;
  invalid: Set<string>;
}
const FormCtx = createContext<Ctx | null>(null);
function useCtx() {
  const ctx = useContext(FormCtx);
  if (!ctx) throw new Error("Triage controls must be inside the form.");
  return ctx;
}

const fid = (key: string) => `tv5-${key.replace(/_/g, "-")}`;

/** One spec question with its answers as a segmented control. */
function Ask({ k, q, set, only }: { k: string; q: ReactNode; set: string; only?: string[] }) {
  const { answers, set: setAnswer, vs, invalid } = useCtx();
  const value = str(answers, k);
  const options = vs.options(set).filter((o) => !only || only.includes(o.code));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border py-2.5 first:border-t-0">
      <span id={`${fid(k)}-q`} className="text-[13px] font-semibold text-ink-900">
        {q}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${fid(k)}-q`}
        id={fid(k)}
        tabIndex={-1}
        className={`inline-flex overflow-hidden rounded-lg border ${invalid.has(k) ? "border-priority-red" : "border-surface-border"}`}
      >
        {options.map((o) => (
          <button
            key={o.code}
            type="button"
            role="radio"
            aria-checked={value === o.code}
            className={`border-l border-surface-border px-3.5 py-1.5 text-[13px] font-semibold first:border-l-0 ${value === o.code ? "bg-brand-green text-on-primary" : "bg-surface-card text-ink-900"}`}
            onClick={() => setAnswer(k, value === o.code ? "" : o.code)}
          >
            {o.display}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Follow-up detail that opens under a question. */
function Detail({ children }: { children: ReactNode }) {
  return <div className="mb-2 rounded-lg bg-surface-bg px-3 py-3">{children}</div>;
}

function Sel({ k, label, set }: { k: string; label: string; set: string }) {
  const { answers, set: setAnswer, vs, invalid } = useCtx();
  return (
    <Field label={label} htmlFor={fid(k)} error={invalid.has(k) ? "Required" : undefined}>
      <SelectChoices
        id={fid(k)}
        options={vs.options(set)}
        value={str(answers, k)}
        placeholder="— select —"
        onChange={(value) => setAnswer(k, value)}
      />
    </Field>
  );
}

function Txt({
  k,
  label,
  placeholder,
  rows,
  type,
}: {
  k: string;
  label: string;
  placeholder?: string;
  rows?: number;
  type?: "datetime-local";
}) {
  const { answers, set: setAnswer, invalid } = useCtx();
  const common = {
    id: fid(k),
    placeholder,
    value: str(answers, k),
    "aria-invalid": invalid.has(k) || undefined,
  };
  return (
    <Field label={label} htmlFor={fid(k)} error={invalid.has(k) ? "Required" : undefined}>
      {rows ? (
        <textarea
          {...common}
          rows={rows}
          className={`${INPUT} resize-y`}
          onChange={(e) => setAnswer(k, e.target.value)}
        />
      ) : (
        <input
          {...common}
          type={type ?? "text"}
          className={INPUT}
          onChange={(e) => setAnswer(k, e.target.value)}
        />
      )}
    </Field>
  );
}

/** A checklist; ticking "Other" opens a box to say what. */
function Checks({ k, legend, set }: { k: string; legend?: string; set: string }) {
  const { answers, set: setAnswer, vs } = useCtx();
  const chosen = list(answers, k);
  return (
    <fieldset className="mt-2">
      <legend className={legend ? GROUP_LABEL : "sr-only"}>{legend ?? set}</legend>
      <CheckChoices
        columns={2}
        options={vs.options(set)}
        value={chosen}
        onChange={(codes) => setAnswer(k, codes)}
      />
      {chosen.includes("other") && (
        <div className="mt-2 max-w-md">
          <Txt k={`${k}_other`} label="Other — describe" />
        </div>
      )}
    </fieldset>
  );
}

function NotMeasured({
  label,
  value,
  vs,
  onChange,
}: {
  label: string;
  value: string;
  vs: ValueSetsApi;
  onChange: (reason: string) => void;
}) {
  return (
    <select
      aria-label={`${label} — not measured reason`}
      className={`${INPUT} !py-1 text-xs`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Not measured?</option>
      {vs.options("triage-v4-not-measured").map((o) => (
        <option key={o.code} value={o.code}>
          Not measured: {o.display}
        </option>
      ))}
    </select>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-2.5 rounded-lg border border-surface-border bg-surface-card px-[18px] py-4 shadow-sm">
      <h2 className="mb-2 text-[13px] font-bold text-ink-900">{title}</h2>
      {children}
    </section>
  );
}

export function TriageFormV5({
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

  const [config, setConfig] = useState<TriageV4Config | null>(null);
  const [answers, setAnswers] = useState<TriageAnswers>(() => {
    const base: TriageAnswers = { ...detail.defaults, ...(stored?.answers ?? {}), schema: "v5" };
    if (!str(base, "c_concern")) base.c_concern = detail.presenting_concern;
    return base;
  });
  const answersRef = useRef(answers);
  const [evaluation, setEvaluation] = useState<TriageV4Evaluation>(() =>
    !editable && detail.signed
      ? {
          ...detail.evaluation,
          recommendation: detail.signed.recommendation,
          reasons: detail.signed.recommendation_reasons,
          findings: detail.signed.findings,
        }
      : detail.evaluation,
  );
  const [signed, setSigned] = useState<TriageAssessmentRecord | null>(
    editable ? null : detail.signed,
  );
  const readOnly = !editable || signed !== null;
  const [draftStatus, setDraftStatus] = useState(
    detail.draft?.draft_saved_at
      ? `Draft saved ${formatTime(detail.draft.draft_saved_at)}`
      : "Draft not saved",
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [tasks, setTasks] = useState<CareTask[]>(detail.tasks);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [known, setKnown] = useState<ClinicalFinding[]>([]);
  const [allergyEdit, setAllergyEdit] = useState(
    () => str(answers, "a_allergy_status") !== "" && str(answers, "a_allergy_confirmed") !== "yes",
  );
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const pending = useRef(false);
  const closed = useRef(!editable);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getTriageV4Config(accessToken)
      .then((c) => !cancelled && setConfig(c))
      .catch(() => undefined);
    // Section A: findings already on record (an earlier triage or intake).
    getClientFindings(accessToken, detail.patient_id)
      .then((r) => !cancelled && setKnown(r.results.filter((f) => f.status === "PRESENT")))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accessToken, detail.patient_id]);

  useEffect(() => {
    if (readOnly) return;
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [readOnly, startedAt]);

  // Leaving with an unsaved change flushes it rather than dropping it.
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
        setDraftStatus(`Draft saved ${formatTime(result.draft_saved_at)}`);
      })
      .catch(() => {
        if (mine !== seq.current || closed.current) return;
        pending.current = true;
        setDraftStatus(DRAFT_FAILED);
      });
  }

  function setMany(values: TriageAnswers) {
    if (readOnly) return;
    const next = { ...answersRef.current, ...values };
    answersRef.current = next;
    setAnswers(next);
    const keys = Object.keys(values);
    if (keys.some((k) => invalid.has(k))) {
      setInvalid((prev) => new Set([...prev].filter((k) => !keys.includes(k))));
    }
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 500);
  }

  function set(key: string, value: string | string[]) {
    setMany({ [key]: value });
  }

  const a = (key: string) => str(answers, key);
  const present = a("b_present");
  const recommended: Priority = evaluation.priority;
  const chosen: Priority = asPriority(a("m_final_priority")) || recommended;
  const override = chosen !== recommended;
  const downgrade = RANK[chosen] < RANK[recommended];
  const safetyRequired = present === "yes" && (chosen === "RED" || chosen === "ORANGE");
  const ews = evaluation.ews;
  const reasonMin = config?.override_reason_min ?? 10;
  const vconf = list(answers, "vconf");

  function vitalCheck(key: string): { error?: string; soft?: string } {
    const raw = a(key);
    const range = config?.vital_ranges[key];
    if (!raw || !range) return {};
    if (!/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) return { error: "Enter a number only" };
    const x = Number(raw);
    if (x < range.hard_min || x > range.hard_max)
      return {
        error: `Not a possible value — check (${range.hard_min}–${range.hard_max} ${range.unit})`,
      };
    if (x < range.soft_min || x > range.soft_max)
      return { soft: `${range.label} ${raw} is unusual` };
    return {};
  }

  const confirmBox = (k: string) => {
    const soft = vitalCheck(k).soft;
    if (!soft) return null;
    return (
      <label
        key={`${k}-confirm`}
        className="flex items-center gap-2 text-[12px] text-priority-orange"
      >
        <input
          type="checkbox"
          checked={vconf.includes(k)}
          onChange={(e) =>
            set("vconf", e.target.checked ? [...vconf, k] : vconf.filter((x) => x !== k))
          }
        />
        {soft} — measured correctly
      </label>
    );
  };

  function markNotMeasured(keys: string[], reason: string) {
    setMany(Object.fromEntries(keys.map((x) => [x, reason])));
  }

  // A render helper, not a component: a component declared in here would remount
  // on every keystroke and lose focus.
  const vitalInput = (k: string, label: string) => {
    const check = vitalCheck(k);
    const unit = config?.vital_ranges[k]?.unit ?? "";
    return (
      <Field
        key={k}
        label={`${label}${unit ? ` (${unit})` : ""}`}
        htmlFor={fid(k)}
        error={check.error ?? (invalid.has(k) && !check.soft ? "Check this value" : undefined)}
      >
        <input
          id={fid(k)}
          type="text"
          inputMode="decimal"
          className={INPUT}
          value={a(k)}
          aria-invalid={Boolean(check.error) || undefined}
          onChange={(e) => setMany({ [k]: e.target.value, vconf: vconf.filter((x) => x !== k) })}
        />
        {confirmBox(k)}
        {!a(k) && (
          <NotMeasured
            label={label}
            value={a(`nm_${k.slice(2)}`)}
            vs={vs}
            onChange={(r) => markNotMeasured([`nm_${k.slice(2)}`], r)}
          />
        )}
      </Field>
    );
  };

  async function onSign() {
    if (!accessToken || readOnly || signing) return;
    window.clearTimeout(timer.current);
    closed.current = true;
    setSigning(true);
    setSignError(null);
    setProblems([]);
    try {
      const record = await signTriage(accessToken, detail.id, {
        answers: answersRef.current,
        decision: override ? "OVERRIDE" : "CONFIRM",
        final_priority: chosen,
        override_reason: override ? a("m_override_reason").trim() : undefined,
      });
      pending.current = false;
      setSigned(record);
      onSigned();
    } catch (err) {
      closed.current = false;
      const fields = err instanceof ApiError ? err.fields : undefined;
      const keys = Array.isArray(fields?.missing_keys) ? fields.missing_keys.map(String) : [];
      const msgs = Array.isArray(fields?.problems) ? fields.problems.map(String) : [];
      if (msgs.length) {
        setProblems(msgs);
        setInvalid(new Set(keys));
        const first = keys.length ? document.getElementById(fid(keys[0])) : null;
        first?.scrollIntoView({ block: "center" });
        first?.focus();
      } else {
        setSignError(
          errorText(
            err,
            "Triage not signed — couldn't reach the server. Your answers are still on this page; check your connection and sign again.",
          ),
        );
      }
    } finally {
      setSigning(false);
    }
  }

  async function onRegisterTasks() {
    if (!accessToken || readOnly) return;
    const actions = list(answers, "n_actions");
    if (!actions.length) return;
    setTaskError(null);
    try {
      setTasks(
        await registerTriageTasks(accessToken, detail.id, {
          actions,
          owner: a("n_owner").trim(),
          status: (a("n_status") || "INITIATED") as CareTask["status"],
        }),
      );
      set("n_actions", []);
    } catch (err) {
      setTaskError(errorText(err, "Tasks not registered — check your connection."));
    }
  }

  const ctx: Ctx = { answers, set, vs, invalid };
  const recActions = new Set(evaluation.recommended_actions ?? []);
  const findings = signed?.findings ?? evaluation.findings;
  const reasonList = evaluation.reason_list ?? [];
  const sexLabel = banner?.sex ? vs.label("sex", banner.sex) : "";
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const allergy = banner?.allergy;
  const allergyText = !allergy
    ? "—"
    : allergy.state === "known"
      ? allergy.items
          .map((i) => (i.reaction ? `${i.substance} (${i.reaction})` : i.substance))
          .join(", ") || "Known allergy"
      : allergy.state === "none"
        ? "No known allergies"
        : "ALLERGY STATUS UNKNOWN";
  const nextStepNeeded =
    a("k_emergency") === "no" && (a("k_bring") === "no" || a("k_bring") === "uncertain");

  return (
    <div className="mx-auto max-w-[1600px]">
      <Breadcrumbs
        items={[
          { label: "Triage", to: "/clinical/triage" },
          { label: banner ? banner.name.trim() || "Temporary client (unnamed)" : "Encounter" },
        ]}
      />
      <SafetyBanner banner={banner} error={bannerError} />
      <EncounterContext detail={detail} banner={banner} />
      <PageHeader
        title="Triage & initial risk screen"
        actions={
          <div className="flex items-center gap-2">
            {!readOnly && <Tag>{`${mm}:${ss}`}</Tag>}
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => navigate("/clinical/triage")}
            >
              Back to queue
            </button>
          </div>
        }
      />
      {vs.error && <ErrorNote>{vs.error}</ErrorNote>}
      {detail.triage_version > 0 && !readOnly && (
        <Callout className="mb-3">
          Re-triage — version {detail.triage_version} stays in the record; signing creates version{" "}
          {detail.triage_version + 1}.
        </Callout>
      )}

      <FormCtx.Provider value={ctx}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={(e) => e.preventDefault()} aria-label="Triage">
            <fieldset disabled={readOnly} className="min-w-0">
              <Section title="A — On record">
                <p className="text-[13px] text-ink-900">
                  {banner?.name || "Temporary client"} · {banner?.citramac_number || "no number"} ·{" "}
                  {banner?.age ?? "age unknown"} yrs · {sexLabel || "sex not recorded"}
                  {banner?.referral_source ? ` · referred by ${banner.referral_source}` : ""}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  Alerts:{" "}
                  {banner && banner.alerts.length
                    ? banner.alerts.map((x) => x.label).join(" · ")
                    : "none"}
                  {detail.priority ? ` · previous priority ${detail.priority}` : ""}
                </p>
                {known.length > 0 && (
                  <ul className="mt-1 text-[12.5px] text-ink-700">
                    {known.map((f) => (
                      <li key={f.key}>
                        <strong>{f.title}</strong> — {f.summary || f.status_label} ·{" "}
                        {f.source_label} · {formatDateTime(f.recorded_at)} ({f.stage.toLowerCase()})
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                  <span>
                    <strong>Allergies:</strong> {allergyText}
                  </span>
                  {a("a_allergy_confirmed") === "yes" && !allergyEdit ? (
                    <Tag tone="brand">Confirmed</Tag>
                  ) : (
                    !readOnly && (
                      <>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => {
                            setAllergyEdit(false);
                            setMany({
                              a_allergy_confirmed: "yes",
                              a_allergy_status: allergy?.state ?? "unknown",
                              a_allergy_detail: "",
                            });
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          aria-expanded={allergyEdit}
                          onClick={() => {
                            setAllergyEdit(true);
                            setMany({ a_allergy_confirmed: "" });
                          }}
                        >
                          Update
                        </button>
                      </>
                    )
                  )}
                </div>
                {allergyEdit && (
                  <div className={`${FIELDGRID} mt-2`}>
                    <Sel k="a_allergy_status" label="Allergy status" set="triage-allergy-status" />
                    {a("a_allergy_status") === "known" && (
                      <Txt
                        k="a_allergy_detail"
                        label="Allergy and reaction"
                        placeholder="e.g. Penicillin — rash"
                      />
                    )}
                  </div>
                )}
                {banner && banner.identity_status !== "IDENTIFIED" && (
                  <Link
                    to={`/clinical/registration?resolve=${detail.patient_id}`}
                    className={`${BTN_GHOST} ${BTN_SM} mt-3`}
                  >
                    Resolve identity
                  </Link>
                )}
              </Section>

              <Section title="B / C — Encounter and what is happening now">
                <div className={FIELDGRID}>
                  <Sel
                    k="b_informant"
                    label="Who is giving the information?"
                    set="triage-informant"
                  />
                  {a("b_informant") && a("b_informant") !== "client" && (
                    <Txt
                      k="b_third_party"
                      label="Name / relationship"
                      placeholder="e.g. Sister — Jane"
                    />
                  )}
                  <Sel k="b_encounter_type" label="Encounter type" set="triage-encounter-type" />
                  {a("b_encounter_type") === "other" && (
                    <Txt k="b_encounter_type_other" label="Encounter type — other" />
                  )}
                </div>
                <Ask k="b_present" q="Is the client physically present?" set="yes-no" />
                <div className="mt-2">
                  <Txt
                    k="c_concern"
                    label="Main concern, in the client's / informant's own words"
                    rows={2}
                  />
                </div>
                <div className={`${FIELDGRID} mt-3`}>
                  <Sel
                    k="c_onset"
                    label="When did this begin or become worse?"
                    set="triage-onset"
                  />
                  <Txt k="c_description" label="Brief description" />
                </div>
              </Section>

              {present === "yes" && (
                <>
                  <Section title="D — Immediate safety: suicide / self-harm">
                    <Ask
                      k="d_suicidal"
                      q="Are you currently having thoughts of killing yourself or seriously harming yourself?"
                      set="no-yes-unable"
                    />
                    {a("d_suicidal") === "yes" && (
                      <Detail>
                        <Ask
                          k="d_act_now"
                          q="Are you thinking about acting on these thoughts now?"
                          set="no-yes-unsure"
                        />
                      </Detail>
                    )}
                    <Ask
                      k="d_attempt"
                      q="Have you done anything recently to try to kill or seriously harm yourself?"
                      set="no-yes"
                    />
                    {a("d_attempt") === "yes" && (
                      <Detail>
                        <Txt k="d_what_happened" label="What happened and when?" />
                      </Detail>
                    )}
                    <Ask
                      k="d_means"
                      q="Known access to something that could be used for serious self-harm?"
                      set="no-yes-unknown"
                    />
                    <Ask
                      k="d_safety"
                      q="Can the client currently maintain their own safety?"
                      set="yes-no-uncertain"
                    />
                  </Section>

                  <Section title="E — Risk of harm to others">
                    <Ask
                      k="e_thoughts"
                      q="Current thoughts of seriously harming someone else?"
                      set="no-yes-unable"
                    />
                    {a("e_thoughts") === "yes" && (
                      <Detail>
                        <Ask
                          k="e_named"
                          q="Is a specific, identifiable person at risk?"
                          set="no-yes"
                        />
                        {a("e_named") === "yes" && (
                          <>
                            <Callout tone="danger" className="my-2">
                              <strong>Duty to protect</strong> — a senior decision on informing the
                              person and/or police is requested when you sign.
                            </Callout>
                            <div className={FIELDGRID}>
                              <Txt k="duty_victim" label="Person at risk (relationship, where)" />
                              <Txt k="duty_informed" label="Who in the team has been informed" />
                              <Sel
                                k="duty_police"
                                label="Police informed?"
                                set="triage-v4-duty-police"
                              />
                              <Sel
                                k="duty_warned"
                                label="Person warned?"
                                set="triage-v4-duty-warned"
                              />
                            </div>
                          </>
                        )}
                      </Detail>
                    )}
                    <Ask
                      k="e_behaviour"
                      q="Recent threatening, aggressive or violent behaviour?"
                      set="no-yes-unknown"
                    />
                    {(a("e_thoughts") === "yes" || a("e_behaviour") === "yes") && (
                      <Detail>
                        <Txt k="e_concern" label="Who / what is the concern?" />
                      </Detail>
                    )}
                    <Ask k="e_act" q="Recent violent act?" set="no-yes" />
                    <Ask
                      k="e_means"
                      q="Known access to means capable of serious harm?"
                      set="no-yes-unknown"
                    />
                    <Ask
                      k="e_danger"
                      q="Current behaviour suggests immediate danger?"
                      set="no-yes-uncertain"
                    />
                  </Section>

                  <Section title="F — Acute mental state">
                    <Ask k="f_change" q="Major change in mental state now?" set="no-yes-unable" />
                    {a("f_change") === "yes" && (
                      <Detail>
                        <Checks k="f_features" set="triage-mental-state-feature" />
                      </Detail>
                    )}
                    <div className={`${FIELDGRID} mt-2`}>
                      <Field label="Level of consciousness">
                        <p className="py-2 text-[13px] text-ink-700">
                          {a("acvpu")
                            ? vs.label("triage-v4-acvpu", a("acvpu"))
                            : "Record ACVPU in H"}
                        </p>
                      </Field>
                      <Sel k="f_orientation" label="Orientation" set="triage-orientation" />
                      <Sel k="f_behaviour" label="Behaviour" set="triage-behaviour" />
                      {a("f_behaviour") === "other" && (
                        <Txt k="f_behaviour_other" label="Behaviour — other" />
                      )}
                    </div>
                  </Section>

                  <Section title="G — Alcohol & other substances">
                    <Ask
                      k="g_use"
                      q="Recent alcohol or other substance use?"
                      set="no-yes-unknown"
                    />
                    {a("g_use") === "yes" && (
                      <div className="-mx-[18px] my-2 overflow-x-auto">
                        <table className={TABLE} id={fid("g_alcohol_last")} tabIndex={-1}>
                          <thead>
                            <tr>
                              <th className={TH}>Substance</th>
                              <th className={TH}>Last use</th>
                              <th className={TH}>Amount / pattern</th>
                              <th className={TH}>Current concern</th>
                            </tr>
                          </thead>
                          <tbody>
                            {SUBSTANCE_ROWS.map((code) => {
                              const label = vs.label("triage-v4-substance", code);
                              return (
                                <tr key={code}>
                                  <td className={TD}>
                                    {code === "other" ? (
                                      <input
                                        id={fid("g_other_name")}
                                        aria-label="Other substance — name"
                                        placeholder="Other — name"
                                        className={`${INPUT} min-w-[120px]`}
                                        value={a("g_other_name")}
                                        onChange={(e) => set("g_other_name", e.target.value)}
                                      />
                                    ) : (
                                      label
                                    )}
                                  </td>
                                  <td className={TD}>
                                    <input
                                      aria-label={`${label} — last use`}
                                      className={`${INPUT} min-w-[120px]`}
                                      value={a(`g_${code}_last`)}
                                      onChange={(e) => set(`g_${code}_last`, e.target.value)}
                                    />
                                  </td>
                                  <td className={TD}>
                                    <input
                                      aria-label={`${label} — amount / pattern`}
                                      className={`${INPUT} min-w-[140px]`}
                                      value={a(`g_${code}_amount`)}
                                      onChange={(e) => set(`g_${code}_amount`, e.target.value)}
                                    />
                                  </td>
                                  <td className={TD}>
                                    <SelectChoices
                                      options={vs.options("triage-substance-concern")}
                                      value={a(`g_${code}_concern`)}
                                      placeholder="—"
                                      onChange={(value) => set(`g_${code}_concern`, value)}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {(a("g_use") === "yes" || a("g_use") === "unknown") && (
                      <div className={`${FIELDGRID} mt-2`}>
                        <Sel
                          k="g_intoxication"
                          label="Current intoxication"
                          set="triage-intoxication"
                        />
                      </div>
                    )}
                    {a("g_use") && (
                      <>
                        <Ask
                          k="g_stopped"
                          q="Recently stopped / significantly reduced heavy or frequent use?"
                          set="no-yes-unknown"
                        />
                        <Checks
                          k="g_withdrawal"
                          legend="Current withdrawal"
                          set="triage-withdrawal-symptom"
                        />
                        <Ask
                          k="g_seizure_hx"
                          q="Previous withdrawal seizure?"
                          set="no-yes-unknown"
                        />
                        <Ask
                          k="g_dts_hx"
                          q="Previous severe withdrawal / DTs?"
                          set="no-yes-unknown"
                        />
                      </>
                    )}
                  </Section>

                  <Section title="H — Urgent medical screen">
                    <Ask
                      k="h_concern"
                      q="Immediate physical / medical concern?"
                      set="no-yes-unknown"
                    />
                    {a("h_concern") === "yes" && (
                      <Detail>
                        <Checks k="h_flags" set="triage-medical-concern" />
                        {list(answers, "h_flags").includes("suspected_overdose") && (
                          <>
                            <Callout tone="danger" className="my-2">
                              <strong>Medical emergency first.</strong> Record what, how much, when,
                              with what and why.
                            </Callout>
                            <div className={FIELDGRID}>
                              <Txt k="od_substance" label="Substance(s)" />
                              <Txt k="od_amount" label="Amount" placeholder="or ‘unknown’" />
                              <Txt k="od_time" label="Time of ingestion" type="datetime-local" />
                              <Txt
                                k="od_coingest"
                                label="Co-ingestants (incl. alcohol)"
                                placeholder="or ‘none known’"
                              />
                              <Sel k="od_intent" label="Intent" set="triage-v4-od-intent" />
                            </div>
                          </>
                        )}
                      </Detail>
                    )}
                    <div className={`${FIELDGRID} mt-3`}>
                      <Sel
                        k="consent_obs"
                        label="Consent to vital signs"
                        set="triage-v4-consent-obs"
                      />
                      <Sel k="chaperone" label="Chaperone" set="triage-v4-chaperone" />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field
                        label="BP (mmHg)"
                        htmlFor={fid("v_sbp")}
                        error={vitalCheck("v_sbp").error ?? vitalCheck("v_dbp").error}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            id={fid("v_sbp")}
                            aria-label="Systolic blood pressure, mmHg"
                            placeholder="sys"
                            inputMode="numeric"
                            className={INPUT}
                            value={a("v_sbp")}
                            onChange={(e) =>
                              setMany({
                                v_sbp: e.target.value,
                                vconf: vconf.filter((x) => x !== "v_sbp"),
                              })
                            }
                          />
                          <span>/</span>
                          <input
                            aria-label="Diastolic blood pressure, mmHg"
                            placeholder="dia"
                            inputMode="numeric"
                            className={INPUT}
                            value={a("v_dbp")}
                            onChange={(e) =>
                              setMany({
                                v_dbp: e.target.value,
                                vconf: vconf.filter((x) => x !== "v_dbp"),
                              })
                            }
                          />
                        </div>
                        {confirmBox("v_sbp")}
                        {confirmBox("v_dbp")}
                        {!a("v_sbp") && (
                          <NotMeasured
                            label="Blood pressure"
                            value={a("nm_sbp")}
                            vs={vs}
                            onChange={(r) => markNotMeasured(["nm_sbp", "nm_dbp"], r)}
                          />
                        )}
                      </Field>
                      {VITALS.map((v) => vitalInput(v.key, v.label))}
                      <Sel k="v_o2" label="Oxygen" set="triage-v4-oxygen" />
                      <Sel k="acvpu" label="Consciousness (ACVPU)" set="triage-v4-acvpu" />
                    </div>
                    {ews && (
                      <p
                        className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${ews.complete ? "border-surface-border" : "border-priority-orange"}`}
                        role="status"
                      >
                        <strong>{ews.label}</strong>
                        {ews.complete ? ` — ${ews.response.text}` : " — partial score"}
                      </p>
                    )}
                  </Section>

                  <Section title="I — Safeguarding & vulnerability">
                    <Ask
                      k="i_safe"
                      q="Do you feel safe where you currently live / stay?"
                      set="triage-feels-safe"
                    />
                    <Checks k="i_flags" set="triage-safeguarding-concern" />
                    {list(answers, "i_flags").includes("sexual_violence") && (
                      <Detail>
                        <Ask
                          k="i_sv_recent"
                          q="Sexual violence in the last 72 hours?"
                          set="no-yes-unknown"
                        />
                        {a("i_sv_recent") === "yes" && (
                          <>
                            <Callout tone="danger" className="my-2">
                              PEP and emergency contraception are time-critical (
                              {config?.pep_window_hours ?? 72} h). Offer a same-gender clinician and
                              a chaperone.
                            </Callout>
                            <Txt
                              k="gbv_incident_at"
                              label="Time of incident (best estimate)"
                              type="datetime-local"
                            />
                          </>
                        )}
                      </Detail>
                    )}
                    <Ask
                      k="i_return"
                      q="Safe to return to current environment?"
                      set="yes-no-uncertain"
                    />
                  </Section>

                  <Section title="J — Immediate functional safety">
                    <Ask
                      k="j_concern"
                      q="Immediate concern that the person cannot safely care for basic needs?"
                      set="no-yes-uncertain"
                    />
                    {a("j_concern") === "yes" && (
                      <Detail>
                        <Checks k="j_flags" set="triage-functional-area" />
                      </Detail>
                    )}
                  </Section>

                  <Section
                    title={`Waiting-area safety${safetyRequired ? ` — required for ${chosen}` : ""}`}
                  >
                    <div className={FIELDGRID}>
                      <Sel
                        k="safety_obs"
                        label="Observation level"
                        set="triage-v4-observation-level"
                      />
                      <Sel
                        k="safety_location"
                        label="Where the person waits"
                        set="triage-v4-location"
                      />
                      <Txt k="safety_observer" label="Named observer" />
                      <Sel
                        k="safety_observer_gender"
                        label="Observer gender (if the client has a preference)"
                        set="triage-v4-observer-gender"
                      />
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 py-1 text-[13px] text-ink-900">
                      <input
                        type="checkbox"
                        checked={a("safety_items_checked") === "yes"}
                        onChange={(e) => set("safety_items_checked", e.target.checked ? "yes" : "")}
                      />
                      Belongings checked for items that could cause harm
                    </label>
                    {a("safety_items_checked") === "yes" && (
                      <div className={FIELDGRID}>
                        <Txt k="safety_removed" label="What was removed" />
                        <Txt k="safety_stored" label="Where it is stored" />
                      </div>
                    )}
                  </Section>

                  <details className="mb-2.5 rounded-lg border border-surface-border bg-surface-card px-[18px] py-3">
                    <summary className="cursor-pointer text-[13px] font-bold text-ink-900">
                      Preferences (optional)
                    </summary>
                    <div className={`${FIELDGRID} mt-3`}>
                      <Sel
                        k="pref_clinician_gender"
                        label="Preferred clinician gender"
                        set="triage-v4-clinician-gender"
                      />
                      <Txt k="pref_support_person" label="Support person present / wanted" />
                      <Txt k="pref_triggers" label="Known triggers" />
                      <Txt k="pref_feel_safe" label="What helps you feel safe here?" />
                    </div>
                  </details>
                </>
              )}

              {present === "no" && (
                <Section title="K — Telephone / third-party safety screen">
                  <div className={FIELDGRID}>
                    <Txt k="k_where" label="Where is the client now?" />
                    <Txt k="k_with" label="Who is physically with them?" />
                    <Txt k="k_last_seen" label="When did the caller last see / speak with them?" />
                  </div>
                  <Ask k="k_alone" q="Are they alone?" set="yes-no-unknown" />
                  <div className="mt-2">
                    <Txt
                      k="k_cause"
                      label="What exactly has the client said or done that is causing concern?"
                      rows={2}
                    />
                  </div>
                  <Checks k="k_flags" legend="Reported" set="triage-telephone-concern" />
                  <Ask
                    k="k_bring"
                    q="Can the person be brought safely for assessment?"
                    set="yes-no-uncertain"
                  />
                  <Ask k="k_emergency" q="Is emergency assistance required?" set="no-yes" />
                  {nextStepNeeded && (
                    <Detail>
                      <Ask
                        k="r_disposition"
                        q="Next step"
                        set="triage-v4-disposition"
                        only={["callback", "home_visit"]}
                      />
                      {a("r_disposition") === "callback" && (
                        <div className={FIELDGRID}>
                          <Txt k="r_callback_at" label="Call-back time" type="datetime-local" />
                          <Sel
                            k="r_callback_owner"
                            label="Who will call back"
                            set="triage-v4-callback-owner"
                          />
                        </div>
                      )}
                    </Detail>
                  )}
                  <div className="mt-2">
                    <Txt k="r_advice" label="Safety advice given to the caller" rows={2} />
                  </div>
                </Section>
              )}

              <Section title="L — Triage summary">
                <div className="-mx-[18px] overflow-x-auto">
                  <table className={TABLE}>
                    <thead>
                      <tr>
                        <th className={TH}>Finding / alert</th>
                        <th className={TH}>Current status</th>
                        <th className={TH}>Source</th>
                        <th className={TH}>Date / time · recorded by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findings.length ? (
                        findings.map((row, i) => {
                          const cells = row as string[];
                          return (
                            <tr key={`${cells[0]}-${i}`}>
                              <td className={TD}>
                                <strong>{cells[0]}</strong>
                              </td>
                              <td className={TD}>{cells[1]}</td>
                              <td className={TD}>{cells[2]}</td>
                              <td className={TD}>
                                {cells[3]
                                  ? `${formatDateTime(cells[3])} · ${cells[4] ?? ""}`
                                  : "On signing"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={4} className={`${TD} !text-ink-500`}>
                            No findings yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="N — Immediate action / disposition">
                <fieldset>
                  <legend className="sr-only">Immediate actions</legend>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {vs.options("triage-action").map((o) => (
                      <label key={o.code} className="flex items-center gap-2 py-1 text-[13px]">
                        <input
                          type="checkbox"
                          checked={list(answers, "n_actions").includes(o.code)}
                          onChange={(e) =>
                            set(
                              "n_actions",
                              e.target.checked
                                ? [...list(answers, "n_actions"), o.code]
                                : list(answers, "n_actions").filter((c) => c !== o.code),
                            )
                          }
                        />
                        {o.display}
                        {recActions.has(o.code) && <Tag tone="brand">recommended</Tag>}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className={`${FIELDGRID} mt-3 items-end`}>
                  <Txt k="n_owner" label="Responsible person / team" />
                  <Sel k="n_status" label="Task status" set="task-status" />
                  <button
                    type="button"
                    className={`${BTN} justify-self-start`}
                    onClick={onRegisterTasks}
                  >
                    Register as tasks
                  </button>
                </div>
                {taskError && <ErrorNote>{taskError}</ErrorNote>}
                {tasks.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[13px]">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <strong>{t.action_label}</strong> · {t.owner} ·{" "}
                        {vs.label("task-status", t.status)}
                        {t.due_at ? ` · due ${formatDateTime(t.due_at)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </fieldset>
          </form>

          <aside aria-label="Priority" className="xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-3">
                <span className="text-[13px] font-bold">
                  M — {signed ? "Signed priority" : "System recommends"}
                </span>
                <PriorityPill priority={signed ? signed.final_priority : recommended} long />
              </div>
              <div className="px-4 py-3" role="status" aria-live="polite">
                <p className="mb-2 text-[12px] text-ink-500">
                  {evaluation.recommendation} · rules{" "}
                  {signed?.rules_version ?? evaluation.rules_version}
                </p>
                {signed ? (
                  <p className="text-[13px]">{signed.recommendation_reasons}</p>
                ) : reasonList.length ? (
                  <ul className="space-y-1.5">
                    {reasonList.map((r, i) => (
                      <li key={`${r.rule}-${i}`} className="flex items-start gap-2 text-[13px]">
                        <PriorityPill priority={r.priority} />
                        <span>{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-500">{evaluation.reasons}</p>
                )}

                {!readOnly && (
                  <>
                    <div className={`${GROUP_LABEL} !mt-4`}>Clinician confirms or overrides</div>
                    <div
                      className="grid grid-cols-2 gap-2"
                      role="group"
                      aria-label="Final priority"
                    >
                      {PRIORITIES.map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={chosen === p}
                          className={`rounded-lg border-2 px-2 py-2 text-left text-[12px] font-bold ${CHIP_TONE[p]} ${chosen === p ? "bg-surface-bg ring-2 ring-current" : "bg-surface-card"}`}
                          onClick={() => set("m_final_priority", p === recommended ? "" : p)}
                        >
                          {p}
                          <span className="block font-medium">{MEANING[p].title}</span>
                          {p === recommended && (
                            <span className="text-[10.5px] font-normal">recommended</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-ink-700">
                      <strong>
                        {chosen} — {MEANING[chosen].title}.
                      </strong>{" "}
                      {MEANING[chosen].action}
                    </p>
                    {override && (
                      <div className="mt-3">
                        <Field
                          label={`Reason for override (${downgrade ? "downgrade" : "upgrade"})`}
                          htmlFor={fid("m_override_reason")}
                          error={
                            invalid.has("m_override_reason")
                              ? "A full sentence is required"
                              : undefined
                          }
                          hint={`At least ${reasonMin} characters.`}
                        >
                          <textarea
                            id={fid("m_override_reason")}
                            rows={2}
                            className={`${INPUT} resize-y`}
                            value={a("m_override_reason")}
                            onChange={(e) => set("m_override_reason", e.target.value)}
                          />
                        </Field>
                        {downgrade && (
                          <p className="mt-1 text-[12px] text-priority-orange">
                            Downgrade — a senior co-signature is requested.
                          </p>
                        )}
                      </div>
                    )}
                    {safetyRequired &&
                      (!a("safety_obs") || !a("safety_location") || !a("safety_observer")) && (
                        <Callout tone="danger" className="mt-3">
                          Required for {chosen}: observation level, where the person waits and a
                          named observer.
                        </Callout>
                      )}
                    {problems.length > 0 && (
                      <div className="mt-3" role="alert">
                        <Callout tone="danger">
                          <div>
                            <strong>Before signing:</strong>
                            <ul className="ml-4 list-disc">
                              {problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        </Callout>
                      </div>
                    )}
                    {signError && <ErrorNote>{signError}</ErrorNote>}
                    <button
                      type="button"
                      className={`${BTN} mt-3 w-full`}
                      disabled={signing}
                      onClick={onSign}
                    >
                      {detail.triage_version > 0 ? "Sign re-triage" : "Sign triage"}
                    </button>
                    <p className="mt-2 flex items-center justify-between text-[12px] text-ink-500">
                      <span>{draftStatus}</span>
                      <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={saveNow}>
                        Save draft
                      </button>
                    </p>
                  </>
                )}
                {signed && (
                  <Callout tone="success" className="mt-3">
                    Signed {formatDateTime(signed.signed_at)} by {signed.signed_by} —{" "}
                    {signed.decision === "OVERRIDE"
                      ? `override: ${signed.override_reason}`
                      : "recommendation confirmed"}
                    . A correction is a full re-triage (new version).
                  </Callout>
                )}
              </div>
            </div>
          </aside>
        </div>
      </FormCtx.Provider>
    </div>
  );
}
