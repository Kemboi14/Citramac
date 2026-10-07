import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  BREACH_RISK_LABEL,
  createBreachIncident,
  getBreachIncident,
  listBreachIncidents,
  listTenantCompliance,
  recordBreachNotification,
  type BreachIncident,
  type BreachIncidentSummary,
  type BreachNotificationTrack,
  type BreachRisk,
  type BreachStatus,
} from "../../lib/complianceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 transition-all duration-150";
const BUTTON_GHOST =
  "inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-bg transition-colors duration-150";

const REFRESH_MS = 60_000;

const RISK_ORDER: BreachRisk[] = ["UNLIKELY", "RISK", "HIGH_RISK"];

const STATUS_TINT: Record<BreachStatus, string> = {
  OPEN: "bg-status-red-tint text-status-red",
  CONTAINED: "bg-status-amber-tint text-status-amber",
  CLOSED: "bg-surface-bg text-ink-500 border border-surface-border",
};

const STATUS_LABEL: Record<BreachStatus, string> = {
  OPEN: "Open",
  CONTAINED: "Contained",
  CLOSED: "Closed",
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "2d 4h", "3h 12m", "45m" — the largest two units of a duration. */
function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Value for a `datetime-local` input, in the browser's local time. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/** Re-renders every `intervalMs` so countdowns stay live. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface FacilityOption {
  id: string;
  name: string;
}

interface ReportForm {
  organization: string;
  title: string;
  description: string;
  became_aware_at: string;
  occurred_at: string;
  involves_health_data: boolean;
  data_categories: string;
  subjects_affected: string;
  risk_level: BreachRisk | "";
  containment_actions: string;
}

function emptyReportForm(): ReportForm {
  return {
    organization: "",
    title: "",
    description: "",
    became_aware_at: toLocalInput(new Date()),
    occurred_at: "",
    involves_health_data: true,
    data_categories: "",
    subjects_affected: "",
    risk_level: "",
    containment_actions: "",
  };
}

export function PlatformBreachIncidentsPage() {
  const { accessToken } = useAuth();
  const [incidents, setIncidents] = useState<BreachIncidentSummary[] | null>(null);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BreachIncident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const now = useNow(30_000);

  const loadList = useCallback(() => {
    if (!accessToken) return;
    listBreachIncidents(accessToken)
      .then((data) => {
        setIncidents(data.results);
        setLastLoaded(new Date());
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Couldn't load breach incidents.")));
  }, [accessToken]);

  const loadDetail = useCallback(
    (id: string) => {
      if (!accessToken) return;
      getBreachIncident(accessToken, id)
        .then((data) => {
          setDetail(data);
          setDetailError(null);
        })
        .catch((err) => setDetailError(errorMessage(err, "Couldn't load the incident.")));
    },
    [accessToken],
  );

  useEffect(() => {
    loadList();
    const timer = window.setInterval(loadList, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId);
    const timer = window.setInterval(() => loadDetail(selectedId), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!accessToken) return;
    listTenantCompliance(accessToken)
      .then((data) =>
        setFacilities(
          data.results.map((row) => ({ id: row.organization_id, name: row.organization_name })),
        ),
      )
      .catch((err) => setError(errorMessage(err, "Couldn't load the facility list.")));
  }, [accessToken]);

  const selectIncident = (id: string) => {
    setDetail(null);
    setDetailError(null);
    setSelectedId(id);
  };

  const onCreated = (incident: BreachIncident) => {
    setShowReport(false);
    setDetail(incident);
    setSelectedId(incident.id);
    loadList();
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Governance · Data protection
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Breach Incidents</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-500">
            Acting as processor, the platform must notify the affected facility within 48 hours of
            becoming aware of a breach. The facility, as controller, then notifies the ODPC (72
            hours) and the Digital Health Agency (48 hours).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={BUTTON_GHOST} onClick={loadList}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {!showReport && (
            <button type="button" className={BUTTON_PRIMARY} onClick={() => setShowReport(true)}>
              <Plus className="h-4 w-4" />
              Report a breach as processor
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {showReport && accessToken && (
        <ReportBreachForm
          accessToken={accessToken}
          facilities={facilities}
          onCancel={() => setShowReport(false)}
          onCreated={onCreated}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-surface-border bg-surface-bg text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Facility</th>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Reported as</th>
              <th className="px-4 py-3 font-semibold">Became aware</th>
              <th className="px-4 py-3 font-semibold">Risk</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Notifications</th>
            </tr>
          </thead>
          <tbody>
            {incidents === null && !error && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-500">
                  Loading incidents…
                </td>
              </tr>
            )}
            {incidents?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-500">
                  No breach incidents have been recorded.
                </td>
              </tr>
            )}
            {incidents?.map((incident) => (
              <tr
                key={incident.id}
                onClick={() => selectIncident(incident.id)}
                className={`cursor-pointer border-b border-surface-border last:border-0 hover:bg-surface-bg ${
                  incident.id === selectedId ? "bg-brand-green-tint/40" : ""
                }`}
              >
                <td className="px-4 py-3 font-medium text-ink-900">{incident.organization_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-700">{incident.reference}</td>
                <td className="px-4 py-3 text-ink-900">{incident.title}</td>
                <td className="px-4 py-3 text-ink-700">{incident.reported_role_label}</td>
                <td className="px-4 py-3 text-ink-700">
                  {formatDateTime(incident.became_aware_at)}
                </td>
                <td className="px-4 py-3 text-ink-700">{incident.risk_level_label}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${STATUS_TINT[incident.status]}`}
                  >
                    {STATUS_LABEL[incident.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {incident.overdue_tracks > 0 && (
                      <span className="rounded-sm bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
                        {incident.overdue_tracks} overdue
                      </span>
                    )}
                    {incident.pending_tracks > 0 && (
                      <span className="rounded-sm bg-status-amber-tint px-2 py-0.5 text-xs font-semibold text-status-amber">
                        {incident.pending_tracks} pending
                      </span>
                    )}
                    {incident.overdue_tracks === 0 && incident.pending_tracks === 0 && (
                      <span className="rounded-sm bg-brand-green-tint px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                        All made
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lastLoaded && (
        <p className="-mt-4 text-xs text-ink-500">
          Refreshes every 60 seconds · last loaded {lastLoaded.toLocaleTimeString()}
        </p>
      )}

      {selectedId && (
        <IncidentDetail
          detail={detail}
          error={detailError}
          now={now}
          accessToken={accessToken}
          onClose={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          onRecorded={() => {
            loadDetail(selectedId);
            loadList();
          }}
        />
      )}
    </div>
  );
}

function ReportBreachForm({
  accessToken,
  facilities,
  onCancel,
  onCreated,
}: {
  accessToken: string;
  facilities: FacilityOption[];
  onCancel: () => void;
  onCreated: (incident: BreachIncident) => void;
}) {
  const [form, setForm] = useState<ReportForm>(emptyReportForm);
  const [error, setError] = useState<string | null>(null);
  const maxNow = toLocalInput(new Date());

  const set = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);
    if (!form.organization) {
      setError("Choose the affected facility.");
      throw new Error("validation");
    }
    if (!form.risk_level) {
      setError("Choose a risk level.");
      throw new Error("validation");
    }
    const aware = new Date(form.became_aware_at);
    if (Number.isNaN(aware.getTime())) {
      setError("Enter when the platform became aware of the breach.");
      throw new Error("validation");
    }
    if (aware.getTime() > Date.now()) {
      setError("Became aware cannot be in the future.");
      throw new Error("validation");
    }
    try {
      const incident = await createBreachIncident(accessToken, {
        organization: form.organization,
        title: form.title.trim(),
        description: form.description.trim(),
        became_aware_at: aware.toISOString(),
        occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : null,
        involves_health_data: form.involves_health_data,
        data_categories: form.data_categories.trim(),
        subjects_affected: form.subjects_affected === "" ? null : Number(form.subjects_affected),
        risk_level: form.risk_level,
        containment_actions: form.containment_actions.trim(),
      });
      onCreated(incident);
    } catch (err) {
      setError(errorMessage(err, "Couldn't record the incident."));
      throw err;
    }
  };

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-ink-900">
            Report a breach as processor
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Recorded against the facility whose data is affected. Its Org Admins and platform staff
            are notified, and the notification deadlines start from &ldquo;Became aware&rdquo;.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="rounded p-1 text-ink-500 hover:text-ink-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className={LABEL_CLASS}>
          Affected facility
          <select
            className={FIELD_CLASS}
            value={form.organization}
            onChange={(e) => set("organization", e.target.value)}
            required
          >
            <option value="">Select a facility…</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Title
          <input
            className={FIELD_CLASS}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            required
          />
        </label>
        <label className={`${LABEL_CLASS} md:col-span-2`}>
          Description
          <textarea
            className={`${FIELD_CLASS} min-h-[90px]`}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Became aware
          <input
            type="datetime-local"
            className={FIELD_CLASS}
            value={form.became_aware_at}
            max={maxNow}
            onChange={(e) => set("became_aware_at", e.target.value)}
            required
          />
          <span className="text-xs font-normal text-ink-500">
            The notification clock runs from this moment. It cannot be in the future.
          </span>
        </label>
        <label className={LABEL_CLASS}>
          Occurred (if known)
          <input
            type="datetime-local"
            className={FIELD_CLASS}
            value={form.occurred_at}
            max={maxNow}
            onChange={(e) => set("occurred_at", e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Risk level
          <select
            className={FIELD_CLASS}
            value={form.risk_level}
            onChange={(e) => set("risk_level", e.target.value as BreachRisk | "")}
            required
          >
            <option value="">Select…</option>
            {RISK_ORDER.map((code) => (
              <option key={code} value={code}>
                {/* eslint-disable-next-line security/detect-object-injection -- `code` comes from the fixed RISK_ORDER array. */}
                {BREACH_RISK_LABEL[code]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          People affected (if known)
          <input
            type="number"
            min={0}
            className={FIELD_CLASS}
            value={form.subjects_affected}
            onChange={(e) => set("subjects_affected", e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Data categories
          <input
            className={FIELD_CLASS}
            value={form.data_categories}
            onChange={(e) => set("data_categories", e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            className="h-[15px] w-[15px] accent-brand-green"
            checked={form.involves_health_data}
            onChange={(e) => set("involves_health_data", e.target.checked)}
          />
          Involves health data
        </label>
        <label className={`${LABEL_CLASS} md:col-span-2`}>
          Containment actions taken
          <textarea
            className={`${FIELD_CLASS} min-h-[70px]`}
            value={form.containment_actions}
            onChange={(e) => set("containment_actions", e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <SaveButton onSave={submit} savingLabel="Recording…" savedLabel="Recorded">
          Record incident
        </SaveButton>
        <button type="button" className={BUTTON_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function IncidentDetail({
  detail,
  error,
  now,
  accessToken,
  onClose,
  onRecorded,
}: {
  detail: BreachIncident | null;
  error: string | null;
  now: number;
  accessToken: string | null;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [recordingId, setRecordingId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-ink-500">{detail?.reference}</div>
          <h2 className="font-display text-lg font-semibold text-ink-900">
            {detail ? detail.title : "Loading incident…"}
          </h2>
          {detail && (
            <p className="mt-0.5 text-sm text-ink-500">
              {detail.organization_name} · reported as {detail.reported_role_label.toLowerCase()} by{" "}
              {detail.reported_by || "—"}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close incident"
          className="rounded p-1 text-ink-500 hover:text-ink-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      {detail && (
        <>
          <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Status">
              <span
                className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${STATUS_TINT[detail.status]}`}
              >
                {STATUS_LABEL[detail.status]}
              </span>
              {detail.closed_at && (
                <span className="ml-2 text-ink-500">{formatDateTime(detail.closed_at)}</span>
              )}
            </Fact>
            <Fact label="Became aware">{formatDateTime(detail.became_aware_at)}</Fact>
            <Fact label="Occurred">{formatDateTime(detail.occurred_at)}</Fact>
            <Fact label="Risk">{detail.risk_level_label}</Fact>
            <Fact label="Involves health data">{detail.involves_health_data ? "Yes" : "No"}</Fact>
            <Fact label="People affected">
              {detail.subjects_affected === null ? "Unknown" : detail.subjects_affected}
            </Fact>
            <Fact label="Data categories" wide>
              {detail.data_categories || "—"}
            </Fact>
            <Fact label="Description" wide>
              <span className="whitespace-pre-wrap">{detail.description}</span>
            </Fact>
            <Fact label="Containment actions" wide>
              <span className="whitespace-pre-wrap">{detail.containment_actions || "—"}</span>
            </Fact>
          </dl>

          <h3 className="mb-2 font-display text-sm font-semibold text-ink-900">
            Notification tracks
          </h3>
          <p className="mb-3 text-xs text-ink-500">
            Platform staff record the &ldquo;Platform → facility&rdquo; notification. The facility
            records its own regulator and data-subject notifications unless the platform reported
            the incident; the server refuses anything else.
          </p>
          <div className="overflow-x-auto rounded-md border border-surface-border">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Track</th>
                  <th className="px-3 py-2 font-semibold">Required</th>
                  <th className="px-3 py-2 font-semibold">Due</th>
                  <th className="px-3 py-2 font-semibold">Time left</th>
                  <th className="px-3 py-2 font-semibold">Notified</th>
                  <th className="px-3 py-2 font-semibold">Method / reference</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.tracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    now={now}
                    recording={recordingId === track.id}
                    onRecord={() => setRecordingId(track.id)}
                    onCancel={() => setRecordingId(null)}
                    accessToken={accessToken}
                    onRecorded={() => {
                      setRecordingId(null);
                      onRecorded();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Fact({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}

function TrackRow({
  track,
  now,
  recording,
  onRecord,
  onCancel,
  accessToken,
  onRecorded,
}: {
  track: BreachNotificationTrack;
  now: number;
  recording: boolean;
  onRecord: () => void;
  onCancel: () => void;
  accessToken: string | null;
  onRecorded: () => void;
}) {
  const remaining = new Date(track.due_at).getTime() - now;
  let timeLeft: React.ReactNode = "—";
  if (!track.notified_at && track.required) {
    if (track.without_delay) {
      timeLeft = <span className="font-semibold text-status-amber">Without delay</span>;
    } else if (track.is_overdue || remaining <= 0) {
      timeLeft = (
        <span className="inline-flex items-center gap-1 font-semibold text-status-red">
          <AlertTriangle className="h-3.5 w-3.5" />
          Overdue by {formatDuration(-remaining)}
        </span>
      );
    } else {
      timeLeft = (
        <span className={remaining < 6 * 3_600_000 ? "font-semibold text-status-amber" : ""}>
          {formatDuration(remaining)} left
        </span>
      );
    }
  }

  return (
    <>
      <tr className="border-b border-surface-border last:border-0 align-top">
        <td className="px-3 py-2 font-medium text-ink-900">{track.track_label}</td>
        <td className="px-3 py-2 text-ink-700">{track.required ? "Yes" : "Not required"}</td>
        <td className="px-3 py-2 text-ink-700">
          {track.without_delay ? "Without delay" : formatDateTime(track.due_at)}
        </td>
        <td className="px-3 py-2 text-ink-700">{timeLeft}</td>
        <td className="px-3 py-2 text-ink-700">
          {track.notified_at ? (
            <>
              <div>{formatDateTime(track.notified_at)}</div>
              <div className="text-xs text-ink-500">by {track.notified_by || "—"}</div>
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2 text-ink-700">
          {track.notified_at ? (
            <>
              <div>{track.method}</div>
              {track.reference && <div className="text-xs text-ink-500">{track.reference}</div>}
              {track.notes && (
                <div className="whitespace-pre-wrap text-xs text-ink-500">{track.notes}</div>
              )}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {!track.notified_at && !recording && (
            <button type="button" className={BUTTON_GHOST} onClick={onRecord}>
              Record notification
            </button>
          )}
        </td>
      </tr>
      {recording && accessToken && (
        <tr className="border-b border-surface-border bg-surface-bg last:border-0">
          <td colSpan={7} className="px-3 py-3">
            <RecordNotificationForm
              accessToken={accessToken}
              track={track}
              onCancel={onCancel}
              onRecorded={onRecorded}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function RecordNotificationForm({
  accessToken,
  track,
  onCancel,
  onRecorded,
}: {
  accessToken: string;
  track: BreachNotificationTrack;
  onCancel: () => void;
  onRecorded: () => void;
}) {
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [notifiedAt, setNotifiedAt] = useState(() => toLocalInput(new Date()));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!method.trim()) {
      setError("Say how the notification was made.");
      throw new Error("validation");
    }
    const at = notifiedAt ? new Date(notifiedAt) : null;
    if (at && at.getTime() > Date.now()) {
      setError("Notified at cannot be in the future.");
      throw new Error("validation");
    }
    try {
      await recordBreachNotification(accessToken, track.id, {
        method: method.trim(),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        notified_at: at ? at.toISOString() : undefined,
      });
      onRecorded();
    } catch (err) {
      setError(errorMessage(err, "Couldn't record the notification."));
      throw err;
    }
  };

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
      <div className="text-sm font-semibold text-ink-900">
        Record notification — {track.track_label}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className={LABEL_CLASS}>
          Method
          <input
            className={FIELD_CLASS}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="e.g. email, phone call, portal"
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Reference
          <input
            className={FIELD_CLASS}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Notified at
          <input
            type="datetime-local"
            className={FIELD_CLASS}
            value={notifiedAt}
            max={toLocalInput(new Date())}
            onChange={(e) => setNotifiedAt(e.target.value)}
          />
        </label>
        <label className={`${LABEL_CLASS} md:col-span-3`}>
          Notes
          <textarea
            className={`${FIELD_CLASS} min-h-[60px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <SaveButton onSave={submit} savingLabel="Recording…" savedLabel="Recorded">
          Record notification
        </SaveButton>
        <button type="button" className={BUTTON_GHOST} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
