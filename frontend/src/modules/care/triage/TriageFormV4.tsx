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
  RadioChoices,
  SelectChoices,
  Tag,
} from "../shared/ui";
import { useValueSets, type ValueSetsApi } from "../shared/useValueSets";
import { EncounterContext } from "./EncounterContext";
import { FIELDGRID, errorText } from "./helpers";

// Triage v4 — mockups/citramac_patient_workflow_v4.html stageTriage(),
// presentTriage(), remoteTriage(), vitalsInputs() and refreshReco(), keeping the
// TRI section semantics (A automatic, B encounter, C concern, D–J in-person
// screen, K telephone / third party, L summary, M priority, N actions). The
// recommendation is computed on the server (backend/apps/care_pathway/
// triage_v4.py, a DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF); this
// screen shows what it returns. Hidden branches are not rendered and the server
// drops their answers on signing (X-08).

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
    action: "Place ahead of routine work; clinician review as soon as possible.",
  },
  YELLOW: {
    title: "Priority",
    action: "Timely assessment; escalate if the condition changes.",
  },
  GREEN: { title: "Routine", action: "Proceed through the normal intake / appointment pathway." },
};
const CHIP_TONE: Record<Priority, string> = {
  RED: "border-priority-red text-priority-red",
  ORANGE: "border-priority-orange text-priority-orange",
  YELLOW: "border-priority-yellow text-priority-yellow",
  GREEN: "border-priority-green text-priority-green",
};
const VITALS: { key: string; label: string }[] = [
  { key: "v_hr", label: "Heart rate" },
  { key: "v_rr", label: "Resp. rate" },
  { key: "v_temp", label: "Temperature" },
  { key: "v_spo2", label: "SpO₂" },
  { key: "v_glucose", label: "Glucose" },
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
  if (!ctx) throw new Error("Triage v4 controls must be inside the form.");
  return ctx;
}

const fid = (key: string) => `tv4-${key.replace(/_/g, "-")}`;

function Sel({ k, label, set, hint }: { k: string; label: string; set: string; hint?: string }) {
  const { answers, set: setAnswer, vs, invalid } = useCtx();
  return (
    <Field
      label={label}
      htmlFor={fid(k)}
      hint={hint}
      error={invalid.has(k) ? "Required" : undefined}
    >
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

function Checks({ k, legend, set }: { k: string; legend: string; set: string }) {
  const { answers, set: setAnswer, vs } = useCtx();
  return (
    <fieldset className="mt-2">
      <legend className={GROUP_LABEL}>{legend}</legend>
      <CheckChoices
        options={vs.options(set)}
        value={list(answers, k)}
        onChange={(codes) => setAnswer(k, codes)}
      />
    </fieldset>
  );
}

function YesBox({ k, label }: { k: string; label: string }) {
  const { answers, set: setAnswer } = useCtx();
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-ink-900">
      <input
        type="checkbox"
        checked={str(answers, k) === "yes"}
        onChange={(e) => setAnswer(k, e.target.checked ? "yes" : "")}
      />
      {label}
    </label>
  );
}

function FlagList({ flags: groupFlags }: { flags: TriageV4Config["flags"] }) {
  const { answers, set, vs } = useCtx();
  const flags = list(answers, "flags");
  return (
    <fieldset className="mt-2">
      <legend className="sr-only">Risk flags</legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {groupFlags.map((f) => (
          <label
            key={f.code}
            className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-[13px] ${
              f.level === "RED" || f.level === "ORANGE" ? "bg-priority-red-tint/40" : ""
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={flags.includes(f.code)}
              onChange={(e) =>
                set(
                  "flags",
                  e.target.checked
                    ? [...flags.filter((x) => x !== f.code), f.code]
                    : flags.filter((x) => x !== f.code),
                )
              }
            />
            <span>
              {vs.label("triage-v4-flag", f.code)}
              {f.hint && <span className="block text-[11.5px] text-ink-500">{f.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Group({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="mb-2.5 rounded-lg border border-surface-border bg-surface-card px-[18px] py-4 shadow-sm">
      <h2 className="mb-3 text-[13px] font-bold text-ink-900">
        {title} {aside && <span className="font-normal text-ink-500">· {aside}</span>}
      </h2>
      {children}
    </section>
  );
}

export function TriageFormV4({
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
    const base: TriageAnswers = { ...detail.defaults, ...(stored?.answers ?? {}), schema: "v4" };
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
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Mockup triage timer: "aim 2–5 min".
  useEffect(() => {
    if (readOnly) return;
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
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

  function set(key: string, value: string | string[]) {
    if (readOnly) return;
    const next = { ...answersRef.current, [key]: value };
    answersRef.current = next;
    setAnswers(next);
    if (invalid.has(key)) {
      setInvalid((prev) => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
    }
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 500);
  }

  function setMany(values: TriageAnswers) {
    if (readOnly) return;
    const next = { ...answersRef.current, ...values };
    answersRef.current = next;
    setAnswers(next);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, 500);
  }

  const a = (key: string) => str(answers, key);
  const present = a("b_present");
  const flags = list(answers, "flags");
  const recommended: Priority = evaluation.priority;
  const chosen: Priority = asPriority(a("m_final_priority")) || recommended;
  const override = chosen !== recommended;
  const downgrade = RANK[chosen] < RANK[recommended];
  const safetyRequired = present === "yes" && (chosen === "RED" || chosen === "ORANGE");
  const minor = banner?.age !== null && banner?.age !== undefined && banner.age < 18;
  const ews = evaluation.ews;
  const reasonMin = config?.override_reason_min ?? 10;

  function screen(groupKey: string, groupCode: string, value: string) {
    const updates: TriageAnswers = { [groupKey]: value };
    if (value === "no") {
      const groupFlags = new Set(
        (config?.flags ?? []).filter((f) => f.group === groupCode).map((f) => f.code),
      );
      updates.flags = flags.filter((f) => !groupFlags.has(f));
      if (groupCode === "SELF") {
        updates.suic = "none";
        updates.selfharm = "none";
        updates.prep = "";
        updates.suic_when = "";
      }
    }
    setMany(updates);
  }

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
    if (x < range.soft_min || x > range.soft_max) return { soft: `${range.label} ${raw} is unusual` };
    return {};
  }

  // A render helper, not a component: a component declared in here would remount
  // on every keystroke and lose focus.
  const vitalInput = (k: string, label: string) => {
    const check = vitalCheck(k);
    const unit = config?.vital_ranges[k]?.unit ?? "";
    const nmKey = `nm_${k.slice(2)}`;
    const confirmed = list(answers, "vconf").includes(k);
    return (
      <Field
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
          onChange={(e) => {
            const value = e.target.value;
            setMany({ [k]: value, vconf: list(answersRef.current, "vconf").filter((x) => x !== k) });
          }}
        />
        {check.soft && (
          <label className="flex items-center gap-2 text-[12px] text-priority-orange">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) =>
                set(
                  "vconf",
                  e.target.checked
                    ? [...list(answers, "vconf"), k]
                    : list(answers, "vconf").filter((x) => x !== k),
                )
              }
            />
            {check.soft} — I confirm it was measured correctly
          </label>
        )}
        {!a(k) && (
          <select
            aria-label={`${label} — not measured reason`}
            className={`${INPUT} !py-1 text-xs`}
            value={a(nmKey)}
            onChange={(e) => set(nmKey, e.target.value)}
          >
            <option value="">Measured / not measured?</option>
            {vs.options("triage-v4-not-measured").map((o) => (
              <option key={o.code} value={o.code}>
                Not measured: {o.display}
              </option>
            ))}
          </select>
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
          status: "INITIATED",
        }),
      );
      set("n_actions", []);
    } catch (err) {
      setTaskError(errorText(err, "Tasks not registered — check your connection."));
    }
  }

  const ctx: Ctx = { answers, set, vs, invalid };
  const groups = config?.groups ?? [];
  const groupFlags = (code: string) => (config?.flags ?? []).filter((f) => f.group === code);
  const recActions = new Set(evaluation.recommended_actions ?? []);
  const findings = signed?.findings ?? evaluation.findings;
  const reasonList = evaluation.reason_list ?? [];

  const flagList = (code: string) => <FlagList flags={groupFlags(code)} />;

  const screenQ = (code: string, key: string, question: string, body: ReactNode) => (
    <div key={code} className="border-t border-surface-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${fid(key)}-q`} className="text-[13px] font-semibold text-ink-900">
          {question}
        </span>
        <div
          role="group"
          aria-labelledby={`${fid(key)}-q`}
          id={fid(key)}
          tabIndex={-1}
          className={`inline-flex overflow-hidden rounded-lg border ${invalid.has(key) ? "border-priority-red" : "border-surface-border"}`}
        >
          {(["no", "yes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={a(key) === v}
              className={`px-4 py-1.5 text-[13px] font-semibold ${a(key) === v ? "bg-brand-green text-on-primary" : "bg-surface-card text-ink-900"}`}
              onClick={() => screen(key, code, v)}
            >
              {v === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>
      {a(key) === "yes" && <div className="mt-2 rounded-lg bg-surface-bg px-3 py-3">{body}</div>}
    </div>
  );

  const groupBody: Record<string, ReactNode> = {
    SELF: (
      <>
        <div className={FIELDGRID}>
          <Sel k="suic" label="Suicidal thoughts" set="triage-v4-suicidality" />
          {a("suic") && a("suic") !== "none" && (
            <>
              <Sel k="suic_when" label="When" set="triage-v4-suicidality-when" />
              <Sel k="prep" label="Any preparatory behaviour?" set="triage-v4-preparatory" />
            </>
          )}
          <Sel k="selfharm" label="Recent self-harm / attempt (this episode)" set="triage-v4-self-harm" />
        </div>
        {flagList("SELF")}
        {flags.includes("overdose") && (
          <div className="mt-2">
            <Callout tone="danger">
              <strong>Medical emergency first.</strong> Move to the medical bay. Record what, how
              much, when, with what, and why — these are required.
            </Callout>
            <div className={`${FIELDGRID} mt-2`}>
              <Txt k="od_substance" label="Substance(s)" />
              <Txt k="od_amount" label="Amount" placeholder="or ‘unknown’" />
              <Txt k="od_time" label="Time of ingestion" type="datetime-local" />
              <Txt k="od_coingest" label="Co-ingestants (incl. alcohol)" placeholder="or ‘none known’" />
              <Sel k="od_intent" label="Intent" set="triage-v4-od-intent" />
            </div>
          </div>
        )}
      </>
    ),
    OTHERS: (
      <>
        {flagList("OTHERS")}
        {flags.includes("homicidal_named") && (
          <div className="mt-2">
            <Callout tone="danger">
              <strong>Duty to protect.</strong> Record who is at risk and who has been informed. A
              senior decision on informing the named person and/or police is requested when you
              sign (steps to be confirmed by legal counsel — VERIFY).
            </Callout>
            <div className={`${FIELDGRID} mt-2`}>
              <Txt k="duty_victim" label="Named person at risk (relationship, where)" />
              <Txt k="duty_informed" label="Who in the team has been informed" placeholder="e.g. on-call psychiatrist" />
              <Sel k="duty_police" label="Police informed?" set="triage-v4-duty-police" />
              <Sel k="duty_warned" label="Named person warned?" set="triage-v4-duty-warned" />
            </div>
          </div>
        )}
      </>
    ),
    MEDICAL: flagList("MEDICAL"),
    SAFEGUARDING: (
      <>
        <div className={FIELDGRID}>
          <Sel k="feel_safe" label="Does the client feel safe where they live / are staying?" set="triage-v4-feel-safe" />
          <Txt k="safeguard_note" label="Abuse, exploitation, threat or vulnerability (brief)" placeholder="Ask privately where possible" />
        </div>
        {flagList("SAFEGUARDING")}
        {flags.includes("gbv_72h") && (
          <div className="mt-2">
            <Callout tone="danger">
              <strong>Time-critical:</strong> HIV PEP and emergency contraception have a{" "}
              {config?.pep_window_hours ?? 72} h window from the incident (illustrative — VERIFY
              against the national GBV guideline). Offer a same-gender clinician and a chaperone.
            </Callout>
            <div className={`${FIELDGRID} mt-2`}>
              <Txt k="gbv_incident_at" label="Time of incident (best estimate)" type="datetime-local" />
            </div>
          </div>
        )}
      </>
    ),
  };

  const sexLabel = banner?.sex ? vs.label("sex", banner.sex) : "";
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");

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
        title="What does this person need right now, and how urgently?"
        subtitle="Triage & initial risk screen · short by design — not the full assessment"
        actions={
          <div className="flex items-center gap-2">
            {!readOnly && <Tag>{`${mm}:${ss} · aim 2–5 min`}</Tag>}
            <button type="button" className={BTN_GHOST} onClick={() => navigate("/clinical/triage")}>
              Back to queue
            </button>
          </div>
        }
      />
      {vs.error && <ErrorNote>{vs.error}</ErrorNote>}
      {detail.triage_version > 0 && !readOnly && (
        <Callout className="mb-3">
          <strong>Full re-triage.</strong> Version {detail.triage_version} stays in the record;
          signing creates version {detail.triage_version + 1}.
        </Callout>
      )}

      <FormCtx.Provider value={ctx}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={(e) => e.preventDefault()} aria-label="Triage v4">
            <fieldset disabled={readOnly} className="min-w-0">
              <Callout className="mb-3">
                “I’m going to ask a few quick questions so I can understand what’s happening and
                what help you need right now. What you tell me stays within the care team, unless
                I’m worried about your safety or someone else’s — then I’d tell you first.”
              </Callout>
              {minor && !flags.includes("minor") && !readOnly && (
                <Callout tone="warning" className="mb-3">
                  Registered age is {banner?.age}. Add the <strong>Minor (under 18)</strong> flag?{" "}
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    onClick={() =>
                      setMany({ flags: [...flags, "minor"], screen_safeguarding: "yes" })
                    }
                  >
                    Add flag
                  </button>
                </Callout>
              )}

              <Group title="A — Automatic information" aside="retrieved, not re-asked">
                <p className="text-[13px] text-ink-900">
                  {banner?.name || "Temporary client"} · {banner?.citramac_number || "no number"} ·{" "}
                  {banner?.age ?? "age unknown"} yrs · {sexLabel || "sex not recorded"}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  Existing alerts:{" "}
                  {banner && banner.alerts.length
                    ? banner.alerts.map((x) => x.label).join(" · ")
                    : "none documented"}
                  {detail.priority ? ` · previous priority ${detail.priority}` : ""}
                </p>
                <div className={`${FIELDGRID} mt-3`}>
                  <Sel k="a_allergy_status" label="Allergy status" set="triage-allergy-status" />
                  {a("a_allergy_status") === "known" && (
                    <Txt k="a_allergy_detail" label="Allergies — updates the central allergy record" />
                  )}
                </div>
                {banner && banner.identity_status !== "IDENTIFIED" && (
                  <Link
                    to={`/clinical/registration?resolve=${detail.patient_id}`}
                    className={`${BTN_GHOST} ${BTN_SM} mt-3`}
                  >
                    Resolve identity
                  </Link>
                )}
              </Group>

              <Group title="B / C — First questions">
                <div className={FIELDGRID}>
                  <Sel k="b_informant" label="Who is giving the information?" set="triage-informant" />
                  {a("b_informant") && a("b_informant") !== "client" && (
                    <Txt k="b_third_party" label="Name / relationship (third party)" placeholder="e.g. Sister — Jane" />
                  )}
                  <Field
                    label="Is the client physically present?"
                    htmlFor={fid("b_present")}
                    error={invalid.has("b_present") ? "Required" : undefined}
                  >
                    <div id={fid("b_present")} tabIndex={-1}>
                      <RadioChoices
                        name="b_present"
                        options={vs.options("yes-no")}
                        value={present}
                        onChange={(v) => set("b_present", v)}
                      />
                    </div>
                  </Field>
                  <Sel k="b_encounter_type" label="Encounter type" set="triage-encounter-type" />
                  <Sel
                    k="distress"
                    label={`Distress / behaviour${present === "no" ? " (as described)" : ""}`}
                    set="triage-v4-distress"
                  />
                  <Txt
                    k="where_now"
                    label="Where is the client now?"
                    placeholder={present === "no" ? "Location described by caller" : "e.g. waiting area"}
                  />
                </div>
                <div className="mt-3">
                  <Txt k="c_concern" label="What has happened / what is the main concern right now?" rows={2} />
                </div>
                <div className={`${FIELDGRID} mt-3`}>
                  <Sel k="c_onset" label="When did this begin or become worse?" set="triage-onset" />
                </div>
                {a("b_informant") && (
                  <p className="mt-2 text-[12px] text-ink-500">
                    Findings will be stored with source:{" "}
                    <strong>
                      {a("b_informant") === "client"
                        ? present === "no"
                          ? "Client report (telephone)"
                          : "Client report"
                        : `Third-party report (${vs.label("triage-informant", a("b_informant")).toLowerCase()})`}
                    </strong>
                    {present === "yes" && " · vital signs: Measurement · observations: Clinician observation"}.
                  </p>
                )}
              </Group>

              {!present && (
                <p className="mb-3 rounded-lg border border-dashed border-surface-border px-4 py-3 text-[13px] text-ink-500">
                  Answer “Is the client physically present?” to open the right questions — in-person
                  screen or telephone / third-party triage.
                </p>
              )}

              {present === "yes" && (
                <>
                  <Group title="D–J — Screening questions" aside="one question per area — detail opens only on “Yes”">
                    <Txt k="collateral" label="Collateral informant present?" placeholder="e.g. father present — available for history" />
                    <div className="mt-2">
                      {groups.map((g) => screenQ(g.code, g.key, g.question, groupBody[g.code]))}
                    </div>
                  </Group>

                  <Group title="G — Substances">
                    <div className={FIELDGRID}>
                      <Sel k="subst_recent" label="Recent alcohol / drug use?" set="yes-no-unknown" />
                      {a("subst_recent") === "yes" && (
                        <>
                          <Txt k="subst_last_use" label="Last use (time / how long ago)" />
                          <Sel k="subst_seizure_hx" label="Seizure history (e.g. withdrawal seizures)?" set="yes-no-unknown" />
                        </>
                      )}
                    </div>
                    {a("subst_recent") === "yes" && (
                      <>
                        <Checks k="subst_which" legend="Which substances?" set="triage-v4-substance" />
                        <YesBox
                          k="subst_withdrawal_signs"
                          label="Current withdrawal signs (tremor, sweating, agitation, yawning, gooseflesh…)"
                        />
                      </>
                    )}
                  </Group>

                  <Group title="F — Observation" aside="clinician observation">
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM} mb-2`}
                      onClick={() =>
                        setMany({
                          obsn_orientation: "oriented",
                          obsn_behaviour: "calm",
                          obsn_intox: "none",
                          obsn_injury: "none",
                          obsn_communicate: "able",
                        })
                      }
                    >
                      No observed concerns
                    </button>
                    <div className={FIELDGRID}>
                      <Sel k="obsn_orientation" label="Orientation" set="triage-v4-orientation" />
                      <Sel k="obsn_behaviour" label="Behaviour" set="triage-v4-behaviour" />
                      <Sel k="obsn_intox" label="Intoxication / withdrawal signs" set="triage-v4-intox-signs" />
                      <Sel k="obsn_injury" label="Visible injury" set="triage-v4-visible-injury" />
                      {a("obsn_injury") === "yes" && <Txt k="obsn_injury_desc" label="Describe injury" />}
                      <Sel k="obsn_communicate" label="Ability to communicate" set="triage-v4-communication" />
                    </div>
                  </Group>

                  <Group title="H — Vital signs & early-warning score" aside="unusual values need confirming">
                    <div className={FIELDGRID}>
                      <Sel k="consent_obs" label="Consent to physical observations" set="triage-v4-consent-obs" />
                      <Sel k="chaperone" label="Chaperone" set="triage-v4-chaperone" />
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      {vitalInput("v_hr", "Heart rate")}
                      <Field label="Blood pressure (mmHg)" htmlFor={fid("v_sbp")} error={vitalCheck("v_sbp").error ?? vitalCheck("v_dbp").error}>
                        <div className="flex items-center gap-1.5">
                          <input
                            id={fid("v_sbp")}
                            aria-label="Systolic blood pressure, mmHg"
                            placeholder="sys"
                            inputMode="numeric"
                            className={INPUT}
                            value={a("v_sbp")}
                            onChange={(e) => setMany({ v_sbp: e.target.value, vconf: list(answersRef.current, "vconf").filter((x) => x !== "v_sbp") })}
                          />
                          <span>/</span>
                          <input
                            aria-label="Diastolic blood pressure, mmHg"
                            placeholder="dia"
                            inputMode="numeric"
                            className={INPUT}
                            value={a("v_dbp")}
                            onChange={(e) => setMany({ v_dbp: e.target.value, vconf: list(answersRef.current, "vconf").filter((x) => x !== "v_dbp") })}
                          />
                        </div>
                        {["v_sbp", "v_dbp"].map((k) =>
                          vitalCheck(k).soft ? (
                            <label key={k} className="flex items-center gap-2 text-[12px] text-priority-orange">
                              <input
                                type="checkbox"
                                checked={list(answers, "vconf").includes(k)}
                                onChange={(e) =>
                                  set("vconf", e.target.checked ? [...list(answers, "vconf"), k] : list(answers, "vconf").filter((x) => x !== k))
                                }
                              />
                              {vitalCheck(k).soft} — I confirm it was measured correctly
                            </label>
                          ) : null,
                        )}
                        {!a("v_sbp") && (
                          <select
                            aria-label="Blood pressure — not measured reason"
                            className={`${INPUT} !py-1 text-xs`}
                            value={a("nm_sbp")}
                            onChange={(e) => setMany({ nm_sbp: e.target.value, nm_dbp: e.target.value })}
                          >
                            <option value="">Measured / not measured?</option>
                            {vs.options("triage-v4-not-measured").map((o) => (
                              <option key={o.code} value={o.code}>
                                Not measured: {o.display}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      {VITALS.filter((v) => v.key !== "v_hr").map((v) => (
                        <div key={v.key} className="contents">
                          {vitalInput(v.key, v.label)}
                        </div>
                      ))}
                      <Sel k="v_o2" label="Oxygen" set="triage-v4-oxygen" />
                      <Sel k="acvpu" label="Consciousness (ACVPU)" set="triage-v4-acvpu" hint="Blank means not assessed — never assumed alert." />
                      <Txt k="pupils" label="Pupils" placeholder="e.g. equal, reactive" />
                    </div>
                    <div
                      className={`mt-3 rounded-lg border px-3 py-2 text-[13px] ${ews && ews.complete ? "border-surface-border" : "border-priority-orange"}`}
                      role="status"
                    >
                      <strong>{ews?.label ?? "EWS —"}</strong>{" "}
                      <span className="text-ink-500">
                        {ews && !ews.complete
                          ? "— a partial score can only under-estimate risk"
                          : ews
                            ? `— ${ews.response.text}`
                            : ""}{" "}
                        (illustrative NEWS2-style thresholds — VERIFY)
                      </span>
                    </div>
                  </Group>

                  <Group title="Immediate safety instruction (waiting area)" aside={safetyRequired ? `required for ${chosen}` : "optional"}>
                    <div className={FIELDGRID}>
                      <Sel k="safety_obs" label="Observation level" set="triage-v4-observation-level" />
                      <Sel k="safety_location" label="Where the person waits" set="triage-v4-location" />
                      <Txt k="safety_observer" label="Named observer" placeholder="Who is watching?" />
                      <Sel k="safety_observer_gender" label="Observer gender (if the client has a preference)" set="triage-v4-observer-gender" />
                    </div>
                    <YesBox k="safety_items_checked" label="Belongings checked for items that could cause harm" />
                    {a("safety_items_checked") === "yes" && (
                      <div className={FIELDGRID}>
                        <Txt k="safety_removed" label="What was removed" placeholder="e.g. belt, lighter, medication" />
                        <Txt k="safety_stored" label="Where it is stored" placeholder="e.g. nurses’ station locker 3" />
                      </div>
                    )}
                  </Group>

                  <details className="mb-2.5 rounded-lg border border-surface-border bg-surface-card px-[18px] py-3">
                    <summary className="cursor-pointer text-[13px] font-bold text-ink-900">
                      Trauma-informed preferences <span className="font-normal text-ink-500">· ask, don’t assume — all optional</span>
                    </summary>
                    <div className={`${FIELDGRID} mt-3`}>
                      <Sel k="pref_clinician_gender" label="Preferred clinician gender" set="triage-v4-clinician-gender" />
                      <Txt k="pref_support_person" label="Support person present / wanted" />
                      <Txt k="pref_triggers" label="Known triggers" />
                      <Txt k="pref_feel_safe" label="What helps you feel safe here?" />
                    </div>
                  </details>
                </>
              )}

              {present === "no" && (
                <>
                  <Callout className="mb-3">
                    <strong>Telephone / third-party triage (TRI-K).</strong> Findings are stored as
                    third-party report (or client report by phone) and must be confirmed when the
                    client is seen. This is never an examination — no vital signs.
                  </Callout>
                  <Group title="K — Where and with whom">
                    <div className={FIELDGRID}>
                      <Sel k="r_alone" label="Is the client alone?" set="yes-no-unknown" />
                      <Txt k="r_last_contact" label="When did the caller last see / speak with the client?" />
                    </div>
                    <div className="mt-3">
                      <Txt k="r_said_done" label="What exactly has the client said or done that is causing concern?" rows={2} />
                    </div>
                  </Group>
                  <Group title="K — Risk">
                    <div className={FIELDGRID}>
                      <Sel k="r_suicide" label="Spoken about suicide / self-harm, or a recent attempt?" set="triage-v4-remote-suicide" />
                      <Sel k="r_harm_others" label="Threatened or attempted to harm another person?" set="triage-v4-remote-harm-others" />
                      <Sel k="r_means" label="Known access to means of serious self-harm or harm to others?" set="no-yes-unknown" />
                      <Sel k="r_responsible" label="Is a responsible person physically with them?" set="yes-no-unknown" />
                    </div>
                    <Checks k="r_mental" legend="Caller-described mental state" set="triage-v4-remote-mental" />
                  </Group>
                  <Group title="K — Substances & medical">
                    <Checks k="r_substances" legend="What substances have been used?" set="triage-v4-substance" />
                    <div className={FIELDGRID}>
                      <Txt k="r_last_use" label="When was the last use?" />
                      <Sel k="r_stopped_heavy" label="Recently stopped heavy alcohol / drug use?" set="no-yes-unknown" />
                    </div>
                    <Checks k="r_medical" legend="Caller-described medical concerns" set="triage-v4-remote-medical" />
                  </Group>
                  <Group title="Disposition — can the client be brought safely?">
                    <div className={FIELDGRID}>
                      <Sel k="r_disposition" label="Disposition" set="triage-v4-disposition" />
                      <Txt k="r_callback_at" label="Call-back / expected arrival" type="datetime-local" />
                      <Sel k="r_callback_owner" label="Who will call back (task owner)" set="triage-v4-callback-owner" />
                    </div>
                    <div className="mt-3">
                      <Txt k="r_advice" label="Safety advice given to caller" rows={2} placeholder="e.g. stay with them, remove means, call emergency services if…" />
                    </div>
                  </Group>
                </>
              )}

              <Group title="L — Automatic triage summary" aside="generated, not retyped">
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
                                {cells[3] ? `${formatDateTime(cells[3])} · ${cells[4] ?? ""}` : "On signing"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={4} className={`${TD} !text-ink-500`}>
                            No structured findings yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Group>

              <Group title="N — Immediate action / disposition" aside="recommended actions are suggestions, never auto-confirmed">
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
                  <Txt k="n_owner" label="Responsible person / team" placeholder="Psychiatry / Nursing" />
                  <button type="button" className={`${BTN} justify-self-start`} onClick={onRegisterTasks}>
                    Register as trackable tasks
                  </button>
                </div>
                {taskError && <ErrorNote>{taskError}</ErrorNote>}
                {tasks.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[13px]">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <strong>{t.action_label}</strong> · {t.owner} · {vs.label("task-status", t.status)}
                        {t.due_at ? ` · due ${formatDateTime(t.due_at)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
            </fieldset>
          </form>

          <aside aria-label="Live recommendation" className="xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-3">
                <span className="text-[13px] font-bold">
                  {signed ? "Signed priority" : "System recommends"}
                </span>
                <PriorityPill priority={signed ? signed.final_priority : recommended} long />
              </div>
              <div className="px-4 py-3" role="status" aria-live="polite">
                <p className="mb-2">
                  <Tag tone="warn">
                    {evaluation.ruleset_label ?? "DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF"}
                  </Tag>
                </p>
                <p className="mb-2 text-[12px] text-ink-500">
                  {evaluation.recommendation} · rules {signed?.rules_version ?? evaluation.rules_version}
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
                {present === "yes" && ews && !signed && (
                  <p className={`mt-2 text-[12.5px] font-semibold ${ews.complete ? "" : "text-priority-orange"}`}>
                    {ews.label}
                  </p>
                )}

                {!readOnly && (
                  <>
                    <div className={`${GROUP_LABEL} !mt-4`}>Clinician confirms or overrides</div>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Final priority">
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
                          {p === recommended && <span className="text-[10.5px] font-normal">recommended</span>}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-ink-700">
                      <strong>{chosen} — {MEANING[chosen].title}.</strong> {MEANING[chosen].action}
                    </p>
                    {override && (
                      <div className="mt-3">
                        <Field
                          label={`Override reason — ${downgrade ? "downgrade" : "upgrade"} (required)`}
                          htmlFor={fid("m_override_reason")}
                          error={invalid.has("m_override_reason") ? "A full sentence is required" : undefined}
                          hint={`At least ${reasonMin} characters. Recorded with your name and the time (audit).`}
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
                          <Callout tone="warning" className="mt-2">
                            A downgrade by a clinician who is not a senior (co-signing) clinician sends
                            a co-signature request to the senior when you sign.
                          </Callout>
                        )}
                      </div>
                    )}
                    {safetyRequired && (!a("safety_obs") || !a("safety_location") || !a("safety_observer")) && (
                      <Callout tone="danger" className="mt-3">
                        Required for {chosen}: observation level, where the person waits and a named
                        observer.
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
                    <p className="mt-2 text-[12px] text-ink-500">
                      <Tag>Draft — unsigned</Tag> {draftStatus}
                    </p>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-2`} onClick={saveNow}>
                      Save draft now
                    </button>
                  </>
                )}
                {signed && (
                  <Callout tone="success" className="mt-3">
                    Signed {formatDateTime(signed.signed_at)} by {signed.signed_by} —{" "}
                    {signed.decision === "OVERRIDE" ? `override: ${signed.override_reason}` : "recommendation confirmed"}.
                    Read-only; a correction is a full re-triage (new version).
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
