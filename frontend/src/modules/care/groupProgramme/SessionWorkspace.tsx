import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import type {
  AttendanceCode,
  GroupClient,
  GroupSessionDetail,
} from "../../../lib/groupProgrammeApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM } from "../shared/styles";
import { Callout } from "../shared/ui";
import { AttendanceTally } from "./AttendanceTally";
import { EditableClientCard, SavedClientCard } from "./ClientAttendanceCard";
import {
  emptyCounts,
  matchesFilters,
  sessionDateLabel,
  sessionStatus,
  type DraftAttendance,
  type Filters,
  type SessionDraft,
  type WorkspaceItem,
} from "./model";
import { StatusChip } from "./SessionRail";
import { SELECT } from "./styles";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-[10px] border border-surface-border bg-surface-card px-[13px] py-2">
      <small className="text-[10px] text-ink-500">{label}</small>
      <strong className="text-xs text-ink-900">{value || "Not recorded"}</strong>
    </div>
  );
}

function AuditTrail({ detail }: { detail: GroupSessionDetail | null }) {
  const trail = detail?.audit_trail ?? [];
  return (
    <details
      className="mt-3.5 rounded-[14px] border border-surface-border bg-surface-card px-[18px] py-3.5"
      open
    >
      <summary className="cursor-pointer text-[13px] font-bold text-ink-900">
        Audit trail ({trail.length})
      </summary>
      <div className="mt-2.5 grid gap-2">
        {trail.length ? (
          trail.map((item, index) => (
            <div
              key={`${item.at}-${index}`}
              className="border-t border-surface-border pt-2 text-[11px] text-ink-900"
            >
              <strong>{item.label}</strong> by {item.by || "Staff member"} ·{" "}
              <span className="text-ink-500">
                {item.at ? formatDateTime(item.at) : "Time not recorded"}
              </span>
              <br />
              <span className="text-ink-500">{item.note}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-ink-500">
            No entries yet. Entries are added when the session is confirmed or amended.
          </p>
        )}
      </div>
    </details>
  );
}

/** The mockup's .group-workspace-main for one selected session. */
export function SessionWorkspace({
  item,
  documentedBy,
  attendanceOptions,
  attendanceLabel,
  clients,
  programmes,
  units,
  filters,
  onFilters,
  search,
  onSearch,
  draft,
  onDraftChange,
  observationOpen,
  onToggleObservation,
  detail,
  detailError,
  onReview,
  onEditScheduled,
  onEditDetails,
  onCorrectEntry,
  onOpenInterventions,
}: {
  item: WorkspaceItem;
  documentedBy: string;
  attendanceOptions: ValueSetConcept[];
  attendanceLabel: (code: AttendanceCode) => string;
  clients: GroupClient[];
  programmes: string[];
  units: string[];
  filters: Filters;
  onFilters: (filters: Filters) => void;
  search: string;
  onSearch: (value: string) => void;
  draft: SessionDraft | undefined;
  onDraftChange: (clientId: string, updates: DraftAttendance) => void;
  observationOpen: Record<string, boolean>;
  onToggleObservation: (clientId: string) => void;
  detail: GroupSessionDetail | null;
  detailError: string | null;
  onReview: () => void;
  onEditScheduled: () => void;
  onEditDetails: () => void;
  onCorrectEntry: () => void;
  onOpenInterventions: (patientId: string) => void;
}) {
  const editable = item.kind !== "saved";
  const status = sessionStatus(item);
  const attendance = draft?.attendance ?? {};
  const matching = clients.filter((client) => matchesFilters(client, filters));
  const selectable = matching.filter((client) => client.eligible);
  // The mockup's cohort line: say how many listed clients are actually admitted.
  const admitted = matching.filter((client) => client.admitted).length;
  const outpatients = matching.length - admitted;

  const counts = emptyCounts();
  let marked = 0;
  let risks = 0;
  let total = 0;
  if (editable) {
    total = selectable.length;
    for (const client of selectable) {
      const entry = attendance[client.id];
      if (entry?.attendance) {
        marked += 1;
        counts[entry.attendance] += 1;
      }
      if (entry?.riskDisclosure) risks += 1;
    }
  } else if (detail) {
    total = detail.entries.length;
    for (const entry of detail.entries) {
      marked += 1;
      counts[entry.attendance] += 1;
      if (entry.risk_disclosure) risks += 1;
    }
  }
  const canReview = editable && selectable.length > 0 && marked === selectable.length;
  const q = search.trim().toLowerCase();
  const visibleClients = matching.filter(
    (client) =>
      !q || `${client.display_id} ${client.name} ${client.programme}`.toLowerCase().includes(q),
  );
  const isDraft = item.kind === "draft";
  const stillToMark = Math.max(0, selectable.length - marked);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-tight text-ink-900 sm:text-[25px]">
              {item.topic}
            </h2>
            <p className="mt-[3px] text-xs text-ink-500">
              {item.category} ·{" "}
              {item.session?.reference ?? (isDraft ? "Draft session" : "Scheduled session")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip label={status.label} tone={status.tone} />
            {item.kind === "saved" && (
              <>
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onEditDetails}>
                  Edit details
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={onCorrectEntry}
                  disabled={!detail}
                >
                  Correct client entry
                </button>
              </>
            )}
            {item.kind === "scheduled" && (
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onEditScheduled}>
                Edit details
              </button>
            )}
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
          <Fact label="Date" value={isDraft ? "Not scheduled" : sessionDateLabel(item.date)} />
          <Fact
            label="Time"
            value={
              isDraft ? "Not set" : `${item.time || "—"}${item.endTime ? `–${item.endTime}` : ""}`
            }
          />
          <Fact label="Facilitator" value={isDraft ? "Not assigned" : item.facilitator} />
          <Fact label="Location" value={isDraft ? "Not assigned" : item.location} />
          <Fact
            label="Documented by"
            value={item.session?.documented_by ?? (documentedBy || "Not yet documented")}
          />
        </div>

        {detailError && (
          <Callout tone="danger" role="alert" className="mt-3">
            {detailError}
          </Callout>
        )}

        <AttendanceTally counts={counts} total={total} label={attendanceLabel} />

        <div className="mb-3.5 mt-1.5 flex flex-wrap items-center justify-between gap-2.5">
          {editable ? (
            <>
              <input
                type="search"
                className="min-w-[180px] flex-[2] rounded-[9px] border border-surface-border bg-surface-card px-2.5 py-2 text-xs text-ink-900 outline-none focus:border-brand-green"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search client name or ID"
                aria-label="Search clients"
              />
              <select
                className={SELECT}
                aria-label="Programme"
                value={filters.programme}
                onChange={(e) => onFilters({ ...filters, programme: e.target.value })}
              >
                <option value="">All programmes</option>
                {programmes.map((programme) => (
                  <option key={programme}>{programme}</option>
                ))}
              </select>
              <select
                className={SELECT}
                aria-label="Residential unit"
                value={filters.unit}
                onChange={(e) => onFilters({ ...filters, unit: e.target.value })}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
              <select
                className={SELECT}
                aria-label="Session eligibility"
                value={filters.eligibility}
                onChange={(e) =>
                  onFilters({ ...filters, eligibility: e.target.value as Filters["eligibility"] })
                }
              >
                <option value="eligible">Eligible clients only</option>
                <option value="all">All active clients</option>
              </select>
            </>
          ) : (
            <span className="text-xs text-ink-500">
              {marked} attendance records · {plural(risks, "risk flag")}
            </span>
          )}
        </div>
        {editable && (
          <p className="-mt-2 mb-3 text-xs text-ink-500">
            {plural(admitted, "active admission")}
            {outpatients ? ` · ${plural(outpatients, "outpatient")}` : ""} · {selectable.length}{" "}
            eligible for this session
          </p>
        )}

        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr))]">
          {editable
            ? visibleClients.map((client) => (
                <EditableClientCard
                  key={client.id}
                  client={client}
                  entry={attendance[client.id] ?? {}}
                  options={attendanceOptions}
                  observationOpen={Boolean(observationOpen[client.id])}
                  onToggleObservation={() => onToggleObservation(client.id)}
                  onChange={(updates) => onDraftChange(client.id, updates)}
                />
              ))
            : detail?.entries.map((entry) => (
                <SavedClientCard
                  key={entry.id}
                  entry={entry}
                  onOpenInterventions={() => onOpenInterventions(entry.patient_id)}
                />
              ))}
        </div>
        {((editable && !visibleClients.length) ||
          (!editable && detail && !detail.entries.length)) && (
          <p className="p-6 text-center text-xs text-ink-500">
            No clients match your search, or no client attendance has been recorded for this
            session.
          </p>
        )}
        <AuditTrail detail={editable ? null : detail} />
      </div>
      {editable && (
        <footer className="sticky bottom-0 z-[2] mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-surface-border bg-surface-card px-4 py-3 sm:px-8">
          <small className="text-ink-500">
            {plural(stillToMark, "client")} still to mark
            {risks ? ` · ${plural(risks, "risk flag")}` : ""}
          </small>
          <button type="button" className={BTN} disabled={!canReview} onClick={onReview}>
            Review session
          </button>
        </footer>
      )}
    </>
  );
}
