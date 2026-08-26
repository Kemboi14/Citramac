import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import {
  dismissAlert,
  investigateAlert,
  listSecurityAlerts,
  resolveAlert,
  type SecurityAlert,
  type SecurityAlertStatus,
} from "../../lib/securityApi";

const SEVERITY_TINT: Record<string, string> = {
  LOW: "bg-surface-bg text-ink-700",
  MEDIUM: "bg-status-amber-tint text-status-amber",
  HIGH: "bg-status-amber-tint text-status-amber",
  CRITICAL: "bg-status-red-tint text-status-red",
};

const STATUS_TINT: Record<string, string> = {
  NEW: "bg-status-amber-tint text-status-amber",
  INVESTIGATING: "bg-brand-green-tint-2 text-brand-green-dark",
  RESOLVED: "bg-brand-green-tint text-brand-green-dark",
  DISMISSED: "bg-surface-bg text-ink-500",
};

const CATEGORY_LABEL: Record<string, string> = {
  FAILED_LOGINS: "Failed login spike",
  MFA_ADOPTION: "Low MFA adoption",
};

const FILTERS: ("All" | SecurityAlertStatus)[] = [
  "All",
  "NEW",
  "INVESTIGATING",
  "RESOLVED",
  "DISMISSED",
];

const ACTION_BUTTON_CLASS =
  "rounded-md border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-50";

export function SecurityAlertsPage() {
  const { accessToken } = useAuth();
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [filter, setFilter] = useState<"All" | SecurityAlertStatus>("All");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    listSecurityAlerts(accessToken)
      .then((res) => setAlerts(res.results))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load security alerts."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const applyUpdate = (updated: SecurityAlert) => {
    setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const runAction = async (
    id: string,
    action: (accessToken: string, id: string) => Promise<SecurityAlert>,
    failureMessage: string,
  ) => {
    if (!accessToken) return;
    setError(null);
    setBusyId(id);
    try {
      const updated = await action(accessToken, id);
      applyUpdate(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failureMessage);
    } finally {
      setBusyId(null);
    }
  };

  const visible = filter === "All" ? alerts : alerts.filter((a) => a.status === filter);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Security
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Security Alerts</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filter === f
                ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                : "border-surface-border bg-surface-card text-ink-700 hover:bg-surface-bg"
            }`}
          >
            {f === "All" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {loading && alerts.length === 0 && <p className="text-sm text-ink-500">Loading alerts…</p>}

      {!loading && (
        <div className="flex flex-col gap-3">
          {visible.map((alert) => (
            <div
              key={alert.id}
              className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-fit rounded border border-surface-border bg-surface-bg px-2 py-0.5 font-mono text-xs">
                      ALT-{alert.id.slice(0, 6).toUpperCase()}
                    </span>
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        SEVERITY_TINT[alert.severity] ?? ""
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        STATUS_TINT[alert.status] ?? ""
                      }`}
                    >
                      {alert.status}
                    </span>
                    <span className="text-sm font-semibold text-ink-900">
                      {CATEGORY_LABEL[alert.category] ?? alert.category}
                    </span>
                  </div>
                  <p className="text-sm text-ink-700">{alert.description}</p>
                  <div className="text-xs text-ink-500">
                    {alert.organization_name || "Platform-wide"} · Detected{" "}
                    {new Date(alert.detected_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  {alert.status === "NEW" && (
                    <button
                      type="button"
                      disabled={busyId === alert.id}
                      onClick={() =>
                        runAction(alert.id, investigateAlert, "Couldn't investigate the alert.")
                      }
                      className={ACTION_BUTTON_CLASS}
                    >
                      Investigate
                    </button>
                  )}
                  {(alert.status === "NEW" || alert.status === "INVESTIGATING") && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === alert.id}
                        onClick={() =>
                          runAction(alert.id, resolveAlert, "Couldn't resolve the alert.")
                        }
                        className={ACTION_BUTTON_CLASS}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === alert.id}
                        onClick={() =>
                          runAction(alert.id, dismissAlert, "Couldn't dismiss the alert.")
                        }
                        className={ACTION_BUTTON_CLASS}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <div className="rounded-lg border border-surface-border bg-surface-card p-6 text-center text-sm text-ink-500 shadow-sm">
              No alerts in this filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
