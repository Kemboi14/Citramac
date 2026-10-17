import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../../auth/useAuth";
import { useDialogA11y } from "../../../components/useDialogA11y";
import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import {
  correctGroupEntry,
  correctGroupSession,
  type AttendanceCode,
  type GroupCategory,
  type GroupSessionDetail,
  type GroupSessionEntry,
  type StaffMember,
} from "../../../lib/groupProgrammeApi";
import { fieldErrorsFrom, formErrorSummary } from "../../../lib/formErrors";
import { BTN, BTN_GHOST, INPUT } from "../shared/styles";
import { Field } from "../shared/ui";
import {
  clientLabel,
  detailsErrors,
  detailsFromSession,
  detailsPayload,
  formFieldErrors,
  type SessionForm,
} from "./model";
import { SessionDetailsFields } from "./SessionEditor";
import { NOTE } from "./styles";

/** Where the page content starts: below the app bar, right of the navigation rail. */
function useContentArea() {
  const measure = () => {
    const main = document.getElementById("main-content")?.getBoundingClientRect();
    const bar = document.querySelector("header")?.getBoundingClientRect();
    return {
      top: Math.max(0, main?.top ?? 0, bar && bar.top <= 0 ? bar.bottom : 0),
      left: Math.max(0, main?.left ?? 0),
    };
  };
  const [area, setArea] = useState(measure);
  useEffect(() => {
    const update = () => setArea(measure());
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  return area;
}

function GroupModal({
  title,
  intro,
  onClose,
  children,
}: {
  title: string;
  intro: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialogA11y<HTMLElement>(true, onClose);
  const area = useContentArea();
  return createPortal(
    // A transparent layer keeps the whole app inert while the dialog is open;
    // only the page content (not the app bar or navigation rail) is dimmed.
    <div className="fixed inset-0 z-[90]">
      <div
        className="fixed grid place-items-center bg-surface-scrim p-4"
        style={{ top: area.top, left: area.left, right: 0, bottom: 0 }}
      >
        <section
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-modal-title"
          className="max-h-full w-[min(560px,100%)] overflow-auto rounded-xl border border-surface-border bg-surface-card p-[18px] shadow-md"
        >
          <h2 id="group-modal-title" className="mb-3 text-[17px] font-bold text-ink-900">
            {title}
          </h2>
          <p className={NOTE}>{intro}</p>
          {children}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function ReasonField({
  id,
  value,
  error,
  onChange,
}: {
  id: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Reason for correction" htmlFor={id} error={error}>
      <textarea
        id={id}
        rows={2}
        maxLength={500}
        className={INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Actions({
  saving,
  label,
  onCancel,
  status,
}: {
  saving: boolean;
  label: string;
  onCancel: () => void;
  status: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN} disabled={saving}>
          {saving ? "Saving…" : label}
        </button>
        <button type="button" className={BTN_GHOST} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      <div role="status" className={status ? "rounded-lg bg-surface-bg px-3 py-2.5 text-xs" : ""}>
        {status}
      </div>
    </>
  );
}

/** The mockup's openGroupSessionDetailsAmendment. */
export function SessionCorrectionDialog({
  session,
  categories,
  staff,
  onClose,
  onSaved,
}: {
  session: GroupSessionDetail;
  categories: GroupCategory[];
  staff: StaffMember[];
  onClose: () => void;
  onSaved: (detail: GroupSessionDetail) => void;
}) {
  const { accessToken } = useAuth();
  const [form, setForm] = useState<SessionForm>(() => detailsFromSession(session));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = detailsErrors(form, categories);
    if (!reason.trim()) found.reason = "Enter the reason for the correction.";
    setErrors(found);
    if (Object.keys(found).length || !accessToken) return;
    setSaving(true);
    correctGroupSession(accessToken, session.id, {
      ...detailsPayload(form, categories),
      reason: reason.trim(),
    })
      .then(onSaved)
      .catch((err) => {
        setErrors(formFieldErrors(fieldErrorsFrom(err)));
        setStatus(formErrorSummary(err, "The session correction could not be saved."));
      })
      .finally(() => setSaving(false));
  };

  return (
    <GroupModal
      title="Correct session details"
      intro="Changes are recorded in the session audit trail and are reflected in linked client entries. Individual observations are not changed."
      onClose={onClose}
    >
      <form className="mt-3 grid grid-cols-1 gap-3 [&>*]:min-w-0" onSubmit={submit} noValidate>
        <SessionDetailsFields
          idPrefix="group-master"
          form={form}
          errors={errors}
          categories={categories}
          staff={staff}
          onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))}
          variant="correction"
          documentedBy={
            // Provenance: who documented the session is not correctable here.
            <Field label="Documenting staff member" htmlFor="group-master-author">
              <input
                id="group-master-author"
                className={INPUT}
                value={session.documented_by}
                readOnly
                aria-readonly="true"
              />
            </Field>
          }
        />
        <ReasonField
          id="group-session-amend-reason"
          value={reason}
          error={errors.reason}
          onChange={setReason}
        />
        <Actions
          saving={saving}
          label="Save session correction"
          onCancel={onClose}
          status={status}
        />
      </form>
    </GroupModal>
  );
}

interface EntryForm {
  attendance: AttendanceCode;
  observation: string;
  riskDisclosure: boolean;
  followUp: boolean;
}

function entryForm(entry: GroupSessionEntry): EntryForm {
  return {
    attendance: entry.attendance,
    observation: entry.observation,
    riskDisclosure: entry.risk_disclosure,
    followUp: entry.follow_up_required,
  };
}

/** The mockup's openGroupProgrammeAmendment — one client's entry only. */
export function EntryCorrectionDialog({
  session,
  attendanceOptions,
  onClose,
  onSaved,
}: {
  session: GroupSessionDetail;
  attendanceOptions: ValueSetConcept[];
  onClose: () => void;
  onSaved: (detail: GroupSessionDetail) => void;
}) {
  const { accessToken } = useAuth();
  const [entryId, setEntryId] = useState(session.entries[0]?.id ?? "");
  const [form, setForm] = useState<EntryForm | null>(() =>
    session.entries[0] ? entryForm(session.entries[0]) : null,
  );
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const chooseEntry = (id: string) => {
    setEntryId(id);
    const entry = session.entries.find((e) => e.id === id);
    setForm(entry ? entryForm(entry) : null);
    setErrors({});
  };
  const update = (updates: Partial<EntryForm>) =>
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      // A risk disclosure always carries an individual follow-up task.
      if (next.riskDisclosure) next.followUp = true;
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form || !accessToken) return;
    const found: Record<string, string> = {};
    if (form.riskDisclosure && !form.observation.trim()) {
      found.observation = "Record the observation for a risk disclosure.";
    }
    if (!reason.trim()) found.reason = "Enter the reason for the correction.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    correctGroupEntry(accessToken, entryId, {
      attendance: form.attendance,
      observation: form.observation.trim(),
      risk_disclosure: form.riskDisclosure,
      follow_up: form.followUp,
      reason: reason.trim(),
    })
      .then(onSaved)
      .catch((err) => {
        setErrors(formFieldErrors(fieldErrorsFrom(err)));
        setStatus(formErrorSummary(err, "The client entry correction could not be saved."));
      })
      .finally(() => setSaving(false));
  };

  return (
    <GroupModal
      title="Correct an individual client entry"
      intro={`${session.session_date} · ${session.category} · ${session.topic}. Only the selected client's linked entry will be amended.`}
      onClose={onClose}
    >
      <form className="mt-3 grid gap-3" onSubmit={submit} noValidate>
        <Field label="Client" htmlFor="group-amend-client">
          <select
            id="group-amend-client"
            className={INPUT}
            value={entryId}
            onChange={(e) => chooseEntry(e.target.value)}
          >
            {session.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {clientLabel(entry)}
              </option>
            ))}
          </select>
        </Field>
        {form && (
          <>
            <Field
              label="Correct attendance"
              htmlFor="group-amend-attendance"
              error={errors.attendance}
            >
              <select
                id="group-amend-attendance"
                className={INPUT}
                value={form.attendance}
                onChange={(e) => update({ attendance: e.target.value as AttendanceCode })}
              >
                {attendanceOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Correct individual observation"
              htmlFor="group-amend-observation"
              error={errors.observation}
            >
              <textarea
                id="group-amend-observation"
                rows={4}
                maxLength={1000}
                className={INPUT}
                value={form.observation}
                onChange={(e) => update({ observation: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-ink-900">
              <input
                type="checkbox"
                checked={form.riskDisclosure}
                onChange={(e) => update({ riskDisclosure: e.target.checked })}
              />
              Risk disclosure requiring individual clinical review
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-900">
              <input
                type="checkbox"
                checked={form.followUp}
                onChange={(e) => update({ followUp: e.target.checked })}
              />
              Individual follow-up task required
            </label>
            {errors.followUp && (
              <p role="alert" className="text-[12px] font-medium text-priority-red">
                {errors.followUp}
              </p>
            )}
          </>
        )}
        <ReasonField
          id="group-amend-reason"
          value={reason}
          error={errors.reason}
          onChange={setReason}
        />
        <Actions saving={saving} label="Save correction" onCancel={onClose} status={status} />
      </form>
    </GroupModal>
  );
}
