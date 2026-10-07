import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  BREACH_RISK_LABEL,
  createBreachIncident,
  getBreachIncident,
  listBreachIncidents,
  recordBreachNotification,
  updateBreachIncident,
  type BreachIncident,
  type BreachIncidentPayload,
  type BreachNotificationTrack,
  type BreachRisk,
  type BreachStatus,
} from "../../lib/complianceApi";
import { formatDateTime } from "../care/shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../care/shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "../care/shared/ui";
import { useRecordData } from "../care/record/useRecordData";

// Org Admin — personal-data breach incidents and their notification deadlines
// (docs/16-DATA-PROTECTION-COMPLIANCE.md; legal opinion of 2 Oct 2026 §10).
// Which tracks are required and when each is due is computed by the server
// (apps.compliance.models.breach_tracks); this screen only displays them. The
// Digital Health Agency's prescribed notification form is not generated here.

const RISKS = Object.keys(BREACH_RISK_LABEL) as BreachRisk[];
const STATUS_LABEL: Record<BreachStatus, string> = {
  OPEN: "Open",
  CONTAINED: "Contained",
  CLOSED: "Closed",
};
const STATUSES = Object.keys(STATUS_LABEL) as BreachStatus[];
const REFRESH_MS = 60_000;

function errorText(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  const fields = err.fields
    ? Object.entries(err.fields)
        .map(([field, msg]) => {
          const text = Array.isArray(msg) ? msg.map(String).join(" ") : String(msg);
          return field === "detail" || field === "status"
            ? text
            : `${field.replace(/_/g, " ")}: ${text}`;
        })
        .join("; ")
    : "";
  return fields && fields !== err.message ? `${err.message} — ${fields}` : err.message;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as the local `yyyy-mm-ddThh:mm` value of a datetime-local input. */
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toLocalInput(d);
}

/** datetime-local value → ISO with offset, or null when blank/invalid. */
function localInputToIso(value: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatSpan(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Ticks every 30s so countdowns stay live between the 60s data refreshes. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function statusTone(status: BreachStatus): "risk" | "warn" | "neutral" {
  if (status === "OPEN") return "risk";
  if (status === "CONTAINED") return "warn";
  return "neutral";
}

function NotificationBadge({ overdue, pending }: { overdue: number; pending: number }) {
  if (overdue > 0) return <Tag tone="risk">{overdue} overdue</Tag>;
  if (pending > 0) return <Tag tone="warn">{pending} pending</Tag>;
  return <Tag tone="brand">All recorded</Tag>;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[13px] text-ink-900">{children}</dd>
    </div>
  );
}

const NOT_RECORDED = <span className="text-ink-400">Not recorded</span>;

// ── Report form ──

interface FactsForm {
  title: string;
  description: string;
  occurred_at: string;
  involves_health_data: boolean;
  data_categories: string;
  subjects_affected: string;
  risk_level: BreachRisk | "";
  containment_actions: string;
}

const EMPTY_FACTS: FactsForm = {
  title: "",
  description: "",
  occurred_at: "",
  involves_health_data: true,
  data_categories: "",
  subjects_affected: "",
  risk_level: "",
  containment_actions: "",
};

function factsFrom(incident: BreachIncident): FactsForm {
  return {
    title: incident.title,
    description: incident.description,
    occurred_at: isoToLocalInput(incident.occurred_at),
    involves_health_data: incident.involves_health_data,
    data_categories: incident.data_categories,
    subjects_affected:
      incident.subjects_affected === null ? "" : String(incident.subjects_affected),
    risk_level: incident.risk_level,
    containment_actions: incident.containment_actions,
  };
}

/** Client-side checks the server would also make; returns a message or null. */
function factsProblem(form: FactsForm, nowMs: number) {
  if (!form.title.trim() || !form.description.trim()) return "Give a title and a description.";
  if (!form.risk_level) return "Choose a risk level.";
  const occurred = localInputToIso(form.occurred_at);
  if (occurred && new Date(occurred).getTime() > nowMs) {
    return "When it occurred cannot be in the future.";
  }
  const affected = form.subjects_affected.trim();
  if (affected && !/^\d+$/.test(affected)) {
    return "Number of people affected must be a whole number.";
  }
  return null;
}

function factsPayload(form: FactsForm) {
  const affected = form.subjects_affected.trim();
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    occurred_at: localInputToIso(form.occurred_at),
    involves_health_data: form.involves_health_data,
    data_categories: form.data_categories.trim(),
    subjects_affected: affected ? Number(affected) : null,
    risk_level: form.risk_level as BreachRisk,
    containment_actions: form.containment_actions.trim(),
  };
}

function FactsFields({
  form,
  set,
  maxLocal,
}: {
  form: FactsForm;
  set: (changes: Partial<FactsForm>) => void;
  maxLocal: string;
}) {
  const id = useId();
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} className="sm:col-span-2">
        <input
          id={`${id}-title`}
          className={INPUT}
          required
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </Field>
      <Field label="What happened" htmlFor={`${id}-description`} className="sm:col-span-2">
        <textarea
          id={`${id}-description`}
          rows={3}
          className={INPUT}
          required
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field label="When it occurred (optional)" htmlFor={`${id}-occurred`}>
        <input
          id={`${id}-occurred`}
          type="datetime-local"
          className={INPUT}
          max={maxLocal}
          value={form.occurred_at}
          onChange={(e) => set({ occurred_at: e.target.value })}
        />
      </Field>
      <Field label="Number of people affected (optional)" htmlFor={`${id}-affected`}>
        <input
          id={`${id}-affected`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className={INPUT}
          value={form.subjects_affected}
          onChange={(e) => set({ subjects_affected: e.target.value })}
        />
      </Field>
      <Field
        label="Data categories involved"
        htmlFor={`${id}-categories`}
        className="sm:col-span-2"
      >
        <input
          id={`${id}-categories`}
          className={INPUT}
          value={form.data_categories}
          onChange={(e) => set({ data_categories: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
          <input
            type="checkbox"
            className="h-[17px] w-[17px] accent-[var(--green)]"
            checked={form.involves_health_data}
            onChange={(e) => set({ involves_health_data: e.target.checked })}
          />
          Involves health data
        </label>
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Risk to the people affected
        </legend>
        <div className="flex flex-col gap-1">
          {RISKS.map((risk) => (
            <label
              key={risk}
              className="flex cursor-pointer items-center gap-2 py-0.5 text-[13px] text-ink-900"
            >
              <input
                type="radio"
                name={`${id}-risk`}
                className="h-[17px] w-[17px] accent-[var(--green)]"
                checked={form.risk_level === risk}
                onChange={() => set({ risk_level: risk })}
              />
              {/* eslint-disable-next-line security/detect-object-injection -- typed BreachRisk key. */}
              {BREACH_RISK_LABEL[risk]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Containment actions taken"
        htmlFor={`${id}-containment`}
        className="sm:col-span-2"
      >
        <textarea
          id={`${id}-containment`}
          rows={2}
          className={INPUT}
          value={form.containment_actions}
          onChange={(e) => set({ containment_actions: e.target.value })}
        />
      </Field>
    </>
  );
}

function ReportForm({
  onCreated,
  onCancel,
}: {
  onCreated: (incident: BreachIncident) => void;
  onCancel: () => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const now = useNow();
  const [form, setForm] = useState<FactsForm>(EMPTY_FACTS);
  const [aware, setAware] = useState(() => toLocalInput(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<FactsForm>) => setForm((f) => ({ ...f, ...changes }));
  const maxLocal = toLocalInput(new Date(now + 60_000));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    const awareIso = localInputToIso(aware);
    const problem =
      (!awareIso && "Enter when you became aware of the breach.") ||
      (awareIso && new Date(awareIso).getTime() > Date.now() + 60_000
        ? "When you became aware cannot be in the future."
        : null) ||
      factsProblem(form, Date.now() + 60_000);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: BreachIncidentPayload = {
        ...factsPayload(form),
        became_aware_at: awareIso as string,
      };
      onCreated(await createBreachIncident(accessToken, payload));
    } catch (err) {
      setError(errorText(err, "Couldn't record the breach."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Report a breach">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-500">
          Deadlines run from when your facility became aware of the breach, so record it as soon as
          you know — you can add and correct the facts afterwards.
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="When you became aware" htmlFor={`${id}-aware`} className="sm:col-span-2">
            <input
              id={`${id}-aware`}
              type="datetime-local"
              className={`${INPUT} sm:max-w-xs`}
              required
              max={maxLocal}
              value={aware}
              onChange={(e) => setAware(e.target.value)}
            />
          </Field>
          <FactsFields form={form} set={set} maxLocal={maxLocal} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BTN} disabled={saving}>
            {saving ? "Recording…" : "Record breach"}
          </button>
          <button type="button" className={BTN_GHOST} disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

// ── Notification tracks ──

function Countdown({ track, now }: { track: BreachNotificationTrack; now: number }) {
  if (!track.required) return <span className="text-ink-400">—</span>;
  if (track.notified_at) return <Tag tone="brand">Notified</Tag>;
  if (track.without_delay) {
    return <span className="font-semibold text-priority-red">Due now — without delay</span>;
  }
  const remaining = new Date(track.due_at).getTime() - now;
  if (remaining <= 0 || track.is_overdue) {
    return (
      <span className="font-semibold text-priority-red">Overdue by {formatSpan(-remaining)}</span>
    );
  }
  return (
    <span className={remaining < 12 * 3_600_000 ? "font-semibold text-priority-orange" : ""}>
      {formatSpan(remaining)} left
    </span>
  );
}

function RecordNotificationForm({
  track,
  onSaved,
  onCancel,
}: {
  track: BreachNotificationTrack;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [notifiedAt, setNotifiedAt] = useState(() => toLocalInput(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    if (!method.trim()) {
      setError("Say how the notification was made.");
      return;
    }
    const at = localInputToIso(notifiedAt);
    if (at && new Date(at).getTime() > Date.now() + 60_000) {
      setError("When it was notified cannot be in the future.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordBreachNotification(accessToken, track.id, {
        method: method.trim(),
        reference: reference.trim(),
        notes: notes.trim(),
        ...(at ? { notified_at: at } : {}),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, "Couldn't record the notification."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-bg p-3.5"
      aria-label={`Record notification — ${track.track_label}`}
    >
      <div className="text-[12.5px] font-semibold text-ink-900">
        Record notification — {track.track_label}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="How it was made" htmlFor={`${id}-method`}>
          <input
            id={`${id}-method`}
            className={INPUT}
            required
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          />
        </Field>
        <Field label="Notified at" htmlFor={`${id}-at`}>
          <input
            id={`${id}-at`}
            type="datetime-local"
            className={INPUT}
            value={notifiedAt}
            onChange={(e) => setNotifiedAt(e.target.value)}
          />
        </Field>
        <Field label="Reference (optional)" htmlFor={`${id}-reference`}>
          <input
            id={`${id}-reference`}
            className={INPUT}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field label="Notes (optional)" htmlFor={`${id}-notes`}>
          <input
            id={`${id}-notes`}
            className={INPUT}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={saving}>
          {saving ? "Saving…" : "Record notification"}
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function notRequiredText(track: BreachNotificationTrack) {
  return track.track === "DHA"
    ? "Not required — no health data involved"
    : "Not required for this risk level";
}

function TracksTable({ incident, onChanged }: { incident: BreachIncident; onChanged: () => void }) {
  const now = useNow();
  const [recording, setRecording] = useState<string | null>(null);
  const recordingTrack = incident.tracks.find((t) => t.id === recording) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className={`${TABLE} min-w-[860px]`} aria-label="Notification deadlines">
          <thead>
            <tr>
              <th className={TH}>Notify</th>
              <th className={TH}>Required</th>
              <th className={TH}>Due</th>
              <th className={TH}>Time left</th>
              <th className={TH}>Notified</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {incident.tracks.map((track) => {
              const platformTrack = track.track === "TENANT_CONTROLLER";
              return (
                <tr key={track.id} className={track.is_overdue ? "bg-priority-red-tint" : ""}>
                  <td className={`${TD} font-semibold`}>{track.track_label}</td>
                  <td className={TD}>
                    {track.required ? (
                      "Required"
                    ) : (
                      <span className="text-ink-500">{notRequiredText(track)}</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {!track.required
                      ? "—"
                      : track.without_delay
                        ? "Without delay"
                        : formatDateTime(track.due_at)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Countdown track={track} now={now} />
                  </td>
                  <td className={TD}>
                    {track.notified_at ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="font-mono">{formatDateTime(track.notified_at)}</span>
                        <span>By {track.notified_by || "—"}</span>
                        <span>Method: {track.method || "—"}</span>
                        {track.reference && <span>Reference: {track.reference}</span>}
                        {track.notes && (
                          <span className="whitespace-pre-wrap text-ink-500">{track.notes}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-400">Not yet</span>
                    )}
                  </td>
                  <td className={TD}>
                    {platformTrack ? (
                      <span className="text-xs text-ink-500">Recorded by platform staff</span>
                    ) : (
                      track.required &&
                      !track.notified_at && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM} whitespace-nowrap`}
                          onClick={() => setRecording(track.id)}
                          disabled={recording === track.id}
                        >
                          Record notification
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {incident.tracks.length === 0 && (
              <tr>
                <td colSpan={6} className={`${TD} py-6 text-center text-ink-500`}>
                  No notification tracks have been computed for this incident.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {recordingTrack && (
        <RecordNotificationForm
          key={recordingTrack.id}
          track={recordingTrack}
          onCancel={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ── Incident detail ──

function IncidentDetail({
  incident,
  onChanged,
  onClose,
}: {
  incident: BreachIncident;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const now = useNow();
  const [editing, setEditing] = useState<FactsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const closed = incident.status === "CLOSED";
  const set = (changes: Partial<FactsForm>) => setEditing((f) => (f ? { ...f, ...changes } : f));

  const saveFacts = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !editing) return;
    const problem = factsProblem(editing, Date.now() + 60_000);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateBreachIncident(accessToken, incident.id, factsPayload(editing));
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(errorText(err, "Couldn't save the incident."));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: BreachStatus) => {
    if (!accessToken || status === incident.status) return;
    if (
      status === "CLOSED" &&
      !window.confirm(`Close incident ${incident.reference}? Its facts can no longer be edited.`)
    ) {
      return;
    }
    setSaving(true);
    setStatusError(null);
    try {
      await updateBreachIncident(accessToken, incident.id, { status });
      onChanged();
    } catch (err) {
      setStatusError(errorText(err, "Couldn't change the incident's status."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{incident.reference}</span>
          <span>{incident.title}</span>
          <Tag tone={statusTone(incident.status)}>{STATUS_LABEL[incident.status]}</Tag>
        </span>
      }
      aside={
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={onClose}>
          Back to list
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {editing ? (
          <form onSubmit={(e) => void saveFacts(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <FactsFields
                form={editing}
                set={set}
                maxLocal={toLocalInput(new Date(now + 60_000))}
              />
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BTN} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className={BTN_GHOST}
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Became aware">{formatDateTime(incident.became_aware_at)}</Item>
              <Item label="Occurred">
                {incident.occurred_at ? formatDateTime(incident.occurred_at) : NOT_RECORDED}
              </Item>
              <Item label="Reported as">{incident.reported_role_label}</Item>
              <Item label="Reported by">{incident.reported_by || NOT_RECORDED}</Item>
              <Item label="Risk">{incident.risk_level_label}</Item>
              <Item label="Involves health data">
                {incident.involves_health_data ? "Yes" : "No"}
              </Item>
              <Item label="People affected">
                {incident.subjects_affected === null
                  ? NOT_RECORDED
                  : String(incident.subjects_affected)}
              </Item>
              <Item label="Data categories">{incident.data_categories || NOT_RECORDED}</Item>
              {incident.closed_at && (
                <Item label="Closed">{formatDateTime(incident.closed_at)}</Item>
              )}
            </dl>
            <dl className="grid grid-cols-1 gap-y-2.5">
              <Item label="What happened">{incident.description || NOT_RECORDED}</Item>
              <Item label="Containment actions">
                {incident.containment_actions || NOT_RECORDED}
              </Item>
            </dl>
            {!closed && (
              <div>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => {
                    setError(null);
                    setEditing(factsFrom(incident));
                  }}
                >
                  Edit facts
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Status</div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Incident status">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={incident.status === status}
                className={`${incident.status === status ? BTN : BTN_GHOST} ${BTN_SM}`}
                disabled={saving || incident.status === status}
                onClick={() => void changeStatus(status)}
              >
                {/* eslint-disable-next-line security/detect-object-injection -- typed BreachStatus key. */}
                {STATUS_LABEL[status]}
              </button>
            ))}
          </div>
          <ErrorNote>{statusError}</ErrorNote>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">
            Notification deadlines
          </div>
          <TracksTable incident={incident} onChanged={onChanged} />
        </div>
      </div>
    </Card>
  );
}

// ── Page ──

export function BreachIncidentsPage() {
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setVersion((v) => v + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const list = useRecordData(
    "breach-incidents",
    version,
    (token) => listBreachIncidents(token),
    "Couldn't load breach incidents.",
  );
  const detail = useRecordData(
    selected,
    version,
    (token) => getBreachIncident(token, selected as string),
    "Couldn't load this incident.",
  );
  const refresh = () => setVersion((v) => v + 1);
  const incidents = list.data?.results ?? null;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <PageHeader
        eyebrow="Organization · Data protection"
        title="Breach Incidents"
        subtitle="Personal-data breaches affecting your facility and the notifications each one requires."
        actions={
          !reporting && (
            <button
              type="button"
              className={BTN}
              onClick={() => {
                setSelected(null);
                setReporting(true);
              }}
            >
              Report a breach
            </button>
          )
        }
      />

      <Callout>
        Deadlines follow the Data Protection Act s.43 and the Digital Health regulations — ODPC
        within 72 hours, Digital Health Agency within 48 hours, and the facility within 48 hours
        when the platform is the processor. The Digital Health Agency notice must be made on its
        prescribed form, which this page does not generate.
      </Callout>

      {reporting && (
        <ReportForm
          onCancel={() => setReporting(false)}
          onCreated={(incident) => {
            setReporting(false);
            setSelected(incident.id);
            refresh();
          }}
        />
      )}

      {selected ? (
        <>
          <ErrorNote>{detail.error}</ErrorNote>
          {detail.data ? (
            <IncidentDetail
              key={detail.data.id}
              incident={detail.data}
              onChanged={refresh}
              onClose={() => setSelected(null)}
            />
          ) : (
            !detail.error && <p className="text-[13px] text-ink-500">Loading incident…</p>
          )}
        </>
      ) : (
        <Card title="Incidents" bodyClassName="p-0">
          <div className="p-[18px] pb-0">
            <ErrorNote>{list.error}</ErrorNote>
          </div>
          {incidents === null ? (
            !list.error && <p className="px-5 py-8 text-sm text-ink-500">Loading incidents…</p>
          ) : incidents.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">
              No breach incidents have been recorded for your facility.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className={`${TABLE} min-w-[760px]`}>
                <thead>
                  <tr>
                    <th className={TH}>Reference</th>
                    <th className={TH}>Title</th>
                    <th className={TH}>Became aware</th>
                    <th className={TH}>Risk</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Notifications</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr
                      key={incident.id}
                      className="cursor-pointer hover:bg-surface-bg"
                      onClick={() => setSelected(incident.id)}
                    >
                      <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                        <button
                          type="button"
                          className="font-semibold text-brand-green hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(incident.id);
                          }}
                        >
                          {incident.reference}
                        </button>
                      </td>
                      <td className={TD}>{incident.title}</td>
                      <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                        {formatDateTime(incident.became_aware_at)}
                      </td>
                      <td className={TD}>{incident.risk_level_label}</td>
                      <td className={TD}>
                        <Tag tone={statusTone(incident.status)}>
                          {STATUS_LABEL[incident.status]}
                        </Tag>
                      </td>
                      <td className={TD}>
                        <NotificationBadge
                          overdue={incident.overdue_tracks}
                          pending={incident.pending_tracks}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
