import { Clock } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  getClientTools,
  getIntakeSchema,
  listIntakeAssessments,
  openIntakeDraft,
  saveIntakeDraft,
  signIntake,
  type IntakeAssessment,
  type IntakeDraft,
  type IntakeSchema,
  type IntakeSectionSpec,
  type IntakeSectionState,
  type IntakeSections,
  type ToolRow,
} from "../../../lib/carePathwayApi";
import { FindingsPanel } from "../shared/FindingsPanel";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL } from "../shared/styles";
import { Callout, Card, ErrorNote, PageHeader, Tag } from "../shared/ui";
import { useAutosaveDraft } from "../shared/useAutosaveDraft";
import { useValueSets } from "../shared/useValueSets";
import { errorText } from "../triage/helpers";
import { InformationTrail } from "./InformationTrail";
import { IntakeDiagnosisTab } from "./IntakeDiagnosisTab";
import { AllergySection } from "./intake/AllergySection";
import { sectionValues } from "./intake/fields";
import { MedsSection } from "./intake/MedsSection";
import { MseSection } from "./intake/MseSection";
import { RiskSection } from "./intake/RiskSection";
import { SchemaSection } from "./intake/SchemaSection";
import { SubstanceSection } from "./intake/SubstanceSection";
import { ToolsSection } from "./intake/ToolsSection";
import { TriggerHint } from "./intake/TriggerHint";
import type { RecordViewProps } from "./types";

const STATE_MARK: Record<IntakeSectionState, { glyph: string; label: string }> = {
  Complete: { glyph: "✓", label: "complete" },
  "In progress": { glyph: "◐", label: "in progress" },
  "Not applicable": { glyph: "—", label: "not applicable" },
  "Not started": { glyph: "○", label: "not started" },
};

// INT-04-07 / 04-08: Section 4 "Yes" links "Past history" onto the Section 3 risk row.
// Mirrors intake._link_past_history on the server so the register updates at once.
const PAST_HISTORY_LINKS: Record<string, string> = { past_attempts: "suicide", past_violence: "violence" };
const PAST_HISTORY = "Past history";

function linkPastHistory(sections: IntakeSections, field: string, value: unknown): IntakeSections {
  // eslint-disable-next-line security/detect-object-injection -- fixed key map.
  const row = PAST_HISTORY_LINKS[field];
  const risk = (sections.risk ?? {}) as Record<string, unknown>;
  const rows = { ...((risk.rows as Record<string, string[]>) ?? {}) };
  const linked = { ...((risk.linked as Record<string, unknown>) ?? {}) };
  const key = `${row}:${PAST_HISTORY}`;
  // eslint-disable-next-line security/detect-object-injection -- risk row key.
  const chosen = rows[row] ?? [];
  if (value === "YES") {
    if (chosen.includes(PAST_HISTORY)) return sections;
    // eslint-disable-next-line security/detect-object-injection -- risk row key.
    rows[row] = [...chosen, PAST_HISTORY];
    // eslint-disable-next-line security/detect-object-injection -- composed key.
    linked[key] = { from: `mh.${field}` };
  } else if (key in linked) {
    // eslint-disable-next-line security/detect-object-injection -- risk row key.
    rows[row] = chosen.filter((o) => o !== PAST_HISTORY);
    // eslint-disable-next-line security/detect-object-injection -- composed key.
    delete linked[key];
  } else {
    return sections;
  }
  return { ...sections, risk: { ...risk, rows, linked } };
}

interface Payload {
  sections: IntakeSections;
  section_state: Record<string, IntakeSectionState>;
  current_section: string;
}

/**
 * Intake & Clinical Assessment — mockup v4 stage 3. Rendered from the served
 * section schema (GET care/intake/schema/); a draft autosaves to the server
 * (never browser storage, CLAUDE.md §5) and signing locks the version. What
 * Registration and Triage captured is pre-populated with its source.
 */
export function IntakeStage(props: RecordViewProps) {
  const { accessToken } = useAuth();
  const [schema, setSchema] = useState<IntakeSchema | null>(null);
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [previous, setPrevious] = useState<IntakeAssessment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([
      getIntakeSchema(accessToken),
      openIntakeDraft(accessToken, props.patientId),
      listIntakeAssessments(accessToken, props.patientId),
    ])
      .then(([s, d, p]) => {
        if (cancelled) return;
        setSchema(s);
        setDraft(d);
        setPrevious(p.results.filter((i) => i.status === "SIGNED"));
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load the intake.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, props.patientId, reload]);

  if (!schema || !draft) {
    return (
      <div>
        <PageHeader
          title="Intake & Clinical Assessment"
          subtitle="Comprehensive clinical understanding — pre-populated from Registration & Triage"
        />
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading assessment…</p>}
      </div>
    );
  }
  return (
    <IntakeWorkspace
      key={draft.id}
      {...props}
      schema={schema}
      initial={draft}
      previous={previous}
      onNewVersion={() => setReload((n) => n + 1)}
    />
  );
}

// Intake risk-register rows → the shared finding each confirms (mirrors
// backend intake.CARRIED_FINDING_KEYS): those are confirmed in Section 3 when
// the intake is signed, so the findings panel does not ask a second time.
const CARRIED_FINDING_KEYS: Record<string, string> = {
  suicide: "SUICIDE_SELF_HARM",
  violence: "HARM_TO_OTHERS",
  safeguarding: "SAFEGUARDING",
  neglect: "SAFEGUARDING",
  medical: "MEDICAL",
};

function reviewedInIntake(sections: IntakeSections): Map<string, string> {
  // The presenting concern is carried into Section 1 with its source.
  const where = new Map([["PRESENTING_CONCERN", "Confirm or update in Section 1"]]);
  const risk = (sections.risk ?? {}) as { carried?: Record<string, unknown> };
  for (const item of Object.keys(risk.carried ?? {})) {
    const key =
      item === "neglect:Difficulty with self-care"
        ? "FUNCTIONAL"
        : CARRIED_FINDING_KEYS[item.split(":")[0]];
    if (key) where.set(key, "Confirm in Section 3 Risk");
  }
  return where;
}

function IntakeWorkspace({
  patientId,
  banner,
  onRecordChanged,
  schema,
  initial,
  previous,
  onNewVersion,
}: RecordViewProps & {
  schema: IntakeSchema;
  initial: IntakeDraft;
  previous: IntakeAssessment[];
  onNewVersion: () => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [sections, setSections] = useState<IntakeSections>(initial.sections);
  const [states, setStates] = useState<Record<string, IntakeSectionState>>(initial.section_overview);
  const [current, setCurrent] = useState(initial.current_section || "pres");
  const [meta, setMeta] = useState({ outstanding: initial.outstanding_now, overview: initial.section_overview });
  const [signed, setSigned] = useState<IntakeDraft | null>(initial.status === "SIGNED" ? initial : null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  // Mockup: the Information trail opens from a "Trail" button, so the section
  // form keeps the full width by default.
  const [showTrail, setShowTrail] = useState(false);
  const trailId = useId();
  const topRef = useRef<HTMLDivElement>(null);

  const payload: Payload = { sections, section_state: states, current_section: current };
  const save = useCallback(
    async (value: Payload) => {
      if (!accessToken) return;
      const next = await saveIntakeDraft(accessToken, patientId, value);
      setMeta({ outstanding: next.outstanding_now, overview: next.section_overview });
      // The server owns the risk-formulation signature and the carried-finding stamps.
      const serverRisk = next.sections?.risk ?? {};
      setSections((prev) => ({
        ...prev,
        risk: {
          ...(prev.risk ?? {}),
          formulation_signed_at: serverRisk.formulation_signed_at ?? "",
          formulation_signed_by: serverRisk.formulation_signed_by ?? "",
          carried: serverRisk.carried ?? prev.risk?.carried,
        },
      }));
    },
    [accessToken, patientId],
  );
  const autosave = useAutosaveDraft({ value: payload, save, enabled: !signed });

  // Tool triggers are computed on the server from the saved draft, so they are
  // re-read after each autosave and on every section change.
  const [toolRows, setToolRows] = useState<ToolRow[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const savedAtMs = autosave.savedAt?.getTime() ?? 0;
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getClientTools(accessToken, patientId)
      .then((r) => {
        if (cancelled) return;
        setToolRows(r.results);
        setToolsError(null);
      })
      .catch((e) => !cancelled && setToolsError(errorText(e, "Couldn't load the assessment-tool triggers.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, savedAtMs, current]);

  const spec = schema.sections.find((s) => s.key === current) ?? schema.sections[0];

  const patch = (sectionKey: string, changes: Record<string, unknown>) => {
    setSections((prev) => ({ ...prev, [sectionKey]: { ...(prev[sectionKey] ?? {}), ...changes } }));
    setStates((prev) =>
      (prev[sectionKey] ?? "Not started") === "Not started" ? { ...prev, [sectionKey]: "In progress" } : prev,
    );
  };
  const values = sectionValues(sections, spec.key);
  const onChange = (key: string, value: unknown) => {
    patch(spec.key, { [key]: value });
    if (spec.key === "mh" && key in PAST_HISTORY_LINKS) setSections((prev) => linkPastHistory(prev, key, value));
  };
  const setState = (state: IntakeSectionState) => setStates((prev) => ({ ...prev, [spec.key]: state }));
  const stateOf = (key: string) => (states[key] ?? meta.overview[key] ?? "Not started") as IntakeSectionState;

  const go = (key: string) => {
    setCurrent(key);
    topRef.current?.scrollIntoView({ block: "start" });
  };
  const index = schema.sections.findIndex((s) => s.key === spec.key);
  const prevSpec = index > 0 ? schema.sections[index - 1] : null;
  const nextSpec = index < schema.sections.length - 1 ? schema.sections[index + 1] : null;
  // Mark done, then move on to the next section of the same group that is not yet
  // complete (mockup: "Mark Section N done").
  const markDone = () => {
    setState("Complete");
    const after = schema.sections.slice(index + 1);
    const target =
      after.find((s) => s.core === spec.core && !["Complete", "Not applicable"].includes(stateOf(s.key))) ?? nextSpec;
    if (target) go(target.key);
  };
  const sectionName = (s: IntakeSectionSpec) => `Section ${s.n}`;
  const saveState = signed
    ? `Signed ${signed.signed_at ? formatDateTime(signed.signed_at) : ""}`
    : autosave.failed
      ? "Couldn't save — retrying…"
      : autosave.dirty
        ? "Saving…"
        : autosave.savedAt
          ? `Draft saved ${autosave.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "Draft not yet saved";

  async function sign(completeness: "COMPLETE" | "PARTIAL" | "UNABLE") {
    if (!accessToken) return;
    setSigning(true);
    setError(null);
    try {
      await saveIntakeDraft(accessToken, patientId, payload);
      const result = await signIntake(accessToken, patientId, completeness);
      setSigned(result);
      setListVersion((v) => v + 1);
      onRecordChanged();
    } catch (e) {
      const fields = (e as { fields?: Record<string, unknown> })?.fields;
      const outstanding = Array.isArray(fields?.outstanding) ? (fields?.outstanding as string[]) : [];
      setError(
        outstanding.length
          ? `${errorText(e, "Can't sign.")} Outstanding: ${outstanding.join("; ")}`
          : errorText(e, "Couldn't sign the intake."),
      );
    } finally {
      setSigning(false);
    }
  }

  const groups: [string, IntakeSectionSpec[]][] = [
    ["Core sections", schema.sections.filter((s) => s.core)],
    ["Extended sections", schema.sections.filter((s) => !s.core)],
  ];

  return (
    <div ref={topRef}>
      <PageHeader
        title="Intake & Clinical Assessment"
        subtitle={`Version ${initial.version} · Registration and Triage data pre-populated — confirm or update, don’t re-ask`}
        actions={
          <>
            <button type="button" className={BTN_GHOST} aria-expanded={showPrevious} onClick={() => setShowPrevious((v) => !v)}>
              Previous assessments
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              aria-expanded={showTrail}
              aria-controls={trailId}
              onClick={() => setShowTrail((v) => !v)}
            >
              <Clock aria-hidden="true" className="h-4 w-4" />
              Trail
            </button>
          </>
        }
      />
      <ErrorNote>{error ?? vs.error ?? toolsError}</ErrorNote>
      {signed && (
        <Callout tone="success" role="status" className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Intake v{signed.version} signed
              {signed.completeness !== "COMPLETE" ? ` — ${signed.completeness.toLowerCase()}, handover recorded` : ""}. It is now
              locked; a correction is a new version.
            </span>
            <button type="button" className={BTN} onClick={onNewVersion}>
              Start a new version
            </button>
          </div>
        </Callout>
      )}
      {showPrevious && (
        <Card title="Previous assessments" className="mb-4">
          {previous.length === 0 ? (
            <p className="text-[13px] text-ink-500">No signed assessments yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-surface-border" key={listVersion}>
              {previous.map((i) => (
                <li key={i.id} className="py-2 text-[13px]">
                  <span className="font-semibold">v{i.version}</span> · {i.signed_at ? formatDateTime(i.signed_at) : formatDateTime(i.created_at)} ·{" "}
                  {i.author_name || "Author not recorded"}
                  {i.presenting_concern && <div className="text-ink-500">{i.presenting_concern}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <FindingsPanel
        patientId={patientId}
        stage="INTAKE"
        readOnly={Boolean(signed)}
        reviewedElsewhere={reviewedInIntake(sections)}
      />

      <div
        className={`grid grid-cols-1 items-start gap-4 lg:grid-cols-[250px_1fr] ${
          showTrail ? "2xl:grid-cols-[250px_1fr_300px]" : ""
        }`}
      >
        <nav aria-label="Intake sections" className="flex flex-col gap-3">
          {groups.map(([title, specs]) => {
            const done = specs.filter((s) => ["Complete", "Not applicable"].includes(states[s.key] ?? meta.overview[s.key] ?? "")).length;
            return (
              <details key={title} open={title.startsWith("Core") || !spec.core}>
                <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  {title} · {done}/{specs.length}
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {specs.map((s) => {
                    const st = (states[s.key] ?? meta.overview[s.key] ?? "Not started") as IntakeSectionState;
                    const mark = STATE_MARK[st];
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          aria-current={current === s.key}
                          aria-label={`${s.core ? "" : `Section ${s.n} · `}${s.title} — ${mark.label}${s.required ? ", required" : ""}`}
                          onClick={() => go(s.key)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                            current === s.key ? "bg-brand-green-tint font-semibold text-brand-green-dark" : "text-ink-900 hover:bg-surface-bg"
                          }`}
                        >
                          <span aria-hidden className="w-4 text-center">{mark.glyph}</span>
                          <span className="flex-1">
                            {s.title}
                            {s.required && <span className="ml-0.5 text-priority-red">*</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </nav>

        <div className="min-w-0">
          <Card
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Section {spec.n} · {spec.title}{" "}
                  <span className="text-[11px] font-semibold text-ink-500">{spec.core ? "Core" : "Extended"}</span>
                </span>
                <Tag tone={stateOf(spec.key) === "Complete" ? "brand" : stateOf(spec.key) === "In progress" ? "warn" : "neutral"}>
                  {STATE_MARK[stateOf(spec.key)].glyph} {stateOf(spec.key)}
                </Tag>
              </span>
            }
            aside={
              !signed && spec.key !== "close" ? (
                <span className="flex flex-wrap gap-2">
                  {/* Only an optional section nobody has started can be set aside. */}
                  {!spec.required && stateOf(spec.key) === "Not started" && (
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setState("Not applicable")}>
                      Not applicable
                    </button>
                  )}
                  {["Complete", "Not applicable"].includes(stateOf(spec.key)) && (
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setState("In progress")}>
                      Re-open section
                    </button>
                  )}
                </span>
              ) : undefined
            }
          >
            <fieldset disabled={Boolean(signed)} className="min-w-0 border-0 p-0">
              <SectionBody
                spec={spec}
                schema={schema}
                patientId={patientId}
                encounterId={banner.psychiatry_encounter_id}
                values={values}
                vs={vs}
                onChange={onChange}
                onPatch={(changes) => patch(spec.key, changes)}
                draft={initial}
                meta={meta}
                onSign={sign}
                signing={signing}
                onRecordChanged={onRecordChanged}
                toolRows={toolRows}
                onOpenTools={() => go("tools")}
              />
            </fieldset>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
              <span role="status" className="mr-auto text-xs text-ink-500">
                {saveState}
              </span>
              {prevSpec && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => go(prevSpec.key)}>
                  ← {sectionName(prevSpec)}
                </button>
              )}
              {!signed && spec.key !== "close" && stateOf(spec.key) !== "Complete" && (
                <button type="button" className={`${BTN} ${BTN_SM}`} onClick={markDone}>
                  ✓ Mark Section {spec.n} done
                </button>
              )}
              {nextSpec && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => go(nextSpec.key)}>
                  {sectionName(nextSpec)} →
                </button>
              )}
            </div>
          </Card>
        </div>
        {showTrail && (
          <div id={trailId} className="order-first lg:col-span-2 2xl:order-none 2xl:col-span-1">
            <InformationTrail patientId={patientId} version={listVersion} />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBody({
  spec,
  schema,
  patientId,
  encounterId,
  values,
  vs,
  onChange,
  onPatch,
  draft,
  meta,
  onSign,
  signing,
  onRecordChanged,
  toolRows,
  onOpenTools,
}: {
  spec: IntakeSectionSpec;
  schema: IntakeSchema;
  patientId: string;
  encounterId: string | null;
  values: Record<string, unknown>;
  vs: ReturnType<typeof useValueSets>;
  onChange: (key: string, value: unknown) => void;
  onPatch: (changes: Record<string, unknown>) => void;
  draft: IntakeDraft;
  meta: { outstanding: string[] };
  onSign: (completeness: "COMPLETE" | "PARTIAL" | "UNABLE") => void;
  signing: boolean;
  onRecordChanged: () => void;
  toolRows: ToolRow[] | null;
  onOpenTools: () => void;
}) {
  const hint = (keys: string[]) => <TriggerHint rows={toolRows} keys={keys} onOpen={onOpenTools} />;
  const sources = (values._sources ?? undefined) as Record<string, { stage?: string; version?: number }> | undefined;
  switch (spec.kind) {
    case "risk":
      return (
        <RiskSection
          spec={spec}
          riskRows={schema.riskRows}
          values={values}
          vs={vs}
          onChange={onChange}
          onPatch={onPatch}
          triggers={hint(["SRA", "SAFETY", "SAFEGUARD"])}
        />
      );
    case "meds":
      return <MedsSection patientId={patientId} spec={spec} values={values} vs={vs} onChange={onChange} onListChanged={onRecordChanged} />;
    case "allergy":
      return <AllergySection patientId={patientId} vs={vs} onChanged={onRecordChanged} />;
    case "mse":
      return <MseSection schema={schema} values={values} vs={vs} onChange={onChange} onPatch={onPatch} />;
    case "substances":
      return (
        <SubstanceSection
          spec={spec}
          values={values}
          vs={vs}
          onChange={onChange}
          triggers={hint(["PAWSS", "AUDITC"])}
          auditC={toolRows?.find((row) => row.key === "AUDITC") ?? null}
          onOpenTools={onOpenTools}
        />
      );
    case "tools":
      return <ToolsSection patientId={patientId} onChanged={onRecordChanged} />;
    case "formulation":
      return (
        <div className="flex flex-col gap-4">
          <Callout>
            <strong>This is not a repeat of the history.</strong> Connect presenting problems,
            predisposing, precipitating, perpetuating and protective factors, risks and strengths.
          </Callout>
          <SchemaSection spec={spec} values={values} vs={vs} onChange={onChange} />
          <IntakeDiagnosisTab patientId={patientId} encounterId={encounterId} onChanged={onRecordChanged} />
        </div>
      );
    case "close":
      return <CloseSection spec={spec} values={values} vs={vs} onChange={onChange} outstanding={meta.outstanding} onSign={onSign} signing={signing} draft={draft} />;
    default:
      if (spec.key === "sx") {
        // Mockup: the triggered chips sit right under the symptom list.
        const at = spec.fields.findIndex((f) => f.key === "list") + 1;
        return (
          <div>
            <SchemaSection spec={{ ...spec, fields: spec.fields.slice(0, at) }} values={values} vs={vs} onChange={onChange} sources={sources} />
            {hint(["PHQ9", "PHQA", "GAD7", "MDQ", "PCL5"])}
            <div className="mt-3">
              <SchemaSection spec={{ ...spec, fields: spec.fields.slice(at) }} values={values} vs={vs} onChange={onChange} sources={sources} />
            </div>
          </div>
        );
      }
      if (spec.key === "trauma") {
        return (
          <div>
            <SchemaSection spec={spec} values={values} vs={vs} onChange={onChange} sources={sources} />
            {hint(["PCL5", "SAFEGUARD"])}
          </div>
        );
      }
      return <SchemaSection spec={spec} values={values} vs={vs} onChange={onChange} sources={sources} />;
  }
}

function CloseSection({
  spec,
  values,
  vs,
  onChange,
  outstanding,
  onSign,
  signing,
}: {
  spec: IntakeSectionSpec;
  values: Record<string, unknown>;
  vs: ReturnType<typeof useValueSets>;
  onChange: (key: string, value: unknown) => void;
  outstanding: string[];
  onSign: (c: "COMPLETE" | "PARTIAL" | "UNABLE") => void;
  signing: boolean;
  draft: IntakeDraft;
}) {
  const status = typeof values.status === "string" ? values.status : "";
  const completeness = status.startsWith("COMPLETE") ? "COMPLETE" : status.startsWith("PARTIAL") ? "PARTIAL" : status.startsWith("UNABLE") ? "UNABLE" : null;
  return (
    <div className="flex flex-col gap-3">
      {outstanding.length ? (
        <Callout tone="warning">
          <strong>{outstanding.length} item(s) outstanding for a complete intake:</strong>
          <ul className="mt-1 list-disc pl-5">
            {outstanding.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Callout>
      ) : (
        <Callout tone="success">All required items are recorded — the intake can be signed as complete.</Callout>
      )}
      <SchemaSection
        spec={{ ...spec, fields: spec.fields.filter((f) => f.key !== "reason_incomplete" || (completeness && completeness !== "COMPLETE")) }}
        values={values}
        vs={vs}
        onChange={onChange}
      />
      <div>
        <span className={FIELD_LABEL}>Clinician signing</span>
        <p className="text-[13px] text-ink-900">Your name and the time are recorded when you sign.</p>
      </div>
      <div>
        <button type="button" className={BTN} disabled={!completeness || signing} onClick={() => completeness && onSign(completeness)}>
          {signing ? "Signing…" : "Sign intake"}
        </button>
      </div>
    </div>
  );
}
