import { ChevronRight } from "lucide-react";
import type { InterventionAction, InterventionModule } from "../../../../lib/carePathwayApi";
import { ModuleGlyph } from "./moduleIcons";
import { deliveredText, metaParts } from "./rates";
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
      className={`rounded-[7px] px-2.5 py-[5px] text-xs font-semibold transition-colors ${
        scope === value ? "bg-surface-card text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"
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

/** The module's meta and tags, shared by the card and the drawer header. */
export function ModuleMeta({
  module,
  actions,
}: {
  module: InterventionModule;
  actions: InterventionAction[];
}) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
        {module.name}
        {module.recommended && <RecommendedBadge />}
        {module.delivered > 0 && (
          <span className="rounded-md bg-brand-green-tint px-2 py-0.5 text-[11px] font-semibold text-brand-green">
            {deliveredText(module)}
          </span>
        )}
        {module.linked_actions.map((id) => {
          const action = actions.find((a) => a.id === id);
          return action ? (
            <span
              key={id}
              className="rounded-md bg-surface-bg px-2 py-0.5 text-[11px] font-semibold text-ink-700"
            >
              ↳ {action.title}
            </span>
          ) : null;
        })}
      </span>
      <span className="mt-px block text-[12.5px] text-ink-500">
        {metaParts(module).join(" · ")}
        {module.preauth && (
          <>
            {" · "}
            <span className="text-priority-orange">pre-auth required</span>
          </>
        )}
      </span>
    </>
  );
}

/** One card per module (v4 `moduleCard`): icon, name, recommended badge,
 * delivered and linked-action tags, price and payer meta, chevron. */
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
      {modules.map((module) => (
        <div key={module.code} className="border-b border-surface-border last:border-b-0">
          <button
            type="button"
            data-module={module.code}
            aria-label={`Open ${module.name} intervention record`}
            aria-haspopup="dialog"
            onClick={() => onOpen(module.code)}
            className="flex min-h-[56px] w-full items-center gap-3 px-[13px] py-[11px] text-left text-ink-900 transition-colors hover:bg-surface-bg"
          >
            <ModuleIcon code={module.code} recommended={module.recommended} />
            <span className="min-w-0 flex-1">
              <ModuleMeta module={module} actions={actions} />
            </span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-ink-400" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ModuleIcon({
  code,
  recommended = false,
  large = false,
}: {
  code: string;
  recommended?: boolean;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-[9px] text-brand-green ${
        recommended ? "bg-brand-green-tint" : "bg-surface-bg"
      } ${large ? "h-9 w-9" : "h-[34px] w-[34px]"}`}
    >
      <ModuleGlyph code={code} />
    </span>
  );
}

export function RecommendedBadge() {
  return (
    <span className="rounded-full bg-brand-green px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[.4px] text-white">
      recommended
    </span>
  );
}
