import { useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import type { DocInputs, DynamicBlock, RecipientRule, UserField } from "../../../lib/documentsApi";
import { searchLoinc, type LoincCode } from "../../../lib/limsApi";
import { BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { CheckChoices, Field, SelectChoices } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { useDocCatalogue } from "./useDocCatalogue";

// Clinician-entered fields of a document (DOC-SPEC #5) — only what the record
// cannot supply. Recipient person / organisation / purpose are edited by the
// caller; every other field is rendered from the template's `userEntered`.

const RECIPIENT_KEYS = ["recipient_name", "recipient_organization", "purpose"];

export interface RecipientValues {
  recipient_type: string;
  recipient_name: string;
  recipient_organization: string;
  purpose: string;
}

interface MonitoringEntry {
  item_id: string;
  indication?: string;
  codes: string[];
}

export function DocumentInputsForm({
  idPrefix,
  fields,
  recipientTypes,
  rules,
  recipient,
  onRecipient,
  inputs,
  onInputs,
  missing = [],
  dynamic = [],
  disabled,
}: {
  idPrefix: string;
  fields: UserField[];
  recipientTypes: string[];
  rules: Record<string, RecipientRule>;
  recipient: RecipientValues;
  onRecipient: (update: (prev: RecipientValues) => RecipientValues) => void;
  inputs: DocInputs;
  onInputs: (update: (prev: DocInputs) => DocInputs) => void;
  missing?: string[];
  dynamic?: DynamicBlock[];
  disabled?: boolean;
}) {
  const vs = useValueSets();
  const { catalogue, className, recipientLabel } = useDocCatalogue();
  const rule = Object.entries(rules).find(([code]) => code === recipient.recipient_type)?.[1];
  const external = rule?.external ?? false;
  const set = (key: string, value: unknown) => onInputs((prev) => ({ ...prev, [key]: value }));
  const text = (key: string) => {
    // eslint-disable-next-line security/detect-object-injection -- template field key.
    const value = inputs[key];
    return typeof value === "string" ? value : "";
  };
  const err = (key: string) => (missing.includes(key) ? "Required" : undefined);
  const monitoringBlock = dynamic.find((b) => b.rule === "DOC-CI-07");
  const referralBlock = dynamic.find((b) => b.rule === "DOC-CI-08");

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
      <Field label="Recipient type" htmlFor={`${idPrefix}-rt`}>
        <select
          id={`${idPrefix}-rt`}
          className={INPUT}
          value={recipient.recipient_type}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value;
            onRecipient((prev) => ({ ...prev, recipient_type: value }));
          }}
        >
          {recipientTypes.map((code) => (
            <option key={code} value={code}>
              {recipientLabel(code)}
            </option>
          ))}
        </select>
      </Field>
      {RECIPIENT_KEYS.map((key) => {
        const field = fields.find((f) => f.key === key);
        if (!field && !(recipient.recipient_type === "PATIENT" && key === "recipient_name"))
          return null;
        const label = field?.label ?? "Recipient";
        return (
          <Field
            key={key}
            label={`${label}${external && key !== "recipient_name" ? " *" : ""}`}
            htmlFor={`${idPrefix}-${key}`}
            error={err(key)}
          >
            <input
              id={`${idPrefix}-${key}`}
              className={INPUT}
              disabled={disabled}
              value={recipient[key as keyof RecipientValues]}
              onChange={(e) => {
                const value = e.target.value;
                onRecipient((prev) => ({ ...prev, [key]: value }));
              }}
            />
          </Field>
        );
      })}

      {fields
        .filter((f) => !RECIPIENT_KEYS.includes(f.key))
        .filter((f) => !["legal_basis", "legal_basis_reference"].includes(f.key) || external)
        .filter((f) => f.key !== "diagnosis_disclosure" || external)
        .filter(
          (f) => f.key !== "specialty_name" || inputs.referral_destination === "OTHER_SPECIALIST",
        )
        .map((field) => {
          const id = `${idPrefix}-${field.key}`;
          const label = `${field.label}${field.required ? " *" : ""}`;
          if (field.type === "textarea") {
            return (
              <Field
                key={field.key}
                label={label}
                htmlFor={id}
                error={err(field.key)}
                className="md:col-span-2"
              >
                <textarea
                  id={id}
                  rows={3}
                  className={INPUT}
                  disabled={disabled}
                  value={text(field.key)}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </Field>
            );
          }
          if (field.type === "valueset" && field.valueset) {
            const options =
              field.key === "legal_basis"
                ? vs
                    .options(field.valueset)
                    .filter((o) => o.code === "CONSENT" || rule?.alternativeBases.includes(o.code))
                : vs.options(field.valueset);
            if (field.key === "legal_basis" && options.length <= 1) return null;
            return (
              <Field key={field.key} label={label} htmlFor={id} error={err(field.key)}>
                <SelectChoices
                  id={id}
                  options={options}
                  value={text(field.key)}
                  placeholder="Select…"
                  disabled={disabled}
                  onChange={(code) => set(field.key, code)}
                />
              </Field>
            );
          }
          if (field.type === "classes") {
            const offered =
              field.key === "consent_scope"
                ? (catalogue?.data_classes ?? []).map((c) => c.code)
                : (rule?.authorizableClasses ?? []).filter((c) => c !== "DIAGNOSIS");
            if (!offered.length) return null;
            const current = Array.isArray(inputs[field.key])
              ? (inputs[field.key] as string[])
              : field.key === "include_classes" && referralBlock?.recommended
                ? referralBlock.recommended
                : [];
            return (
              <Field
                key={field.key}
                label={label}
                className="md:col-span-2"
                error={err(field.key)}
                hint={
                  external
                    ? "Each item must also be covered by the client's authorization (DOC-GOV-03)."
                    : undefined
                }
              >
                <CheckChoices
                  columns={2}
                  disabled={disabled}
                  options={offered.map((c) => ({ code: c, display: className(c) }))}
                  value={current}
                  onChange={(codes) => set(field.key, codes)}
                />
              </Field>
            );
          }
          if (field.type === "monitoring") {
            return (
              <MonitoringField
                key={field.key}
                block={monitoringBlock}
                value={(inputs.monitoring as MonitoringEntry[] | undefined) ?? []}
                onChange={(value) => set("monitoring", value)}
                disabled={disabled}
                error={err("monitoring")}
              />
            );
          }
          return (
            <Field key={field.key} label={label} htmlFor={id} error={err(field.key)}>
              <input
                id={id}
                type={
                  field.type === "date"
                    ? "date"
                    : field.type === "datetime"
                      ? "datetime-local"
                      : "text"
                }
                className={INPUT}
                disabled={disabled}
                value={text(field.key)}
                onChange={(e) => set(field.key, e.target.value)}
              />
            </Field>
          );
        })}
    </div>
  );
}

/** DOC-CI-07: one field group per selected medication; investigations come from
 * facility configuration or are picked from the LOINC index — no static per-drug
 * template and no monitoring schedule in code. */
function MonitoringField({
  block,
  value,
  onChange,
  disabled,
  error,
}: {
  block: DynamicBlock | undefined;
  value: MonitoringEntry[];
  onChange: (value: MonitoringEntry[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState<Record<string, string>>({});
  const [found, setFound] = useState<Record<string, LoincCode[]>>({});
  const available = block?.available ?? [];
  const entry = (id: string) => value.find((v) => v.item_id === id);
  const update = (id: string, change: (e: MonitoringEntry) => MonitoringEntry | null) => {
    const current = entry(id) ?? { item_id: id, codes: [] };
    const next = change(current);
    const rest = value.filter((v) => v.item_id !== id);
    onChange(next ? [...rest, next] : rest);
  };
  const search = (id: string) => {
    // eslint-disable-next-line security/detect-object-injection -- prescription item id.
    const q = (query[id] ?? "").trim();
    if (!accessToken || q.length < 2) return;
    searchLoinc(accessToken, q)
      .then((rows) => setFound((prev) => ({ ...prev, [id]: rows })))
      .catch(() => setFound((prev) => ({ ...prev, [id]: [] })));
  };

  return (
    <Field label="Medication-monitoring investigations *" className="md:col-span-2" error={error}>
      {!block && (
        <p className="text-[12.5px] text-ink-500">
          Generate the draft first — the client&rsquo;s prescribed medications are then listed here.
        </p>
      )}
      {block && available.length === 0 && (
        <p className="text-[12.5px] text-ink-500">No prescribed medications on record.</p>
      )}
      <div className="flex flex-col gap-3">
        {available.map((med) => {
          const selected = entry(med.item_id);
          return (
            <div key={med.item_id} className="rounded-lg border border-surface-border p-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(selected)}
                  onChange={(e) =>
                    update(med.item_id, () =>
                      e.target.checked ? { item_id: med.item_id, codes: [] } : null,
                    )
                  }
                />
                {med.medication}
                {med.indication && (
                  <span className="font-normal text-ink-500">· {med.indication}</span>
                )}
              </label>
              {selected && (
                <div className="mt-2 flex flex-col gap-2 pl-6 text-[12.5px]">
                  <div className="text-ink-500">
                    Configured by the facility:{" "}
                    {med.configured_codes.length ? med.configured_codes.join(", ") : "none"}
                  </div>
                  {selected.codes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selected.codes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          disabled={disabled}
                          onClick={() =>
                            update(med.item_id, (e) => ({
                              ...e,
                              codes: e.codes.filter((c) => c !== code),
                            }))
                          }
                          aria-label={`Remove ${code}`}
                        >
                          {code} ×
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      placeholder="Search LOINC tests…"
                      aria-label={`Search tests for ${med.medication}`}
                      disabled={disabled}
                      value={query[med.item_id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setQuery((prev) => ({ ...prev, [med.item_id]: v }));
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && (e.preventDefault(), search(med.item_id))
                      }
                    />
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      disabled={disabled}
                      onClick={() => search(med.item_id)}
                    >
                      Search
                    </button>
                  </div>
                  {(found[med.item_id] ?? []).map((row) => (
                    <button
                      key={row.code}
                      type="button"
                      className="text-left text-brand-green hover:underline"
                      disabled={disabled}
                      onClick={() =>
                        update(med.item_id, (e) => ({
                          ...e,
                          codes: e.codes.includes(row.code) ? e.codes : [...e.codes, row.code],
                        }))
                      }
                    >
                      + {row.description} ({row.code})
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Field>
  );
}
