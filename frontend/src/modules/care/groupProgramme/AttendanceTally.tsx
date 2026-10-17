import type { AttendanceCode } from "../../../lib/groupProgrammeApi";
import { ATTENDANCE_BAR, ATTENDANCE_CODES } from "./styles";

/** The mockup's .group-attendance-tally: "N of M present", legend and stacked bar. */
export function AttendanceTally({
  counts,
  total,
  label,
}: {
  counts: Record<AttendanceCode, number>;
  total: number;
  label: (code: AttendanceCode) => string;
}) {
  return (
    <div className="mb-3.5 mt-[22px] rounded-[14px] border border-surface-border bg-surface-card px-[18px] py-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="text-[17px] text-ink-900">
          {counts.PRESENT} of {total} present
        </strong>
        <span className="flex flex-wrap gap-3.5 text-[11px] text-ink-500">
          {ATTENDANCE_CODES.map((code) => (
            <span key={code} className="inline-flex items-center">
              <span
                aria-hidden="true"
                // eslint-disable-next-line security/detect-object-injection -- typed code.
                className={`mr-[5px] inline-block h-2 w-2 rounded-[3px] ${ATTENDANCE_BAR[code]}`}
              />
              {label(code)}
            </span>
          ))}
        </span>
      </div>
      <div
        className="mt-3 flex h-[9px] overflow-hidden rounded-full bg-surface-border"
        role="img"
        aria-label={`Attendance summary: ${ATTENDANCE_CODES.map(
          // eslint-disable-next-line security/detect-object-injection -- typed code.
          (code) => `${counts[code]} ${label(code)}`,
        ).join(", ")}`}
      >
        {ATTENDANCE_CODES.map((code) => (
          <span
            key={code}
            // eslint-disable-next-line security/detect-object-injection -- typed code.
            className={`min-w-0 transition-[width] duration-200 ${ATTENDANCE_BAR[code]}`}
            // eslint-disable-next-line security/detect-object-injection -- typed code.
            style={{ width: `${total ? (counts[code] / total) * 100 : 0}%` }}
          />
        ))}
      </div>
    </div>
  );
}
