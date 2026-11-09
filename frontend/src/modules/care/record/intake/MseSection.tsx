import type { IntakeSchema } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, SelectChoices } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";
import { ListTextarea } from "./ListTextarea";

const SPHERES = [
  { key: "orient_time", label: "Time" },
  { key: "orient_place", label: "Place" },
  { key: "orient_person", label: "Person" },
];
// Findings shown in red: they raise risk proposals or psychosis alerts (INT-16).
const ALERTING = new Set([
  "SUICIDAL",
  "HOMICIDAL",
  "AUDITORY_HALLUCINATIONS",
  "VISUAL_HALLUCINATIONS",
]);

const GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: "Observation",
    hint: "How the client presented now",
    keys: ["appearance", "behavior", "rapport", "psychomotor", "speech"],
  },
  {
    title: "Mood & thought",
    hint: "Subjective mood, observed affect, thought and perception",
    keys: ["mood", "affect", "thought_process", "thought_content", "perception"],
  },
  {
    title: "Cognition & judgement",
    hint: "Alertness, memory, insight and decision-making",
    keys: ["cognition", "insight", "judgment", "impulse_control"],
  },
];

type MseDomain = IntakeSchema["mseDomains"][number];

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
    values.findings && typeof values.findings === "object"
      ? (values.findings as Record<string, string[]>)
      : {};
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

  const domainByKey = new Map(schema.mseDomains.map((d) => [d.key, d] as const));
  const sections = GROUPS.map((group) => ({
    ...group,
    domains: group.keys.map((k) => domainByKey.get(k)).filter((d): d is MseDomain => Boolean(d)),
  })).filter((group) => group.domains.length > 0);
  const groupedKeys = new Set(GROUPS.flatMap((g) => g.keys));
  const ungrouped = schema.mseDomains.filter((d) => !groupedKeys.has(d.key));
  if (ungrouped.length > 0) {
    sections.push({
      title: "Additional domains",
      hint: "",
      keys: ungrouped.map((d) => d.key),
      domains: ungrouped,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-500">
          Structured options drive alerts and triggers; notes add context. Records the mental state{" "}
          <strong>now</strong>.
        </p>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={fillNormal}>
          Insert normal MSE (smart phrase)
        </button>
      </div>
      {legacy && (
        <Callout tone="warning">
          This MSE was written as free text before structured findings. The earlier text is kept as
          each domain’s notes — pick the structured findings so alerts and triggers can read them.
        </Callout>
      )}

      <section
        aria-label="Orientation and attention"
        className="rounded-xl border border-surface-border bg-surface-bg/60 p-3.5"
      >
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-700">
          Orientation &amp; attention
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SPHERES.map((s) => (
            <label key={s.key} className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>{s.label}</span>
              <SelectChoices
                options={vs.options("intake-orientation")}
                placeholder="Select…"
                value={text(s.key)}
                onChange={(code) => onChange(s.key, code)}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={FIELD_LABEL}>Attention test — result</span>
            <input
              className={INPUT}
              placeholder="e.g. months backwards, serial 7s"
              value={text("attention")}
              onChange={(e) => onChange("attention", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>Reliability of account</span>
            <SelectChoices
              options={vs.options("intake-reliability")}
              placeholder="Select…"
              value={
                vs
                  .options("intake-reliability")
                  .find((o) => o.code === text("reliability") || o.display === text("reliability"))
                  ?.code ?? ""
              }
              onChange={(code) => onChange("reliability", code)}
            />
          </label>
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} aria-label={section.title} className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-700">
              {section.title}
            </h3>
            {section.hint && <span className="text-[11.5px] text-ink-500">{section.hint}</span>}
          </div>
          <ul
            id={section.title === "Observation" ? "intake-mse-required" : undefined}
            tabIndex={section.title === "Observation" ? -1 : undefined}
            className="grid grid-cols-1 gap-2.5 lg:grid-cols-2"
          >
            {section.domains.map((domain) => (
              <li
                key={domain.key}
                className="flex min-w-0 flex-col gap-2 rounded-xl border border-surface-border bg-surface-bg/50 px-3.5 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink-900">{domain.label}</span>
                  {domain.required && (
                    <span className="rounded-full bg-priority-red-tint px-2 py-0.5 text-[11px] font-semibold text-priority-red">
                      Required
                    </span>
                  )}
                </div>
                {domain.valueset ? (
                  <div
                    role="group"
                    aria-label={`MSE — ${domain.label}`}
                    className="flex flex-wrap gap-1.5"
                  >
                    {vs.options(domain.valueset).map((o) => {
                      const on = picked(domain.key).includes(o.code);
                      return (
                        <button
                          key={o.code}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(domain.key, o.code)}
                          className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                            on
                              ? ALERTING.has(o.code)
                                ? "border-priority-red bg-priority-red-tint text-priority-red"
                                : "border-brand-green bg-brand-green-tint text-brand-green-dark"
                              : "border-surface-border bg-surface-card text-ink-700 hover:border-brand-green/40 hover:text-ink-900"
                          }`}
                        >
                          {o.display}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <input
                  className={`${INPUT} bg-surface-card`}
                  aria-label={`Notes — ${domain.label}`}
                  placeholder={
                    domain.valueset ? "Add note (optional)" : "In the client’s own words"
                  }
                  value={text(domain.key)}
                  onChange={(e) => onChange(domain.key, e.target.value)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {(picked("thought_content").includes("SUICIDAL") ||
        picked("thought_content").includes("HOMICIDAL")) && (
        <Callout tone="danger">
          Thought content is recorded as suicidal / homicidal — a risk proposal is raised for your
          decision in Section 3.
        </Callout>
      )}

      <section
        aria-label="MSE summary"
        className="rounded-xl border border-surface-border bg-surface-bg/60 p-3.5"
      >
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>MSE summary / clinically significant findings</span>
          <ListTextarea
            rows={3}
            value={text("summary")}
            onChange={(value) => onChange("summary", value)}
          />
        </label>
      </section>
    </div>
  );
}
