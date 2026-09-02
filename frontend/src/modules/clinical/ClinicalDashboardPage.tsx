import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, FileText, Paperclip, Users } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { StatCard } from "../../components/StatCard";
import { getClinicalDashboardSummary, type ClinicalDashboardSummary } from "../../lib/dashboardApi";

const WORKFLOW_STEPS = [
  "Client Registration",
  "Client History",
  "Assessment",
  "Clinical Encounter",
  "Diagnosis / Treatment",
  "Care Plan / Follow-up",
  "Discharge / After-care",
];

/** Clinical Workspace landing page — mockups/citramac_clinical_workspace.html. */
export function ClinicalDashboardPage() {
  const { accessToken } = useAuth();
  const { selectPatient } = usePatientContext();
  const [summary, setSummary] = useState<ClinicalDashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getClinicalDashboardSummary(accessToken)
      .then(setSummary)
      .catch(() => setError("Couldn't load the dashboard summary."));
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Care delivery and documentation
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Coordinate safe, connected care across outpatient, inpatient and community services.
        </p>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="grid grid-cols-4 gap-3.5 max-md:grid-cols-2">
        <StatCard
          icon={Users}
          value={summary?.registered_clients ?? "—"}
          label="Registered clients"
        />
        <StatCard
          icon={CalendarClock}
          tone="amber"
          value={summary?.appointments_today ?? "—"}
          label="Today's appointments"
        />
        <StatCard
          icon={FileText}
          value={summary?.active_admissions ?? "—"}
          label="Active admissions"
        />
        <StatCard
          icon={Paperclip}
          value={summary?.attachments_total ?? "—"}
          label="Documents on file"
        />
      </div>

      <div className="grid grid-cols-[1.35fr_0.8fr] gap-4 max-lg:grid-cols-1">
        <section className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-ink-900">
              Today&apos;s appointments
            </h2>
            <Link
              to="/clinical/appointments"
              className="text-[11px] font-semibold text-brand-green"
            >
              View calendar
            </Link>
          </div>
          {!summary?.recent_appointments.length && (
            <p className="text-sm text-ink-500">No appointments scheduled for today.</p>
          )}
          {summary?.recent_appointments.map((appointment) => (
            <div
              key={appointment.id}
              className="flex items-center gap-3 border-t border-surface-bg py-3 first:border-t-0"
            >
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink-900">
                  {appointment.patient_name} · {appointment.appointment_type || "Appointment"}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {new Date(appointment.scheduled_for).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {appointment.location || "Location TBC"}
                </p>
              </div>
              <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-[10px] font-semibold text-brand-green-dark">
                {appointment.status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
          <h2 className="mb-3 font-display text-[15px] font-semibold text-ink-900">
            Clinical workflow
          </h2>
          <div className="flex flex-col">
            {WORKFLOW_STEPS.map((step, index) => (
              <div key={step} className="flex items-center gap-3 py-1.5">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-brand-green-tint text-[10px] font-bold text-brand-green">
                  {index + 1}
                </span>
                <span className="text-[13px] font-medium text-ink-700">{step}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-md bg-brand-green-tint p-2.5 text-[10.5px] leading-relaxed text-brand-green-dark">
            Care records stay connected across outpatient, inpatient, and after-care workflows.
          </p>
        </section>
      </div>

      <section className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-semibold text-ink-900">
            Recently registered clients
          </h2>
          <Link to="/clinical/registry" className="text-[11px] font-semibold text-brand-green">
            Open Client Registry
          </Link>
        </div>
        {!summary?.recent_patients.length && (
          <p className="text-sm text-ink-500">No clients registered yet.</p>
        )}
        <div className="flex flex-col">
          {summary?.recent_patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              onClick={() =>
                selectPatient(patient.id, `${patient.first_name} ${patient.last_name}`)
              }
              className="flex items-center justify-between border-t border-surface-bg py-3 text-left first:border-t-0 hover:bg-brand-green-tint-2"
            >
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {patient.first_name} {patient.last_name}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {patient.uhid_number || patient.citramac_number} · {patient.gender}
                </p>
              </div>
              <span className="text-xs text-ink-500">
                {new Date(patient.registered_at).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
