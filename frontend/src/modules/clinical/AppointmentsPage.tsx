import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { MetricTile } from "../../components/MetricTile";
import { ApiError } from "../../lib/apiClient";
import {
  createAppointment,
  listAppointments,
  updateAppointment,
  type Appointment,
  type AppointmentStatus,
} from "../../lib/appointmentsApi";
import { listPatients, type PatientListRow } from "../../lib/clinicalApi";
import { getMhpTeamRoster, type MhpTeamRosterRow } from "../../lib/mhpExtrasApi";

// Appointment types exactly as the approved mockup lists them
// (docs/15-CLINICAL-WORKSPACE-V3.md §1.13). Stored as Appointment.appointment_type text, as
// before. Administrative, not a clinical code; moves to a served ValueSet with the rest (doc C2).
const APPOINTMENT_TYPES = [
  "Psychiatry review",
  "Individual psychotherapy",
  "Family psychotherapy",
  "Group psychotherapy",
  "Medication review",
  "Outpatient follow-up",
];

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: "Confirmed",
  CHECKED_IN: "Checked in",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

const STATUS_TINT: Record<AppointmentStatus, string> = {
  SCHEDULED: "bg-brand-green-tint text-brand-green",
  CHECKED_IN: "bg-brand-green-tint text-brand-green-dark",
  COMPLETED: "bg-surface-bg text-ink-700",
  CANCELLED: "bg-status-red-tint text-status-red",
  NO_SHOW: "bg-status-red-tint text-status-red",
};

const FIELD_CLASS =
  "w-full rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const LABEL_CLASS =
  "flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-top text-[13px] text-ink-900";
const CARD = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const CARD_HEADER =
  "border-b border-surface-border px-[18px] py-3.5 text-[13px] font-bold text-ink-900";
const GHOST_SM =
  "rounded-[9px] border border-surface-border bg-surface-card px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 hover:bg-surface-bg";

function localDateIso(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullName(row: { first_name: string; last_name: string; email?: string }) {
  return `${row.first_name} ${row.last_name}`.trim() || row.email || "Unnamed";
}

/**
 * Appointments — docs/15-CLINICAL-WORKSPACE-V3.md §1.13. Lists today onward.
 *
 * Two deliberate departures from the mockup, both to keep real data honest:
 * - Client is a registry search, not a drop-down of every client. The registry is paginated
 *   and can hold thousands of records.
 * - Provider is picked from the care-team roster, because Appointment.provider is a user
 *   account, not a typed name.
 *
 * Check in and Cancel stay as row actions. They were live on the previous screen, and
 * removing them would take away a working step.
 */
export function AppointmentsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const today = localDateIso(new Date());

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roster, setRoster] = useState<MhpTeamRosterRow[]>([]);

  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<PatientListRow[]>([]);
  const [client, setClient] = useState<PatientListRow | null>(null);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  const [provider, setProvider] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => {
    if (!accessToken) return;
    listAppointments(accessToken, { from: today })
      .then((data) => {
        setAppointments(data.results);
        setLoadError(null);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load appointments."),
      )
      .finally(() => setIsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `refresh` only depends on accessToken/today.
  useEffect(refresh, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    getMhpTeamRoster(accessToken)
      .then(setRoster)
      .catch(() => setRoster([]));
  }, [accessToken]);

  useEffect(() => {
    const query = clientQuery.trim();
    if (!accessToken || client || query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      listPatients(accessToken, { q: query })
        .then((data) => !cancelled && setClientResults(data.results.slice(0, 6)))
        .catch(() => !cancelled && setClientResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, clientQuery, client]);

  // Stale results are hidden rather than cleared in the effect above.
  const shownClientResults = client || clientQuery.trim().length < 2 ? [] : clientResults;

  const sorted = [...appointments].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  const scheduled = sorted.filter((a) => a.status !== "CANCELLED");
  const todayCount = scheduled.filter(
    (a) => localDateIso(new Date(a.scheduled_for)) === today,
  ).length;
  const clientsScheduled = new Set(scheduled.map((a) => a.patient)).size;

  const query = search.trim().toLowerCase();
  const visible = sorted.filter(
    (a) =>
      !query ||
      [a.patient_name, a.appointment_type, a.provider_name, STATUS_LABEL[a.status]]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );

  const setStatus = async (appointment: Appointment, status: AppointmentStatus) => {
    if (!accessToken) return;
    try {
      await updateAppointment(accessToken, appointment.id, { status });
      refresh();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't update the appointment.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    if (!client) {
      setFormError("Select a client from the search results.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await createAppointment(accessToken, {
        patient: client.id,
        scheduled_for: new Date(`${date}T${time}`).toISOString(),
        appointment_type: appointmentType,
        provider: provider || null,
      });
      setClient(null);
      setClientQuery("");
      setTime("");
      setAppointmentType("");
      setProvider("");
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't add the appointment.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-900">Appointments</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            Review upcoming visits and schedule client appointments
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/clinical/caseload")}
          className="rounded-[9px] border border-surface-border bg-surface-card px-4 py-2 text-[13px] font-semibold text-ink-900 transition-colors duration-150 hover:bg-surface-bg"
        >
          My Caseload
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile value={scheduled.length} label="Scheduled Appointments" />
        <MetricTile value={todayCount} label="Today" />
        <MetricTile value={clientsScheduled} label="Clients Scheduled" />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <div className={CARD_HEADER}>Upcoming Schedule</div>
          <div className="p-[18px]">
            <label className={LABEL_CLASS}>
              Search appointments
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client, type, provider, or status..."
                className={FIELD_CLASS}
              />
            </label>
          </div>
          {loadError && (
            <p className="mx-[18px] mb-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {loadError}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Date &amp; Time</th>
                  <th className={TH}>Client</th>
                  <th className={TH}>Appointment</th>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={5} className={`${TD} text-center text-ink-500`}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                      {sorted.length === 0
                        ? "No upcoming appointments."
                        : "No appointments match this search."}
                    </td>
                  </tr>
                )}
                {visible.map((a) => {
                  const when = new Date(a.scheduled_for);
                  return (
                    <tr key={a.id} className="hover:bg-surface-bg">
                      <td className={TD}>
                        <strong>{when.toLocaleDateString()}</strong>
                        <br />
                        <span className="text-[11px] text-ink-500">
                          {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className={TD}>{a.patient_name}</td>
                      <td className={TD}>{a.appointment_type || "Appointment"}</td>
                      <td className={TD}>{a.provider_name || "Not assigned"}</td>
                      <td className={TD}>
                        <span
                          className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_TINT[a.status]}`}
                        >
                          {STATUS_LABEL[a.status]}
                        </span>
                        {a.status === "SCHEDULED" && (
                          <div className="mt-1.5 flex gap-1">
                            <button
                              type="button"
                              className={`${GHOST_SM} text-ink-900`}
                              onClick={() => setStatus(a, "CHECKED_IN")}
                            >
                              Check in
                            </button>
                            <button
                              type="button"
                              className={`${GHOST_SM} text-status-red`}
                              onClick={() => setStatus(a, "CANCELLED")}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={CARD}>
          <div className={CARD_HEADER}>Schedule an Appointment</div>
          <form onSubmit={submit} className="flex flex-col gap-3 p-[18px]">
            <div className="relative">
              <label className={LABEL_CLASS}>
                Client
                <input
                  type="search"
                  value={
                    client
                      ? `${fullName(client)} · ${client.citramac_number || client.uhid_number}`
                      : clientQuery
                  }
                  onChange={(e) => {
                    setClient(null);
                    setClientQuery(e.target.value);
                  }}
                  placeholder="Search by name, UHID or CITRAMAC ID"
                  autoComplete="off"
                  required
                  className={FIELD_CLASS}
                />
              </label>
              {shownClientResults.length > 0 && (
                <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-md">
                  {shownClientResults.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setClient(row);
                        setClientResults([]);
                      }}
                      className="block w-full border-b border-surface-border px-3 py-2 text-left text-[12.5px] text-ink-900 last:border-b-0 hover:bg-surface-bg"
                    >
                      <strong>{fullName(row)}</strong>
                      <span className="ml-2 text-[11px] text-ink-500">
                        {row.citramac_number || row.uhid_number}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={LABEL_CLASS}>
                Date
                <input
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className={FIELD_CLASS}
                />
              </label>
              <label className={LABEL_CLASS}>
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className={FIELD_CLASS}
                />
              </label>
            </div>
            <label className={LABEL_CLASS}>
              Appointment type
              <select
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value)}
                required
                className={FIELD_CLASS}
              >
                <option value="">Select appointment type</option>
                {APPOINTMENT_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">Select clinician or therapist</option>
                {roster.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {fullName(member)}
                  </option>
                ))}
              </select>
            </label>
            {formError && (
              <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {formError}
              </p>
            )}
            <div>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-[9px] bg-brand-green px-4 py-2 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:bg-brand-green-dark disabled:opacity-60"
              >
                {isSaving ? "Adding…" : "Add Appointment"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
