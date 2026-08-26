import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import {
  getSecurityPolicy,
  updateSecurityPolicy,
  type MandatoryControls,
  type SecurityPolicy,
} from "../../lib/securityApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

type NumericFieldKey =
  | "minimum_password_length"
  | "password_expiry_days"
  | "password_history_count"
  | "max_failed_login_attempts"
  | "lockout_duration_minutes"
  | "session_timeout_minutes"
  | "max_concurrent_sessions"
  | "token_expiry_minutes"
  | "rate_limit_per_minute"
  | "data_retention_years";

const NUMERIC_FIELDS: { key: NumericFieldKey; label: string }[] = [
  { key: "minimum_password_length", label: "Minimum Password Length" },
  { key: "password_expiry_days", label: "Password Expiry (days)" },
  { key: "password_history_count", label: "Password History Count" },
  { key: "max_failed_login_attempts", label: "Max Failed Login Attempts" },
  { key: "lockout_duration_minutes", label: "Lockout Duration (minutes)" },
  { key: "session_timeout_minutes", label: "Session Timeout (minutes)" },
  { key: "max_concurrent_sessions", label: "Max Concurrent Sessions" },
  { key: "token_expiry_minutes", label: "Token Expiry (minutes)" },
  { key: "rate_limit_per_minute", label: "Rate Limit (requests/min)" },
  { key: "data_retention_years", label: "Data Retention (years)" },
];

const MANDATORY_LABELS: Record<keyof MandatoryControls, string> = {
  tenant_isolation: "Tenant Data Isolation",
  rbac_enforcement: "Role-Based Access Control",
  audit_logging: "Audit Logging",
  api_authentication: "API Authentication",
  encryption_in_transit: "Encryption In Transit",
  encryption_at_rest: "Encryption At Rest",
  mfa_required: "Multi-Factor Authentication",
};

const MANDATORY_ORDER: (keyof MandatoryControls)[] = [
  "tenant_isolation",
  "rbac_enforcement",
  "audit_logging",
  "api_authentication",
  "encryption_in_transit",
  "encryption_at_rest",
  "mfa_required",
];

export function SecurityPoliciesPage() {
  const { accessToken } = useAuth();
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [form, setForm] = useState<Record<NumericFieldKey, string>>(
    {} as Record<NumericFieldKey, string>,
  );
  const [complexity, setComplexity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const applyPolicy = (p: SecurityPolicy) => {
    setPolicy(p);
    setComplexity(p.password_complexity);
    const nextForm = {} as Record<NumericFieldKey, string>;
    NUMERIC_FIELDS.forEach(({ key }) => {
      nextForm[key] = String(p[key]);
    });
    setForm(nextForm);
  };

  useEffect(() => {
    if (!accessToken) return;
    getSecurityPolicy(accessToken)
      .then(applyPolicy)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the security baseline."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !policy) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const payload: Partial<SecurityPolicy> = {};
      NUMERIC_FIELDS.forEach(({ key }) => {
        const num = Number(form[key]);
        if (!Number.isNaN(num) && num !== policy[key]) {
          payload[key] = num;
        }
      });
      if (complexity !== policy.password_complexity) {
        payload.password_complexity = complexity;
      }
      const updated = await updateSecurityPolicy(accessToken, payload);
      applyPolicy(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the security baseline.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Security
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Security Policies</h1>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
      {saved && (
        <p className="rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
          Baseline saved.
        </p>
      )}

      {loading && !policy && <p className="text-sm text-ink-500">Loading policy…</p>}

      {policy && (
        <>
          <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
              Mandatory Platform Controls
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Enforced platform-wide for every tenant. Not configurable from this screen.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MANDATORY_ORDER.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-3"
                >
                  <span className="text-sm font-medium text-ink-700">{MANDATORY_LABELS[key]}</span>
                  <span className="flex items-center gap-1 rounded-sm bg-brand-green-tint px-2 py-0.5 text-xs font-semibold text-brand-green-dark">
                    <Lock className="h-3 w-3" />
                    {policy.mandatory_controls[key] ? "Enforced" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={submit}
            className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
          >
            <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
              Tenant Configurable Controls
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Baseline defaults applied across tenants. Updating these affects the platform-wide
              minimums.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={LABEL_CLASS}>
                Password Complexity
                <input
                  className={FIELD_CLASS}
                  value={complexity}
                  onChange={(e) => setComplexity(e.target.value)}
                />
              </label>
              {NUMERIC_FIELDS.map(({ key, label }) => (
                <label key={key} className={LABEL_CLASS}>
                  {label}
                  <input
                    type="number"
                    className={FIELD_CLASS}
                    value={form[key] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="mt-5">
              <button type="submit" disabled={saving} className={BUTTON_CLASS}>
                {saving ? "Saving…" : "Save Baseline"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
