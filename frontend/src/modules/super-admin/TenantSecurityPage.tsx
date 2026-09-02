import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
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

export function TenantSecurityPage() {
  const { accessToken } = useAuth();
  const [dashboard, setDashboard] = useState<SecurityDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getSecurityDashboard(accessToken)
      .then((d) => {
        setDashboard(d);
        if (d.tenants.length > 0) setSelectedOrgId(d.tenants[0].organization_id);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load tenant security data."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const selected: TenantSecurityRow | undefined = dashboard?.tenants.find(
    (t) => t.organization_id === selectedOrgId,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Security
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Tenant Security</h1>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {loading && !dashboard && <p className="text-sm text-ink-500">Loading tenant security…</p>}

      {dashboard && (
        <>
          <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">MFA Adoption</th>
                  <th className="px-4 py-3">Failed Logins (24h)</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.tenants.map((t) => (
                  <tr
                    key={t.organization_id}
                    onClick={() => setSelectedOrgId(t.organization_id)}
                    className={`cursor-pointer border-b border-surface-border last:border-0 hover:bg-surface-bg ${
                      selectedOrgId === t.organization_id ? "bg-surface-bg" : ""
                    }`}
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
                  </tr>
                ))}
                {dashboard.tenants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-ink-500">
                      No tenants found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-ink-900">
                  {selected.organization_name}
                </h2>
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                    STATUS_TINT[selected.status] ?? ""
                  }`}
                >
                  {selected.status}
                </span>
              </div>

              <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Score
                  </div>
                  <ScoreRing score={selected.score} />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    MFA Adoption
                  </div>
                  <div className="mt-1 font-display text-xl font-bold text-ink-900">
                    {selected.mfa_adoption_percent}%
                  </div>
                  <div className="text-xs text-ink-500">
                    {selected.mfa_enabled_count} of {selected.total_users} users
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Failed Logins (24h)
                  </div>
                  <div className="mt-1 font-display text-xl font-bold text-ink-900">
                    {selected.failed_logins_24h}
                  </div>
                </div>
              </div>

              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">
                Inherited Security Controls
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">Multi-Factor Authentication</span>
                  <span className="text-sm font-semibold text-brand-green-dark">
                    Required · Enforced
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">Tenant Isolation</span>
                  <span className="text-sm font-semibold text-brand-green-dark">
                    Enabled · Enforced
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">Password Policy</span>
                  <span className="text-sm font-semibold text-ink-900">
                    {selected.password_policy}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">Session Security</span>
                  <span className="text-sm font-semibold text-ink-900">
                    {selected.session_security}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">Audit Logging</span>
                  <span className="text-sm font-semibold text-ink-900">
                    {selected.audit_logging}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-bg px-4 py-2.5">
                  <span className="text-sm text-ink-700">API Security</span>
                  <span className="text-sm font-semibold text-ink-900">
                    {selected.api_security}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
