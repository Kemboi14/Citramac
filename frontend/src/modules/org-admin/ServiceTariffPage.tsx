import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  addFromCatalogue,
  createBillingService,
  createInsurer,
  listBillingServices,
  listInsurers,
  listTariffCatalogue,
  updateBillingService,
  updateInsurer,
  type BillingService,
  type BillingServicePayerRate,
  type Insurer,
  type TariffCatalogueEntry,
} from "../../lib/carePathwayApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-middle text-[13px] text-ink-900";
const INPUT =
  "w-full rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const NUM_INPUT = `${INPUT} text-right tabular-nums`;
const SECONDARY_BTN =
  "inline-flex items-center justify-center rounded-[9px] border border-surface-border bg-surface-card px-3 py-1 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-50";
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

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function payerRateValue(rates: BillingServicePayerRate[], insurerId: string) {
  return rates.find((r) => r.insurer === insurerId)?.rate ?? "";
}

function setPayerRate(
  rates: BillingServicePayerRate[],
  insurer: Insurer,
  rate: string,
): BillingServicePayerRate[] {
  const next = [...rates];
  const idx = next.findIndex((r) => r.insurer === insurer.id);
  const row: BillingServicePayerRate = {
    payer: "INSURER",
    insurer: insurer.id,
    insurer_name: insurer.name,
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
  insurers,
  onSaved,
}: {
  service: BillingService;
  insurers: Insurer[];
  onSaved: (s: BillingService) => void;
}) {
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(service));
  const [status, setStatus] = useState<RowStatus>({ state: "idle" });

  const isMed = service.is_medication;
  const rate = draft.rate.trim();
  const invalidRate =
    (rate !== "" && !isValidRate(rate)) ||
    draft.payer_rates.some((r) => r.rate !== null && !isValidRate(r.rate));
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
          {insurers.length === 0 && (
            <span className="text-[11px] text-ink-400">No insurers added</span>
          )}
          {insurers.map((insurer) => (
            <label key={insurer.id} className="flex items-center gap-2 text-[11px] text-ink-600">
              <span className="w-20 truncate" title={insurer.name}>
                {insurer.name}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={`${NUM_INPUT} w-24 py-1 text-[11px]`}
                value={payerRateValue(draft.payer_rates, insurer.id)}
                aria-label={`${insurer.name} rate for ${service.display_name || service.name}`}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((p) => ({
                    ...p,
                    payer_rates: setPayerRate(p.payer_rates, insurer, value),
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

function InsurersCard({
  insurers,
  onChange,
}: {
  insurers: Insurer[];
  onChange: (next: Insurer[]) => void;
}) {
  const { accessToken } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const replace = (updated: Insurer) =>
    onChange(insurers.map((i) => (i.id === updated.id ? updated : i)));

  const add = () => {
    if (!accessToken || !name.trim()) return;
    setBusy(true);
    setError(null);
    createInsurer(accessToken, name.trim())
      .then((created) => {
        onChange([...insurers, created].sort((a, b) => a.name.localeCompare(b.name)));
        setName("");
      })
      .catch((err) => setError(errorText(err, "Couldn't add the insurer.")))
      .finally(() => setBusy(false));
  };

  const save = (id: string, payload: { name?: string; active?: boolean }) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    updateInsurer(accessToken, id, payload)
      .then((updated) => {
        replace(updated);
        setEditing(null);
      })
      .catch((err) => setError(errorText(err, "Couldn't save the insurer.")))
      .finally(() => setBusy(false));
  };

  return (
    <section className={CARD_CLASS} aria-labelledby="insurers-title">
      <div className="border-b border-surface-border px-[18px] py-3.5">
        <h2 id="insurers-title" className="text-[13px] font-bold text-ink-900">
          Insurers
        </h2>
        <p className="text-[11px] text-ink-500">
          The private insurers this organisation works with. Each gets its own rate column below,
          and registration offers them for a client with private insurance. A client is charged
          their insurer&rsquo;s rate where one is set, otherwise the out-of-pocket price.
        </p>
      </div>
      <div className="flex flex-col gap-2 px-[18px] py-3.5">
        {insurers.length === 0 && (
          <p className="text-xs text-ink-500">No insurers yet. Add the ones you bill.</p>
        )}
        {insurers.map((insurer) => (
          <div key={insurer.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            {editing?.id === insurer.id ? (
              <>
                <input
                  className={`${INPUT} w-56`}
                  value={editing.name}
                  aria-label={`New name for ${insurer.name}`}
                  onChange={(e) => setEditing({ id: insurer.id, name: e.target.value })}
                />
                <button
                  type="button"
                  className={BTN}
                  disabled={busy || !editing.name.trim()}
                  onClick={() => save(insurer.id, { name: editing.name.trim() })}
                >
                  Save
                </button>
                <button type="button" className={SECONDARY_BTN} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span
                  className={`w-56 font-semibold ${insurer.active ? "text-ink-900" : "text-ink-400"}`}
                >
                  {insurer.name}
                  {!insurer.active && " (retired)"}
                </span>
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  disabled={busy}
                  onClick={() => setEditing({ id: insurer.id, name: insurer.name })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  disabled={busy}
                  onClick={() => save(insurer.id, { active: !insurer.active })}
                >
                  {insurer.active ? "Retire" : "Restore"}
                </button>
              </>
            )}
          </div>
        ))}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            className={`${INPUT} w-56`}
            placeholder="Insurer name"
            value={name}
            aria-label="New insurer name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button type="button" className={BTN} disabled={busy || !name.trim()} onClick={add}>
            Add insurer
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-status-red">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function CatalogueCard({ onAdded }: { onAdded: (added: BillingService[]) => void }) {
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState<TariffCatalogueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listTariffCatalogue(accessToken)
      .then((data) => !cancelled && setEntries(data))
      .catch((err) => !cancelled && setError(errorText(err, "Couldn't load the catalogue.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const categories = useMemo(
    () => ["ALL", ...Array.from(new Set((entries ?? []).map((e) => e.category || "Other"))).sort()],
    [entries],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (category === "ALL" || (e.category || "Other") === category) &&
        (!q || `${e.name} ${e.category} ${e.description}`.toLowerCase().includes(q)),
    );
  }, [entries, query, category]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = () => {
    if (!accessToken || picked.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ids = [...picked];
    addFromCatalogue(accessToken, ids)
      .then((added) => {
        onAdded(added);
        setEntries(
          (prev) => prev?.map((e) => (ids.includes(e.id) ? { ...e, on_tariff: true } : e)) ?? prev,
        );
        setPicked(new Set());
        setNotice(
          `${added.length} added to your tariff without a price. Set each price below before it is billed.`,
        );
      })
      .catch((err) => setError(errorText(err, "Couldn't add those services.")))
      .finally(() => setBusy(false));
  };

  return (
    <section className={CARD_CLASS} aria-labelledby="catalogue-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-[18px] py-3.5">
        <div>
          <h2 id="catalogue-title" className="text-[13px] font-bold text-ink-900">
            Add from the service catalogue
          </h2>
          <p className="text-[11px] text-ink-500">
            Tick the services your facility offers. They are added without a price; you set it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${INPUT} w-56`}
            placeholder="Search the catalogue"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the catalogue"
          />
          <select
            className={`${INPUT} w-48`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Catalogue category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "All categories" : c}
              </option>
            ))}
          </select>
          <button type="button" className={BTN} disabled={busy || picked.size === 0} onClick={add}>
            {busy ? "Adding…" : picked.size ? `Add ${picked.size} to tariff` : "Add to tariff"}
          </button>
        </div>
      </div>
      {entries === null && !error && (
        <p className="px-5 py-4 text-sm text-ink-500">Loading catalogue…</p>
      )}
      {error && (
        <p role="alert" className="px-5 py-3 text-xs text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="px-5 py-3 text-xs text-brand-green">
          {notice}
        </p>
      )}
      {entries && (
        <ul className="max-h-72 overflow-y-auto">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 border-b border-surface-border px-[18px] py-2 text-[13px]"
            >
              <input
                type="checkbox"
                id={`cat-${entry.id}`}
                disabled={entry.on_tariff}
                checked={entry.on_tariff || picked.has(entry.id)}
                onChange={() => toggle(entry.id)}
              />
              <label htmlFor={`cat-${entry.id}`} className="flex flex-1 flex-col">
                <span className={entry.on_tariff ? "text-ink-400" : "text-ink-900"}>
                  {entry.name}
                </span>
                <span className="text-[11px] text-ink-500">
                  {entry.category}
                  {entry.on_tariff ? " · already on your tariff" : ""}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-5 py-4 text-center text-sm text-ink-500">Nothing matches.</li>
          )}
        </ul>
      )}
    </section>
  );
}

function AddServiceCard({ onAdded }: { onAdded: (added: BillingService) => void }) {
  const { accessToken } = useAuth();
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [medicineName, setMedicineName] = useState("");
  const [mass, setMass] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMed = category.trim().toLowerCase() === "medication";
  const invalidRate = rate.trim() !== "" && !isValidRate(rate.trim());
  const ready = isMed ? medicineName.trim() && mass.trim() : name.trim();

  const add = () => {
    if (!accessToken || !ready || invalidRate) return;
    setBusy(true);
    setError(null);
    createBillingService(accessToken, {
      category: category.trim(),
      name: isMed ? undefined : name.trim(),
      medicine_name: isMed ? medicineName.trim() : undefined,
      mass: isMed ? mass.trim() : undefined,
      rate: rate.trim() || null,
    })
      .then((created) => {
        onAdded(created);
        setName("");
        setMedicineName("");
        setMass("");
        setRate("");
      })
      .catch((err) => setError(errorText(err, "Couldn't add the service.")))
      .finally(() => setBusy(false));
  };

  return (
    <section className={CARD_CLASS} aria-labelledby="add-service-title">
      <div className="border-b border-surface-border px-[18px] py-3.5">
        <h2 id="add-service-title" className="text-[13px] font-bold text-ink-900">
          Add a service that is not in the catalogue
        </h2>
        <p className="text-[11px] text-ink-500">
          For a medicine, set the category to &ldquo;Medication&rdquo; and give its strength.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-[18px] py-3.5">
        <label className="flex flex-col gap-1 text-[11px] text-ink-600">
          Category
          <input
            className={`${INPUT} w-44`}
            value={category}
            list="tariff-categories"
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        {isMed ? (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-ink-600">
              Medicine name
              <input
                className={`${INPUT} w-48`}
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-600">
              Strength
              <input
                className={`${INPUT} w-28`}
                value={mass}
                placeholder="e.g. 5mg"
                onChange={(e) => setMass(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-[11px] text-ink-600">
            Service name
            <input
              className={`${INPUT} w-64`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-ink-600">
          Out-of-pocket price (Ksh, optional)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={`${NUM_INPUT} w-32`}
            value={rate}
            aria-invalid={invalidRate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={BTN}
          disabled={busy || !ready || invalidRate}
          onClick={add}
        >
          Add service
        </button>
      </div>
      {error && (
        <p role="alert" className="px-[18px] pb-3 text-xs text-status-red">
          {error}
        </p>
      )}
    </section>
  );
}

export function ServiceTariffPage() {
  const { accessToken } = useAuth();
  const [services, setServices] = useState<BillingService[] | null>(null);
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([listBillingServices(accessToken), listInsurers(accessToken)])
      .then(([data, list]) => {
        if (cancelled) return;
        setServices(data);
        setInsurers(list);
      })
      .catch((err) => !cancelled && setError(errorText(err, "Couldn't load the service tariff.")));
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

  const activeInsurers = insurers.filter((i) => i.active);
  const onSaved = (updated: BillingService) =>
    setServices((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)) ?? prev);
  const onAdded = (added: BillingService[]) =>
    setServices((prev) =>
      [...(prev ?? []), ...added].sort(
        (a, b) =>
          (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name),
      ),
    );
  const unpricedCount = services?.filter((s) => s.rate === null).length ?? 0;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green-dark">
          Organization · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Service Tariff</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Your organisation&rsquo;s own services and prices (Ksh per unit). Add services from the
          platform catalogue or write your own, then set the out-of-pocket price and each
          insurer&rsquo;s rate. No price is suggested or filled in for you; a service without a
          price is recorded but not billed until you set one.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}
      {services === null && !error && <p className="text-sm text-ink-500">Loading tariff…</p>}

      {services && (
        <>
          <InsurersCard insurers={insurers} onChange={setInsurers} />
          <CatalogueCard onAdded={onAdded} />
          <AddServiceCard onAdded={(created) => onAdded([created])} />
          <datalist id="tariff-categories">
            {categories
              .filter((c) => c !== "ALL" && c !== "Uncategorized")
              .map((c) => (
                <option key={c} value={c} />
              ))}
          </datalist>
          <section className={CARD_CLASS} aria-labelledby="service-tariff-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-[18px] py-3.5">
              <div>
                <h2 id="service-tariff-title" className="text-[13px] font-bold text-ink-900">
                  Billable services
                </h2>
                <p className="text-[11px] text-ink-500">
                  {filtered.length} shown
                  {unpricedCount > 0 ? ` · ${unpricedCount} without an out-of-pocket price` : ""}
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
                {services.length === 0
                  ? "No services yet. Add them from the catalogue above."
                  : "No services match this filter."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse">
                  <thead>
                    <tr>
                      <th className={TH}>Service / Medicine</th>
                      <th className={TH}>Mass / Strength</th>
                      <th className={TH}>Out-of-pocket price (Ksh)</th>
                      <th className={TH}>Insurer rates (Ksh)</th>
                      <th className={TH}>Active</th>
                      <th className={TH}>
                        <span className="sr-only">Save</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((service) => (
                      <TariffRow
                        key={service.id}
                        service={service}
                        insurers={activeInsurers}
                        onSaved={onSaved}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
