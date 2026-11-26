import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  createServiceCatalogueItem,
  listServiceCatalogue,
  updateServiceCatalogueItem,
  type ServiceCatalogueItem,
} from "../../lib/carePathwayApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card shadow-sm";
const TH =
  "border-b border-surface-border bg-surface-bg px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const TD = "border-b border-surface-border px-3.5 py-2.5 align-middle text-[13px] text-ink-900";
const INPUT =
  "w-full rounded-lg border border-surface-border bg-surface-bg px-2.5 py-2 text-[13px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green focus:bg-surface-card";
const BTN =
  "inline-flex items-center justify-center rounded-[9px] border border-brand-green bg-brand-green px-3 py-1 text-xs font-semibold text-on-primary transition-colors duration-150 hover:border-brand-green-dark hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BTN =
  "inline-flex items-center justify-center rounded-[9px] border border-surface-border bg-surface-card px-3 py-1 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-50";

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

const isMedication = (category: string) => category.trim().toLowerCase() === "medication";

interface Draft {
  category: string;
  name: string;
  description: string;
  medicine_name: string;
  mass: string;
}

const EMPTY: Draft = { category: "", name: "", description: "", medicine_name: "", mass: "" };

function draftReady(d: Draft) {
  return isMedication(d.category) ? d.medicine_name.trim() && d.mass.trim() : d.name.trim();
}

function DraftFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const field = (key: keyof Draft, label: string, width: string, placeholder?: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-ink-600">
      {label}
      <input
        className={`${INPUT} ${width}`}
        value={draft[key]}
        placeholder={placeholder}
        list={key === "category" ? "catalogue-categories" : undefined}
        onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <>
      {field("category", "Category", "w-44")}
      {isMedication(draft.category) ? (
        <>
          {field("medicine_name", "Medicine name", "w-48")}
          {field("mass", "Strength", "w-28", "e.g. 5mg")}
        </>
      ) : (
        field("name", "Service name", "w-64")
      )}
      {field("description", "Description (optional)", "w-64")}
    </>
  );
}

function payloadFrom(d: Draft) {
  const med = isMedication(d.category);
  return {
    category: d.category.trim(),
    name: med ? undefined : d.name.trim(),
    medicine_name: med ? d.medicine_name.trim() : "",
    mass: med ? d.mass.trim() : "",
    description: d.description.trim(),
  };
}

function CatalogueRow({
  item,
  onSaved,
}: {
  item: ServiceCatalogueItem;
  onSaved: (item: ServiceCatalogueItem) => void;
}) {
  const { accessToken } = useAuth();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (payload: Parameters<typeof updateServiceCatalogueItem>[2]) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    updateServiceCatalogueItem(accessToken, item.id, payload)
      .then((updated) => {
        onSaved(updated);
        setEditing(null);
      })
      .catch((err) => setError(errorText(err, "Couldn't save.")))
      .finally(() => setBusy(false));
  };

  if (editing) {
    return (
      <tr>
        <td className={TD} colSpan={4}>
          <div className="flex flex-wrap items-end gap-2">
            <DraftFields draft={editing} onChange={setEditing} />
            <button
              type="button"
              className={BTN}
              disabled={busy || !draftReady(editing)}
              onClick={() => save(payloadFrom(editing))}
            >
              Save
            </button>
            <button type="button" className={SECONDARY_BTN} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-xs text-status-red">
              {error}
            </p>
          )}
        </td>
      </tr>
    );
  }
  return (
    <tr className="hover:bg-surface-bg">
      <td className={TD}>
        <div className={`font-semibold ${item.active ? "" : "text-ink-400"}`}>{item.name}</div>
        {item.description && <div className="text-[11px] text-ink-500">{item.description}</div>}
      </td>
      <td className={TD}>{item.category || "—"}</td>
      <td className={TD}>{item.active ? "In use" : "Retired"}</td>
      <td className={TD}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={busy}
            onClick={() =>
              setEditing({
                category: item.category,
                name: item.name,
                description: item.description,
                medicine_name: item.medicine_name,
                mass: item.mass,
              })
            }
          >
            Edit
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={busy}
            onClick={() => save({ active: !item.active })}
          >
            {item.active ? "Retire" : "Restore"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-status-red">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

export function ServiceCataloguePage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<ServiceCatalogueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listServiceCatalogue(accessToken)
      .then((data) => !cancelled && setItems(data))
      .catch((err) => !cancelled && setError(errorText(err, "Couldn't load the catalogue.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const categories = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.category).filter(Boolean))).sort(),
    [items],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) => !q || `${i.name} ${i.category} ${i.description}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const onSaved = (updated: ServiceCatalogueItem) =>
    setItems((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? prev);

  const add = () => {
    if (!accessToken || !draftReady(draft)) return;
    setBusy(true);
    setAddError(null);
    createServiceCatalogueItem(accessToken, payloadFrom(draft))
      .then((created) => {
        setItems((prev) => [...(prev ?? []), created]);
        setDraft({ ...EMPTY, category: draft.category });
      })
      .catch((err) => setAddError(errorText(err, "Couldn't add the service.")))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green-dark">
          Platform · Billing
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Service Catalogue</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          The services organisations can add to their own tariff. The catalogue holds names,
          categories and medicine strengths only &mdash; never a price. Each organisation sets its
          own prices and insurer rates. Retiring a service hides it from organisations that have not
          added it; tariffs that already have it keep their line.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      <section className={CARD_CLASS} aria-labelledby="catalogue-add-title">
        <div className="border-b border-surface-border px-[18px] py-3.5">
          <h2 id="catalogue-add-title" className="text-[13px] font-bold text-ink-900">
            Add a service
          </h2>
          <p className="text-[11px] text-ink-500">
            For a medicine, set the category to &ldquo;Medication&rdquo; and give its strength.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 px-[18px] py-3.5">
          <DraftFields draft={draft} onChange={setDraft} />
          <button type="button" className={BTN} disabled={busy || !draftReady(draft)} onClick={add}>
            Add
          </button>
        </div>
        {addError && (
          <p role="alert" className="px-[18px] pb-3 text-xs text-status-red">
            {addError}
          </p>
        )}
        <datalist id="catalogue-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </section>

      {items === null && !error && <p className="text-sm text-ink-500">Loading catalogue…</p>}
      {items && (
        <section className={CARD_CLASS} aria-labelledby="catalogue-list-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-[18px] py-3.5">
            <div>
              <h2 id="catalogue-list-title" className="text-[13px] font-bold text-ink-900">
                Services
              </h2>
              <p className="text-[11px] text-ink-500">
                {shown.length} shown · {items.filter((i) => i.active).length} in use
              </p>
            </div>
            <input
              className={`${INPUT} w-64`}
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the catalogue"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Service</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <CatalogueRow key={item.id} item={item} onSaved={onSaved} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
