import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getTaskOwners,
  registerTriageTasks,
  type CareTask,
  type TaskPerson,
} from "../../../lib/carePathwayApi";
import type { SigningTask } from "../../../lib/triageV4Api";
import { formatDateTime } from "../shared/format";
import { BTN, INPUT } from "../shared/styles";
import { ErrorNote, Field } from "../shared/ui";

/**
 * Every triage task is assigned to a named member of the clinical staff, picked
 * from a drop-down (owner rule, 2026-11-10). No team and no free text. The list
 * holds only staff who can open the triage's branch (task_assignees.py).
 */

/** The clinical staff a task on this triage can be assigned to. */
export function useTaskPeople(triageId: string) {
  const { accessToken } = useAuth();
  const [people, setPeople] = useState<TaskPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getTaskOwners(accessToken, triageId)
      .then((r) => {
        if (cancelled) return;
        setPeople(r.people);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the staff list — check your connection.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, triageId]);
  return { people, error };
}

function PersonSelect({
  id,
  value,
  people,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  people: TaskPerson[] | null;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      className={INPUT}
      value={value}
      disabled={disabled || !people}
      required
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{people ? "— choose a person —" : "Loading staff…"}</option>
      {(people ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Section N: one row per ticked action, each with its own assignee. "Register
 * as tasks" stays disabled until every ticked action has a person.
 */
export function SectionNTaskRegister({
  triageId,
  actions,
  actionDetails,
  requiredDetailCodes = [],
  schema,
  actionLabel,
  readOnly,
  status = "INITIATED",
  idPrefix,
  onRegistered,
}: {
  triageId: string;
  /** The ticked action codes. */
  actions: string[];
  actionDetails?: Record<string, string>;
  requiredDetailCodes?: string[];
  schema?: "v3" | "v4" | "v5";
  actionLabel: (code: string) => string;
  readOnly: boolean;
  status?: CareTask["status"];
  idPrefix: string;
  /** The triage's tasks after registering; the form clears its ticked actions. */
  onRegistered: (tasks: CareTask[]) => void;
}) {
  const { accessToken } = useAuth();
  const { people, error: peopleError } = useTaskPeople(triageId);
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = actions.filter((code) => !assignees[code]);
  const missingDetails = actions.filter(
    (code) => requiredDetailCodes.includes(code) && !actionDetails?.[code]?.trim(),
  );

  async function register() {
    if (
      !accessToken ||
      readOnly ||
      busy ||
      !actions.length ||
      missing.length ||
      missingDetails.length
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const tasks = await registerTriageTasks(accessToken, triageId, {
        tasks: actions.map((code) => ({
          action: code,
          assignee: assignees[code],
          ...(actionDetails?.[code]?.trim() ? { detail: actionDetails[code].trim() } : {}),
        })),
        status,
        schema,
      });
      setAssignees({});
      onRegistered(tasks);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Tasks not registered — check your connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) return null;
  return (
    <div className="mt-3">
      {actions.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {actions.map((code) => (
            <Field
              key={code}
              label={<>Assign “{actionLabel(code)}” to</>}
              htmlFor={`${idPrefix}-assign-${code}`}
            >
              <PersonSelect
                id={`${idPrefix}-assign-${code}`}
                value={assignees[code] ?? ""}
                people={people}
                onChange={(value) => setAssignees((current) => ({ ...current, [code]: value }))}
              />
            </Field>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-500">
          Tick the actions above, then choose who does each one.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN}
          disabled={busy || !actions.length || missing.length > 0 || missingDetails.length > 0}
          onClick={register}
        >
          {busy ? "Registering…" : "Register as tasks"}
        </button>
        {actions.length > 0 && missing.length > 0 && (
          <span className="text-[12.5px] text-ink-500">
            Choose a person for every ticked action to register them.
          </span>
        )}
        {missingDetails.length > 0 && (
          <span className="text-[12.5px] text-ink-500">
            Describe “Other” before registering it.
          </span>
        )}
      </div>
      {(error || peopleError) && <ErrorNote>{error ?? peopleError}</ErrorNote>}
    </div>
  );
}

/** The key the server names when a signing task has no assignee. */
export const signingAssigneeKey = (focus: string) => `task_assignee_${focus}`;

/** The current assignee of each open task, by focus — prefills the signing picks. */
export function existingAssignees(tasks: CareTask[]) {
  const out: Record<string, string> = {};
  for (const t of tasks) {
    if (t.focus_type && t.assignee && t.status !== "COMPLETED") out[t.focus_type] = t.assignee;
  }
  return out;
}

/**
 * The tasks this triage's signature will raise (call-back, PEP decision, duty
 * to protect, psychiatric review…), each with its assignee. The triage cannot
 * be signed until each one has a named person.
 */
export function SigningTaskAssignees({
  triageId,
  tasks,
  value,
  onChange,
  readOnly,
  invalid,
  fieldId,
}: {
  triageId: string;
  tasks: SigningTask[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  readOnly: boolean;
  invalid: Set<string>;
  /** The form's id for an answer key, so a sign error can focus the select. */
  fieldId: (key: string) => string;
}) {
  const { people, error } = useTaskPeople(triageId);
  if (readOnly || tasks.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-surface-border bg-surface-bg p-3">
      <p className="text-[13px] font-semibold text-ink-900">Tasks raised when you sign</p>
      <p className="mb-2 text-[12px] text-ink-500">
        Your answers raise these tasks. Choose who does each one before signing.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tasks.map((task) => {
          const key = signingAssigneeKey(task.focus);
          return (
            <Field
              key={task.focus}
              label={task.label}
              htmlFor={fieldId(key)}
              hint={[
                `Usually: ${task.role}`,
                task.due_at ? `due ${formatDateTime(task.due_at)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              error={invalid.has(key) ? "Choose a person for this task." : undefined}
            >
              <PersonSelect
                id={fieldId(key)}
                value={value[task.focus] ?? ""}
                people={people}
                invalid={invalid.has(key)}
                onChange={(person) => onChange({ ...value, [task.focus]: person })}
              />
            </Field>
          );
        })}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
