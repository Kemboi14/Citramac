import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Landmark, Upload, Users } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  getPlatformDashboardStats,
  type Organization,
  type OrganizationStatus,
  type PlatformActivityEntry,
  type PlatformDashboardStats,
} from "../../lib/organizationsApi";
import { getPlatformBranding, uploadPlatformLogo } from "../../lib/brandingApi";
import { StatCard } from "../../components/StatCard";
import { BarChart } from "../../components/charts/BarChart";
import { DonutChart } from "../../components/charts/DonutChart";

/**
 * Upload-once, shows-everywhere platform logo (AppShell's sidebar mark +
 * the generic login screen all read the same /platform/branding/ record).
 * A full reload after a successful upload is a deliberate, disclosed
 * shortcut — AppShell fetches branding independently on its own mount, so
 * without a reload the sidebar here wouldn't pick up the change until the
 * next navigation.
 */
function PlatformBrandingCard() {
  const { accessToken } = useAuth();
  const [logo, setLogo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPlatformBranding()
      .then((b) => setLogo(b.logo))
      .catch(() => setLogo(null));
  }, []);

  const handleFile = async (file: File) => {
    if (!accessToken) return;
    setError(null);
    setUploading(true);
    try {
      await uploadPlatformLogo(accessToken, file);
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the logo.");
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md border border-surface-border bg-surface-bg">
        {logo ? (
          <img src={logo} alt="Platform logo" className="h-full w-full object-contain p-1" />
        ) : (
          <span className="text-[10px] font-semibold text-ink-400">No logo</span>
        )}
      </div>
      <div className="flex-1">
        <div className="font-display text-sm font-semibold text-ink-900">Platform Branding</div>
        <p className="text-xs text-ink-500">
          Shown in every shell&rsquo;s sidebar and the generic login screen. PNG, JPG, WEBP, or SVG,
          up to 2MB.
        </p>
        {error && <p className="mt-1 text-xs text-status-red">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-surface-border bg-surface-card px-3 py-2 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg disabled:opacity-60"
      >
        <Upload className="h-3.5 w-3.5" />
        {uploading ? "Uploading…" : logo ? "Replace Logo" : "Upload Logo"}
      </button>
    </div>
  );
}

const STATUS_TINT: Record<OrganizationStatus, string> = {
  ACTIVE: "bg-brand-green-tint text-brand-green-dark",
  PENDING_VERIFICATION: "bg-status-amber-tint text-status-amber",
  SUSPENDED: "bg-status-red-tint text-status-red",
};

const STATUS_LABEL: Record<OrganizationStatus, string> = {
  ACTIVE: "Active",
  PENDING_VERIFICATION: "Pending Verification",
  SUSPENDED: "Suspended",
};

const ORG_TYPE_LABEL: Record<string, string> = {
  HOSPITAL: "Hospital / Healthcare Provider",
  SCHOOL: "School",
  UNIVERSITY: "University",
  CORPORATE: "Corporate",
  INDIVIDUAL: "Individual Practitioner",
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "created",
  UPDATE: "updated",
  DELETE: "deleted",
  VIEW: "viewed",
  ERASURE: "executed a right-to-erasure request on",
  LOGIN: "logged in",
  LOGIN_FAILED: "failed to log in",
  LOGOUT: "logged out",
};

const ACTION_DOT: Record<string, string> = {
  CREATE: "bg-brand-green",
  UPDATE: "bg-status-amber",
  DELETE: "bg-status-red",
  ERASURE: "bg-status-red",
  LOGIN_FAILED: "bg-status-red",
  LOGIN: "bg-brand-green",
  LOGOUT: "bg-ink-400",
  VIEW: "bg-ink-400",
};

function StatusBadge({ status }: { status: OrganizationStatus }) {
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `status` is the compile-time-checked `OrganizationStatus` prop union, not user input.
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TINT[status] ?? ""}`}
    >
      {/* eslint-disable-next-line security/detect-object-injection -- `status` is the compile-time-checked `OrganizationStatus` prop union, not user input. */}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function orgTypeOrFacility(org: Organization) {
  if (org.org_type === "HOSPITAL" && org.facility_type) {
    return org.facility_type.replaceAll("_", " ");
  }
  return ORG_TYPE_LABEL[org.org_type] ?? org.org_type;
}

function orgInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function activityLine(entry: PlatformActivityEntry) {
  const verb = ACTION_LABEL[entry.action] ?? entry.action.toLowerCase();
  const target = entry.model ? ` ${entry.model}` : "";
  const org = entry.organization_name ? ` for ${entry.organization_name}` : "";
  return `${entry.actor_name} ${verb}${target}${org}`;
}

/**
 * Platform Super Admin landing dashboard — citramac_SUPER-ADMIN-v4.html
 * "Platform Dashboard" tab. Aggregate cross-tenant stats + real charts;
 * per-tenant detail lives on the Organizations page. Deviation from the
 * mockup: the mockup's "Platform Activity" feed uses hand-written narrative
 * copy per event; this renders the same real audit-log substance (actor,
 * action, model, org) as a formatted sentence instead, since there's no
 * backend concept of bespoke per-event prose.
 */
export function PlatformDashboardPage() {
  const { accessToken } = useAuth();
  const [stats, setStats] = useState<PlatformDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    getPlatformDashboardStats(accessToken)
      .then(setStats)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load platform statistics."),
      )
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Super Admin
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Platform Dashboard</h1>
        <p className="mt-1 max-w-[520px] text-[13px] text-ink-500">
          A live view of every organization, branch, and clinician active on CITRAMAC.
        </p>
      </div>

      <PlatformBrandingCard />

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {isLoading && !stats && <p className="text-sm text-ink-500">Loading…</p>}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Building2}
              value={stats.total_organizations}
              label="Total Organizations"
              trend={
                stats.orgs_added_this_month > 0
                  ? { label: `+${stats.orgs_added_this_month} this mo.`, direction: "up" }
                  : undefined
              }
            />
            <StatCard
              icon={Landmark}
              value={stats.total_branches}
              label="Active Branches"
              trend={
                stats.branches_added_this_month > 0
                  ? { label: `+${stats.branches_added_this_month} this mo.`, direction: "up" }
                  : undefined
              }
            />
            <StatCard
              icon={Users}
              value={stats.active_users}
              label="Active Platform Users"
              trend={
                stats.users_added_this_month > 0
                  ? { label: `+${stats.users_added_this_month} this mo.`, direction: "up" }
                  : undefined
              }
            />
            <StatCard
              icon={AlertTriangle}
              tone="amber"
              value={stats.pending_verification}
              label="Pending Verification"
              trend={
                stats.pending_verification > 0
                  ? { label: "Needs review", direction: "down" }
                  : { label: "All clear", direction: "neutral" }
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
              <div className="mb-1 font-display text-[14.5px] font-semibold text-ink-900">
                Organization Growth
              </div>
              <div className="mb-2 text-[11.5px] text-ink-400">
                New organizations onboarded per month
              </div>
              <BarChart
                data={stats.organization_growth.map((g) => ({
                  label: g.month.slice(5),
                  value: g.count,
                }))}
              />
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
              <div className="mb-3 font-display text-[14.5px] font-semibold text-ink-900">
                By Facility Level
              </div>
              <DonutChart
                centerLabel="Orgs"
                data={stats.branches_by_facility_level.map((f) => ({
                  label: f.facility_level.replaceAll("_", " ") || "Unspecified",
                  value: f.count,
                }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
              <div className="mb-1 font-display text-[14.5px] font-semibold text-ink-900">
                Recently Onboarded
              </div>
              <div className="mb-3 text-[11.5px] text-ink-400">
                Latest organizations added to the platform
              </div>
              <table className="w-full text-left text-[12.8px]">
                <thead>
                  <tr className="border-b border-surface-border text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
                    <th className="py-2">Organization</th>
                    <th className="py-2">County</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recently_onboarded.map((org) => (
                    <tr key={org.id} className="border-b border-surface-border last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px] bg-brand-green-tint font-display text-[11.5px] font-bold text-brand-green-dark">
                            {orgInitials(org.name)}
                          </div>
                          <span className="font-semibold text-ink-900">{org.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-ink-700">{org.county || "—"}</td>
                      <td className="py-2.5 text-ink-700">{orgTypeOrFacility(org)}</td>
                      <td className="py-2.5">
                        <StatusBadge status={org.status} />
                      </td>
                    </tr>
                  ))}
                  {stats.recently_onboarded.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-ink-500">
                        No organizations onboarded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm">
              <div className="mb-1 font-display text-[14.5px] font-semibold text-ink-900">
                Platform Activity
              </div>
              <div className="mb-3 text-[11.5px] text-ink-400">Immutable audit trail</div>
              <div className="flex flex-col">
                {stats.recent_activity.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex gap-2.5 border-b border-surface-border py-2.5 last:border-0 last:pb-0"
                  >
                    <span
                      className={`mt-[5px] h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                        ACTION_DOT[entry.action] ?? "bg-ink-400"
                      }`}
                    />
                    <div>
                      <div className="text-[12.5px] leading-snug text-ink-700">
                        {activityLine(entry)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-400">
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
                {stats.recent_activity.length === 0 && (
                  <p className="text-sm text-ink-500">No platform activity yet.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
