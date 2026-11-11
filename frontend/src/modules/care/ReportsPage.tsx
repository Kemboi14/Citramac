import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getCareReports, type CareReports, type Priority } from "../../lib/carePathwayApi";
import { TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader, PriorityPill } from "./shared/ui";

// Operational overview: figures as they stand now. Period counts are the
// Clinical report (ClinicalReportPage).

const PRIORITIES: Priority[] = ["RED", "ORANGE", "YELLOW", "GREEN"];

export function ReportsPage() {
  const { accessToken } = useAuth();
  const [data, setData] = useState<CareReports | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getCareReports(accessToken)
      .then((result) => !cancelled && setData(result))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load the reports."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const v = (value: number | string | undefined) => (data ? String(value ?? 0) : "—");
  const metrics: [string, string][] = [
    ["Clients in care (open episode)", v(data?.clients_in_care)],
    ["Awaiting triage", v(data?.awaiting_triage)],
    ["Triage re-checks due", v(data?.rechecks_due)],
    ["Triages signed today", v(data?.triages_signed_today)],
    ["Inpatients", v(data?.inpatients)],
    ["Occupied beds", data ? `${data.occupied_beds} / ${data.total_beds}` : "—"],
    ["Appointments today", v(data?.appointments_today)],
  ];
  const distribution = PRIORITIES.map((priority) => ({
    priority,
    count: data
      ? String(data.priority_distribution.find((row) => row.priority === priority)?.count ?? 0)
      : "—",
  }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={`Service overview · ${new Date().toLocaleDateString()}`}
        title="Operational overview"
        subtitle="How the service stands right now. For counts over a period, open the Clinical report."
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <Card title="Operational overview" bodyClassName="p-0">
          <table className={TABLE} aria-label="Operational report">
            <thead>
              <tr>
                <th className={TH}>Measure</th>
                <th className={TH}>Current</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([label, value]) => (
                <tr key={label} className="hover:bg-surface-bg">
                  <td className={TD}>{label}</td>
                  <td className={`${TD} tabular-nums`}>
                    <strong>{value}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Clients in care by latest triage priority" bodyClassName="p-0">
          <table className={TABLE} aria-label="Clients in care by latest triage priority">
            <thead>
              <tr>
                <th className={TH}>Priority</th>
                <th className={TH}>Clients</th>
              </tr>
            </thead>
            <tbody>
              {distribution.map(({ priority, count }) => (
                <tr key={priority} className="hover:bg-surface-bg">
                  <td className={TD}>
                    <PriorityPill priority={priority} />
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    <strong>{count}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
