import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  KeyRound,
  LogIn,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { StatCard } from "../../components/StatCard";
import { ScoreRing } from "../../components/charts/ScoreRing";
import {
  getSecurityDashboard,
  type SecurityDashboard,
  type TenantSecurityRow,
} from "../../lib/securityApi";

const STATUS_TINT: Record<string, string> = {
  Secure: "bg-brand-green-tint text-brand-green-dark",
  Warning: "bg-status-amber-tint text-status-amber",
  "Non-Compliant": "bg-status-red-tint text-status-red",
  Critical: "bg-status-red-tint text-status-red",
};

const NEUTRAL_PILL = "rounded-sm bg-surface-bg px-2 py-0.5 text-xs font-medium text-ink-700";

export function SecurityDashboardPage() {
  const { accessToken } = useAuth();
  const [dashboard, setDashboard] = useState<SecurityDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    getSecurityDashboard(accessToken)
      .then(setDashboard)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the security dashboard."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Security
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Security Dashboard</h1>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {loading && !dashboard && <p className="text-sm text-ink-500">Loading security posture…</p>}

      {dashboard && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Building2} label="Total Tenants" value={dashboard.total_tenants} />
            <StatCard
              icon={ShieldCheck}
              label="Fully Compliant"
              value={dashboard.fully_compliant_tenants}
            />
            <StatCard
              icon={AlertTriangle}
              tone="amber"
              label="Tenants With Warnings"
              value={dashboard.tenants_with_warnings}
            />
            <StatCard
              icon={ShieldAlert}
              tone="red"
              label="Non-Compliant Tenants"
              value={dashboard.non_compliant_tenants}
            />
            <StatCard
              icon={ShieldAlert}
              tone="red"
              label="Critical Security Issues"
              value={dashboard.critical_security_issues}
            />
            <StatCard
              icon={KeyRound}
              label="MFA Adoption"
              value={`${dashboard.mfa_adoption_percent}%`}
            />
            <StatCard
              icon={Bell}
              tone="amber"
              label="Active Alerts"
              value={dashboard.active_alerts}
            />
            <StatCard
              icon={LogIn}
              tone="red"
              label="Failed Logins (24h)"
              value={dashboard.failed_logins_24h}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">MFA Adoption</th>
                  <th className="px-4 py-3">Failed Logins (24h)</th>
                  <th className="px-4 py-3">Password Policy</th>
                  <th className="px-4 py-3">Session Security</th>
                  <th className="px-4 py-3">Audit Logging</th>
                  <th className="px-4 py-3">API Security</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.tenants.map((t: TenantSecurityRow) => (
                  <tr
                    key={t.organization_id}
                    className="border-b border-surface-border last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">{t.organization_name}</td>
                    <td className="px-4 py-3">
                      <ScoreRing score={t.score} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                          STATUS_TINT[t.status] ?? ""
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{t.mfa_adoption_percent}%</td>
                    <td className="px-4 py-3 text-ink-700">{t.failed_logins_24h}</td>
                    <td className="px-4 py-3">
                      <span className={NEUTRAL_PILL}>{t.password_policy}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={NEUTRAL_PILL}>{t.session_security}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={NEUTRAL_PILL}>{t.audit_logging}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={NEUTRAL_PILL}>{t.api_security}</span>
                    </td>
                  </tr>
                ))}
                {dashboard.tenants.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-ink-500">
                      No tenants found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
