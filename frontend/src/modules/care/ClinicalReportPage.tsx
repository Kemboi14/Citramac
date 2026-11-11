import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  clinicalReportPrintPath,
  getClinicalReport,
  type ClinicalReport,
  type ClinicalReportQuery,
} from "../../lib/carePathwayApi";
import { DocumentActions } from "../../components/DocumentActions";
import { CountSectionTable } from "../clinical/CountSectionTable";
import { formatDateTime } from "./shared/format";
import { BTN, FIELD_LABEL, INPUT } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader } from "./shared/ui";

/**
 * Clinical Report — what the service did for one branch over one period:
 * new episodes, triage priority, ICD-11 diagnoses, admissions and discharges,
 * risk alerts, psychiatric reviews, waiting time and closed episodes. Counts
 * only, small numbers withheld, computed when opened and never stored
 * (apps/care_pathway/clinical_report.py). Opens on last month at the working
 * branch.
 */
export function ClinicalReportPage() {
  const { accessToken } = useAuth();
  const [report, setReport] = useState<ClinicalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ClinicalReportQuery>({});
  // What the shown report was compiled for — the print buttons use exactly this.
  const [shown, setShown] = useState<ClinicalReportQuery>({});

  const show = useCallback((next: ClinicalReport) => {
    const exact = {
      branch: next.branch_id,
      period_start: next.period_start,
      period_end: next.period_end,
    };
    setReport(next);
    setShown(exact);
    setForm(exact);
    setError(null);
  }, []);
  const failed = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Couldn't compile the clinical report.");

  // First open: last month at the working branch (the server's defaults).
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getClinicalReport(accessToken)
      .then((next) => !cancelled && show(next))
      .catch((err) => !cancelled && failed(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accessToken, show]);

  const load = async (query: ClinicalReportQuery) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      show(await getClinicalReport(accessToken, query));
    } catch (err) {
      failed(err);
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void load(form);
  };

  const branches = report?.branches ?? [];
  const period = report ? `${report.period_start} to ${report.period_end}` : "";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Reports & analytics"
        title="Clinical report"
        subtitle="What the service did for one branch over a period: episodes, triage, diagnoses, admissions, risk alerts, psychiatric reviews, waiting time and outcomes."
      />

      <Callout tone="info" label="Counts only">
        No names, identifiers or notes. Each client is counted once per row. Counts of 1–4 are shown
        as &ldquo;&lt;5&rdquo;, and where a total would give a small count away another count is
        withheld too. The report is worked out from the records each time it is opened and is not
        stored.
      </Callout>

      <Card title="Branch and period">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          {branches.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Branch</span>
              <select
                className={INPUT}
                value={form.branch ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>From</span>
            <input
              type="date"
              className={INPUT}
              value={form.period_start ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>To</span>
            <input
              type="date"
              className={INPUT}
              value={form.period_end ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
              required
            />
          </label>
          <button type="submit" className={BTN} disabled={loading}>
            {loading ? "Compiling…" : "Show report"}
          </button>
        </form>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {!report && loading && <p className="text-[13px] text-ink-500">Compiling the report…</p>}

      {report && (
        <Card
          title={`${report.branch_name} · ${period}`}
          aside={
            <DocumentActions
              path={clinicalReportPrintPath(shown)}
              filename={`clinical-report-${report.period_start}-${report.period_end}`}
              label={`Clinical report ${period}`}
              disabled={loading}
            />
          }
        >
          <p className="mb-4 text-xs text-ink-500">
            {report.reference} · compiled {formatDateTime(report.generated_at)}
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            {report.sections.map((section) => (
              <CountSectionTable key={section.code} section={section} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
