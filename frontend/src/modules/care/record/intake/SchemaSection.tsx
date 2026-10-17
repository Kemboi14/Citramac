import type { IntakeField, IntakeSectionSpec } from "../../../../lib/carePathwayApi";
import { GROUP_LABEL } from "../../shared/styles";
import type { ValueSetsApi } from "../../shared/useValueSets";
import { FieldControl, type SectionValues } from "./fields";

const GRID = "grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2";

/** Renders every field of a section from the served schema. `skip` hides
 * fields a specialised section draws itself; a `show_when` field is shown only
 * while its controlling answer allows it, and is cleared when hidden (X-08). */
export function SchemaSection({
  spec,
  values,
  vs,
  onChange,
  skip = [],
  sources,
}: {
  spec: IntakeSectionSpec;
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (fieldKey: string, value: unknown) => void;
  skip?: string[];
  sources?: Record<string, { stage?: string; version?: number } | undefined>;
}) {
  const visible = (f: IntakeField) =>
    !f.show_when || f.show_when.in.includes(String(values[f.show_when.field] ?? ""));
  const fields = spec.fields.filter((f) => !skip.includes(f.key) && visible(f));
  const change = (key: string, value: unknown) => {
    onChange(key, value);
    for (const dependent of spec.fields) {
      if (dependent.show_when?.field === key && !dependent.show_when.in.includes(String(value ?? ""))) {
        onChange(dependent.key, undefined);
      }
    }
  };
  const groups: { name: string; fields: IntakeField[] }[] = [];
  for (const field of fields) {
    const name = field.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.fields.push(field);
    else groups.push({ name, fields: [field] });
  }
  return (
    <div>
      {groups.map((group, index) => (
        <div key={`${group.name}-${index}`}>
          {group.name && <div className={GROUP_LABEL}>{group.name}</div>}
          <div className={GRID}>
            {group.fields.map((field) => {
              // eslint-disable-next-line security/detect-object-injection -- schema key.
              const source = sources?.[field.key];
              return (
                <FieldControl
                  key={field.key}
                  idPrefix={`intake-${spec.key}`}
                  field={field}
                  value={values[field.key]}
                  vs={vs}
                  onChange={(value) => change(field.key, value)}
                  carriedFrom={source ? `${source.stage ?? "an earlier step"}${source.version ? ` v${source.version}` : ""}` : undefined}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
