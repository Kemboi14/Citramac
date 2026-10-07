import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  listBillingServices,
  updateBillingService,
  type BillingService,
} from "../../lib/carePathwayApi";

// Org Admin — the facility tariff that prices every delivered service in
// clinical billing (docs/15-CLINICAL-WORKSPACE-V3.md §1.15). Rates are entered
// by the organisation; this screen never pre-fills or suggests one (CLAUDE.md
// §6 — tariff values are not something the software may invent). A service
// with no rate is excluded from billing with a visible notice until one is set.

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-middle text-[13px] text-ink-900";
const INPUT =
  "w-36 rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-right text-[13px] tabular-nums text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const BTN =
  "inline-flex items-center justify-center rounded-[9px] border border-brand-green bg-brand-green px-3 py-1 text-xs font-semibold text-on-primary transition-colors duration-150 hover:border-brand-green-dark hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-50";

type RowStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

interface Draft {
  rate: string;
  active: boolean;
}

/** Non-negative, at most 10 whole digits and 2 decimals (DecimalField(12, 2)). */
function isValidRate(value: string) {
  const [whole, fraction, ...rest] = value.split(".");
  const digits = (part: string) => [...part].every((ch) => ch >= "0" && ch <= "9");
  if (rest.length > 0 || !whole || whole.length > 10 || !digits(whole)) return false;
  return (
    fraction === undefined || (fraction.length >= 1 && fraction.length <= 2 && digits(fraction))
  );
}

function toDraft(service: BillingService): Draft {
  return { rate: service.rate ?? "", active: service.active };
}

function sameRate(a: string, b: string | null) {
  if (a.trim() === "" || b === null) return a.trim() === "" && b === null;
  return Number(a) === Number(b);
}

function TariffRow({
  service,
  onSaved,
}: {
  service: BillingService;
  onSaved: (service: BillingService) => void;
}) {
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => toDraft(service));
  const [status, setStatus] = useState<RowStatus>({ state: "idle" });

  const rate = draft.rate.trim();
  const invalid = rate !== "" && !isValidRate(rate);
  const dirty = !sameRate(draft.rate, service.rate) || draft.active !== service.active;
  const inputId = `tariff-rate-${service.id}`;
  const statusId = `tariff-status-${service.id}`;

  const save = () => {
    if (!accessToken || invalid || !dirty) return;
    setStatus({ state: "saving" });
    updateBillingService(accessToken, service.id, {
      rate: rate === "" ? null : rate,
      active: draft.active,
    })
      .then((updated) => {
        onSaved(updated);
        setDraft(toDraft(updated));
        setStatus({ state: "saved" });
      })
      .catch((err) =>
        setStatus({
          state: "error",
          message: err instanceof ApiError ? err.message : "Couldn't save this rate.",
        }),
      );
  };

  return (
    <tr className="hover:bg-surface-bg">
      <td className={TD}>
        <label htmlFor={inputId} className="font-semibold">
          {service.name}
        </label>
        {service.rate === null && (
          <span className="ml-2 inline-block whitespace-nowrap rounded-md bg-priority-orange-tint px-2 py-0.5 text-[11px] font-medium text-priority-orange">
            No rate — excluded from billing
          </span>
        )}
      </td>
      <td className={TD}>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={INPUT}
          value={draft.rate}
          aria-invalid={invalid}
          aria-describedby={statusId}
          onChange={(e) => {
            const value = e.target.value;
            setDraft((prev) => ({ ...prev, rate: value }));
            setStatus({ state: "idle" });
          }}
        />
      </td>
      <td className={TD}>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={draft.active}
            aria-checked={draft.active}
            onChange={(e) => {
              const checked = e.target.checked;
              setDraft((prev) => ({ ...prev, active: checked }));
              setStatus({ state: "idle" });
            }}
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 flex-shrink-0 rounded-full bg-ink-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface-card after:transition-transform after:content-[''] peer-checked:bg-brand-green peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-green"
          />
          <span className="text-xs text-ink-700">{draft.active ? "Active" : "Inactive"}</span>
          <span className="sr-only">{service.name} active</span>
        </label>
      </td>
      <td className={TD}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BTN}
            disabled={!dirty || invalid || status.state === "saving"}
            onClick={save}
          >
            {status.state === "saving" ? "Saving…" : "Save"}
          </button>
          <span id={statusId} role="status" className="text-xs">
            {invalid && (
              <span className="text-status-red">
                Enter a rate of zero or more, up to two decimal places.
              </span>
            )}
            {!invalid && status.state === "saved" && (
              <span className="text-brand-green">Saved</span>
            )}
            {!invalid && status.state === "error" && (
              <span className="text-status-red">{status.message}</span>
            )}
          </span>
        </div>
      </td>
    </tr>
  );
}

export function ServiceTariffPage() {
  const { accessToken } = useAuth();
  const [services, setServices] = useState<BillingService[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listBillingServices(accessToken)
      .then((data) => !cancelled && setServices(data))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load the service tariff."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const onSaved = (updated: BillingService) =>
    setServices((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? prev);

  const unpricedCount = services?.filter((s) => s.rate === null).length ?? 0;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Organization · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Service Tariff</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          The rates set here price every delivered service in clinical billing, in Kenya shillings
          per unit delivered. A service without a rate is excluded from billing — with a notice on
          the Billing screen — until a rate is set here. Enter your facility&rsquo;s confirmed
          tariff; no rate is suggested or filled in for you.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}
      {services === null && !error && <p className="text-sm text-ink-500">Loading tariff…</p>}

      {services && (
        <section className={CARD_CLASS} aria-labelledby="service-tariff-title">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border px-[18px] py-3.5">
            <h2 id="service-tariff-title" className="text-[13px] font-bold text-ink-900">
              Billable services
            </h2>
            {unpricedCount > 0 && (
              <span className="whitespace-nowrap rounded-md bg-priority-orange-tint px-2 py-0.5 text-[11px] font-medium text-priority-orange">
                {unpricedCount} without a rate
              </span>
            )}
          </div>
          {services.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">
              No billable services are configured for this organisation.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr>
                    <th className={TH}>Service</th>
                    <th className={TH}>Rate (Ksh)</th>
                    <th className={TH}>Active</th>
                    <th className={TH}>
                      <span className="sr-only">Save</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => (
                    <TariffRow key={service.id} service={service} onSaved={onSaved} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
