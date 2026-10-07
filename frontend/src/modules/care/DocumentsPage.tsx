import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getSignedDocuments, type SignedDocumentRow } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST, BTN_SM, TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader, PriorityPill, Tag } from "./shared/ui";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.14 — mockup documents().

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
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[780px]`} aria-label="Signed triage documents">
            <thead>
              <tr>
                <th className={TH}>Document</th>
                <th className={TH}>Client</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Signed</th>
                <th className={TH}>Clinician</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows && rows.length > 0 ? (
                rows.map((row) => (
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
              ) : (
                <tr>
                  <td colSpan={6} className={`${TD} !p-6 text-center !text-ink-500`}>
                    {rows
                      ? "No signed triage documents are available yet."
                      : error
                        ? "—"
                        : "Loading documents…"}
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
