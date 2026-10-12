import type { IntakeField, IntakeSections } from "../../../../lib/carePathwayApi";
import { FIELD_LABEL, INPUT } from "../../shared/styles";
import { CheckChoices, SelectChoices } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";

export type SectionValues = Record<string, unknown>;

export function sectionValues(sections: IntakeSections, key: string): SectionValues {
  // eslint-disable-next-line security/detect-object-injection -- keys come from the served schema.
  return sections[key] ?? {};
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) => (Array.isArray(value) ? (value as string[]) : []);

/** One schema-driven control: label + input bound to a section value. */
export function FieldControl({
  idPrefix,
  field,
  value,
  vs,
  onChange,
  carriedFrom,
}: {
  idPrefix: string;
  field: IntakeField;
  value: unknown;
  vs: ValueSetsApi;
  onChange: (value: unknown) => void;
  /** Where a pre-filled value came from (Registration / Triage), shown as a chip. */
  carriedFrom?: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  const wide = field.full || field.type === "multi" || field.type === "textarea";
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = (
        <textarea
          id={id}
          rows={field.rows ?? 2}
          className={`${INPUT} resize-y`}
          value={text(value)}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "select":
      control = (
        <SelectChoices
          id={id}
          options={vs.options(field.valueset ?? "")}
          placeholder="— select —"
          value={text(value)}
          onChange={onChange}
        />
      );
      break;
    case "multi": {
      const options = vs.options(field.valueset ?? "");
      control = (
        <CheckChoices
          options={options}
          value={list(value)}
          onChange={onChange}
          columns={options.length > 6 ? 2 : undefined}
        />
      );
      break;
    }
    case "check":
      control = (
        <label className="flex items-center gap-2 text-[13px] text-ink-900">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );
      break;
    default:
      control = (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type={
              field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text"
            }
            className={INPUT}
            value={text(value)}
            required={field.required}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.unit && <span className="text-xs text-ink-500">{field.unit}</span>}
        </div>
      );
  }
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      {field.type !== "check" && (
        <label htmlFor={id} className={FIELD_LABEL}>
          {field.label}
          {field.required && <span className="ml-1 text-priority-red">*</span>}
          {field.restricted && (
            <span className="ml-1.5 rounded bg-priority-orange-tint px-1 text-[10px] text-priority-orange">
              restricted
            </span>
          )}
        </label>
      )}
      {control}
      {carriedFrom && (
        <p className="text-[11px] text-brand-green">✓ Pre-filled from {carriedFrom} — confirm or update</p>
      )}
      {field.hint && <p className="text-[11px] text-ink-500">{field.hint}</p>}
    </div>
  );
}
