import type { IntakeSchema } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, SelectChoices } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";

const SPHERES = [
  { key: "orient_time", label: "Orientation — time" },
  { key: "orient_place", label: "Orientation — place" },
  { key: "orient_person", label: "Orientation — person" },
];
// Findings shown in red: they raise risk proposals or psychosis alerts (INT-16).
const ALERTING = new Set(["SUICIDAL", "HOMICIDAL", "AUDITORY_HALLUCINATIONS", "VISUAL_HALLUCINATIONS"]);

/** Section 16 — mental state examination (INT-16). Each domain is structured
 * chips from its served value set plus the clinician's notes; the chips drive
 * alerts and triggers (thought content Suicidal / Homicidal raises a risk
 * proposal), the notes add context. Mirrored into the one MSE store
 * (triage.MentalStatusExam) by the server. */
export function MseSection({
  schema,
  values,
  vs,
  onPatch,
  onChange,
}: {
  schema: IntakeSchema;
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (key: string, value: unknown) => void;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const text = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : "");
  const findings =
    values.findings && typeof values.findings === "object" ? (values.findings as Record<string, string[]>) : {};
  const legacy = !values.findings && schema.mseDomains.some((d) => text(d.key).trim());
  const picked = (domain: string) => findings[domain] ?? [];
  const toggle = (domain: string, code: string) => {
    const current = picked(domain);
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    onChange("findings", { ...findings, [domain]: next });
  };
  const fillNormal = () =>
    onPatch({
      findings,
      ...Object.fromEntries(Object.entries(schema.mseNormal).filter(([k]) => !text(k))),
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-ink-500">
          Structured options drive alerts and triggers; notes add context. The MSE records the mental state{" "}
          <strong>now</strong>.
        </span>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM} ml-auto`} onClick={fillNormal}>
          Insert normal MSE (smart phrase)
        </button>
      </div>
      {legacy && (
        <Callout tone="warning">
          This MSE was written as free text before structured findings. The earlier text is kept as each domain’s
          notes — pick the structured findings so alerts and triggers can read them.
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        {SPHERES.map((s) => (
          <label key={s.key} className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{s.label}</span>
            <SelectChoices
              options={vs.options("intake-orientation")}
              placeholder="— select —"
              value={text(s.key)}
              onChange={(code) => onChange(s.key, code)}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={FIELD_LABEL}>Attention test (e.g. months backwards, serial 7s) — result</span>
          <input className={INPUT} value={text("attention")} onChange={(e) => onChange("attention", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Reliability of account</span>
          <SelectChoices
            options={vs.options("intake-reliability")}
            placeholder="— select —"
            value={vs.options("intake-reliability").find((o) => o.code === text("reliability") || o.display === text("reliability"))?.code ?? ""}
            onChange={(code) => onChange("reliability", code)}
          />
        </label>
      </div>
      {/* Mockup `.msedom`: label | structured options | notes on one row at desktop width. */}
      <ul className="flex flex-col divide-y divide-surface-border border-b border-surface-border">
        {schema.mseDomains.map((domain) => (
          <li
            key={domain.key}
            className="grid grid-cols-1 items-start gap-2.5 py-2.5 lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,.8fr)]"
          >
            <div className="text-[13px] font-semibold text-ink-900 lg:pt-1.5">
              {domain.label}
              {domain.required && <span className="ml-1.5 text-xs font-semibold text-priority-red">Required</span>}
            </div>
            {domain.valueset ? (
              <div role="group" aria-label={`MSE — ${domain.label}`} className="flex flex-wrap gap-1.5">
                {vs.options(domain.valueset).map((o) => {
                  const on = picked(domain.key).includes(o.code);
                  return (
                    <button
                      key={o.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(domain.key, o.code)}
                      className={`rounded-md border px-2 py-1 text-[12px] font-medium ${
                        on
                          ? ALERTING.has(o.code)
                            ? "border-priority-red bg-priority-red-tint text-priority-red"
                            : "border-brand-green bg-brand-green-tint text-brand-green-dark"
                          : ALERTING.has(o.code)
                            ? "border-surface-border text-priority-red"
                            : "border-surface-border text-ink-900"
                      }`}
                    >
                      {o.display}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span aria-hidden="true" />
            )}
            <input
              className={INPUT}
              aria-label={`Notes — ${domain.label}`}
              placeholder={domain.valueset ? "Clinical notes" : "In the client’s own words"}
              value={text(domain.key)}
              onChange={(e) => onChange(domain.key, e.target.value)}
            />
          </li>
        ))}
      </ul>
      {(picked("thought_content").includes("SUICIDAL") || picked("thought_content").includes("HOMICIDAL")) && (
        <Callout tone="danger">
          Thought content is recorded as suicidal / homicidal — a risk proposal is raised for your decision in Section 3.
        </Callout>
      )}
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>MSE summary / clinically significant findings</span>
        <textarea rows={3} className={`${INPUT} resize-y`} value={text("summary")} onChange={(e) => onChange("summary", e.target.value)} />
      </label>
    </div>
  );
}
