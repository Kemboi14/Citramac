import type { InterventionContext } from "../../../../lib/carePathwayApi";

/** "Clinical context — carried forward · confirm, don't re-enter" (v4
 * `appendModuleRecord`): what the record already holds, so nothing is typed twice. */
export function ClinicalContext({ context }: { context: InterventionContext }) {
  const rows: [string, string, string?][] = [
    ["Allergies", context.allergies || "Not recorded"],
    ["Diagnosis", context.diagnoses.join("; ") || "Not recorded"],
    [
      "Risk",
      context.risk || "No signed risk formulation recorded",
      context.risk_change_72h ? `Next 24–72 h: ${context.risk_change_72h}` : undefined,
    ],
    ["Active alerts", context.alerts.join("; ") || "None recorded"],
    ["Current medicines", context.medicines.join("; ") || "No current medication recorded"],
  ];
  return (
    <details
      open
      className="mb-2 mt-2.5 rounded-[9px] border border-surface-border bg-surface-bg px-2.5"
    >
      <summary className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[.35px] text-ink-500">
        Clinical context
        <span className="text-[11px] font-normal normal-case tracking-normal text-ink-400">
          carried forward · confirm, don’t re-enter
        </span>
      </summary>
      {rows.map(([label, value, source]) => (
        <div
          key={label}
          className="grid grid-cols-[94px_1fr] gap-2 border-t border-surface-border py-[7px] text-xs"
        >
          <span className="font-semibold text-ink-500">{label}</span>
          <span className="text-ink-900">
            {value}
            {source && <span className="mt-0.5 block text-[11px] text-ink-500">{source}</span>}
          </span>
        </div>
      ))}
    </details>
  );
}
