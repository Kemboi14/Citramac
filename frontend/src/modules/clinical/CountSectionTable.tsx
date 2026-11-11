import type { NacadaSection } from "../../lib/mhpExtrasApi";
import { TABLE, TD, TH } from "../care/shared/styles";
import { StatusPill } from "../care/shared/ui";

/**
 * One section of a counts-only report (NACADA NDO, Clinical Report): its total,
 * any median, and each breakdown. Withheld counts ("<5", "withheld") are greyed.
 */
export function CountSectionTable({ section }: { section: NacadaSection }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-bold text-ink-900">{section.title}</h3>
        {section.scope === "organization" && <StatusPill>Organisation-wide</StatusPill>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className={TABLE}>
          <tbody>
            <tr>
              <td className={`${TD} font-semibold`}>{section.total_label}</td>
              <td className={`${TD} text-right font-semibold tabular-nums`}>
                {section.total.display}
              </td>
            </tr>
            {section.median_days && (
              <tr>
                <td className={TD}>Median wait</td>
                <td className={`${TD} text-right tabular-nums`}>{section.median_days.display}</td>
              </tr>
            )}
            {section.breakdowns.map((breakdown) => [
              <tr key={breakdown.code}>
                <th colSpan={2} className={TH}>
                  {breakdown.title}
                </th>
              </tr>,
              ...breakdown.rows.map((row) => (
                <tr key={`${breakdown.code}-${row.code}`}>
                  <td className={`${TD} pl-6`}>{row.label}</td>
                  <td
                    className={`${TD} text-right tabular-nums ${row.masked ? "text-ink-500" : ""}`}
                  >
                    {row.display}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      {section.notes.map((note) => (
        <p key={note} className="text-xs text-ink-500">
          {note}
        </p>
      ))}
    </div>
  );
}
