import type { ReactNode } from "react";
import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import type {
  AttendanceCode,
  GroupCategory,
  GroupClient,
  ScheduledGroupSession,
  StaffMember,
} from "../../../lib/groupProgrammeApi";
import { BTN, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Card, Field, Tag } from "../shared/ui";
import {
  matchesFilters,
  OTHER_FACILITATOR,
  scheduledLocal,
  type DraftAttendance,
  type Filters,
  type SessionForm,
} from "./model";
import { DETAILS, DETAILS_SUMMARY, NOTE } from "./styles";

/** Session detail inputs — shared by the editor and the "Correct session details" dialog. */
export function SessionDetailsFields({
  idPrefix,
  form,
  errors,
  categories,
  staff,
  onChange,
  documentedBy,
  variant = "editor",
}: {
  idPrefix: string;
  form: SessionForm;
  errors: Record<string, string>;
  categories: GroupCategory[];
  staff: StaffMember[];
  onChange: (updates: Partial<SessionForm>) => void;
  documentedBy?: ReactNode;
  /** "correction": the single-column "Correct session details" dialog. */
  variant?: "editor" | "correction";
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const isOther = categories.find((c) => c.code === form.category)?.is_other ?? false;
  const correction = variant === "correction";
  const dateField = (
    <>
      <Field label="Session date" htmlFor={id("date")} error={errors.sessionDate}>
        <input
          id={id("date")}
          type="date"
          className={INPUT}
          value={form.sessionDate}
          onChange={(e) => onChange({ sessionDate: e.target.value })}
        />
      </Field>
    </>
  );
  const categoryFields = (
    <>
      <Field label="Session category" htmlFor={id("category")} error={errors.category}>
        <select
          id={id("category")}
          className={INPUT}
          value={form.category}
          onChange={(e) => onChange({ category: e.target.value })}
        >
          <option value="">Select a category</option>
          {categories
            .filter((c) => c.active || c.code === form.category)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.display}
              </option>
            ))}
        </select>
      </Field>
      {isOther && (
        <Field label="Approved category name" htmlFor={id("other")} error={errors.categoryOther}>
          <input
            id={id("other")}
            type="text"
            maxLength={100}
            className={INPUT}
            value={form.categoryOther}
            onChange={(e) => onChange({ categoryOther: e.target.value })}
          />
        </Field>
      )}
    </>
  );
  const timeFields = (
    <>
      <Field label="Start time" htmlFor={id("start")} error={errors.startTime}>
        <input
          id={id("start")}
          type="time"
          className={INPUT}
          value={form.startTime}
          onChange={(e) => onChange({ startTime: e.target.value })}
        />
      </Field>
      <Field label="End time" htmlFor={id("end")} error={errors.endTime}>
        <input
          id={id("end")}
          type="time"
          className={INPUT}
          value={form.endTime}
          onChange={(e) => onChange({ endTime: e.target.value })}
        />
      </Field>
    </>
  );
  const topicFacilitatorFields = (
    <>
      <Field label="Topic or activity" htmlFor={id("topic")} error={errors.topic}>
        <input
          id={id("topic")}
          type="text"
          maxLength={160}
          className={INPUT}
          value={form.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
        />
      </Field>
      <Field label="Facilitator" htmlFor={id("facilitator")} error={errors.facilitatorId}>
        <select
          id={id("facilitator")}
          className={INPUT}
          value={form.facilitatorId}
          onChange={(e) => onChange({ facilitatorId: e.target.value })}
        >
          <option value="">Select the facilitator</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
          <option value={OTHER_FACILITATOR}>Not in the staff directory</option>
        </select>
      </Field>
      {form.facilitatorId === OTHER_FACILITATOR && (
        <Field
          label="Facilitator name"
          htmlFor={id("facilitator-name")}
          error={errors.facilitatorName}
        >
          <input
            id={id("facilitator-name")}
            type="text"
            maxLength={120}
            className={INPUT}
            value={form.facilitatorName}
            onChange={(e) => onChange({ facilitatorName: e.target.value })}
          />
        </Field>
      )}
    </>
  );
  // Mockup order: the editor puts category beside the date; the correction
  // dialog (openGroupSessionDetailsAmendment) is date, start, end, category, …
  return (
    <>
      {dateField}
      {correction ? timeFields : categoryFields}
      {correction ? categoryFields : timeFields}
      {topicFacilitatorFields}
      {documentedBy}
      <Field
        label={correction ? "Location" : "Session location"}
        htmlFor={id("location")}
        error={errors.location}
      >
        <input
          id={id("location")}
          type="text"
          maxLength={120}
          className={INPUT}
          value={form.location}
          onChange={(e) => onChange({ location: e.target.value })}
        />
      </Field>
      <Field
        label={
          correction ? "Session content or intervention" : "Brief session content or intervention"
        }
        htmlFor={id("description")}
        error={errors.description}
        hint={
          correction
            ? undefined
            : "Describe the shared intervention only; keep client-specific observations in that client’s row."
        }
        className={correction ? "" : "sm:col-span-2 lg:col-span-3"}
      >
        <textarea
          id={id("description")}
          rows={3}
          maxLength={2000}
          className={INPUT}
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </>
  );
}

/** The mockup's "Session documentation" panel: details, the client table, review. */
export function SessionEditor({
  open,
  onToggle,
  editable,
  scheduled,
  scheduledKey,
  onSelectScheduled,
  form,
  errors,
  onFormChange,
  categories,
  staff,
  documentedBy,
  clients,
  programmes,
  units,
  filters,
  onFilters,
  attendance,
  attendanceOptions,
  onDraftChange,
  onReview,
  review,
  status,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  editable: boolean;
  scheduled: ScheduledGroupSession[];
  scheduledKey: string;
  onSelectScheduled: (key: string) => void;
  form: SessionForm | null;
  errors: Record<string, string>;
  onFormChange: (updates: Partial<SessionForm>) => void;
  categories: GroupCategory[];
  staff: StaffMember[];
  documentedBy: string;
  clients: GroupClient[];
  programmes: string[];
  units: string[];
  filters: Filters;
  onFilters: (filters: Filters) => void;
  attendance: Record<string, DraftAttendance>;
  attendanceOptions: ValueSetConcept[];
  onDraftChange: (clientId: string, updates: DraftAttendance) => void;
  onReview: () => void;
  review: ReactNode;
  status: string;
}) {
  const visible = clients.filter((client) => matchesFilters(client, filters));
  return (
    <details
      className={DETAILS}
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      id="group-session-editor"
    >
      <summary className={DETAILS_SUMMARY}>
        Session documentation · create or record attendance
      </summary>
      <div className="grid min-w-0 gap-3 p-3.5 [&>*]:min-w-0">
        {!editable || !form ? (
          <p className={NOTE}>
            Select a scheduled session or create a new group session to record attendance. A
            confirmed session is corrected from its workspace view.
          </p>
        ) : (
          <>
            <Card title="Session details" aside={<Tag>One review · linked client entries</Tag>}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                <Field label="Scheduled session" htmlFor="group-scheduled">
                  <select
                    id="group-scheduled"
                    className={INPUT}
                    value={scheduledKey}
                    onChange={(e) => onSelectScheduled(e.target.value)}
                  >
                    <option value="">Unscheduled / enter details</option>
                    {scheduled.map((item) => {
                      const local = scheduledLocal(item);
                      return (
                        <option key={item.key} value={item.key}>
                          {local.date} {local.time} · {item.category} · {item.facilitator}
                        </option>
                      );
                    })}
                  </select>
                </Field>
                <SessionDetailsFields
                  idPrefix="group-editor"
                  form={form}
                  errors={errors}
                  categories={categories}
                  staff={staff}
                  onChange={onFormChange}
                  documentedBy={
                    <Field
                      label="Documenting staff member"
                      htmlFor="group-author"
                      hint="Recorded from your signed-in account."
                    >
                      <input id="group-author" className={INPUT} value={documentedBy} readOnly />
                    </Field>
                  }
                />
              </div>
            </Card>
            <Card title={`Eligible clients (${clients.length})`}>
              <p className={`${NOTE} mb-3`}>
                Active admissions only. Select an attendance status for every listed client.
                Individual observations are optional; do not record details for another client here.
              </p>
              <div className="mb-3.5 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                <Field label="Programme" htmlFor="group-filter-programme">
                  <select
                    id="group-filter-programme"
                    className={INPUT}
                    value={filters.programme}
                    onChange={(e) => onFilters({ ...filters, programme: e.target.value })}
                  >
                    <option value="">All programmes</option>
                    {programmes.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Residential unit / setting" htmlFor="group-filter-unit">
                  <select
                    id="group-filter-unit"
                    className={INPUT}
                    value={filters.unit}
                    onChange={(e) => onFilters({ ...filters, unit: e.target.value })}
                  >
                    <option value="">All units / settings</option>
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Session eligibility" htmlFor="group-filter-eligibility">
                  <select
                    id="group-filter-eligibility"
                    className={INPUT}
                    value={filters.eligibility}
                    onChange={(e) =>
                      onFilters({
                        ...filters,
                        eligibility: e.target.value as Filters["eligibility"],
                      })
                    }
                  >
                    <option value="eligible">Eligible clients only</option>
                    <option value="all">Show all active admissions</option>
                  </select>
                </Field>
              </div>
              <div className="max-w-full overflow-x-auto">
                <table className={TABLE} aria-label="Client attendance and individual observations">
                  <thead>
                    <tr>
                      <th className={TH}>Client identifier and name</th>
                      <th className={TH}>Programme / unit</th>
                      <th className={TH}>Attendance</th>
                      <th className={TH}>Individual observation or response</th>
                      <th className={TH}>Risk / follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((client) => {
                      const entry = attendance[client.id] ?? {};
                      const locked = !client.eligible;
                      return (
                        <tr key={client.id}>
                          <td className={TD}>
                            <strong>{client.display_id || "—"}</strong>
                            <br />
                            {client.name}
                            {locked && (
                              <>
                                <br />
                                <Tag tone="risk">Eligibility review required</Tag>
                              </>
                            )}
                          </td>
                          <td className={TD}>
                            {client.programme}
                            <br />
                            <span className={NOTE}>{client.unit}</span>
                          </td>
                          <td className={TD}>
                            <select
                              className={INPUT}
                              disabled={locked}
                              aria-label={`Attendance for ${client.name}`}
                              value={entry.attendance ?? ""}
                              onChange={(e) =>
                                onDraftChange(client.id, {
                                  attendance: (e.target.value || undefined) as
                                    AttendanceCode | undefined,
                                })
                              }
                            >
                              <option value="">Select status</option>
                              {attendanceOptions.map((o) => (
                                <option key={o.code} value={o.code}>
                                  {o.display}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className={TD}>
                            <textarea
                              className={`${INPUT} min-h-14 min-w-[190px]`}
                              rows={2}
                              maxLength={1000}
                              disabled={locked}
                              aria-label={`Optional individual observation for ${client.name}`}
                              placeholder="Optional; record only this client's response, insight, difficulty or follow-up"
                              value={entry.observation ?? ""}
                              onChange={(e) =>
                                onDraftChange(client.id, { observation: e.target.value })
                              }
                            />
                          </td>
                          <td className={TD}>
                            <label className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                disabled={locked}
                                checked={Boolean(entry.riskDisclosure)}
                                aria-label={`Flag a risk disclosure for ${client.name}`}
                                onChange={(e) =>
                                  onDraftChange(client.id, {
                                    riskDisclosure: e.target.checked,
                                    followUp: e.target.checked || Boolean(entry.followUp),
                                  })
                                }
                              />
                              Risk disclosure
                            </label>
                            <label className="mt-1 flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                disabled={locked}
                                checked={Boolean(entry.followUp || entry.riskDisclosure)}
                                aria-label={`Require individual follow-up for ${client.name}`}
                                onChange={(e) =>
                                  onDraftChange(client.id, { followUp: e.target.checked })
                                }
                              />
                              Individual follow-up task
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!clients.length && (
                <p className={NOTE}>No active clients are available for a new group session.</p>
              )}
            </Card>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={BTN} onClick={onReview} disabled={!clients.length}>
                Review session
              </button>
              <span className={NOTE}>
                No record is saved until the reviewed session is confirmed.
              </span>
            </div>
            {review}
          </>
        )}
        <div
          role="status"
          aria-live="polite"
          className={status ? "rounded-lg bg-surface-bg px-3 py-2.5 text-xs text-ink-900" : ""}
        >
          {status}
        </div>
      </div>
    </details>
  );
}
