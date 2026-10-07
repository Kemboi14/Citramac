import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BillingEvent, BillingOverview, BillingStatus } from "../../../lib/carePathwayApi";
import { formatKsh } from "../shared/format";
import { TABLE, TD, TH } from "../shared/styles";
import { Tag } from "../shared/ui";

// docs/15-CLINICAL-WORKSPACE-V3.md §1.15 — mockup billing(): four summary
// cards, the "Billing events" table and the data notes. Shared by the Billing
// page and the client-record Journey "Billing" stage. Every figure comes from
// the server's allocation (services.billing_overview); rates are the facility's
// configured tariff, never a value held in this file.

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: "h-4 w-4",
};

type MetricKey = "services" | "unbilled" | "claimed" | "paid";

const METRICS: {
  key: MetricKey;
  label: string;
  edge: string;
  iconTone: string;
  icon: ReactNode;
  detail: (count: number) => string;
}[] = [
  {
    key: "services",
    label: "Services",
    edge: "before:bg-brand-green",
    iconTone: "text-brand-green",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
        <path d="M12 21v-9m8-4.5-8 4.5-8-4.5M12 7v5m-2.5-2.5h5" />
      </svg>
    ),
    detail: (n) => `${n} delivered ${n === 1 ? "event" : "events"}`,
  },
  {
    key: "unbilled",
    label: "Unbilled",
    edge: "before:bg-priority-orange",
    iconTone: "text-priority-orange",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M8 3h8l4 4v14H4V3z" />
        <path d="M8 12h8m-8 4h5M16 3v5h4" />
      </svg>
    ),
    detail: (n) => `${n} ${n === 1 ? "event" : "events"} with a balance`,
  },
  {
    key: "claimed",
    label: "Claimed",
    edge: "before:bg-brand-green-dark",
    iconTone: "text-brand-green-dark",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" />
        <path d="M9 8h6m-6 4h6m-6 4h3" />
      </svg>
    ),
    detail: (n) => `${n} ${n === 1 ? "event" : "events"} with a balance`,
  },
  {
    key: "paid",
    label: "Paid",
    edge: "before:bg-priority-green",
    iconTone: "text-priority-green",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.3 2.3 4.8-4.8" />
      </svg>
    ),
    detail: (n) => `${n} ${n === 1 ? "event" : "events"} settled`,
  },
];

const STATUS_CHIP: Record<BillingStatus, { label: string; className: string }> = {
  unbilled: { label: "unbilled", className: "bg-priority-orange-tint text-priority-orange" },
  claimed: { label: "claimed", className: "bg-brand-green-tint text-brand-green" },
  paid: { label: "paid", className: "bg-priority-green-tint text-priority-green" },
  partial: { label: "Part paid", className: "bg-priority-yellow-tint text-priority-yellow" },
  "partial-claim": {
    label: "Part claimed",
    className: "bg-priority-orange-tint text-priority-orange",
  },
};

const NOTE =
  "rounded-sm border border-surface-border bg-surface-bg px-[13px] py-2.5 text-[11px] text-ink-500";

function eventDate(iso: string) {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })
    : "Date not recorded";
}

function summaryNumber(amount: string) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(amount));
}

function StatusChip({ status }: { status: BillingStatus }) {
  // eslint-disable-next-line security/detect-object-injection -- `status` is a typed union.
  const chip = STATUS_CHIP[status] ?? { label: status, className: "bg-surface-bg text-ink-700" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-1 text-[11px] font-semibold before:h-1.5 before:w-1.5 before:rounded-full before:bg-current before:content-[''] ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}

function EventRow({ event }: { event: BillingEvent }) {
  return (
    <tr className="hover:bg-surface-bg">
      <td className={`${TD} !px-4 !py-3 !align-middle`}>
        <span className="block font-semibold">{event.client_name}</span>
        <span className="mt-0.5 block whitespace-nowrap text-[11px] text-ink-500">
          {event.client_number}
        </span>
      </td>
      <td className={`${TD} !px-4 !py-3 !align-middle`}>{event.service}</td>
      <td className={`${TD} !px-4 !py-3 !align-middle !text-ink-700`}>{event.payer}</td>
      <td className={`${TD} whitespace-nowrap !px-4 !py-3 !align-middle`}>
        {eventDate(event.delivered_at)}
      </td>
      <td
        className={`${TD} whitespace-nowrap !px-4 !py-3 text-right !align-middle font-semibold tabular-nums`}
      >
        {formatKsh(event.amount)}
      </td>
      <td className={`${TD} !px-4 !py-3 !align-middle`}>
        <StatusChip status={event.status} />
      </td>
    </tr>
  );
}

export function BillingOverviewView({
  overview,
  error,
  loading,
  title = "Billing events",
  caption = "Charges generated from documented delivered services",
  showTariffLink = false,
}: {
  overview: BillingOverview | null;
  error: string | null;
  loading: boolean;
  title?: string;
  caption?: string;
  /** Org Admins get a link to the Service Tariff screen when services are unpriced. */
  showTariffLink?: boolean;
}) {
  const unavailable = !overview && !!error;
  const events = overview?.events ?? [];
  const unpriced = overview?.unpriced_services ?? [];

  return (
    <div className="grid gap-[18px]">
      <section
        className="grid grid-cols-2 gap-3.5 min-[901px]:grid-cols-4"
        aria-label="Billing summary"
      >
        {METRICS.map((metric) => {
          const bucket = overview?.summary[metric.key];
          return (
            <article
              key={metric.key}
              className={`relative min-w-0 overflow-hidden rounded-lg border border-surface-border bg-surface-card p-[18px] shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] max-[480px]:p-3.5 ${metric.edge}`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-ink-500">
                <span className={metric.iconTone}>{metric.icon}</span>
                <span>{metric.label}</span>
              </div>
              <strong className="mt-[13px] block overflow-hidden text-ellipsis whitespace-nowrap font-display text-[clamp(20px,2.1vw,27px)] font-semibold tracking-[-.5px] text-ink-900 max-[480px]:text-base">
                {bucket ? (
                  <>
                    <span className="font-body text-[.62em] font-semibold tracking-normal max-[480px]:hidden">
                      Ksh{" "}
                    </span>
                    {summaryNumber(bucket.amount)}
                  </>
                ) : (
                  "—"
                )}
              </strong>
              <span className="mt-[3px] block text-[11px] text-ink-500">
                {bucket
                  ? metric.detail(bucket.count)
                  : unavailable
                    ? "Billing data unavailable"
                    : loading
                      ? "Loading…"
                      : "Billing data unavailable"}
              </span>
            </article>
          );
        })}
      </section>

      <section
        className="overflow-hidden rounded-lg border border-surface-border bg-surface-card shadow-sm"
        aria-label={title}
      >
        <header className="flex items-center justify-between gap-3 border-b border-surface-border px-[18px] py-4 max-[480px]:flex-col max-[480px]:items-start">
          <div>
            <h2 className="text-[13px] font-bold text-ink-900">{title}</h2>
            <p className="mt-0.5 text-[11px] text-ink-500">{caption}</p>
          </div>
          <Tag>{`${events.length} ${events.length === 1 ? "event" : "events"}`}</Tag>
        </header>
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[700px]`}>
            <thead>
              <tr>
                <th className={`${TH} !px-4 !py-3`}>Client</th>
                <th className={`${TH} !px-4 !py-3`}>Service</th>
                <th className={`${TH} !px-4 !py-3`}>Payer</th>
                <th className={`${TH} !px-4 !py-3`}>Date</th>
                <th className={`${TH} !px-4 !py-3 !text-right`}>Amount</th>
                <th className={`${TH} !px-4 !py-3`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.length > 0 ? (
                events.map((event) => <EventRow key={event.id} event={event} />)
              ) : (
                <tr>
                  <td colSpan={6} className="border-b border-surface-border">
                    <div className="grid justify-items-center gap-1.5 px-5 py-[42px] text-center text-[12.5px] text-ink-500">
                      {loading && !overview ? (
                        <span>Loading billing events…</span>
                      ) : (
                        <>
                          <strong className="text-[13px] text-ink-700">
                            {unavailable ? "Billing data unavailable" : "No billable events yet"}
                          </strong>
                          <span>
                            {unavailable
                              ? error
                              : "Delivered services recorded in the Psychiatry module will appear here."}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {events.length > 0 && (
        <p className={NOTE}>Amounts use the facility’s configured tariff rates.</p>
      )}
      {unpriced.length > 0 && (
        <p className={NOTE} role="status">
          Some delivered services were not included because their rates are not configured:{" "}
          {unpriced.join(", ")}.
          {showTariffLink && (
            <>
              {" "}
              <Link
                to="/org-admin/service-tariff"
                className="font-semibold text-brand-green underline-offset-2 hover:underline"
              >
                Set rates in Service Tariff
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
