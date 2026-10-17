import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import type {
  AttendanceCode,
  GroupClient,
  GroupSessionEntry,
} from "../../../lib/groupProgrammeApi";
import { BTN_GHOST, BTN_SM } from "../shared/styles";
import { initials, type DraftAttendance } from "./model";
import { ATTENDANCE_CHIP, ATTENDANCE_TEXT, CARD, CHIP } from "./styles";

const CHECKBOX = "h-4 w-4 accent-[var(--green)] disabled:cursor-not-allowed";

function cardBorder(attendance: string | undefined, risk: boolean | undefined) {
  if (risk) return "border-priority-red";
  return attendance === "PRESENT" ? "border-priority-green" : "border-surface-border";
}

function Identity({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[11px]">
      <span
        aria-hidden="true"
        className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-brand-green-tint text-xs font-bold text-brand-green"
      >
        {initials(name) || "—"}
      </span>
      <div className="min-w-0">
        <strong className="block [overflow-wrap:anywhere] text-[13px] text-ink-900">{name}</strong>
        <small className="block [overflow-wrap:anywhere] text-[10px] text-ink-500">{detail}</small>
      </div>
    </div>
  );
}

/** Attendance being marked for an unsaved session — React state only until confirmed. */
export function EditableClientCard({
  client,
  entry,
  options,
  observationOpen,
  onToggleObservation,
  onChange,
}: {
  client: GroupClient;
  entry: DraftAttendance;
  options: ValueSetConcept[];
  observationOpen: boolean;
  onToggleObservation: () => void;
  onChange: (updates: DraftAttendance) => void;
}) {
  const canAttend = client.eligible;
  const noteId = `group-note-${client.id}`;
  return (
    <article className={`${CARD} ${cardBorder(entry.attendance, entry.riskDisclosure)}`}>
      <div className="flex items-center justify-between gap-2.5">
        <Identity
          name={client.name}
          detail={[client.display_id, client.programme].filter(Boolean).join(" · ")}
        />
        <span
          className="max-w-[48%] flex-none truncate whitespace-nowrap rounded-full bg-surface-bg px-2 py-[3px] text-[10px] text-ink-500"
          title={client.unit}
        >
          {client.unit}
        </span>
      </div>
      {!canAttend && (
        <div className="text-[11px] text-ink-500">
          Session eligibility review required; attendance cannot be recorded until cleared.
        </div>
      )}
      <div
        className="grid grid-cols-4 gap-[3px] rounded-[9px] bg-surface-bg p-[3px]"
        role="group"
        aria-label={`Attendance for ${client.name}`}
      >
        {options.map((option) => {
          const code = option.code as AttendanceCode;
          const pressed = entry.attendance === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={pressed}
              disabled={!canAttend}
              onClick={() => onChange({ attendance: code })}
              className={`rounded-lg px-0.5 py-2 text-[11px] font-bold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 max-[520px]:text-[9px] ${
                pressed
                  ? // eslint-disable-next-line security/detect-object-injection -- served code.
                    `bg-surface-card shadow-sm ${ATTENDANCE_TEXT[code] ?? "text-ink-900"}`
                  : "text-ink-500"
              }`}
            >
              {option.display}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-[11px] text-ink-500">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={Boolean(entry.riskDisclosure)}
            disabled={!canAttend}
            onChange={(e) =>
              onChange({
                riskDisclosure: e.target.checked,
                followUp: e.target.checked || Boolean(entry.followUp),
              })
            }
          />
          Risk disclosure
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={Boolean(entry.followUp || entry.riskDisclosure)}
            disabled={!canAttend}
            onChange={(e) => onChange({ followUp: e.target.checked })}
          />
          Individual follow-up
        </label>
      </div>
      <button
        type="button"
        aria-expanded={observationOpen}
        aria-controls={noteId}
        disabled={!canAttend}
        onClick={onToggleObservation}
        className="w-full text-center text-xs font-bold text-brand-green disabled:opacity-45"
      >
        {entry.observation ? "Edit observation" : "Add observation"}
      </button>
      {observationOpen && (
        <div className="grid gap-[7px]" id={noteId}>
          <textarea
            className="min-h-[78px] w-full resize-y rounded-[10px] border border-surface-border bg-surface-bg px-3 py-2.5 text-xs text-ink-900 outline-none focus:border-brand-green"
            maxLength={1000}
            rows={3}
            autoFocus
            aria-label={`Optional individual observation for ${client.name}`}
            placeholder="Optional — record only this client's response"
            value={entry.observation ?? ""}
            disabled={!canAttend}
            onChange={(e) => onChange({ observation: e.target.value })}
          />
          <small className="text-[11px] text-ink-500">Visible only on this client’s record.</small>
        </div>
      )}
    </article>
  );
}

/** A confirmed client entry, shown read-only in the facilitator's saved-session view. */
export function SavedClientCard({
  entry,
  onOpenInterventions,
}: {
  entry: GroupSessionEntry;
  onOpenInterventions: () => void;
}) {
  return (
    <article className={`${CARD} ${cardBorder(entry.attendance, entry.risk_disclosure)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Identity
          name={entry.name}
          detail={[entry.display_id, entry.programme].filter(Boolean).join(" · ")}
        />
        <span className={`${CHIP} ${ATTENDANCE_CHIP[entry.attendance] ?? ""}`}>
          {entry.attendance_display || "Not recorded"}
        </span>
      </div>
      <div className="text-[11px] text-ink-500">
        {entry.observation ? (
          <>
            <strong>Individual observation:</strong> {entry.observation}
          </>
        ) : (
          "No individual observation recorded."
        )}
      </div>
      {entry.risk_disclosure && (
        <div className="text-[11px] text-ink-500" role="note">
          Risk disclosure flagged for individual review.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-[11px] text-ink-500">
        <span>
          {entry.intervention_linked ? "Intervention linked" : "Intervention linkage pending"}
        </span>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onOpenInterventions}>
          Open client interventions
        </button>
      </div>
    </article>
  );
}
