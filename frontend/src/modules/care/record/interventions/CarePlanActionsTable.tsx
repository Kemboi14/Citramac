import type { InterventionAction, PriorityOrBlank } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { TABLE, TD, TH } from "../../shared/styles";
import { Card, PriorityPill, Tag } from "../../shared/ui";

/** "Care-plan actions — what the plan asked for": status, latest record and
 * how many deliveries (excluding corrected ones) each action has. The
 * Priority column is the client's current signed triage priority, as in the
 * mockup (`renderInterventionData` uses `client.priority` on every row). */
export function CarePlanActionsTable({
  actions,
  loading,
  triagePriority,
}: {
  actions: InterventionAction[];
  loading: boolean;
  triagePriority: PriorityOrBlank;
}) {
  return (
    <Card bodyClassName="overflow-x-auto">
      <table className={`${TABLE} min-w-[600px]`}>
        <thead>
          <tr>
            <th className={`${TH} text-ink-700`}>Action</th>
            <th className={`${TH} text-ink-700`}>Priority</th>
            <th className={`${TH} text-ink-700`}>Status</th>
            <th className={`${TH} text-right text-ink-700`}>Records</th>
          </tr>
        </thead>
        <tbody>
          {actions.length > 0 ? (
            actions.map((action) => (
              <tr key={action.id}>
                <td className={`${TD} align-middle`}>
                  <strong>{action.title}</strong>
                </td>
                <td className={`${TD} align-middle`}>
                  <PriorityPill priority={triagePriority} pendingLabel="Not recorded" />
                </td>
                <td className={`${TD} align-middle`}>
                  <Tag>{action.status_display}</Tag>
                  {action.latest_at && (
                    <div className="mt-0.5 text-[11px] text-ink-700">
                      {action.latest_by || "Provider not recorded"} ·{" "}
                      {formatDateTime(action.latest_at)}
                    </div>
                  )}
                </td>
                <td className={`${TD} text-right align-middle`}>{action.records}</td>
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
