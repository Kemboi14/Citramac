import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
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
} from "../../../lib/carePathwayApi";
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
import { ToolsSection } from "./intake/ToolsSection";
import type { RecordViewProps } from "./types";

const STATE_MARK: Record<IntakeSectionState, { glyph: string; label: string }> = {
  Complete: { glyph: "✓", label: "complete" },
  "In progress": { glyph: "◐", label: "in progress" },
  "Not applicable": { glyph: "—", label: "not applicable" },
  "Not started": { glyph: "○", label: "not started" },
};

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
  const topRef = useRef<HTMLDivElement>(null);

  const payload: Payload = { sections, section_state: states, current_section: current };
  const save = useCallback(
    async (value: Payload) => {
      if (!accessToken) return;
      const next = await saveIntakeDraft(accessToken, patientId, value);
      setMeta({ outstanding: next.outstanding_now, overview: next.section_overview });
    },
    [accessToken, patientId],
  );
  const autosave = useAutosaveDraft({ value: payload, save, enabled: !signed });

  const spec = schema.sections.find((s) => s.key === current) ?? schema.sections[0];

  const patch = (sectionKey: string, changes: Record<string, unknown>) => {
    setSections((prev) => ({ ...prev, [sectionKey]: { ...(prev[sectionKey] ?? {}), ...changes } }));
    setStates((prev) =>
      (prev[sectionKey] ?? "Not started") === "Not started" ? { ...prev, [sectionKey]: "In progress" } : prev,
    );
  };
  const values = sectionValues(sections, spec.key);
  const onChange = (key: string, value: unknown) => patch(spec.key, { [key]: value });
  const setState = (state: IntakeSectionState) => setStates((prev) => ({ ...prev, [spec.key]: state }));

  const go = (key: string) => {
    setCurrent(key);
    topRef.current?.scrollIntoView({ block: "start" });
  };

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
            <span role="status" className="self-center text-xs text-ink-500">
              {signed
                ? `Signed ${signed.signed_at ? formatDateTime(signed.signed_at) : ""}`
                : autosave.failed
                  ? "Couldn't save — retrying…"
                  : autosave.dirty
                    ? "Saving…"
                    : autosave.savedAt
                      ? `Saved ${autosave.savedAt.toLocaleTimeString()}`
                      : "Draft"}
            </span>
          </>
        }
      />
      <ErrorNote>{error ?? vs.error}</ErrorNote>
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

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[250px_1fr_300px]">
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
            title={`${spec.core ? "" : `Section ${spec.n} · `}${spec.title}`}
            aside={<Tag tone={states[spec.key] === "Complete" ? "brand" : "neutral"}>{states[spec.key] ?? "Not started"}</Tag>}
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
              />
            </fieldset>
            {!signed && spec.key !== "close" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
                <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => setState("Complete")}>
                  Mark section complete
                </button>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setState("Not applicable")}>
                  Not applicable
                </button>
                {states[spec.key] === "Complete" && (
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setState("In progress")}>
                    Re-open
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
        <InformationTrail patientId={patientId} version={listVersion} />
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
}) {
  const sources = (values._sources ?? undefined) as Record<string, { stage?: string; version?: number }> | undefined;
  switch (spec.kind) {
    case "risk":
      return <RiskSection spec={spec} riskRows={schema.riskRows} values={values} vs={vs} onChange={onChange} onPatch={onPatch} />;
    case "meds":
      return <MedsSection patientId={patientId} spec={spec} values={values} vs={vs} onChange={onChange} onListChanged={onRecordChanged} />;
    case "allergy":
      return <AllergySection patientId={patientId} onChanged={onRecordChanged} />;
    case "mse":
      return <MseSection schema={schema} values={values} vs={vs} onChange={onChange} onPatch={onPatch} />;
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
