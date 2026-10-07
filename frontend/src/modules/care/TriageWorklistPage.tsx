import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { getTriageWorklist, type WorklistRow } from "../../lib/carePathwayApi";
import { formatDateTime, formatTime } from "./shared/format";
import { BTN_GHOST, BTN_SM, TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.5 — mockup triageWorklist(). The server
// decides which encounters are included and which are overdue; this page sorts
// overdue first, then due time, and refreshes every minute.

const REFRESH_MS = 60_000;

function sortRows(rows: WorklistRow[]) {
  const due = (row: WorklistRow) => {
    const t = new Date(row.due_at).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return [...rows].sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue) || due(a) - due(b));
}

export function TriageWorklistPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<WorklistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (isCancelled: () => boolean) => {
      if (!accessToken) return;
      getTriageWorklist(accessToken)
        .then((data) => {
          if (isCancelled()) return;
          setRows(sortRows(data.results));
          setError(null);
        })
        .catch((err) => {
          if (isCancelled()) return;
          setError(errorText(err, "Couldn't refresh the triage worklist — check your connection."));
        });
    },
    [accessToken],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    load(isCancelled);
    const timer = window.setInterval(() => load(isCancelled), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const items = rows ?? [];
  const overdue = items.filter((row) => row.is_overdue).length;
  const count = rows
    ? `${items.length} ${items.length === 1 ? "item" : "items"} · ${overdue} overdue`
    : "Loading…";

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        eyebrow="Clinical workflow"
        title="Triage — awaiting and re-checks due"
        subtitle={
          <>
            <p>{count}</p>
            <p>Overdue first, then due time. Priority is assigned after triage.</p>
          </>
        }
      />
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <Card
        title="Triage — awaiting and re-checks due"
        aside={<Tag>{count}</Tag>}
        bodyClassName="overflow-x-auto"
        className="overflow-hidden"
      >
        <table className={`${TABLE} min-w-[780px]`} aria-label="Triage awaiting and re-checks due">
          <thead>
            <tr>
              <th className={TH}>Client</th>
              <th className={TH}>Setting / status</th>
              <th className={TH}>Detail</th>
              <th className={TH}>Due</th>
              <th className={TH}>
                <span className="sr-only">Open encounter</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows && items.length === 0 && (
              <tr>
                <td colSpan={5} className={`${TD} !p-6 text-center !text-ink-500`}>
                  No arrivals or re-checks are currently due.
                </td>
              </tr>
            )}
            {items.map((row) => {
              const recheck = row.status === "RECHECK_DUE";
              const cell = `${TD} leading-[1.45] ${row.is_overdue ? "bg-priority-red-tint" : ""}`;
              return (
                <tr key={row.id}>
                  <td
                    className={`${cell} ${row.is_overdue ? "shadow-[inset_3px_0_var(--pri-red)]" : ""}`}
                  >
                    <strong>
                      {row.name || "Unknown client"} · {row.mrn || row.citramac_number}
                    </strong>
                    <br />
                    <span className="text-[11px] text-ink-500">
                      {row.citramac_number || "CITRAMAC ID not recorded"}
                    </span>
                  </td>
                  <td className={cell}>
                    {row.setting === "INPATIENT" ? "Inpatient" : "Outpatient"} · {row.status_label}
                  </td>
                  <td className={cell}>
                    {recheck
                      ? `Re-check due · last triage v${row.triage_version || 1} ${formatTime(row.last_triaged_at)}`
                      : `${row.wait_minutes} min · triage target`}
                    {row.is_overdue && (
                      <>
                        <br />
                        <span className="text-[11px] font-bold uppercase text-priority-red">
                          Overdue
                        </span>
                      </>
                    )}
                  </td>
                  <td className={cell}>{formatDateTime(row.due_at)}</td>
                  <td className={cell}>
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      aria-label={`Open ${recheck ? "re-check" : "triage"} for ${row.name || "client"}`}
                      onClick={() => navigate(`/clinical/triage/${row.id}`)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
