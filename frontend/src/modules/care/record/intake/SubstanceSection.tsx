import { useState, type ReactNode } from "react";
import type { IntakeSectionSpec, ToolRow } from "../../../../lib/carePathwayApi";
import { BTN_GHOST, BTN_SM, GROUP_LABEL } from "../../shared/styles";
import { Callout, SelectChoices, Tag } from "../../shared/ui";
import type { ValueSetsApi } from "../../shared/useValueSets";
import { FieldControl, type SectionValues } from "./fields";
import { SchemaSection } from "./SchemaSection";

type Card = Record<string, string> & { substance: string };

const asCards = (v: unknown): Card[] =>
  Array.isArray(v) ? (v.filter((c) => c && typeof c === "object") as Card[]) : [];

/** Section 8 — substance use (INT-08). One card per substance (rows from the
 * served `intake-substance-rows`; Nicotine is recorded here only), harm-reduction
 * prompts only when injecting, and text-only safety guidance — no doses. */
export function SubstanceSection({
  spec,
  values,
  vs,
  onChange,
  triggers,
  auditC,
  onOpenTools,
}: {
  spec: IntakeSectionSpec;
  values: SectionValues;
  vs: ValueSetsApi;
  onChange: (key: string, value: unknown) => void;
  /** "Triggered:" tool chips (mockup `triggerHint`). */
  triggers?: ReactNode;
  /** The AUDIT-C row of the client's assessment tools, when loaded. */
  auditC: ToolRow | null;
  onOpenTools: () => void;
}) {
  const [adding, setAdding] = useState("");
  const cards = asCards(values.substances);
  const kind = typeof values.kind === "string" ? values.kind : "";
  const shown = new Set(cards.map((c) => c.substance));
  const setCard = (index: number, key: string, value: unknown) =>
    onChange(
      "substances",
      cards.map((c, i) => (i === index ? { ...c, [key]: value } : c)),
    );
  const currentCard = (code: string) => cards.some((c) => c.substance === code && c.current === "YES");
  const alcohol = ["ALCOHOL", "POLY_SUBSTANCE", "UNKNOWN"].includes(kind) || currentCard("ALCOHOL");
  const opioid = kind === "OPIOIDS" || shown.has("OPIOIDS");
  const unknown = ["UNKNOWN", "POLY_SUBSTANCE"].includes(kind);
  const sources = (values._sources ?? undefined) as Record<string, { stage?: string; version?: number }> | undefined;
  const only = (keys: string[]) => ({ ...spec, fields: spec.fields.filter((f) => keys.includes(f.key)) });
  const pillField = (key: string) => spec.fields.find((f) => f.key === key);

  return (
    <div className="flex flex-col gap-3">
      <SchemaSection spec={only(["kind", "screen"])} values={values} vs={vs} onChange={onChange} sources={sources} />
      <p className="text-[11.5px] text-ink-500">
        {auditC?.last ? (
          <>
            AUDIT-C:{" "}
            <strong className="text-ink-900">
              {auditC.last.score} · {auditC.last.band}
            </strong>
          </>
        ) : (
          <>
            AUDIT-C (structured, 3 items) — record it in{" "}
            <button type="button" className="font-semibold text-brand-green underline" onClick={onOpenTools}>
              Section 20 Assessment tools
            </button>
            .
          </>
        )}
      </p>
      <div className={GROUP_LABEL}>
        Substances used <span className="font-normal normal-case text-ink-500">— one card per substance</span>
      </div>
      {cards.length === 0 && <p className="text-[13px] text-ink-500">No substances recorded yet.</p>}
      {cards.map((card, index) => (
        <section key={card.substance} className="rounded-lg border border-surface-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink-900">{vs.label("intake-substance-rows", card.substance)}</span>
            {card.current === "YES" ? <Tag tone="warn">current</Tag> : card.current ? <Tag>{vs.label("intake-substance-current", card.current)}</Tag> : null}
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {(spec.cardFields ?? []).map((field) => (
              <FieldControl
                key={field.key}
                idPrefix={`intake-subs-${card.substance}`}
                field={field}
                value={card[field.key]}
                vs={vs}
                onChange={(value) => setCard(index, field.key, value)}
                labelPrefix={vs.label("intake-substance-rows", card.substance)}
                wideClass="sm:col-span-2 xl:col-span-3"
              />
            ))}
          </div>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM} mt-2`}
            onClick={() => onChange("substances", cards.filter((_, i) => i !== index))}
          >
            Remove card
          </button>
        </section>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-col gap-1 text-[11px] font-semibold uppercase text-ink-500">
          Add a substance
          <SelectChoices
            options={vs.options("intake-substance-rows").filter((o) => !shown.has(o.code))}
            placeholder="— choose —"
            value={adding}
            onChange={setAdding}
          />
        </label>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={!adding}
          onClick={() => {
            onChange("substances", [...cards, { substance: adding, current: "YES" }]);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
      {/* Mockup order: injecting (and its harm-reduction prompts), then features and consequences. */}
      <SchemaSection spec={only(["injecting", "harm_reduction"])} values={values} vs={vs} onChange={onChange} />
      {["features", "consequences"].map((key) => {
        const field = pillField(key);
        return field ? (
          <FieldControl
            key={key}
            idPrefix={`intake-${spec.key}`}
            field={field}
            // eslint-disable-next-line security/detect-object-injection -- fixed schema keys.
            value={values[key]}
            vs={vs}
            onChange={(value) => onChange(key, value)}
            pills
          />
        ) : null;
      })}
      <SchemaSection
        spec={{
          ...spec,
          fields: spec.fields.filter(
            (f) => !["kind", "screen", "injecting", "harm_reduction", "features", "consequences"].includes(f.key),
          ),
        }}
        values={values}
        vs={vs}
        onChange={onChange}
      />
      {triggers}
      {alcohol && (
        <section aria-labelledby="intake-thiamine" className="rounded-xl border border-surface-border bg-surface-card p-3 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 id="intake-thiamine" className="text-[13px] font-bold text-ink-900">
              Thiamine — give promptly
            </h3>
            <Tag tone="risk">alert</Tag>
          </div>
          <p className="text-[12.5px] text-ink-900">
            Alcohol dependence or malnutrition: give thiamine as soon as possible (parenteral if Wernicke’s
            encephalopathy is suspected). <strong>Never delay glucose in hypoglycaemia</strong> — treat low glucose
            immediately and give thiamine alongside. Dose and route follow the facility protocol.
          </p>
        </section>
      )}
      {opioid && (
        <Callout tone="warning">
          <strong>Opioids — overdose risk.</strong> Opioid withdrawal is distressing but rarely life-threatening. Offer
          opioid agonist therapy (methadone / buprenorphine); naloxone kit and overdose-risk teaching at discharge
          (tolerance falls quickly).
        </Callout>
      )}
      {unknown && (
        <Callout tone="warning">
          <strong>Unknown / poly-substance — urine drug screen.</strong> Order a UDS and use generic intoxication /
          withdrawal observations. No substance-specific scale until the substance is known.
        </Callout>
      )}
    </div>
  );
}
