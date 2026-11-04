import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  listClientRegistry,
  type ClientRegistryCategory,
  type ClientRegistryRow,
} from "../../lib/clinicalApi";
import { PageHeader, PriorityPill } from "../care/shared/ui";
import { clientRecordPath } from "../care/shared/recordRoutes";

const TABS: { label: string; category?: ClientRegistryCategory }[] = [
  { label: "All" },
  { label: "Awaiting triage", category: "awaiting-triage" },
  { label: "Emergency", category: "emergency" },
  { label: "Inpatient", category: "INPATIENT" },
  { label: "Outpatient", category: "OUTPATIENT" },
  { label: "Residential", category: "RESIDENTIAL" },
];

function sexLabel(sex: string) {
  if (sex === "MALE") return "M";
  if (sex === "FEMALE") return "F";
  if (sex === "NOT_STATED" || sex === "NOT_SAID") return "—";
  return sex ? "Other" : "—";
}

function settingLabel(setting: string) {
  switch (setting) {
    case "INPATIENT":
      return "Inpatient";
    case "OUTPATIENT":
      return "Outpatient";
    case "RESIDENTIAL":
      return "Residential";
    case "PARTIAL":
      return "Partial";
    case "POSTTREATMENT_SUPPORT":
      return "Post-treatment support";
    default:
      return setting || "—";
  }
}

function allergyLabel(patient: ClientRegistryRow) {
  if (patient.allergies.length) return `ALLERGY: ${patient.allergies.join(", ")}`;
  if (patient.allergy_status === "UNKNOWN") return "Unknown";
  if (patient.allergy_status === "NONE") return "None recorded";
  return "Active allergies on file";
}

export function ClientRegistryPage() {
  const { accessToken } = useAuth();
  const { selectPatient } = usePatientContext();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<ClientRegistryRow[]>([]);
  const [count, setCount] = useState(0);
  const [category, setCategory] = useState<ClientRegistryCategory | undefined>();
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(() => {
    if (!accessToken) return;
    const requestId = ++requestSequence.current;
    setIsLoading(true);
    setError(null);
    listClientRegistry(accessToken, { category, page })
      .then((data) => {
        if (requestId !== requestSequence.current) return;
        setPatients(data.results);
        setCount(data.total_count);
        setHasNext(data.next !== null);
        setHasPrevious(data.previous !== null);
      })
      .catch((err: unknown) => {
        if (requestId === requestSequence.current) {
          setError(err instanceof ApiError ? err.message : "Couldn't load the client registry.");
        }
      })
      .finally(() => {
        if (requestId === requestSequence.current) setIsLoading(false);
      });
  }, [accessToken, category, page]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) reload();
    });
    return () => {
      cancelled = true;
      requestSequence.current += 1;
    };
  }, [reload]);

  const openPatient = (patient: ClientRegistryRow) => {
    selectPatient(patient.id, patient.name);
    navigate(clientRecordPath(patient.id, "triage"));
  };

  const activeTab = category ?? "";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Clients"
        subtitle={
          <>
            {isLoading ? "Loading" : error ? "—" : count} client records · one record per person,
            encounters and episodes beneath it
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => navigate("/clinical/registration")}
            className="flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition-colors duration-150 hover:bg-brand-green-dark"
          >
            <Plus className="h-4 w-4" />
            Register client
          </button>
        }
      />

      <div
        role="tablist"
        aria-label="Filter clients"
        className="mb-5 flex overflow-x-auto rounded-lg border border-surface-border bg-surface-card"
      >
        {TABS.map((tab) => {
          const selected = activeTab === (tab.category ?? "");
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setCategory(tab.category);
                setPage(1);
              }}
              className={`shrink-0 border-r border-surface-border px-4 py-2 text-[13px] transition-colors last:border-r-0 ${
                selected
                  ? "bg-brand-green-tint font-semibold text-brand-green-dark"
                  : "text-ink-700 hover:bg-surface-bg hover:text-ink-900"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[1060px] border-collapse text-left text-[13px]">
          <thead className="border-b border-surface-border bg-surface-bg text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Age / sex</th>
              <th className="px-4 py-3">Setting</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Allergies</th>
              <th className="px-4 py-3">Responsible team</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  Loading clients…
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-status-red" role="alert">
                  <div>{error}</div>
                  <button
                    type="button"
                    onClick={reload}
                    className="mt-2 font-semibold text-brand-green-dark underline"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            )}
            {!isLoading && !error && patients.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  No clients in this view.
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              patients.map((patient) => (
                <tr
                  key={patient.id}
                  onClick={() => openPatient(patient)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPatient(patient);
                    }
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-surface-border last:border-b-0 transition-colors duration-150 hover:bg-brand-green-tint-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
                >
                  <td className="px-4 py-3 font-semibold text-ink-900">
                    <span>{patient.name}</span>
                    <span className="ml-3 font-mono font-normal text-ink-500">
                      {patient.client_number || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                    {patient.age ?? "—"} · {sexLabel(patient.sex)}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{settingLabel(patient.setting)}</td>
                  <td className="px-4 py-3">
                    <PriorityPill priority={patient.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
                      {patient.status}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 font-semibold ${
                      patient.allergies.length || patient.allergy_status === "ACTIVE_ALLERGIES"
                        ? "text-status-red"
                        : "text-ink-700"
                    }`}
                  >
                    {allergyLabel(patient)}
                  </td>
                  <td className="px-4 py-3 text-ink-700">{patient.responsible_team || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(hasNext || hasPrevious) && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-700">
          <button
            type="button"
            onClick={() => {
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={!hasPrevious || isLoading}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-ink-900 transition-colors hover:bg-surface-bg disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            onClick={() => {
              setPage((current) => current + 1);
            }}
            disabled={!hasNext || isLoading}
            className="rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-ink-900 transition-colors hover:bg-surface-bg disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
