import { ChevronRight } from "lucide-react";
import type { InterventionAction, InterventionModule } from "../../../../lib/carePathwayApi";
import { rateText } from "./rates";
import type { ModuleScope } from "./scope";

export function ScopeToggle({
  scope,
  planCount,
  allCount,
  onChange,
}: {
  scope: ModuleScope;
  planCount: number;
  allCount: number;
  onChange: (scope: ModuleScope) => void;
}) {
  const option = (value: ModuleScope, label: string, count: number) => (
    <button
      type="button"
      aria-pressed={scope === value}
      onClick={() => onChange(value)}
      className={`rounded-[7px] px-[9px] py-[5px] text-[11px] font-semibold transition-colors ${
        scope === value ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500"
      }`}
    >
      {label} · {count}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Filter clinical modules"
      className="flex gap-[3px] rounded-[9px] border border-surface-border bg-surface-bg p-[3px]"
    >
      {option("plan", "For this plan", planCount)}
      {option("all", "All modules", allCount)}
    </div>
  );
}

/** Grouped module rows: icon letter, title, Recommended badge, meta line,
 * "N delivered" and a chevron. Opening one opens its drawer. */
export function ModuleList({
  modules,
  actions,
  onOpen,
}: {
  modules: InterventionModule[];
  actions: InterventionAction[];
  onOpen: (code: string) => void;
}) {
  if (modules.length === 0) {
    return (
      <p className="p-4 text-xs text-ink-500">
        No module is linked to this plan yet — show all modules to record care.
      </p>
    );
  }
  return (
    <div>
      {modules.map((module, index) => {
        const action = actions.find((item) => item.id === module.action_id);
        const meta = module.recommended
          ? rateText(module)
          : action
            ? `Linked to ${action.title}`
            : rateText(module);
        const newGroup = index === 0 || modules[index - 1].group !== module.group;
        return (
          <div key={module.code}>
            {newGroup && (
              <div className="px-4 pb-[5px] pt-[9px] text-[10px] text-ink-700">
                {module.group}
              </div>
            )}
            <button
              type="button"
              aria-label={`Record ${module.name}`}
              aria-haspopup="dialog"
              onClick={() => onOpen(module.code)}
              className="flex w-full items-center gap-3 border-b border-surface-border px-4 py-3 text-left text-ink-900 transition-colors last:border-b-0 hover:bg-surface-bg"
            >
              <ModuleIcon name={module.name} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-[7px] font-bold">
                  {module.name}
                  {module.recommended && <RecommendedBadge />}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">{meta}</span>
              </span>
              {module.delivered > 0 && (
                <span className="whitespace-nowrap rounded-full bg-brand-green-tint px-[9px] py-1 text-[10px] font-semibold text-brand-green">
                  {module.delivered} delivered
                </span>
              )}
              <ChevronRight aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-ink-400" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ModuleIcon({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-[9px] bg-brand-green-tint font-bold text-brand-green ${
        large ? "h-[42px] w-[42px]" : "h-9 w-9"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function RecommendedBadge() {
  return (
    <span className="rounded-full bg-brand-green-tint px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[.3px] text-brand-green">
      Recommended
    </span>
  );
}
