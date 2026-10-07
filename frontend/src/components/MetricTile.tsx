/** Plain value + uppercase label tile — the clinical workspace mockup's `.stat-card`
 * (docs/15-CLINICAL-WORKSPACE-V3.md §1.12, §1.13). */
export function MetricTile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
      <div className="font-display text-[28px] font-extrabold leading-tight text-ink-900">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </div>
    </div>
  );
}
