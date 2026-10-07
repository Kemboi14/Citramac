import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { MetricTile } from "../../components/MetricTile";
import { ApiError } from "../../lib/apiClient";
import { getCaseload, type CaseloadRow } from "../../lib/caseloadApi";
import { initialsAndLabel } from "../../shells/userDisplay";
import { clientRecordPath } from "../care/shared/recordRoutes";
import { PriorityPill } from "../care/shared/ui";

const FIELD_CLASS =
  "w-full rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-top text-[13px] text-ink-900";
const TAG =
  "inline-block whitespace-nowrap rounded-md border border-surface-border bg-surface-bg px-2 py-0.5 text-[11px] font-medium text-ink-900";

function careSetting(row: CaseloadRow) {
  if (row.care_setting === "OUTPATIENT") return "Outpatient";
  return `${row.ward ?? "Inpatient"}${row.bed ? ` · Bed ${row.bed}` : ""}`;
}

function nextAppointment(row: CaseloadRow) {
  if (!row.next_appointment) return "Not scheduled";
  return new Date(row.next_appointment.scheduled_for).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * My Caseload — docs/15-CLINICAL-WORKSPACE-V3.md §1.12 (mapping M9). Priority is
 * the client's latest signed triage priority; "Pending triage" when none.
 */
export function CaseloadPage() {
  const { accessToken, claims } = useAuth();
  const { selectPatient } = usePatientContext();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CaseloadRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getCaseload(accessToken)
      .then((data) => !cancelled && setRows(data.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load your caseload."),
      )
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const query = search.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      !query ||
      [
        row.name,
        row.citramac_number,
        row.uhid_number,
        row.diagnosis?.code,
        row.diagnosis?.description,
        row.status,
        row.priority,
        careSetting(row),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  const inpatients = rows.filter((row) => row.care_setting === "INPATIENT").length;
  const redOrange = rows.filter(
    (row) => row.priority === "RED" || row.priority === "ORANGE",
  ).length;

  const openRecord = (row: CaseloadRow) => {
    selectPatient(row.id, row.name);
    navigate(clientRecordPath(row.id, "intake"));
  };

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-900">My Caseload</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            Clients assigned to {initialsAndLabel(claims).name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/clinical/appointments")}
          className="rounded-[9px] bg-brand-green px-4 py-2 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:bg-brand-green-dark"
        >
          View Appointments
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile value={rows.length} label="Assigned Clients" />
        <MetricTile value={inpatients} label="Inpatients" />
        <MetricTile value={rows.length - inpatients} label="Outpatients" />
        <MetricTile value={redOrange} label="RED / ORANGE Priority" />
      </div>

      <section className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex items-center justify-between gap-2.5 border-b border-surface-border px-[18px] py-3.5 text-[13px] font-bold text-ink-900">
          Assigned Clients
          <span className={TAG}>
            {rows.length} {rows.length === 1 ? "client" : "clients"}
          </span>
        </div>
        <div className="p-[18px]">
          <label className="flex max-w-[420px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Search your caseload
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, diagnosis, or status..."
              className={FIELD_CLASS}
            />
          </label>
        </div>
        {error && (
          <p className="mx-[18px] mb-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Diagnosis</th>
                <th className={TH}>Care Setting</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Status</th>
                <th className={TH}>Next Appointment</th>
                <th className={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className={`${TD} text-center text-ink-500`}>
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className={`${TD} py-6 text-center text-ink-500`}>
                    {rows.length === 0
                      ? "No clients are assigned to you yet."
                      : "No clients match this search."}
                  </td>
                </tr>
              )}
              {visible.map((row) => (
                <tr key={row.id} className="hover:bg-surface-bg">
                  <td className={TD}>
                    <strong>{row.name}</strong>
                    <br />
                    <span className="text-[11px] text-ink-500">
                      {row.citramac_number || row.uhid_number || "—"}
                    </span>
                  </td>
                  <td className={TD}>
                    {row.diagnosis
                      ? `${row.diagnosis.code} — ${row.diagnosis.description}`
                      : "Not recorded"}
                  </td>
                  <td className={TD}>
                    <span
                      className={
                        row.care_setting === "INPATIENT"
                          ? "inline-block whitespace-nowrap rounded-md bg-status-red-tint px-2 py-0.5 text-[11px] font-medium text-status-red"
                          : TAG
                      }
                    >
                      {careSetting(row)}
                    </span>
                  </td>
                  <td className={TD}>
                    <PriorityPill priority={row.priority} />
                  </td>
                  <td className={TD}>
                    <span className={TAG}>{row.status}</span>
                  </td>
                  <td className={TD}>{nextAppointment(row)}</td>
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => openRecord(row)}
                      className="rounded-[9px] border border-surface-border bg-surface-card px-3 py-1 text-xs font-semibold text-ink-900 transition-colors duration-150 hover:bg-surface-bg"
                    >
                      Open record
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
