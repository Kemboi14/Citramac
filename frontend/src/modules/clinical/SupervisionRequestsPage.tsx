import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePatientContext } from "../../clinical/PatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  completeSupervisionRequest,
  createSupervisionRequest,
  listSupervisionRequests,
  scheduleSupervisionRequest,
  type SupervisionRequest,
} from "../../lib/ccpExtrasApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

const STATUS_TINT: Record<string, string> = {
  OPEN: "bg-ink-100 text-ink-700",
  SCHEDULED: "bg-brand-green-tint text-brand-green-dark",
  COMPLETED: "bg-surface-border text-ink-500",
};

/**
 * Junior clinician requests supervisor time on a case — mirrors the
 * mockup's "Supervision Requests" nav item, docs/07-CLINICAL-MODULES-SPEC.md
 * §7.14.5.
 */
export function SupervisionRequestsPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [topic, setTopic] = useState("");
  const [requests, setRequests] = useState<SupervisionRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!accessToken) return;
    setRequests((await listSupervisionRequests(accessToken)).results);
  };

  useEffect(() => {
    if (!accessToken) return;
    listSupervisionRequests(accessToken)
      .then((res) => setRequests(res.results))
      .catch(() => setError("Couldn't load supervision requests."));
  }, [accessToken]);

  if (!selected) {
    return (
      <p className="text-ink-500">
        Select a client from the{" "}
        <Link to="/clinical" className="font-semibold text-brand-green hover:underline">
          Client Registry
        </Link>{" "}
        first.
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !topic.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await createSupervisionRequest(accessToken, selected.patientId, topic);
      setTopic("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the request.");
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await scheduleSupervisionRequest(accessToken, id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule.");
    } finally {
      setBusy(false);
    }
  };

  const complete = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      await completeSupervisionRequest(accessToken, id, "");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          CCP Program · Clinical Review &amp; Supervision
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Supervision Requests — {selected.patientName}
        </h1>
      </div>

      <form
        onSubmit={submit}
        className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <label className={LABEL_CLASS}>
          Topic
          <input
            className={FIELD_CLASS}
            placeholder="e.g. Risk escalation review"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy} className={`${BUTTON_CLASS} mt-4`}>
          Request Supervision
        </button>
      </form>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Requests</h2>
        <div className="flex flex-col gap-3">
          {requests
            .filter((r) => r.patient === selected.patientId)
            .map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-sm border border-surface-border p-3 text-sm"
              >
                <span>{r.topic}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      STATUS_TINT[r.status] ?? ""
                    }`}
                  >
                    {r.status}
                  </span>
                  {r.status === "OPEN" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline"
                      onClick={() => schedule(r.id)}
                    >
                      Schedule
                    </button>
                  )}
                  {r.status === "SCHEDULED" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline"
                      onClick={() => complete(r.id)}
                    >
                      Mark Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
