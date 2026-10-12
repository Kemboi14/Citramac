import type { IntakeSchema } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { SelectChoices } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";

const TEXT_ONLY_EXTRA = [
  { key: "orientation", label: "Orientation (time, place, person)" },
  { key: "attention", label: "Attention test (e.g. months backwards, serial 7s) — result" },
];

/** Section 16 — mental state examination. Stored in the one MSE store
 * (triage.MentalStatusExam); each domain is a served option plus the
 * clinician's own words. */
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
  const fillNormal = () =>
    onPatch(Object.fromEntries(Object.entries(schema.mseNormal).filter(([k]) => !text(k))));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={fillNormal}>
          Fill normal findings
        </button>
        <span className="text-[11px] text-ink-500">
          Only blank domains are filled — edit anything that differs.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {schema.mseDomains.map((domain) => (
          <div key={domain.key} className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor={`mse-${domain.key}`}>
              {domain.label}
            </label>
            {domain.valueset ? (
              <SelectChoices
                id={`mse-${domain.key}-pick`}
                options={vs.options(domain.valueset)}
                placeholder="— pick, or write below —"
                value=""
                onChange={(code) =>
                  onChange(domain.key, vs.label(domain.valueset ?? "", code))
                }
              />
            ) : null}
            <input
              id={`mse-${domain.key}`}
              className={INPUT}
              value={text(domain.key)}
              onChange={(e) => onChange(domain.key, e.target.value)}
            />
          </div>
        ))}
        {TEXT_ONLY_EXTRA.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={FIELD_LABEL} htmlFor={`mse-${f.key}`}>
              {f.label}
            </label>
            <input
              id={`mse-${f.key}`}
              className={INPUT}
              value={text(f.key)}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor="mse-reliability">
            Reliability of account
          </label>
          <SelectChoices
            id="mse-reliability"
            options={vs.options("intake-reliability")}
            placeholder="— select —"
            value={vs.options("intake-reliability").find((o) => o.display === text("reliability"))?.code ?? ""}
            onChange={(code) => onChange("reliability", vs.label("intake-reliability", code))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className={FIELD_LABEL} htmlFor="mse-summary">
          MSE summary / clinically significant findings
        </label>
        <textarea
          id="mse-summary"
          rows={3}
          className={`${INPUT} resize-y`}
          value={text("summary")}
          onChange={(e) => onChange("summary", e.target.value)}
        />
      </div>
    </div>
  );
}
