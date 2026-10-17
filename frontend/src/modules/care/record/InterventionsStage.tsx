import { useState } from "react";
import { getInterventionWorkspace, listInterventions } from "../../../lib/carePathwayApi";
import { ErrorNote } from "../shared/ui";
import { CarePlanActionsTable } from "./interventions/CarePlanActionsTable";
import { InterventionDrawer } from "./interventions/InterventionDrawer";
import { ModuleList, ScopeToggle } from "./interventions/ModuleList";
import { scopedModules, type ModuleScope } from "./interventions/scope";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

const SECTION_HEAD = "mb-2 mt-5 flex flex-wrap items-center justify-between gap-2.5";
const SECTION_LABEL = "text-[11px] font-bold uppercase tracking-[.4px] text-ink-700";

/**
 * Interventions — the approved v4 mockup (`psychiatricInterventionWorkspace`):
 * what the plan asked for, the clinical modules care is recorded from, and a
 * full-screen module drawer. Recommendations and tariff come from the server
 * (care/clients/<id>/interventions/workspace/); nothing is kept in browser
 * storage (CLAUDE.md §5).
 */
export function InterventionsStage({ patientId, banner }: RecordViewProps) {
  const [version, setVersion] = useState(0);
  const workspace = useRecordData(
    patientId,
    version,
    (token) => getInterventionWorkspace(token, patientId),
    "Couldn't load the interventions workspace.",
  );
  const records = useRecordData(
    patientId,
    version,
    (token) => listInterventions(token, patientId),
    "Couldn't load the intervention record.",
  );
  const [scope, setScope] = useState<ModuleScope>("plan");
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const data = workspace.data;
  const modules = data?.modules ?? [];
  const actions = data?.actions ?? [];
  const planModules = scopedModules(modules, "plan");
  const shown = scope === "plan" ? planModules : scopedModules(modules, "all");
  const openModule = modules.find((module) => module.code === openCode);
  const clientName = banner.preferred_name || banner.name || "this client";

  const refresh = (message: string) => {
    setStatus(message);
    setVersion((v) => v + 1);
  };

  return (
    <section aria-labelledby="interventions-title">
      <div className="text-[11px] font-bold tracking-[.35px] text-brand-green">
        What did the team actually do?
      </div>
      <h2 id="interventions-title" className="font-display text-xl font-semibold text-ink-900">
        Interventions
      </h2>
      <p className="mb-[18px] mt-1 max-w-[640px] text-[12.5px] text-ink-700">
        Record care delivered in response to the care plan. Client context carries forward;
        confirm it before recording. Review charges in Billing.
      </p>

      <p role="status" aria-live="polite" className="mb-3.5 text-xs text-ink-500 empty:hidden">
        {status}
      </p>
      <ErrorNote>{workspace.error ?? records.error}</ErrorNote>

      <div className={SECTION_HEAD}>
        <div>
          <b className={SECTION_LABEL}>Care-plan actions</b>
          <span className="ml-2 text-xs text-ink-500">what the plan asked for</span>
        </div>
      </div>
      <CarePlanActionsTable
        actions={actions}
        loading={workspace.loading && !data}
        triagePriority={banner.priority}
      />

      <div className={SECTION_HEAD}>
        <b className={SECTION_LABEL}>Clinical modules</b>
        <ScopeToggle
          scope={scope}
          planCount={planModules.length}
          allCount={modules.length}
          onChange={setScope}
        />
      </div>
      <div className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
        {data ? (
          <ModuleList modules={shown} actions={actions} onOpen={setOpenCode} />
        ) : (
          <p className="p-4 text-xs text-ink-500">
            {workspace.loading ? "Loading clinical modules…" : "Clinical modules are unavailable."}
          </p>
        )}
      </div>

      {openModule && data && (
        <InterventionDrawer
          key={openModule.code}
          patientId={patientId}
          clientName={clientName}
          module={openModule}
          actions={actions}
          context={data.context}
          records={(records.data?.results ?? []).filter((r) => r.module === openModule.code)}
          onClose={() => setOpenCode(null)}
          onRecorded={() => {
            setOpenCode(null);
            refresh(`Intervention recorded for ${clientName}.`);
          }}
          onCorrected={refresh}
        />
      )}
    </section>
  );
}
