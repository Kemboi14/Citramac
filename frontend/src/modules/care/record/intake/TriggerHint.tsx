import type { ToolRow } from "../../../../lib/carePathwayApi";

/** Short chip labels for the served tool keys (mockup `TOOLS[].short`). */
const SHORT: Record<string, string> = {
  SRA: "Risk formulation",
  SAFETY: "Safety plan",
  PAWSS: "PAWSS",
  AUDITC: "AUDIT-C",
  PHQ9: "PHQ-9",
  PHQA: "PHQ-A",
  EPDS: "EPDS",
  GAD7: "GAD-7",
  MDQ: "MDQ",
  PCL5: "Trauma assessment",
  COG: "Cognitive screen",
  SAFEGUARD: "Safeguarding workflow",
  CRI: "CRI baseline",
};

const TONE: Record<ToolRow["status"], string> = {
  Completed: "border-transparent bg-brand-green-tint text-brand-green",
  Recommended: "border-transparent bg-priority-orange-tint text-priority-orange",
  "In progress": "bg-surface-bg text-ink-900 border-surface-border",
  Declined: "bg-surface-bg text-ink-900 border-surface-border",
  "Not approved": "bg-surface-bg text-ink-900 border-surface-border",
  "Not indicated": "bg-surface-bg text-ink-900 border-surface-border",
};

const toolLabel = (row: ToolRow) => SHORT[row.key] ?? row.name;

/**
 * "Triggered:" chips (mockup `triggerHint`): the assessment tools the server's
 * tool triggers (care/clients/<id>/tools/) currently recommend from this
 * section's findings, with their status. Each chip opens Section 20.
 */
export function TriggerHint({
  rows,
  keys,
  onOpen,
}: {
  rows: ToolRow[] | null;
  keys: string[];
  onOpen: () => void;
}) {
  if (!rows) return null;
  const on = keys
    .map((key) => rows.find((row) => row.key === key))
    .filter((row): row is ToolRow => Boolean(row && row.why.length > 0));
  if (on.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-500">Triggered:</span>
      {on.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={onOpen}
          title={row.why.join(" · ")}
          aria-label={`${toolLabel(row)} · ${row.status} — open Section 20 Assessment tools`}
          className={`inline-flex min-h-[26px] items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold underline-offset-2 hover:underline ${TONE[row.status]}`}
        >
          <span aria-hidden="true">→</span>
          {toolLabel(row)} · {row.status}
        </button>
      ))}
    </div>
  );
}
