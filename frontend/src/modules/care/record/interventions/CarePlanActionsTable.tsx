import { Clock } from "lucide-react";
import { Link } from "react-router-dom";
import type { InterventionAction } from "../../../../lib/carePathwayApi";
import { formatDate, formatDateTime } from "../../shared/format";
import { clientReportPath } from "../../shared/recordRoutes";
import { TABLE, TD, TH } from "../../shared/styles";
import { Card, PriorityPill, Tag } from "../../shared/ui";

const STATUS_TONE: Record<string, "brand" | "warn" | undefined> = {
  COMPLETED: "brand",
  PLANNED: "warn",
  SCHEDULED: "warn",
};

/** Where an action's records are listed in the client report. */
function recordsList(modules: string[]) {
  if (modules.includes("family_psychotherapy")) return { tab: "interventions", filter: "family" };
  if (modules.includes("psychotherapy")) return { tab: "interventions", filter: "psychotherapy" };
  if (modules.includes("psychiatry")) return { tab: "interventions", filter: "psychiatry" };
  return { tab: "interventions", filter: "care-plan" };
}

/** The origin line, said once ("Added by clinician · Added by clinician" read twice). */
function origin(action: InterventionAction) {
  const parts = [action.decision_display, action.why].filter(Boolean);
  const unique = parts.filter(
    (part, i) => parts.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === i,
  );
  const text = unique.join(" · ").toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** "Care-plan actions — what the plan asked for" (v4 `stageInterventions`):
 * each action with where it is delivered, its priority, due date, status and
 * the latest delivery. Sorted most
 * urgent first by the server; corrected deliveries are not counted. */
export function CarePlanActionsTable({
  actions,
  loading,
  moduleNames = {},
  patientId,
}: {
  actions: InterventionAction[];
  loading: boolean;
  /** Module code → name, to say which module delivers each action. */
  moduleNames?: Record<string, string>;
  /** The client, for links to where the records are. */
  patientId: string;
}) {
  return (
    <Card bodyClassName="overflow-x-auto p-0">
      <table className={`${TABLE} min-w-[860px]`}>
        <thead>
          <tr>
            <th className={TH}>Action</th>
            <th className={TH}>Delivered through</th>
            <th className={TH}>Priority</th>
            <th className={TH}>Due</th>
            <th className={TH}>Status</th>
            <th className={TH}>Last delivery</th>
            <th className={`${TH} text-right`}>Records</th>
          </tr>
        </thead>
        <tbody>
          {actions.length > 0 ? (
            actions.map((action) => {
              const from = origin(action);
              const through = action.modules.map((code) => moduleNames[code]).filter(Boolean);
              return (
                <tr key={action.id} className="align-top">
                  <td className={TD}>
                    <div className="font-semibold text-ink-900">{action.title}</div>
                    {action.instructions && (
                      <div className="mt-0.5 text-[12.5px] text-ink-700">{action.instructions}</div>
                    )}
                    {from && <div className="mt-1 text-[11.5px] text-ink-500">{from}</div>}
                    {action.note && (
                      <div className="mt-1.5 border-l-2 border-brand-green pl-2">
                        <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink-700">
                          {action.note.text}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          Care-plan note · {action.note.author || "Clinician"} ·{" "}
                          {formatDateTime(action.note.at)}
                        </p>
                      </div>
                    )}
                  </td>
                  <td className={`${TD} text-[12.5px] text-ink-700`}>
                    {through.length ? through.join(", ") : "—"}
                  </td>
                  <td className={TD}>
                    <PriorityPill priority={action.priority} pendingLabel="Not set" />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-[12.5px] tabular-nums`}>
                    {action.due_at ? (
                      <span className={action.overdue ? "font-semibold text-priority-red" : ""}>
                        {formatDate(action.due_at)}
                      </span>
                    ) : (
                      <span className="text-ink-400">Not set</span>
                    )}
                    {action.overdue && (
                      <div className="mt-1">
                        <Tag tone="risk">
                          <Clock aria-hidden="true" className="mr-1 inline h-3 w-3" />
                          Overdue
                        </Tag>
                      </div>
                    )}
                  </td>
                  <td className={TD}>
                    <Tag tone={STATUS_TONE[action.status]}>{action.status_display}</Tag>
                  </td>
                  <td className={`${TD} text-[12.5px]`}>
                    {action.latest_at ? (
                      <>
                        <div className="text-ink-900">{formatDateTime(action.latest_at)}</div>
                        <div className="text-ink-500">
                          {action.latest_by || "Provider not recorded"} · {action.records}{" "}
                          {action.records === 1 ? "record" : "records"}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-400">Nothing recorded yet</span>
                    )}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {action.records > 0 ? (
                      <Link
                        to={clientReportPath(patientId, recordsList(action.modules))}
                        className="font-semibold text-brand-green hover:underline"
                        title="Open these records in the client report"
                      >
                        {action.records}
                      </Link>
                    ) : (
                      <span className="text-ink-400">0</span>
                    )}
                    {Boolean(action.group_records) && (
                      <div className="mt-0.5 whitespace-nowrap text-[11px] text-ink-500">
                        incl. {action.group_records} from group
                      </div>
                    )}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={7} className={`${TD} py-6 text-center text-ink-500`}>
                {loading ? "Loading care plan…" : "No care plan actions documented yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
