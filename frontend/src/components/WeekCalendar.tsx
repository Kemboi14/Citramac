import { Fragment } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Appointment } from "../lib/appointmentsApi";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 07:00–19:00

// Small, deterministic palette keyed by a hash of the appointment type —
// purely a visual grouping aid (matches the mockup's colour-coded week
// grid), not a real backend category, so no fixed type→colour mapping is
// invented. Falls back to the brand green for an untyped appointment.
const PALETTE = [
  { bg: "bg-brand-green-tint", text: "text-brand-green-dark" },
  { bg: "bg-[#eaf1fc]", text: "text-[#1a63c9]" },
  { bg: "bg-[#f0eafd]", text: "text-[#6840a2]" },
  { bg: "bg-status-amber-tint", text: "text-status-amber" },
  { bg: "bg-status-red-tint", text: "text-status-red" },
];

function colorFor(appointment: Appointment) {
  if (!appointment.appointment_type) return PALETTE[0];
  let hash = 0;
  for (const ch of appointment.appointment_type) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/**
 * Week-view appointments calendar — the second clinical-workspace mockup's
 * default Appointments layout (day columns × hourly rows, colour-coded
 * events, mini month picker), hand-rolled with native `Date` since the
 * project has no calendar/date library dependency and this is the only
 * screen that needs one. `weekStart` is always normalised to the Sunday of
 * its week.
 */
export function WeekCalendar({
  weekStart,
  onWeekChange,
  appointments,
  onSelectAppointment,
}: {
  weekStart: Date;
  onWeekChange: (next: Date) => void;
  appointments: Appointment[];
  onSelectAppointment: (appointment: Appointment) => void;
}) {
  const start = startOfWeek(weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();

  const byDayAndHour = (day: Date, hour: number) =>
    appointments.filter((a) => {
      const d = new Date(a.scheduled_for);
      return isSameDay(d, day) && d.getHours() === hour;
    });

  // Mini month grid for the month containing `weekStart`.
  const monthAnchor = new Date(start.getFullYear(), start.getMonth(), 1);
  const monthStartWeekday = monthAnchor.getDay();
  const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: monthStartWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), i + 1),
    ),
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_230px]">
      <div className="min-w-0 overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border p-3.5">
          <div className="font-display text-[14px] font-semibold text-ink-900">
            {start.toLocaleDateString([], { day: "numeric", month: "short" })} –{" "}
            {addDays(start, 6).toLocaleDateString([], {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onWeekChange(startOfWeek(new Date()))}
              className="rounded-md border border-surface-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-surface-bg"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => onWeekChange(addDays(start, -7))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-border bg-white text-ink-700 hover:bg-surface-bg"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => onWeekChange(addDays(start, 7))}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-border bg-white text-ink-700 hover:bg-surface-bg"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[52px_repeat(7,1fr)]">
            <div className="border-b border-r border-surface-border bg-surface-bg" />
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className={`border-b border-r border-surface-border p-2 text-center text-[10px] font-bold uppercase tracking-wide last:border-r-0 ${
                  isSameDay(day, today)
                    ? "bg-brand-green-tint text-brand-green-dark"
                    : "bg-surface-bg text-ink-500"
                }`}
              >
                {day.toLocaleDateString([], { weekday: "short", day: "numeric" })}
              </div>
            ))}

            {HOURS.map((hour) => (
              <Fragment key={hour}>
                <div
                  key={`h-${hour}`}
                  className="border-b border-r border-surface-border p-1.5 text-right text-[9px] text-ink-400"
                >
                  {hour % 12 === 0 ? 12 : hour % 12}
                  {hour < 12 ? "am" : "pm"}
                </div>
                {days.map((day) => {
                  const slot = byDayAndHour(day, hour);
                  return (
                    <div
                      key={`${day.toISOString()}-${hour}`}
                      className="min-h-[52px] border-b border-r border-surface-border p-0.5 last:border-r-0"
                    >
                      {slot.map((a) => {
                        const c = colorFor(a);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => onSelectAppointment(a)}
                            className={`mb-0.5 w-full rounded-sm px-1.5 py-1 text-left text-[9.5px] leading-tight ${c.bg} ${c.text} transition-transform duration-150 hover:-translate-y-px`}
                          >
                            <strong className="block truncate">
                              {new Date(a.scheduled_for).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </strong>
                            <span className="block truncate">
                              {a.patient_name || a.appointment_type || "Appointment"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <aside className="rounded-lg border border-surface-border bg-surface-card p-3.5 shadow-sm">
        <h3 className="mb-3 font-display text-[12.5px] font-semibold text-ink-900">
          Mini Calendar
        </h3>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[9px]">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <span key={d} className="py-1 text-ink-400">
              {d}
            </span>
          ))}
          {monthCells.map((cell, i) => (
            <button
              key={i}
              type="button"
              disabled={!cell}
              onClick={() => cell && onWeekChange(startOfWeek(cell))}
              className={`h-6 rounded-sm text-[10px] ${
                !cell
                  ? ""
                  : cell.toDateString() >= start.toDateString() &&
                      cell.toDateString() <= addDays(start, 6).toDateString()
                    ? "bg-brand-green font-bold text-white"
                    : "text-ink-700 hover:bg-brand-green-tint"
              }`}
            >
              {cell?.getDate()}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-1.5 border-t border-surface-border pt-3 text-[9.5px] text-ink-500">
          {PALETTE.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-sm ${c.bg}`} />
              Appointment group {i + 1}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}
