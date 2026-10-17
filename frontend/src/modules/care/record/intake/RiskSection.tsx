import type { ReactNode } from "react";
import type { IntakeRiskRow, IntakeSectionSpec } from "../../../../lib/carePathwayApi";
import { BTN, BTN_GHOST, BTN_SM, GROUP_LABEL } from "../../shared/styles";
import { Callout, Tag } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import type { SectionValues } from "./fields";
import { SchemaSection } from "./SchemaSection";

interface Carried {
  stage?: string;
  version?: number;
  by?: string;
  confirmed?: boolean;
  /** The clinician found this triage finding no longer present; it stays in the trail. */
  not_present?: boolean;
  resolved_by?: string;
  resolved_at?: string;
}

const asRows = (v: unknown): Record<string, string[]> =>
  v && typeof v === "object" ? (v as Record<string, string[]>) : {};
const asCarried = (v: unknown): Record<string, Carried> =>
  v && typeof v === "object" ? (v as Record<string, Carried>) : {};

/** Section 3 — risk register: confirm what triage carried forward, tick what
 * applies now, then sign a structured formulation (no single Low/Moderate/High
 * label sets priority). */
export function RiskSection({
  spec,
  riskRows,
  values,
  vs,
  onChange,
  onPatch,
  triggers,
}: {
  spec: IntakeSectionSpec;
  riskRows: IntakeRiskRow[];
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (key: string, value: unknown) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  /** "Triggered:" tool chips (mockup `triggerHint`), shown after the actions. */
  triggers?: ReactNode;
}) {
  const rows = asRows(values.rows);
  const carried = asCarried(values.carried);
  const open = Object.entries(carried).filter(([, c]) => !c.confirmed);
  const label = (rowKey: string) => riskRows.find((r) => r.key === rowKey)?.label ?? rowKey;
  const signedAt = typeof values.formulation_signed_at === "string" ? values.formulation_signed_at : "";
  const signedBy = typeof values.formulation_signed_by === "string" ? values.formulation_signed_by : "";

  const setRow = (row: IntakeRiskRow, option: string, on: boolean) => {
    const current = rows[row.key] ?? [];
    let next: string[];
    // "None identified" excludes the current (active) options only — "Past history"
    // can stand beside it (it is linked from Section 4, INT-04-07/08).
    if (!on) next = current.filter((o) => o !== option);
    else if (row.single) next = [option];
    else if (row.none.includes(option)) next = [...current.filter((o) => !row.active.includes(o) && !row.none.includes(o)), option];
    else next = [...current.filter((o) => !row.none.includes(o) || !row.active.includes(option)), option];
    // A carried triage finding that is no longer present is resolved, not erased —
    // the server stamps who resolved it and when.
    const carriedKey = `${row.key}:${option}`;
    const nextCarried = { ...carried };
    if (!on && nextCarried[carriedKey] && !nextCarried[carriedKey].confirmed) {
      nextCarried[carriedKey] = { ...nextCarried[carriedKey], confirmed: true, not_present: true };
    }
    onPatch({
      rows: { ...rows, [row.key]: next },
      carried: nextCarried,
      // Editing the risk record after signing the formulation re-opens it.
      formulation_signed_at: "",
    });
  };

  const confirm = (keys: string[]) =>
    onPatch({
      carried: Object.fromEntries(
        Object.entries(carried).map(([k, c]) => [k, keys.includes(k) ? { ...c, confirmed: true } : c]),
      ),
    });

  const requiredFormulation = ["static", "dynamic", "protective", "change_72h", "summary"];
  const formulationReady = requiredFormulation.every(
    (k) => typeof values[k] === "string" && (values[k] as string).trim() !== "",
  );
  const anyActive = riskRows.some((r) => (rows[r.key] ?? []).some((o) => r.active.includes(o)));

  return (
    <div className="flex flex-col gap-3">
      <Callout>
        Findings from triage keep their source — <strong>confirm or update each one, don’t
        re-document</strong>.
      </Callout>
      {Object.keys(carried).length > 0 && (
        <div>
          <div className={GROUP_LABEL}>
            Carried forward from triage —{" "}
            {open.length ? `${open.length} awaiting confirmation` : "all confirmed"}
          </div>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(carried).map(([key, c]) => {
              const [rowKey, option] = key.split(":");
              return (
                <li key={key} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Tag tone="brand">
                    {label(rowKey)}: {option}
                  </Tag>
                  <span className="text-[11px] text-ink-500">
                    triage{c.version ? ` v${c.version}` : ""}
                    {c.by ? ` · ${c.by}` : ""}
                  </span>
                  {c.not_present ? (
                    <Tag>
                      not present now{c.resolved_by ? ` · ${c.resolved_by}` : ""} — kept in the trail
                    </Tag>
                  ) : c.confirmed ? (
                    <Tag>confirmed ✓</Tag>
                  ) : (
                    <>
                      <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => confirm([key])}>
                        Confirm
                      </button>
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() =>
                          setRow(riskRows.find((r) => r.key === rowKey)!, option, false)
                        }
                      >
                        Not present now
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {open.length > 1 && (
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM} mt-2`}
              onClick={() => confirm(open.map(([k]) => k))}
            >
              Confirm all unchanged
            </button>
          )}
        </div>
      )}

      <div>
        <div className={GROUP_LABEL}>Active risk record — tick what applies now</div>
        <div className="flex flex-col gap-2">
          {riskRows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-1 gap-1.5 rounded-lg border border-surface-border p-2.5 sm:grid-cols-[220px_1fr]"
            >
              <div className="text-[12.5px] font-semibold text-ink-900">{row.label}</div>
              <div role="group" aria-label={row.label} className="flex flex-wrap gap-x-4 gap-y-1">
                {row.options.map((option) => (
                  <label
                    key={option}
                    className={`flex items-center gap-1.5 text-[12.5px] ${
                      row.active.includes(option) ? "font-semibold text-priority-red" : "text-ink-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={(rows[row.key] ?? []).includes(option)}
                      onChange={(e) => setRow(row, option, e.target.checked)}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SchemaSection spec={spec} values={values} vs={vs} onChange={onChange}
        skip={["static", "dynamic", "protective", "change_72h", "summary", "plan", "review_by", "concern_level"]} />
      {triggers}

      <div>
        <div className={GROUP_LABEL}>
          Structured risk formulation{" "}
          <span className="font-normal normal-case text-ink-500">
            — replaces a Low / Moderate / High rating
          </span>
        </div>
        <div className="mb-2">
          {signedAt ? (
            <Tag tone="brand">
              Signed {new Date(signedAt).toLocaleString()}
              {signedBy ? ` · ${signedBy}` : ""}
            </Tag>
          ) : (
            <Tag tone="warn">Draft — unsigned{anyActive ? " · required: an active risk is recorded" : ""}</Tag>
          )}
        </div>
        <SchemaSection
          spec={{
            ...spec,
            fields: spec.fields.filter((f) =>
              ["static", "dynamic", "protective", "change_72h", "summary", "plan", "review_by", "concern_level"].includes(f.key),
            ),
          }}
          values={values}
          vs={vs}
          onChange={(k, v) => onPatch({ [k]: v, formulation_signed_at: "" })}
        />
        <button
          type="button"
          className={`${BTN} ${BTN_SM} mt-3`}
          disabled={!formulationReady}
          title={formulationReady ? "" : "Complete static, dynamic, protective, next 24–72 h and the summary first"}
          // A truthy value asks the server to sign; it records the signer and time itself.
          onClick={() => onPatch({ formulation_signed_at: "sign" })}
        >
          {signedAt ? "Re-sign formulation" : "Sign risk formulation"}
        </button>
      </div>
    </div>
  );
}
