import { AutoResizeTextarea } from "../shared/AutoResizeTextarea";
import type { ReactNode } from "react";
import type { GroupCategory, StaffMember } from "../../../lib/groupProgrammeApi";
import { INPUT } from "../shared/styles";
import { Field } from "../shared/ui";
import { OTHER_FACILITATOR, type SessionForm } from "./model";
import DateInput from "../../../components/DateInput";
import { useAuth } from "../../../auth/useAuth";

/** The one category that is psychotherapy; recording it needs this permission (server-checked). */
const PSYCHOTHERAPY_CATEGORY = "group_psychotherapy";
const DELIVER_PSYCHOTHERAPY = "clinical.psychotherapy.deliver";

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
  const { profile } = useAuth();
  const canDeliver = profile?.permissions?.includes(DELIVER_PSYCHOTHERAPY) ?? false;
  const isOther = categories.find((c) => c.code === form.category)?.is_other ?? false;
  const correction = variant === "correction";
  const dateField = (
    <>
      <Field label="Session date" htmlFor={id("date")} error={errors.sessionDate}>
        <DateInput
          id={id("date")}
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
            .filter(
              (c) => canDeliver || c.code !== PSYCHOTHERAPY_CATEGORY || c.code === form.category,
            )
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
        <AutoResizeTextarea
          id={id("description")}
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </>
  );
}
