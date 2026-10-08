import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getCareDashboard, type CareDashboard } from "../../lib/carePathwayApi";
import { EmptyState } from "../../components/EmptyState";
import { PanelSkeleton, TableSkeletonRows } from "../../components/Skeleton";
import { formatTime } from "./shared/format";
import { Callout, Card, ErrorNote, PageHeader, Tag, Timeline } from "./shared/ui";
import { BTN, BTN_GHOST, TABLE, TD, TH } from "./shared/styles";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.3 — mockup dashboard(). Every number is
// served by GET /care/dashboard/; nothing here is demo text.

const REFRESH_MS = 60_000;

const PATHWAY_STEPS = [
  "Registration",
  "Triage",
  "Intake",
  "Care Plan",
  "Interventions",
  "Outcomes",
  "Billing",
  "Follow-up",
];

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-[19px] w-[19px]",
};

const ICONS = {
  triage: (
    <svg {...ICON_PROPS}>
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  psychiatry: (
    <svg {...ICON_PROPS}>
      <path d="M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3Z" />
      <path d="M9 21h6m-5-4v4m4-4v4M9 9h.01M15 9h.01" />
    </svg>
  ),
  caseload: (
    <svg {...ICON_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  ),
  appointments: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </svg>
  ),
  inpatient: (
    <svg {...ICON_PROPS}>
      <path d="M3 21V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13M3 13h18M7 10h3v3H7zm7 0h3v3h-3zM5 21v-4m14 4v-4" />
    </svg>
  ),
};

function StatCard({
  value,
  label,
  change,
  tone,
}: {
  value: ReactNode;
  label: string;
  change: ReactNode;
  tone?: "up" | "down";
}) {
  const toneClass =
    tone === "up" ? "text-brand-green" : tone === "down" ? "text-priority-red" : "text-ink-900";
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm">
      <div className="font-display text-[28px] font-extrabold text-ink-900">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[.4px] text-ink-500">
        {label}
      </div>
      <div className={`mt-1.5 min-h-[1lh] text-[11.5px] font-medium ${toneClass}`}>{change}</div>
    </div>
  );
}

function QuickTile({
  icon,
  title,
  detail,
  count,
  attention = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  count: string;
  attention?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-surface-border bg-surface-card p-3.5 text-left text-ink-900 transition duration-150 hover:-translate-y-px hover:border-brand-green/40 hover:bg-surface-bg hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
    >
      <span
        aria-hidden="true"
        className="grid h-[38px] w-[38px] flex-[0_0_38px] place-items-center rounded-[11px] bg-brand-green-tint text-brand-green"
      >
        {icon}
      </span>
      <span className="grid min-w-0 gap-[3px]">
        <span className="text-[12.5px] font-bold leading-[1.35]">{title}</span>
        <span className="text-[11px] leading-[1.35] text-ink-500">{detail}</span>
      </span>
      <span
        className={`ml-auto whitespace-nowrap rounded-full border px-2 py-[3px] text-[11px] font-bold ${
          attention
            ? "border-priority-orange/25 bg-priority-orange-tint text-priority-orange"
            : "border-surface-border bg-surface-bg text-ink-700"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function activityTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "time not recorded";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const TODAY_LABEL = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export function DashboardPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<CareDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    (isCancelled: () => boolean) => {
      if (!accessToken) return;
      getCareDashboard(accessToken)
        .then((result) => {
          if (isCancelled()) return;
          setData(result);
          setUpdatedAt(new Date());
          setError(null);
        })
        .catch((err) => {
          if (isCancelled()) return;
          setError(err instanceof ApiError ? err.message : "Couldn't load the dashboard.");
        })
        .finally(() => setRefreshing(false));
    },
    [accessToken],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    load(isCancelled);
    const timer = window.setInterval(() => load(isCancelled), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const n = (value: number | undefined) => (data ? String(value ?? 0) : "—");

  // What needs a person's attention right now, most urgent first, each with a way in.
  const attention = data
    ? [
        {
          count: data.red_orange,
          text: (c: number) =>
            `${c} RED / ORANGE ${c === 1 ? "client" : "clients"} need priority attention`,
          to: "/clinical/psychiatry",
        },
        {
          count: data.triage_due,
          text: (c: number) => `${c} triage ${c === 1 ? "item is" : "items are"} due`,
          to: "/clinical/triage",
        },
        {
          count: data.follow_ups_overdue,
          text: (c: number) =>
            `${c} follow-up ${c === 1 ? "appointment is" : "appointments are"} overdue`,
          to: "/clinical/follow-up?bucket=overdue",
        },
        {
          count: data.discharged_without_follow_up,
          text: (c: number) =>
            `${c} discharged ${c === 1 ? "client has" : "clients have"} no follow-up booked`,
          to: "/clinical/follow-up?bucket=unbooked",
        },
      ].filter((item) => item.count > 0)
    : [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle={`System overview — ${TODAY_LABEL()}${updatedAt ? ` · Updated ${formatTime(updatedAt.toISOString())}` : ""}`}
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                load(() => false);
              }}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => navigate("/clinical/registration")}
            >
              + New Registration
            </button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {data && (
        <section className="mb-6" aria-label="Needs attention">
          {attention.length > 0 ? (
            <Callout tone="warning" role="status">
              <div className="mb-1.5 text-[13px] font-bold">Needs attention</div>
              <ul className="flex flex-col gap-1">
                {attention.map((item) => (
                  <li key={item.to}>
                    <Link className="font-semibold underline hover:no-underline" to={item.to}>
                      {item.text(item.count)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Callout>
          ) : (
            <Callout tone="success" role="status">
              Nothing is waiting on you right now.
            </Callout>
          )}
        </section>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          value={n(data?.total_clients)}
          label="Total Clients"
          change={data ? `↑ ${data.new_this_week} this week` : ""}
          tone="up"
        />
        <StatCard
          value={n(data?.inpatients)}
          label="Inpatients"
          change={data ? `${data.beds_available} beds available` : ""}
        />
        <StatCard
          value={n(data?.outpatients)}
          label="Outpatients"
          change={data ? `↑ ${data.outpatients_new_today} new today` : ""}
          tone="up"
        />
        <StatCard
          value={n(data?.red_orange)}
          label="RED / ORANGE"
          change="Requires attention"
          tone="down"
        />
      </div>

      <section className="mb-6" aria-labelledby="dashboard-quick-access-title">
        <div className="mb-[11px]">
          <h2 id="dashboard-quick-access-title" className="text-[15px] font-bold text-ink-900">
            Quick access
          </h2>
          <p className="mt-[3px] text-xs text-ink-500">
            Jump to the work that needs your attention.
          </p>
        </div>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
          <QuickTile
            icon={ICONS.triage}
            title="Triage queue"
            detail="Arrivals and re-checks due"
            count={`${n(data?.triage_due)} due`}
            attention={(data?.triage_due ?? 0) > 0}
            onClick={() => navigate("/clinical/triage")}
          />
          <QuickTile
            icon={ICONS.psychiatry}
            title="Psychiatry review"
            detail="Signed referrals · priority order"
            count={`${n(data?.psychiatry_queued)} queued`}
            attention={(data?.psychiatry_queued ?? 0) > 0}
            onClick={() => navigate("/clinical/psychiatry")}
          />
          <QuickTile
            icon={ICONS.caseload}
            title="My caseload"
            detail="Clients assigned to you"
            count={`${n(data?.caseload_count)} clients`}
            onClick={() => navigate("/clinical/caseload")}
          />
          <QuickTile
            icon={ICONS.appointments}
            title="Appointments"
            detail="Today’s scheduled visits"
            count={`${n(data?.appointments_today)} today`}
            onClick={() => navigate("/clinical/appointments")}
          />
          <QuickTile
            icon={ICONS.appointments}
            title="Follow-up"
            detail="Overdue and unbooked follow-ups"
            count={`${data ? data.follow_ups_overdue + data.discharged_without_follow_up : "—"} to action`}
            attention={
              (data?.follow_ups_overdue ?? 0) + (data?.discharged_without_follow_up ?? 0) > 0
            }
            onClick={() => navigate("/clinical/follow-up")}
          />
          <QuickTile
            icon={ICONS.inpatient}
            title="Inpatient admissions"
            detail="Current stays and bed allocation"
            count={`${n(data?.beds_available)} beds free`}
            onClick={() => navigate("/clinical/inpatient")}
          />
        </div>
      </section>

      <section
        className="mb-4 overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm"
        aria-labelledby="dashboard-lifecycle-title"
      >
        <h2
          id="dashboard-lifecycle-title"
          className="px-[18px] pb-[5px] pt-3.5 text-[13px] font-bold text-ink-900"
        >
          CITRAMAC care pathway
        </h2>
        <p className="m-0 px-[18px] pb-3 text-[11.5px] text-ink-500">
          One connected journey from first contact through ongoing care.
        </p>
        <div
          className="overflow-x-auto px-[18px] pb-4 [scrollbar-width:thin] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
          role="region"
          aria-label="Care pathway stages"
          tabIndex={0}
        >
          <ol className="m-0 flex w-max min-w-full list-none items-center gap-2 p-0">
            {PATHWAY_STEPS.map((step, index) => {
              const highlighted = index === 0 || index === PATHWAY_STEPS.length - 1;
              return [
                index > 0 && (
                  <li
                    key={`${step}-arrow`}
                    aria-hidden="true"
                    className="text-sm leading-none text-ink-400"
                  >
                    →
                  </li>
                ),
                <li
                  key={step}
                  className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-[9px] border px-[11px] py-[7px] text-[11.5px] font-semibold leading-tight ${
                    highlighted
                      ? "border-brand-green/25 bg-brand-green-tint text-brand-green"
                      : "border-surface-border bg-surface-bg text-ink-700"
                  }`}
                >
                  {step}
                </li>,
              ];
            })}
          </ol>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Recent Activity">
          {!data ? (
            error ? (
              <p className="text-[13px] text-ink-500">—</p>
            ) : (
              <PanelSkeleton lines={4} />
            )
          ) : data.recent_activity.length === 0 ? (
            <EmptyState title="No recent activity">
              Registrations, triage, admissions and discharges appear here as they happen.
            </EmptyState>
          ) : (
            <Timeline
              items={data.recent_activity.map((item, index) => ({
                key: `${item.at}-${index}`,
                time: activityTime(item.at),
                title: item.title,
                detail: item.detail,
              }))}
            />
          )}
        </Card>
        <Card title="Triage arrivals" bodyClassName="p-0 overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Setting</th>
                <th className={TH}>Wait / status</th>
              </tr>
            </thead>
            <tbody>
              {data && data.triage_arrivals.length > 0 ? (
                data.triage_arrivals.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-bg">
                    <td className={TD}>
                      <Link
                        to={`/clinical/triage/${row.id}`}
                        className="font-semibold text-ink-900 hover:text-brand-green hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className={TD}>
                      {row.setting === "INPATIENT" ? "Inpatient" : "Outpatient"}
                    </td>
                    <td className={TD}>
                      <Tag>
                        {row.wait_minutes} min · {row.status_label}
                      </Tag>
                    </td>
                  </tr>
                ))
              ) : !data ? (
                error ? (
                  <tr>
                    <td colSpan={3} className={`${TD} text-center text-ink-500`}>
                      —
                    </td>
                  </tr>
                ) : (
                  <TableSkeletonRows columns={3} rows={3} />
                )
              ) : (
                <tr>
                  <td colSpan={3}>
                    <EmptyState title="No arrivals or re-checks are due" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
