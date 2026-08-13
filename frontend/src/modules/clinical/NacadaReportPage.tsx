import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import {
  exportNacadaReport,
  generateNacadaReport,
  listNacadaReports,
  type NacadaNdoReport,
} from "../../lib/ccpExtrasApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60";

/**
 * NACADA National Drug Observatory report, auto-compiled from
 * SudRehabPlan/UrineDrugScreen data — docs/07-CLINICAL-MODULES-SPEC.md
 * §7.14.6. Submission to NACADA's own systems is a Phase 6+ integration;
 * "export" here just marks the compiled snapshot ready for hand-off.
 */
export function NacadaReportPage() {
  const { accessToken } = useAuth();
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reports, setReports] = useState<NacadaNdoReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    setReports((await listNacadaReports(accessToken)).results);
  };

  useEffect(() => {
    if (!accessToken) return;
    listNacadaReports(accessToken)
      .then((res) => setReports(res.results))
      .catch(() => setError("Couldn't load NACADA reports."));
  }, [accessToken]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !periodStart || !periodEnd) return;
    setError(null);
    setBusy(true);
    try {
      await generateNacadaReport(accessToken, periodStart, periodEnd);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate the report.");
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await exportNacadaReport(accessToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't export the report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          CCP Program · Regulatory Reporting
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">NACADA NDO Report</h1>
      </div>

      <form
        onSubmit={generate}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Generate Report</h2>
        <div className="flex items-end gap-3">
          <label className={LABEL_CLASS}>
            Period start
            <input
              type="date"
              className={FIELD_CLASS}
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              required
            />
          </label>
          <label className={LABEL_CLASS}>
            Period end
            <input
              type="date"
              className={FIELD_CLASS}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} className={BUTTON_CLASS}>
            Generate
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Compiled Reports</h2>
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-sm border border-surface-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink-900">
                  {r.period_start} → {r.period_end}
                </span>
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                    r.status === "EXPORTED"
                      ? "bg-brand-green-tint text-brand-green-dark"
                      : "bg-ink-100 text-ink-700"
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-sm bg-ink-50 p-2 text-xs text-ink-700">
                {JSON.stringify(r.summary_data, null, 2)}
              </pre>
              {r.status === "DRAFT" && (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 text-sm font-semibold text-brand-green hover:underline"
                  onClick={() => exportReport(r.id)}
                >
                  Mark Exported
                </button>
              )}
            </div>
          ))}
          {reports.length === 0 && (
            <p className="text-sm text-ink-500">No reports generated yet.</p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
