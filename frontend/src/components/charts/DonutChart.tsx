const PALETTE = ["#006e51", "#34a884", "#9bcdb9", "#b8790a", "#fe0000", "#5f736c"];

/** Conic-gradient donut chart with legend — citramac_SUPER-ADMIN.html `.donut`. */
export function DonutChart({
  data,
  centerLabel,
}: {
  data: { label: string; value: number }[];
  centerLabel: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  let cursor = 0;
  const stops = data.map((d, i) => {
    const start = total > 0 ? (cursor / total) * 100 : 0;
    cursor += d.value;
    const end = total > 0 ? (cursor / total) * 100 : 0;
    return `${PALETTE[i % PALETTE.length]} ${start}% ${end}%`;
  });

  return (
    <div className="mt-1.5 flex items-center gap-5">
      <div
        className="relative flex h-[120px] w-[120px] flex-shrink-0 animate-scale-in items-center justify-center rounded-full transition-transform duration-200 hover:scale-105"
        style={{
          background: total > 0 ? `conic-gradient(${stops.join(", ")})` : "var(--bg)",
        }}
      >
        <div className="absolute h-[70px] w-[70px] rounded-full bg-surface-card" />
        <div className="relative z-[1] text-center">
          <div className="font-display text-lg font-bold text-ink-900">{total}</div>
          <div className="text-[9px] font-semibold uppercase text-ink-400">{centerLabel}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="flex animate-fade-in items-center gap-2 text-xs text-ink-700"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span
              className="h-[9px] w-[9px] flex-shrink-0 rounded-[3px]"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            {d.label}
            <span className="ml-auto font-bold text-ink-900">{d.value}</span>
          </div>
        ))}
        {data.length === 0 && <p className="text-xs text-ink-500">No branch data yet.</p>}
      </div>
    </div>
  );
}
