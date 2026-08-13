import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePatientContext } from "../../clinical/PatientContext";
import { listPatients, type PatientListRow } from "../../lib/clinicalApi";

const ALLERGY_BADGE: Record<string, string> = {
  ACTIVE_ALLERGIES: "bg-status-red-tint text-status-red",
  UNKNOWN: "bg-status-amber-tint text-status-amber",
  NONE: "bg-brand-green-tint text-brand-green-dark",
};

/**
 * Module 1 — replicates the AppSheet reference table columns exactly, per
 * docs/03-DESIGN-SYSTEM.md §3.5 and mockups/appsheet_client_registration_reference.png.
 */
export function ClientRegistryPage() {
  const { accessToken } = useAuth();
  const { selectPatient } = usePatientContext();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    listPatients(accessToken)
      .then((data) => setPatients(data.results))
      .catch(() => setError("Couldn't load the client registry."))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  const openPatient = (patient: PatientListRow) => {
    selectPatient(patient.id, `${patient.first_name} ${patient.last_name}`);
    navigate("/clinical/triage");
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Module 1 · Patient Registration &amp; Demographics
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Client Registry</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/clinical/registry-new")}
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark"
        >
          + New Client
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-surface-bg text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">First Name</th>
              <th className="px-4 py-3">Last Name</th>
              <th className="px-4 py-3">Middle/Other Names</th>
              <th className="px-4 py-3">UHID Number</th>
              <th className="px-4 py-3">Gender</th>
              <th className="px-4 py-3">Date Of Birth</th>
              <th className="px-4 py-3">Age</th>
              <th className="px-4 py-3">Doctor&apos;s Name</th>
              <th className="px-4 py-3">Allergy Status</th>
              <th className="px-4 py-3">Nationality</th>
              <th className="px-4 py-3">Marital Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-ink-500">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-status-red">
                  {error}
                </td>
              </tr>
            )}
            {!isLoading && !error && patients.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-ink-500">
                  No clients registered yet.
                </td>
              </tr>
            )}
            {patients.map((patient) => (
              <tr
                key={patient.id}
                onClick={() => openPatient(patient)}
                className="cursor-pointer border-t border-surface-border hover:bg-brand-green-tint-2"
              >
                <td className="px-4 py-3 text-ink-700">{patient.first_name}</td>
                <td className="px-4 py-3 text-ink-700">{patient.last_name}</td>
                <td className="px-4 py-3 text-ink-700">{patient.middle_other_names}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-700">{patient.uhid_number}</td>
                <td className="px-4 py-3 text-ink-700">{patient.gender}</td>
                <td className="px-4 py-3 text-ink-700">{patient.date_of_birth}</td>
                <td className="px-4 py-3 text-ink-700">{patient.age}</td>
                <td className="px-4 py-3 text-ink-700">{patient.doctors_name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ALLERGY_BADGE[patient.allergy_status] ?? ""}`}
                  >
                    {patient.allergy_status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700">{patient.nationality}</td>
                <td className="px-4 py-3 text-ink-700">{patient.marital_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
