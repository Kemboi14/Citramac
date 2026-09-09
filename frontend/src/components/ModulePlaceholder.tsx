import type { LucideIcon } from "lucide-react";
import { ClipboardList, Info } from "lucide-react";
import { StatCard } from "./StatCard";

/**
 * Richer "not yet built" placeholder for Clinical Workspace nav leaves that
 * have no backing model/spec anywhere (docs/07-CLINICAL-MODULES-SPEC.md) —
 * see /home/nick/.claude/plans/drifting-baking-falcon.md for the full list
 * and rationale. Unlike the disabled/greyed "Soon" nav treatment
 * (AppShell.tsx), a page rendering this IS reachable and clickable — it's
 * honest about being unbuilt rather than either hiding the nav entry or
 * faking canned data, matching this project's existing disclosure pattern
 * (e.g. Sentry's empty-DSN gating, the honest HIE-transmission stub).
 * Deliberately shows no fabricated KPI numbers or work-queue rows.
 */
export function ModulePlaceholder({
  eyebrow,
  title,
  description,
  icon: Icon = ClipboardList,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div>
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          {eyebrow}
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">{title}</h1>
        <p className="mt-1.5 max-w-xl text-[13px] text-ink-500">{description}</p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <StatCard icon={Icon} value="—" label="Not yet available" />
        <StatCard icon={Icon} tone="amber" value="—" label="Not yet available" />
        <StatCard icon={Icon} value="—" label="Not yet available" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
          <h2 className="font-display text-sm font-semibold text-ink-900">Work queue</h2>
          <p className="mt-3 rounded-md border border-dashed border-surface-border bg-surface-bg px-4 py-8 text-center text-[12.5px] text-ink-500">
            This module has no working screen yet — nothing to queue. It&apos;s listed here honestly
            rather than hidden, so the full navigation matches the approved design.
          </p>
        </div>
        <div className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
          <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink-900">
            <Info className="h-4 w-4 text-brand-green" /> Module status
          </h2>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
            Not built yet — no backend model or spec currently exists for this screen. See{" "}
            <span className="font-mono text-[11.5px]">docs/07-CLINICAL-MODULES-SPEC.md</span> for
            what is planned.
          </p>
        </div>
      </div>
    </div>
  );
}
