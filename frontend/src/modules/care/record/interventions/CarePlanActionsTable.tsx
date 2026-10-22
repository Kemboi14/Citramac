import { Clock } from "lucide-react";
import type { InterventionAction } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { TABLE, TD, TH } from "../../shared/styles";
import { Card, PriorityPill, Tag } from "../../shared/ui";

const STATUS_TONE: Record<string, "brand" | "warn" | undefined> = {
  COMPLETED: "brand",
  PLANNED: "warn",
  SCHEDULED: "warn",
};

/** "Care-plan actions — what the plan asked for" (v4 `stageInterventions`):
 * each action with its own priority, instructions, why it was planned, an
 * overdue flag, its status and how many deliveries (corrected ones excluded)
 * are recorded against it. Sorted most urgent first by the server. */
export function CarePlanActionsTable({
  actions,
  loading,
}: {
  actions: InterventionAction[];
  loading: boolean;
}) {
  return (
    <Card bodyClassName="overflow-x-auto">
      <table className={`${TABLE} min-w-[640px]`}>
        <thead>
          <tr>
            <th className={TH}>Action</th>
            <th className={TH}>Priority</th>
            <th className={TH}>Status</th>
            <th className={`${TH} text-right`}>Records</th>
          </tr>
        </thead>
        <tbody>
          {actions.length > 0 ? (
            actions.map((action) => (
              <tr key={action.id}>
                <td className={TD}>
                  <strong>{action.title}</strong>
                  {action.instructions && (
                    <div className="text-xs text-ink-500">{action.instructions}</div>
                  )}
                  {(action.decision_display || action.why) && (
                    <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[.4px] text-ink-400">
                      {[action.decision_display, action.why].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                <td className={TD}>
                  <PriorityPill priority={action.priority} pendingLabel="Not set" />
                  {action.overdue && (
                    <div className="mt-1">
                      <Tag tone="risk">
                        <Clock aria-hidden="true" className="mr-1 inline h-3 w-3" />
                        overdue
                      </Tag>
                    </div>
                  )}
                </td>
                <td className={TD}>
                  <Tag tone={STATUS_TONE[action.status]}>{action.status_display}</Tag>
                  {action.latest_at && (
                    <div className="mt-0.5 text-[11.5px] text-ink-500">
                      {action.latest_by || "Provider not recorded"} · {formatDateTime(action.latest_at)}
                    </div>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{action.records}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className={`${TD} py-6 text-center text-ink-500`}>
                {loading ? "Loading care plan…" : "No care plan actions documented yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
