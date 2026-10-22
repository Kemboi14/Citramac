import type { InterventionModule } from "../../../../lib/carePathwayApi";

export type ModuleScope = "plan" | "all";

/** The modules a scope shows, in the v4 order: recommended first, then the
 * catalogue order (`stageInterventions`). "For this plan" is what the plan
 * or the record recommends, plus anything a plan action is delivered through. */
export function scopedModules(modules: InterventionModule[], scope: ModuleScope) {
  const forPlan = (m: InterventionModule) => m.recommended || m.linked_actions.length > 0;
  return modules
    .map((module, index) => ({ module, index }))
    .filter(({ module }) => scope === "all" || forPlan(module))
    .sort(
      (a, b) =>
        Number(forPlan(b.module)) - Number(forPlan(a.module)) || a.index - b.index,
    )
    .map(({ module }) => module);
}
