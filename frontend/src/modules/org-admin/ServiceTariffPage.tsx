import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  listBillingServices,
  updateBillingService,
  type BillingService,
  type BillingServicePayerRate,
} from "../../lib/carePathwayApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-middle text-[13px] text-ink-900";
const INPUT =
  "w-full rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const NUM_INPUT = `${INPUT} text-right tabular-nums`;
const BTN =
  "inline-flex items-center justify-center rounded-[9px] border border-brand-green bg-brand-green px-3 py-1 text-xs font-semibold text-on-primary transition-colors duration-150 hover:border-brand-green-dark hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-50";

type RowStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

interface Draft {
  medicine_name: string;
  mass: string;
  rate: string;
  active: boolean;
  payer_rates: BillingServicePayerRate[];
}

function isValidRate(value: string) {
  if (value.trim() === "") return true;
  const [whole, fraction, ...rest] = value.split(".");
  const digits = (part: string) => [...part].every((ch) => ch >= "0" && ch <= "9");
  if (rest.length > 0 || !whole || whole.length > 10 || !digits(whole)) return false;
  return (
    fraction === undefined || (fraction.length >= 1 && fraction.length <= 2 && digits(fraction))
  );
}

function draftFrom(service: BillingService): Draft {
  return {
    medicine_name: service.medicine_name ?? "",
    mass: service.mass ?? "",
    rate: service.rate ?? "",
    active: service.active,
    payer_rates: service.payer_rates ?? [],
  };
}

function payerRateValue(rates: BillingServicePayerRate[], payer: string) {
  return rates.find((r) => r.payer === payer)?.rate ?? "";
}

function setPayerRate(
  rates: BillingServicePayerRate[],
  payer: string,
  rate: string,
): BillingServicePayerRate[] {
  const next = [...rates];
  const idx = next.findIndex((r) => r.payer === payer);
  const row: BillingServicePayerRate = {
    payer,
    payer_code: idx >= 0 ? next[idx].payer_code : "",
    rate: rate.trim() === "" ? null : rate.trim(),
    requires_preauth: idx >= 0 ? next[idx].requires_preauth : false,
    active: true,
  };
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return next;
}

function TariffRow({
  service,
  onSaved,
}: {
  service: BillingService;
  onSaved: (s: BillingService) => void;
}) {
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(service));
  const [status, setStatus] = useState<RowStatus>({ state: "idle" });

  const isMed = service.is_medication;
  const rate = draft.rate.trim();
  const invalidRate = rate !== "" && !isValidRate(rate);
  const medNameMissing = isMed && !draft.medicine_name.trim();
  const massMissing = isMed && !draft.mass.trim();
  const dirty =
    draft.medicine_name !== (service.medicine_name ?? "") ||
    draft.mass !== (service.mass ?? "") ||
    (draft.rate ?? "") !== (service.rate ?? "") ||
    draft.active !== service.active ||
    JSON.stringify(draft.payer_rates) !== JSON.stringify(service.payer_rates ?? []);

  const save = () => {
    if (!accessToken || invalidRate || medNameMissing || massMissing || !dirty) return;
    setStatus({ state: "saving" });
    const payload: {
      rate: string | null;
      active: boolean;
      payer_rates: BillingServicePayerRate[];
      medicine_name?: string;
      mass?: string;
    } = {
      rate: rate === "" ? null : rate,
      active: draft.active,
      payer_rates: draft.payer_rates,
    };
    if (isMed) {
      payload.medicine_name = draft.medicine_name.trim();
      payload.mass = draft.mass.trim();
    }
    updateBillingService(accessToken, service.id, payload)
      .then((updated) => {
        onSaved(updated);
        setDraft(draftFrom(updated));
        setStatus({ state: "saved" });
      })
      .catch((err) =>
        setStatus({
          state: "error",
          message: err instanceof ApiError ? err.message : "Couldn't save.",
        }),
      );
  };

  return (
    <tr className="hover:bg-surface-bg">
      <td className={TD}>
        <div className="flex flex-col gap-1">
          {isMed ? (
            <>
              <input
                className={INPUT}
                value={draft.medicine_name}
                placeholder="Medicine name"
                aria-label={`Medicine name for ${service.display_name || service.name}`}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, medicine_name: e.target.value }));
                  setStatus({ state: "idle" });
                }}
              />
              <span className="text-[11px] text-ink-500">{service.category || "Medication"}</span>
            </>
          ) : (
            <>
              <div className="font-semibold">{service.display_name || service.name}</div>
              {service.category ? (
                <span className="text-[11px] text-ink-500">{service.category}</span>
              ) : null}
              {service.description && service.description !== service.name ? (
                <span className="text-[11px] text-ink-500">{service.description}</span>
              ) : null}
            </>
          )}
        </div>
      </td>
      <td className={TD}>
        {isMed ? (
          <input
            className={INPUT}
            value={draft.mass}
            placeholder="e.g. 5mg"
            aria-label={`Mass for ${service.display_name || service.name}`}
            onChange={(e) => {
              setDraft((p) => ({ ...p, mass: e.target.value }));
              setStatus({ state: "idle" });
            }}
          />
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </td>
      <td className={TD}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={`${NUM_INPUT} w-28`}
          value={draft.rate}
          aria-label={`Price for ${service.display_name || service.name}`}
          aria-invalid={invalidRate}
          onChange={(e) => {
            setDraft((p) => ({ ...p, rate: e.target.value }));
            setStatus({ state: "idle" });
          }}
        />
      </td>
      <td className={TD}>
        <div className="flex flex-col gap-1">
          {["CIC", "AAR"].map((payer) => (
            <label key={payer} className="flex items-center gap-2 text-[11px] text-ink-600">
              <span className="w-8">{payer}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={`${NUM_INPUT} w-24 py-1 text-[11px]`}
                value={payerRateValue(draft.payer_rates, payer)}
                aria-label={`${payer} rate for ${service.display_name || service.name}`}
                onChange={(e) => {
                  setDraft((p) => ({
                    ...p,
                    payer_rates: setPayerRate(p.payer_rates, payer, e.target.value),
                  }));
                  setStatus({ state: "idle" });
                }}
              />
            </label>
          ))}
        </div>
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
              setDraft((p) => ({ ...p, active: e.target.checked }));
              setStatus({ state: "idle" });
            }}
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 flex-shrink-0 rounded-full bg-ink-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface-card after:transition-transform after:content-[''] peer-checked:bg-brand-green peer-checked:after:translate-x-4"
          />
          <span className="text-xs text-ink-700">{draft.active ? "Active" : "Inactive"}</span>
        </label>
      </td>
      <td className={TD}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BTN}
            disabled={
              !dirty || invalidRate || medNameMissing || massMissing || status.state === "saving"
            }
            onClick={save}
          >
            {status.state === "saving" ? "Saving…" : "Save"}
          </button>
          <span role="status" className="text-xs">
            {invalidRate && (
              <span className="text-status-red">Price must be zero or more, up to 2 decimals.</span>
            )}
            {!invalidRate && (medNameMissing || massMissing) && (
              <span className="text-status-red">Medicine name and mass are required.</span>
            )}
            {!invalidRate && !medNameMissing && !massMissing && status.state === "saved" && (
              <span className="text-brand-green">Saved</span>
            )}
            {!invalidRate && !medNameMissing && !massMissing && status.state === "error" && (
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");

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

  const categories = useMemo(() => {
    const values = Array.from(
      new Set((services ?? []).map((s) => s.category || "Uncategorized")),
    ).sort();
    return ["ALL", ...values];
  }, [services]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (services ?? []).filter((s) => {
      if (category !== "ALL" && (s.category || "Uncategorized") !== category) return false;
      if (!q) return true;
      return [
        s.display_name,
        s.name,
        s.medicine_name,
        s.mass,
        s.category,
        s.description,
        s.code,
      ].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [services, query, category]);

  const onSaved = (updated: BillingService) =>
    setServices((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? prev);
  const unpricedCount = services?.filter((s) => s.rate === null).length ?? 0;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green-dark">
          Organization · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Service Tariff</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Rates price delivered services in clinical billing (Ksh per unit). Medication rows can be
          edited by medicine name, mass/strength, and price. CIC/AAR insurance rates are stored per
          service. No rate is suggested or filled in for you.
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-[18px] py-3.5">
            <div>
              <h2 id="service-tariff-title" className="text-[13px] font-bold text-ink-900">
                Billable services
              </h2>
              <p className="text-[11px] text-ink-500">
                {filtered.length} shown
                {unpricedCount > 0 ? ` · ${unpricedCount} without an out-of-pocket rate` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${INPUT} w-56`}
                placeholder="Search service or medicine"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search tariff"
              />
              <select
                className={`${INPUT} w-48`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter category"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === "ALL" ? "All categories" : c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">
              No services match this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr>
                    <th className={TH}>Service / Medicine</th>
                    <th className={TH}>Mass / Strength</th>
                    <th className={TH}>Out-of-pocket price (Ksh)</th>
                    <th className={TH}>Insurance rates (Ksh)</th>
                    <th className={TH}>Active</th>
                    <th className={TH}>
                      <span className="sr-only">Save</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((service) => (
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
