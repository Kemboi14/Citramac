import type { InterventionContext } from "../../../../lib/carePathwayApi";

/** "Clinical context — carried forward · confirm, don't re-enter": what the
 * record already holds, shown so nothing is typed twice. */
export function ClinicalContext({ context }: { context: InterventionContext }) {
  const rows: [string, string][] = [
    ["Client", context.client],
    ["Diagnosis", context.diagnoses.join("; ") || "Not recorded"],
    ["Allergies", context.allergies || "Not recorded"],
    ["Active alerts", context.alerts.join(", ") || "None recorded"],
    ["Current medicines", context.medicines.join("; ") || "No medication entries found"],
    ["Care-plan goals", context.goals.join("; ") || "No linked action recorded"],
  ];
  return (
    <div className="mb-3.5 rounded-lg border border-surface-border bg-surface-bg px-3 py-[11px]">
      <details
        open
        className="mb-1.5 rounded-[10px] border border-surface-border bg-surface-bg px-2.5"
      >
        <summary className="flex min-h-[38px] cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[.35px] text-ink-500">
          Clinical context
          <span className="text-[11px] font-normal normal-case tracking-normal text-ink-400">
            carried forward · confirm, don’t re-enter
          </span>
        </summary>
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[82px_1fr] gap-2 border-t border-surface-border py-2 text-xs"
          >
            <span className="font-semibold text-ink-500">{label}</span>
            <span className="text-ink-900">{value}</span>
          </div>
        ))}
      </details>
    </div>
  );
}
