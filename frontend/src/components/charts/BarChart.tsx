/** Vertical gradient bar chart — citramac_SUPER-ADMIN.html `.bar-chart`. */
export function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="mt-2 flex h-[150px] items-end gap-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <div className="flex w-full flex-1 items-end justify-center">
            <div
              className="w-full max-w-[26px] origin-bottom animate-grow-up rounded-t-[6px] rounded-b-[3px] bg-gradient-to-b from-[#16947a] to-brand-green transition-[filter] duration-150 hover:brightness-110"
              style={{
                height: `${Math.max(4, (d.value / max) * 100)}%`,
                animationDelay: `${i * 60}ms`,
              }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <div className="text-[10.5px] font-semibold text-ink-400">{d.label}</div>
        </div>
      ))}
      {data.length === 0 && <p className="pb-4 text-sm text-ink-500">No growth data yet.</p>}
    </div>
  );
}
