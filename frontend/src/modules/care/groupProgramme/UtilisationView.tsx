import type { GroupUtilisation } from "../../../lib/groupProgrammeApi";
import { TABLE, TD, TH } from "../shared/styles";
import { Callout, Card } from "../shared/ui";
import { NOTE } from "./styles";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <strong className="block text-[25px] text-ink-900">{value}</strong>
      <span className="text-xs text-ink-500">{label}</span>
    </div>
  );
}

/** The mockup's "Programme utilisation" — aggregate counts only, served as such. */
export function UtilisationView({
  data,
  error,
}: {
  data: GroupUtilisation | null;
  error: string | null;
}) {
  return (
    <div className="min-h-full overflow-auto px-4 py-4 sm:px-8 sm:py-6">
      <h2 className="font-display text-2xl font-semibold text-ink-900">Programme utilisation</h2>
      <p className="mt-[3px] text-xs text-ink-500">
        Confirmed sessions for supervision and quality review.
      </p>
      {error && (
        <Callout tone="danger" role="alert" className="mt-3">
          {error}
        </Callout>
      )}
      <div className="my-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <Stat value={data?.confirmed_sessions ?? 0} label="Confirmed sessions" />
        <Stat value={data?.recorded_attendances ?? 0} label="Recorded attendances" />
        <Stat value={data?.follow_ups_outstanding ?? 0} label="Follow-ups outstanding" />
        <Stat value={data?.linked_intervention_records ?? 0} label="Linked intervention records" />
      </div>
      <Card title="Programme attendance by category" bodyClassName="">
        <div className="overflow-x-auto">
          <table className={TABLE} aria-label="Aggregate group programme utilisation">
            <thead>
              <tr>
                {[
                  "Session category",
                  "Sessions",
                  "Present",
                  "Absent",
                  "Excused",
                  "Declined",
                  "Attendance",
                ].map((heading) => (
                  <th key={heading} className={TH}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.by_category.length ? (
                data.by_category.map((row) => (
                  <tr key={row.category}>
                    <td className={TD}>
                      <strong>{row.category}</strong>
                    </td>
                    <td className={TD}>{row.sessions}</td>
                    <td className={TD}>{row.present}</td>
                    <td className={TD}>{row.absent}</td>
                    <td className={TD}>{row.excused}</td>
                    <td className={TD}>{row.declined}</td>
                    <td className={TD}>{row.attendance_percent}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className={`${TD} ${NOTE}`}>
                    No confirmed attendance data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={`${NOTE} px-3 py-2.5`}>
          Aggregate counts only. Individual observations and risk disclosures are excluded.
        </p>
      </Card>
      <Card title="Clinical continuity" bodyClassName="" className="mt-3.5">
        <div className="overflow-x-auto">
          <table className={TABLE} aria-label="Group psychotherapy clinical continuity">
            <thead>
              <tr>
                <th className={TH}>Continuity metric</th>
                <th className={TH}>Current</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={TD}>Sessions with linked intervention records</td>
                <td className={TD}>{data?.sessions_with_linked_records ?? 0}</td>
              </tr>
              <tr>
                <td className={TD}>Risk disclosures flagged for individual review</td>
                <td className={TD}>{data?.risk_disclosures_flagged ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
