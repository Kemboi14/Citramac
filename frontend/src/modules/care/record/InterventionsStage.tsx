import { useState } from "react";
import { Tooltip } from "../../../components/Tooltip";
import { useNavigate } from "react-router-dom";
import { getInterventionWorkspace, listInterventions } from "../../../lib/carePathwayApi";
import { Callout, Card, ErrorNote } from "../shared/ui";
import { formatDateTime } from "../shared/format";
import { CarePlanActionsTable } from "./interventions/CarePlanActionsTable";
import { InterventionDrawer } from "./interventions/InterventionDrawer";
import { ModuleList, ScopeToggle } from "./interventions/ModuleList";
import { scopedModules, type ModuleScope } from "./interventions/scope";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";
import { clientRecordPath, psychotherapySessionPath } from "../shared/recordRoutes";

const INTRO =
  "Record what was delivered in response to the care plan. Each record links to a care-plan " +
  "action and captures provider, time, intervention, client response, outcome and next action. " +
  "Billable care creates the billing event automatically, so nothing is documented twice.";

const SECTION_HEAD = "mb-2 mt-5 flex flex-wrap items-center justify-between gap-2.5";
const SECTION_LABEL = "text-[11px] font-bold uppercase tracking-[.4px] text-ink-700";

/**
 * Interventions — the v4 patient workflow's `stageInterventions` (what the
 * Psychiatric review opens): what the plan asked for, the clinical modules care
 * is recorded from, and a full-screen module drawer. Recommendations, tariff and
 * payer codes come from the server (care/clients/<id>/interventions/workspace/);
 * nothing is kept in browser storage (guide.md §5).
 */
export function InterventionsStage({ patientId, banner, onRecordChanged }: RecordViewProps) {
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
  const navigate = useNavigate();
  // Individual and Family Psychotherapy open straight on their session page.
  const openModule_ = (code: string) => {
    if (code === "psychotherapy" || code === "family_psychotherapy") {
      navigate(
        psychotherapySessionPath(
          code === "family_psychotherapy" ? "family" : "individual",
          patientId,
        ),
        { state: { from: clientRecordPath(patientId, "interventions") } },
      );
      return;
    }
    setOpenCode(code);
  };
  const modules = data?.modules ?? [];
  const actions = data?.actions ?? [];
  const planModules = scopedModules(modules, "plan");
  const shown = scope === "plan" ? planModules : scopedModules(modules, "all");
  const openModule = modules.find((module) => module.code === openCode);
  const clientName = banner.preferred_name || banner.name || "this client";

  const refresh = (message: string) => {
    setStatus(message);
    setVersion((v) => v + 1);
    onRecordChanged();
  };

  return (
    <section aria-labelledby="interventions-title">
      <div className="text-[11px] font-bold tracking-[.35px] text-brand-green">
        What did the team actually do?
      </div>
      <h2
        id="interventions-title"
        className="mb-[18px] flex items-center gap-2 font-display text-xl font-semibold text-ink-900"
      >
        <Tooltip label={INTRO}>
          <span
            tabIndex={0}
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            Interventions
          </span>
        </Tooltip>
      </h2>

      <p role="status" aria-live="polite" className="mb-3.5 text-xs text-ink-500 empty:hidden">
        {status}
      </p>
      <ErrorNote>{workspace.error ?? records.error}</ErrorNote>

      {data && !data.plan_signed && (
        <Callout tone="warning">
          The care plan is not signed yet. Actions confirmed for this client are shown below and
          appear here as they are accepted; sign the plan to complete the confirmed care plan.
        </Callout>
      )}

      {data && (
        <>
          <div className={SECTION_HEAD}>
            <div>
              <b className={SECTION_LABEL}>Care-plan actions</b>
              <span className="ml-2 text-xs text-ink-500">
                what the plan asked for · status updates as care is recorded
              </span>
            </div>
          </div>
          <CarePlanActionsTable
            actions={actions}
            loading={workspace.loading && !data}
            moduleNames={Object.fromEntries(modules.map((m) => [m.code, m.name]))}
          />
        </>
      )}

      {(data?.scheduled_sessions ?? []).length > 0 && (
        <Card title="Upcoming psychiatry sessions" className="mt-3">
          <ul className="divide-y divide-surface-border">
            {(data?.scheduled_sessions ?? []).map((session) => (
              <li key={session.id} className="py-2 first:pt-0 last:pb-0">
                <strong className="block text-[13px] text-ink-900">{session.activity_title}</strong>
                <span className="text-xs text-ink-700">
                  {formatDateTime(session.scheduled_for)}
                  {session.provider_name ? ` · ${session.provider_name}` : ""}
                </span>
                {session.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-700">
                    Scheduling note: {session.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {openModule && data ? (
        <div className="mt-5">
          <InterventionDrawer
            key={openModule.code}
            patientId={patientId}
            clientName={clientName}
            module={openModule}
            actions={actions}
            context={data.context}
            records={(records.data?.results ?? []).filter((r) =>
              openModule.history_modules.includes(r.module),
            )}
            onClose={() => {
              setOpenCode(null);
              setVersion((v) => v + 1);
            }}
            onRecorded={(message) => refresh(message)}
            onCorrected={refresh}
          />
        </div>
      ) : (
        <>
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
              <ModuleList modules={shown} actions={actions} onOpen={openModule_} />
            ) : (
              <p className="p-4 text-xs text-ink-500">
                {workspace.loading
                  ? "Loading clinical modules…"
                  : "Clinical modules are unavailable."}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
