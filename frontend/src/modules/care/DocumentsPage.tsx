import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getSignedDocuments, type SignedDocumentRow } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST, BTN_SM, TABLE, TD, TH } from "./shared/styles";
import { EmptyState } from "../../components/EmptyState";
import { TableSkeletonRows } from "../../components/Skeleton";
import { SortHeader, TableFilter } from "./shared/TableControls";
import { useTableControls } from "./shared/useTableControls";
import { Card, ErrorNote, PageHeader, PriorityPill, Tag } from "./shared/ui";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.14 — mockup documents().

const PRIORITY_RANK: Record<string, number> = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
const SORTS = {
  client: (row: SignedDocumentRow) => row.name || "",
  priority: (row: SignedDocumentRow) => PRIORITY_RANK[row.priority] ?? 9,
  signed: (row: SignedDocumentRow) => new Date(row.signed_at).getTime() || null,
};
const searchText = (row: SignedDocumentRow) =>
  [row.document, row.name, row.mrn, row.citramac_number, row.signed_by, row.priority].join(" ");

export function DocumentsPage() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<SignedDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getSignedDocuments(accessToken)
      .then((data) => !cancelled && setRows(data.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load signed documents."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const count = rows?.length ?? 0;
  const controls = useTableControls(rows, { sorts: SORTS, searchText });

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Clinical records"
        title="Documents"
        subtitle="Signed clinical documents linked to client records"
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Card
        title="Signed triage assessments"
        aside={<Tag>{`${count} ${count === 1 ? "document" : "documents"}`}</Tag>}
        bodyClassName="p-0"
      >
        <TableFilter
          controls={controls}
          label="Filter signed documents"
          placeholder="Filter by client or clinician…"
        />
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[780px]`} aria-label="Signed triage documents">
            <thead>
              <tr>
                <th className={TH}>Document</th>
                <SortHeader controls={controls} sortKey="client">
                  Client
                </SortHeader>
                <SortHeader controls={controls} sortKey="priority">
                  Priority
                </SortHeader>
                <SortHeader controls={controls} sortKey="signed">
                  Signed
                </SortHeader>
                <th className={TH}>Clinician</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!rows && !error && <TableSkeletonRows columns={6} />}
              {controls.rows.length > 0
                ? controls.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-surface-bg">
                      <td className={TD}>
                        <strong>{row.document || "Signed triage assessment"}</strong>
                        {row.version > 1 && (
                          <span className="ml-1.5 text-[11px] text-ink-500">v{row.version}</span>
                        )}
                      </td>
                      <td className={TD}>
                        {row.name || "Unknown client"}
                        <br />
                        <span className="break-all text-[11px] text-ink-500">
                          {row.citramac_number || "CITRAMAC ID not recorded"} · MRN{" "}
                          {row.mrn || "not recorded"}
                        </span>
                      </td>
                      <td className={TD}>
                        <PriorityPill priority={row.priority} />
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{formatDateTime(row.signed_at)}</td>
                      <td className={TD}>{row.signed_by || "Clinician not recorded"}</td>
                      <td className={TD}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Link
                            to={`/clinical/documents/${row.id}`}
                            className={`${BTN_GHOST} ${BTN_SM}`}
                          >
                            View
                          </Link>
                          <Link
                            to={clientRecordPath(row.patient_id, "intake")}
                            className={`${BTN_GHOST} ${BTN_SM}`}
                          >
                            Open record
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                : rows && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          title={
                            rows.length === 0
                              ? "No signed documents yet"
                              : "No documents match that filter"
                          }
                        >
                          {rows.length === 0
                            ? "Signed triage assessments appear here once a clinician signs them."
                            : undefined}
                        </EmptyState>
                      </td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
