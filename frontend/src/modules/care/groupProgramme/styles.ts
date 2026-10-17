// The mockup's .group-* classes on the app's theme tokens.
import type { AttendanceCode } from "../../../lib/groupProgrammeApi";
import type { StatusTone } from "./model";

export const ATTENDANCE_CODES: AttendanceCode[] = ["PRESENT", "ABSENT", "EXCUSED", "DECLINED"];

export const CHIP = "rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap";

export const STATUS_CHIP: Record<StatusTone, string> = {
  live: "bg-priority-green-tint text-priority-green",
  upcoming: "bg-priority-yellow-tint text-priority-yellow",
  "past-due": "bg-priority-orange-tint text-priority-orange",
  completed: "bg-surface-border text-ink-500",
};

export const ATTENDANCE_CHIP: Record<AttendanceCode, string> = {
  PRESENT: "bg-priority-green-tint text-priority-green",
  ABSENT: "bg-priority-red-tint text-priority-red",
  EXCUSED: "bg-priority-yellow-tint text-priority-yellow",
  DECLINED: "bg-surface-border text-ink-500",
};

/** Text colour of the pressed segment button. */
export const ATTENDANCE_TEXT: Record<AttendanceCode, string> = {
  PRESENT: "text-priority-green",
  ABSENT: "text-priority-red",
  EXCUSED: "text-priority-yellow",
  DECLINED: "text-ink-500",
};

export const ATTENDANCE_BAR: Record<AttendanceCode, string> = {
  PRESENT: "bg-priority-green",
  ABSENT: "bg-priority-red",
  EXCUSED: "bg-priority-yellow",
  // Near-black, as the mockup's Declined legend and bar.
  DECLINED: "bg-ink-900",
};

export const CARD =
  "grid min-w-0 gap-3 rounded-[14px] border bg-surface-card p-3.5 shadow-sm transition-colors duration-200";

export const PANEL = "rounded-[14px] border border-surface-border bg-surface-card";

export const DETAILS =
  "group rounded-xl border border-surface-border bg-surface-card [&>summary::-webkit-details-marker]:hidden";

export const DETAILS_SUMMARY =
  "cursor-pointer list-none px-4 py-3.5 text-[13px] font-bold text-ink-900 group-open:border-b group-open:border-surface-border";

export const SELECT =
  "min-w-[140px] max-w-[220px] flex-1 rounded-[9px] border border-surface-border bg-surface-card px-2.5 py-2 text-xs text-ink-900 outline-none focus:border-brand-green";

export const NOTE = "text-xs text-ink-500";
