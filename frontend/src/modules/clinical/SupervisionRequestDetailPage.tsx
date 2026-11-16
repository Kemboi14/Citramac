import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  completeSupervisionRequest,
  getSupervisionRequest,
  scheduleSupervisionRequest,
  type SupervisionRequest,
} from "../../lib/mhpExtrasApi";
import { Breadcrumbs } from "../care/shared/Breadcrumbs";
import { formatDateTime } from "../care/shared/format";
import { PageHeader } from "../care/shared/ui";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg transition-colors";

const STATUS_TINT: Record<SupervisionRequest["status"], string> = {
  OPEN: "bg-status-amber-tint text-status-amber",
  SCHEDULED: "bg-brand-green-tint text-brand-green-dark",
  COMPLETED: "bg-surface-border text-ink-500",
};
const STATUS_LABEL: Record<SupervisionRequest["status"], string> = {
  OPEN: "Open",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
};

function isSelfAssessmentTopic(topic: string) {
  return topic.startsWith("Therapist self-assessment");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeInputValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextFreeSlot() {
  const slot = new Date();
  slot.setHours(slot.getHours() + 1, 0, 0, 0);
  return slot;
}

type SupervisionRequestLoad = {
  key: string;
  request?: SupervisionRequest;
  error?: string;
};

function StatusPill({ status }: { status: SupervisionRequest["status"] }) {
  return (
    <span
      className={`inline-flex rounded-sm px-2 py-0.5 text-[11px] font-semibold ${STATUS_TINT[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{children}</dd>
    </div>
  );
}

export function SupervisionRequestDetailPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [requestLoad, setRequestLoad] = useState<SupervisionRequestLoad | null>(null);
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");

  const requestKey = JSON.stringify([id ?? null, accessToken ?? null]);
  const currentLoad = requestLoad?.key === requestKey ? requestLoad : null;
  const request = currentLoad?.request ?? null;
  const loading = Boolean(id) && !currentLoad;
  const error =
    currentLoad?.error ?? (actionError?.key === requestKey ? actionError.message : null);
  const setError = (message: string | null) =>
    setActionError(message ? { key: requestKey, message } : null);

  useEffect(() => {
    if (!accessToken || !id) return;
    let active = true;
    getSupervisionRequest(accessToken, id)
      .then((data) => {
        if (!active) return;
        setRequestLoad({ key: requestKey, request: data });
        setActionError(null);
        const slot = data.scheduled_for ? new Date(data.scheduled_for) : nextFreeSlot();
        setScheduleDate(dateInputValue(slot));
        setScheduleTime(timeInputValue(slot));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setRequestLoad({
          key: requestKey,
          error: err instanceof ApiError ? err.message : "Couldn't load this supervision request.",
        });
      });
    return () => {
      active = false;
    };
  }, [accessToken, id, requestKey]);

  const schedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !request || !scheduleDate || !scheduleTime) return;
    const slot = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(slot.getTime())) {
      setError("Choose a valid date and time for the session.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const updated = await scheduleSupervisionRequest(accessToken, request.id, slot.toISOString());
      setRequestLoad({ key: requestKey, request: updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule the session.");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!accessToken || !request) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await completeSupervisionRequest(accessToken, request.id, completionNotes);
      setRequestLoad({ key: requestKey, request: updated });
      setCompletionNotes("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete the request.");
    } finally {
      setBusy(false);
    }
  };

  const back = () => navigate("/clinical/mhp/supervision");

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[
            { label: "Clinical" },
            { label: "Supervision requests", to: "/clinical/mhp/supervision" },
            { label: "Loading…" },
          ]}
        />
        <p className="text-sm text-ink-500">Loading supervision request…</p>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[
            { label: "Clinical" },
            { label: "Supervision requests", to: "/clinical/mhp/supervision" },
            { label: "Not found" },
          ]}
        />
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error || "This supervision request could not be found."}
        </p>
        <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={back}>
          Back to queue
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: "Clinical" },
          { label: "Supervision requests", to: "/clinical/mhp/supervision" },
          { label: request.patient_name || "Supervision request" },
        ]}
      />

      <PageHeader
        title={request.patient_name || "Supervision request"}
        subtitle={`Requested by ${request.requested_by_name || "Unknown clinician"} · ${formatDateTime(request.requested_at)}`}
        actions={<StatusPill status={request.status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Details</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <DetailRow label="Client">{request.patient_name || "Unknown client"}</DetailRow>
              <DetailRow label="Requested by">
                {request.requested_by_name || "Unknown clinician"}
              </DetailRow>
              <DetailRow label="Supervisor">{request.supervisor_name || "Not yet taken"}</DetailRow>
              <DetailRow label="Status">{STATUS_LABEL[request.status]}</DetailRow>
              <DetailRow label="Requested">{formatDateTime(request.requested_at)}</DetailRow>
              {request.scheduled_for && (
                <DetailRow label="Scheduled for">{formatDateTime(request.scheduled_for)}</DetailRow>
              )}
              {request.completed_at && (
                <DetailRow label="Completed">{formatDateTime(request.completed_at)}</DetailRow>
              )}
            </dl>
          </section>

          {request.topic.trim() && !isSelfAssessmentTopic(request.topic) && (
            <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-3 font-display text-base font-semibold text-ink-900">Topic</h2>
              <p className="text-sm text-ink-900">{request.topic}</p>
            </section>
          )}

          {request.notes.trim() && (
            <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-3 font-display text-base font-semibold text-ink-900">
                Self-assessment and reflection
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink-700">{request.notes}</p>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {error && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {error}
            </p>
          )}

          {request.status === "OPEN" && (
            <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-3 font-display text-base font-semibold text-ink-900">
                Schedule the session
              </h2>
              <p className="mb-4 text-xs text-ink-500">
                You will be recorded as the supervisor for this request.
              </p>
              <form onSubmit={schedule} className="flex flex-col gap-3">
                <label className={LABEL_CLASS}>
                  Date
                  <input
                    type="date"
                    className={FIELD_CLASS}
                    value={scheduleDate}
                    onChange={(event) => setScheduleDate(event.target.value)}
                    required
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Time
                  <input
                    type="time"
                    className={FIELD_CLASS}
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !scheduleDate || !scheduleTime}
                  className={BUTTON_CLASS}
                >
                  Schedule session
                </button>
              </form>
            </section>
          )}

          {request.status === "SCHEDULED" && (
            <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-3 font-display text-base font-semibold text-ink-900">
                Complete the request
              </h2>
              <label className={LABEL_CLASS}>
                Completion notes (optional)
                <textarea
                  rows={4}
                  className={FIELD_CLASS}
                  value={completionNotes}
                  onChange={(event) => setCompletionNotes(event.target.value)}
                  placeholder="What was agreed, and what happens next?"
                />
              </label>
              <button
                type="button"
                onClick={complete}
                disabled={busy}
                className={`${BUTTON_CLASS} mt-3 w-full`}
              >
                Mark complete
              </button>
            </section>
          )}

          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={back}>
            <ChevronLeft className="mr-1 inline h-4 w-4" />
            Back to queue
          </button>
        </aside>
      </div>
    </div>
  );
}
