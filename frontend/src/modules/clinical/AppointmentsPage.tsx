import { useEffect, useState } from "react";
import { CalendarClock, Mail } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import { WeekCalendar } from "../../components/WeekCalendar";
import {
  createAppointment,
  listAppointments,
  updateAppointment,
  type Appointment,
  type AppointmentMode,
  type AppointmentStatus,
} from "../../lib/appointmentsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";

const FILTERS = ["Today", "Upcoming", "Past", "Cancelled", "All"] as const;
type Filter = (typeof FILTERS)[number];
type ViewMode = "Week" | "Agenda";

const STATUS_TINT: Record<AppointmentStatus, string> = {
  SCHEDULED: "bg-status-amber-tint text-status-amber",
  CHECKED_IN: "bg-brand-green-tint text-brand-green-dark",
  COMPLETED: "bg-brand-green-tint text-brand-green-dark",
  CANCELLED: "bg-status-red-tint text-status-red",
  NO_SHOW: "bg-status-red-tint text-status-red",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Appointments Calendar — rebuilt against the second (2026-09) clinical-
 * workspace mockup: a real week-grid is now the default view
 * (`WeekCalendar.tsx`); the original filtered flat list isn't deleted, it
 * becomes the "Agenda" toggle mode, which several clinicians may still
 * prefer for scanning a long list quickly.
 *
 * Every SCHEDULED appointment with a patient contact email gets a real
 * reminder email (apps.client_registry.tasks.send_appointment_reminders,
 * a Celery beat job every 15 minutes) once it falls inside
 * APPOINTMENT_REMINDER_HOURS_BEFORE (24h by default) of its time — the
 * detail sidebar's "Reminder sent/pending" pill reflects the backend's
 * own `reminder_sent_at` field, it isn't a frontend-only indicator.
 */
export function AppointmentsPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [view, setView] = useState<ViewMode>("Week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [filter, setFilter] = useState<Filter>("Upcoming");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scheduledFor, setScheduledFor] = useState("");
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState("");
  const [mode, setMode] = useState<AppointmentMode>("IN_PERSON");
  const [appointmentType, setAppointmentType] = useState("");

  const refresh = () => {
    if (!accessToken) return;
    listAppointments(accessToken)
      .then((data) => setAppointments(data.results))
      .catch(() => setError("Couldn't load appointments."));
  };

  useEffect(refresh, [accessToken]);

  const book = async () => {
    if (!accessToken || !selected || !scheduledFor) return;
    setError(null);
    try {
      await createAppointment(accessToken, {
        patient: selected.patientId,
        scheduled_for: new Date(scheduledFor).toISOString(),
        duration_minutes: duration,
        location,
        mode,
        appointment_type: appointmentType,
      });
      setScheduledFor("");
      setAppointmentType("");
      setLocation("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't book the appointment.");
      throw err;
    }
  };

  const setStatus = async (appointment: Appointment, status: AppointmentStatus) => {
    if (!accessToken) return;
    await updateAppointment(accessToken, appointment.id, { status });
    setSelectedAppointment((prev) => (prev?.id === appointment.id ? { ...prev, status } : prev));
    refresh();
  };

  const today = todayIso();
  const filtered = appointments.filter((appointment) => {
    const date = appointment.scheduled_for.slice(0, 10);
    if (filter === "Today") return date === today;
    if (filter === "Upcoming") return date >= today && appointment.status !== "CANCELLED";
    if (filter === "Past") return date < today;
    if (filter === "Cancelled") return appointment.status === "CANCELLED";
    return true;
  });

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Appointments
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Appointments Calendar</h1>
        </div>
        <div className="flex rounded-md border border-surface-border bg-white p-0.5">
          {(["Week", "Agenda"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-sm px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors duration-150 ${
                view === v ? "bg-brand-green text-white" : "text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
            Book for {selected.patientName}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className={LABEL_CLASS}>
              Date &amp; time
              <input
                type="datetime-local"
                className={FIELD_CLASS}
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </label>
            <label className={LABEL_CLASS}>
              Duration (min)
              <input
                type="number"
                min={5}
                step={5}
                className={`${FIELD_CLASS} w-24`}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label className={LABEL_CLASS}>
              Mode
              <select
                className={FIELD_CLASS}
                value={mode}
                onChange={(e) => setMode(e.target.value as AppointmentMode)}
              >
                <option value="IN_PERSON">In person</option>
                <option value="PHONE">Phone</option>
                <option value="VIDEO">Video</option>
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Location
              <input
                className={FIELD_CLASS}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Consultation room 2"
              />
            </label>
            <label className={`${LABEL_CLASS} flex-1 min-w-[200px]`}>
              Type
              <input
                className={FIELD_CLASS}
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value)}
                placeholder="Psychiatric review"
              />
            </label>
            <SaveButton onSave={book} disabled={!scheduledFor}>
              Book appointment
            </SaveButton>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {view === "Week" ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <WeekCalendar
              weekStart={weekStart}
              onWeekChange={setWeekStart}
              appointments={appointments}
              onSelectAppointment={setSelectedAppointment}
            />
          </div>
          <aside className="rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
            {!selectedAppointment && (
              <p className="text-[12.5px] text-ink-500">
                Select an appointment on the grid to view its details.
              </p>
            )}
            {selectedAppointment && (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="font-display text-[14px] font-semibold text-ink-900">
                    {selectedAppointment.appointment_type || "Appointment"}
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-500">
                    {selectedAppointment.patient_name}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-md border border-surface-border p-2">
                    <span className="text-ink-400">Date</span>
                    <div className="font-semibold text-ink-900">
                      {new Date(selectedAppointment.scheduled_for).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-surface-border p-2">
                    <span className="text-ink-400">Time</span>
                    <div className="font-semibold text-ink-900">
                      {new Date(selectedAppointment.scheduled_for).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      ({selectedAppointment.duration_minutes} min)
                    </div>
                  </div>
                  <div className="rounded-md border border-surface-border p-2">
                    <span className="text-ink-400">Mode</span>
                    <div className="font-semibold text-ink-900">
                      {selectedAppointment.mode.replace("_", " ")}
                    </div>
                  </div>
                  <div className="rounded-md border border-surface-border p-2">
                    <span className="text-ink-400">Location</span>
                    <div className="font-semibold text-ink-900">
                      {selectedAppointment.location || "—"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_TINT[selectedAppointment.status]}`}
                  >
                    {selectedAppointment.status.replace(/_/g, " ")}
                  </span>
                  {selectedAppointment.status === "SCHEDULED" && (
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        selectedAppointment.reminder_sent_at
                          ? "bg-brand-green-tint text-brand-green-dark"
                          : "bg-surface-bg text-ink-500"
                      }`}
                      title={
                        selectedAppointment.reminder_sent_at
                          ? `Reminder emailed ${new Date(selectedAppointment.reminder_sent_at).toLocaleString()}`
                          : "No reminder email sent yet"
                      }
                    >
                      <Mail className="h-3 w-3" />
                      {selectedAppointment.reminder_sent_at ? "Reminder sent" : "Reminder pending"}
                    </span>
                  )}
                </div>
                {selectedAppointment.status === "SCHEDULED" && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="flex-1 rounded-sm border border-surface-border px-2 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-brand-green-tint-2"
                      onClick={() => setStatus(selectedAppointment, "CHECKED_IN")}
                    >
                      Check in
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-sm border border-surface-border px-2 py-1.5 text-[11px] font-semibold text-status-red hover:bg-status-red-tint"
                      onClick={() => setStatus(selectedAppointment, "CANCELLED")}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="flex gap-1 border-b border-surface-border">
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`border-b-2 px-3 py-2 text-[11px] font-bold transition-colors duration-150 ${
                  filter === option
                    ? "border-brand-green text-brand-green-dark"
                    : "border-transparent text-ink-500 hover:text-brand-green-dark"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div
            key={filter}
            className="animate-fade-in rounded-lg border border-surface-border bg-surface-card shadow-sm"
          >
            {filtered.length === 0 && (
              <p className="p-6 text-center text-sm text-ink-500">No appointments in this view.</p>
            )}
            {filtered.map((appointment) => (
              <div
                key={appointment.id}
                className="flex items-center gap-3 border-t border-surface-bg p-4 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink-900">
                    {appointment.patient_name} · {appointment.appointment_type || "Appointment"}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(appointment.scheduled_for).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    ({appointment.duration_minutes} min) ·{" "}
                    {appointment.location || "No location set"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_TINT[appointment.status]}`}
                >
                  {appointment.status.replace(/_/g, " ")}
                </span>
                {appointment.status === "SCHEDULED" && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="rounded-sm border border-surface-border px-2 py-1 text-[11px] font-semibold text-ink-700 hover:bg-brand-green-tint-2"
                      onClick={() => setStatus(appointment, "CHECKED_IN")}
                    >
                      Check in
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-surface-border px-2 py-1 text-[11px] font-semibold text-status-red hover:bg-status-red-tint"
                      onClick={() => setStatus(appointment, "CANCELLED")}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
