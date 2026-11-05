import type { WorklistRow } from "../../../lib/carePathwayApi";
import { formatDateTime, formatTime } from "./format";
import { BTN_GHOST, BTN_SM, TD, TH } from "./styles";
import { PriorityPill } from "./ui";

/** The triage queue's columns, shared by the triage worklist page and the
 * clinical dashboard so the two always show the same thing. */
export function TriageWorklistHeadCells() {
  return (
    <>
      <th className={TH}>Client</th>
      <th className={TH}>Setting / status</th>
      <th className={TH}>Detail</th>
      <th className={TH}>Due</th>
      <th className={TH}>
        <span className="sr-only">Open encounter</span>
      </th>
    </>
  );
}

/** One triage queue row: who, where, why it's due (arrival wait or re-check,
 * with the priority from the last triage), when, and Open. Overdue rows are
 * highlighted. */
export function TriageWorklistRow({ row, onOpen }: { row: WorklistRow; onOpen: () => void }) {
  const recheck = row.status === "RECHECK_DUE";
  const cell = `${TD} leading-[1.45] ${row.is_overdue ? "bg-priority-red-tint" : ""}`;
  return (
    <tr>
      <td className={`${cell} ${row.is_overdue ? "shadow-[inset_3px_0_var(--pri-red)]" : ""}`}>
        <strong>
          {row.name || "Unknown client"} · {row.mrn || row.citramac_number}
        </strong>
        <br />
        <span className="text-[11px] text-ink-500">
          {row.citramac_number || "CITRAMAC ID not recorded"}
        </span>
      </td>
      <td className={cell}>
        {row.setting === "INPATIENT" ? "Inpatient" : "Outpatient"} · {row.status_label}
      </td>
      <td className={cell}>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {recheck && <PriorityPill priority={row.priority} />}
          {recheck
            ? `Re-check due · last triage v${row.triage_version || 1} ${formatTime(row.last_triaged_at)}`
            : `${row.wait_minutes} min · triage target`}
        </span>
        {row.is_overdue && (
          <>
            <br />
            <span className="text-[11px] font-bold uppercase text-priority-red">
              {row.recheck_overdue ? `Re-triage overdue (${row.priority})` : "Overdue"}
            </span>
          </>
        )}
      </td>
      <td className={cell}>{formatDateTime(row.due_at)}</td>
      <td className={cell}>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          aria-label={`Open ${recheck ? "re-check" : "triage"} for ${row.name || "client"}`}
          onClick={onOpen}
        >
          Open
        </button>
      </td>
    </tr>
  );
}
