/**
 * Stand-in for not-yet-built module pages — Phase 2 only needs shell
 * navigation to work end to end (docs/11-ROADMAP-AND-PHASES.md Phase 2 exit
 * criteria); real module content per docs/07-CLINICAL-MODULES-SPEC.md lands
 * starting Phase 3.
 */
export function PlaceholderPage({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-8 shadow-sm">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
        {eyebrow}
      </div>
      <h1 className="font-display text-2xl font-bold text-ink-900">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        The real screens for this module land in a later phase — see docs/11-ROADMAP-AND-PHASES.md.
      </p>
    </div>
  );
}
