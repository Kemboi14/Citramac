import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getCcpTeamRoster, type CcpTeamRosterRow } from "../../lib/ccpExtrasApi";

/**
 * Roster/caseload view of the CCP team — docs/07-CLINICAL-MODULES-SPEC.md
 * §7.14.6. "Specialties" reflects each member's assigned Roles.
 */
export function CcpTeamPage() {
  const { accessToken } = useAuth();
  const [roster, setRoster] = useState<CcpTeamRosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getCcpTeamRoster(accessToken)
      .then(setRoster)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load the CCP team roster."),
      );
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          CCP Program · Team &amp; Reporting
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">CCP Team</h1>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Caseload</th>
              <th className="px-4 py-3">Specialties</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row) => (
              <tr key={row.user_id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-3 font-medium text-ink-900">
                  {row.first_name} {row.last_name}
                </td>
                <td className="px-4 py-3 text-ink-700">{row.email}</td>
                <td className="px-4 py-3 text-ink-700">{row.caseload_count}</td>
                <td className="px-4 py-3 text-ink-700">
                  {row.specialties.length > 0 ? row.specialties.join(", ") : "—"}
                </td>
              </tr>
            ))}
            {roster.length === 0 && !error && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-500">
                  No care-team assignments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
