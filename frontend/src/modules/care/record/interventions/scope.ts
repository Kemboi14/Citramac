import type { InterventionGroup, InterventionModule } from "../../../../lib/carePathwayApi";

export type ModuleScope = "plan" | "all";

const GROUP_ORDER: InterventionGroup[] = ["Assess", "Treat", "Support", "Close-out"];

/** The modules a scope shows, in the mockup's order: by group, recommended
 * first, then catalogue order (`renderInterventionModules`). */
export function scopedModules(modules: InterventionModule[], scope: ModuleScope) {
  const shown = modules.filter(
    (module) => scope === "all" || module.recommended || module.action_id !== null,
  );
  return shown
    .map((module) => ({ module, index: modules.indexOf(module) }))
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.module.group) - GROUP_ORDER.indexOf(b.module.group) ||
        Number(b.module.recommended) - Number(a.module.recommended) ||
        a.index - b.index,
    )
    .map(({ module }) => module);
}
