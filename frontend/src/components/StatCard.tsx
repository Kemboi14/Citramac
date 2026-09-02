import type { LucideIcon } from "lucide-react";

const ICON_TONE = {
  green: "bg-brand-green-tint text-brand-green",
  amber: "bg-status-amber-tint text-status-amber",
  red: "bg-status-red-tint text-status-red",
} as const;

const TREND_TONE = {
  up: "bg-brand-green-tint text-brand-green-dark",
  down: "bg-status-red-tint text-status-red",
  neutral: "bg-surface-bg text-ink-500",
} as const;

/** Icon + value + trend-badge stat card — citramac_SUPER-ADMIN.html `.stat-card`. */
export function StatCard({
  icon: Icon,
  tone = "green",
  value,
  label,
  trend,
}: {
  icon: LucideIcon;
  tone?: keyof typeof ICON_TONE;
  value: string | number;
  label: string;
  trend?: { label: string; direction: "up" | "down" | "neutral" };
}) {
  return (
    <div className="animate-fade-in rounded-lg border border-surface-border bg-surface-card p-[18px] pb-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div
          // eslint-disable-next-line security/detect-object-injection -- `tone` is `keyof typeof ICON_TONE`, a compile-time-checked prop union, never user input.
          className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] transition-transform duration-200 ${ICON_TONE[tone]}`}
        >
          <Icon className="h-[17px] w-[17px]" />
        </div>
        {trend && (
          <span
            className={`rounded-full px-2 py-[3px] text-[11px] font-bold ${TREND_TONE[trend.direction]}`}
          >
            {trend.label}
          </span>
        )}
      </div>
      <div className="mt-3.5 font-display text-[28px] font-bold text-ink-900">{value}</div>
      <div className="mt-0.5 text-[12.5px] font-medium text-ink-500">{label}</div>
    </div>
  );
}
