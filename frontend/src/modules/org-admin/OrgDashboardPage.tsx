import { useEffect, useState } from "react";
import { BedDouble, CalendarPlus, Stethoscope, Users } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getOrgDashboardStats, type OrgDashboardStats } from "../../lib/organizationsApi";
import { listStaff, type Staff } from "../../lib/governanceApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  children?: React.ReactNode;
}

function StatCard({ icon, label, value, children }: StatCardProps) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center gap-2 text-ink-500">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-ink-900">{value}</div>
      {children}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-bg">
      <div className="h-full rounded-full bg-brand-green" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function initials(s: Staff) {
  return `${s.first_name.charAt(0)}${s.last_name.charAt(0)}`.toUpperCase();
}

/**
 * Org Admin's live operational snapshot — bed occupancy, admissions,
 * outpatient/CCP volume, staffing, per-ward occupancy, and today's duty roster.
 */
export function OrgDashboardPage() {
  const { accessToken } = useAuth();
  const [stats, setStats] = useState<OrgDashboardStats | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve().then(() => {
      setError(null);
      return Promise.all([getOrgDashboardStats(accessToken), listStaff(accessToken)])
        .then(([statsRes, staffRes]) => {
          setStats(statsRes);
          setStaff(staffRes.results);
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Couldn't load dashboard stats."),
        )
        .finally(() => setLoading(false));
    });
  }, [accessToken]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Overview
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Dashboard</h1>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<BedDouble size={16} />}
              label="Bed Occupancy"
              value={`${stats.bed_occupancy_percent}%`}
            >
              <p className="mt-1 text-xs text-ink-500">
                {stats.beds_occupied}/{stats.beds_total} beds
              </p>
              <ProgressBar percent={stats.bed_occupancy_percent} />
            </StatCard>

            <StatCard
              icon={<CalendarPlus size={16} />}
              label="Admissions Today"
              value={stats.admissions_today}
            />

            <StatCard
              icon={<Stethoscope size={16} />}
              label="Outpatient / CCP Volume"
              value={stats.outpatient_ccp_volume}
            />

            <StatCard
              icon={<Users size={16} />}
              label="Staff on Duty"
              value={stats.staff_on_duty}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className={CARD_CLASS}>
              <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
                Ward Occupancy
              </h2>
              <div className="flex flex-col gap-4">
                {stats.ward_occupancy.map((ward) => {
                  const percent = ward.total > 0 ? (ward.occupied / ward.total) * 100 : 0;
                  return (
                    <div key={ward.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-ink-900">{ward.name}</span>
                        <span className="text-ink-500">
                          {ward.occupied}/{ward.total}
                        </span>
                      </div>
                      <ProgressBar percent={percent} />
                    </div>
                  );
                })}
                {stats.ward_occupancy.length === 0 && (
                  <p className="text-sm text-ink-500">No wards yet.</p>
                )}
              </div>
            </div>

            <div className={CARD_CLASS}>
              <div className="mb-4">
                <h2 className="font-display text-base font-semibold text-ink-900">Staff on Duty</h2>
                <p className="text-xs text-ink-400">Today&rsquo;s roster</p>
              </div>
              <div className="flex flex-col">
                {staff.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2.5 border-b border-surface-border py-2.5 last:border-0 last:pb-0"
                  >
                    <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px] bg-brand-green-tint font-display text-[11px] font-bold text-brand-green-dark">
                      {initials(s)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[12.6px] font-semibold text-ink-900">
                        {s.first_name} {s.last_name}
                      </div>
                      <div className="truncate text-[11px] text-ink-400">
                        {s.role_names.join(", ") || "—"}
                      </div>
                    </div>
                    <span
                      className={`ml-auto flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                        s.is_on_duty
                          ? "bg-brand-green-tint text-brand-green-dark"
                          : "bg-surface-bg text-ink-500"
                      }`}
                    >
                      {s.is_on_duty ? "On duty" : "Off duty"}
                    </span>
                  </div>
                ))}
                {staff.length === 0 && <p className="text-sm text-ink-500">No staff yet.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
