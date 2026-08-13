import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useEnsureEncounter } from "../../clinical/useEnsureEncounter";
import { ApiError } from "../../lib/apiClient";
import { createPrescription, type PrescriptionItem } from "../../lib/clinicalApi";
import {
  dispenseMedication,
  listStores,
  searchDrugIndex,
  type DispenseRecord,
  type DrugIndexEntry,
  type Store,
} from "../../lib/pharmacyApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60";

/**
 * Module 6 — e-prescribe then dispense with FEFO batch selection, gated on
 * the same POS billing-clearance check as lab orders —
 * docs/07-CLINICAL-MODULES-SPEC.md §7.6, §7.10.
 */
export function PharmacyPage() {
  const { accessToken } = useAuth();
  const { encounterId, patientName, error: encounterError } = useEnsureEncounter();

  const [drugQuery, setDrugQuery] = useState("");
  const [drugMatches, setDrugMatches] = useState<DrugIndexEntry[]>([]);
  const [prescribeForm, setPrescribeForm] = useState({
    dose: "",
    route: "Oral",
    frequency: "Once daily",
    duration: "30 days",
  });
  const [prescribedItem, setPrescribedItem] = useState<PrescriptionItem | null>(null);

  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [dispensed, setDispensed] = useState<DispenseRecord[] | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    listStores(accessToken)
      .then((res) => {
        setStores(res.results);
        if (res.results.length > 0) setStoreId(res.results[0].id);
      })
      .catch(() => {
        /* store list is optional at page-load time */
      });
  }, [accessToken]);

  if (encounterError) return <p className="text-status-red">{encounterError}</p>;
  if (!encounterId) return <p className="text-ink-500">Loading…</p>;

  const runDrugSearch = async () => {
    if (!accessToken || !drugQuery.trim()) return;
    setError(null);
    try {
      setDrugMatches(await searchDrugIndex(accessToken, drugQuery));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Drug search failed.");
    }
  };

  const prescribe = async (drugCode: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const prescription = await createPrescription(
        accessToken,
        encounterId,
        drugCode,
        prescribeForm.dose,
        prescribeForm.route,
        prescribeForm.frequency,
        prescribeForm.duration,
      );
      setPrescribedItem(prescription.items[0] ?? null);
      setDispensed(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the prescription.");
    } finally {
      setBusy(false);
    }
  };

  const dispense = async () => {
    if (!accessToken || !prescribedItem || !storeId) return;
    setError(null);
    setBusy(true);
    try {
      setDispensed(await dispenseMedication(accessToken, prescribedItem.id, storeId, quantity));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't dispense — check billing/stock.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 6 · Pharmacy
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Pharmacy — {patientName}</h1>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">1. Prescribe</h2>
        <div className="flex gap-2">
          <input
            className={`${FIELD_CLASS} flex-1`}
            placeholder="Search National Drug Index, e.g. fluoxetine"
            value={drugQuery}
            onChange={(e) => setDrugQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runDrugSearch()}
          />
          <button type="button" className={BUTTON_CLASS} onClick={runDrugSearch}>
            Search
          </button>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-3">
          <label className={LABEL_CLASS}>
            Dose
            <input
              className={FIELD_CLASS}
              value={prescribeForm.dose}
              onChange={(e) => setPrescribeForm((f) => ({ ...f, dose: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Route
            <input
              className={FIELD_CLASS}
              value={prescribeForm.route}
              onChange={(e) => setPrescribeForm((f) => ({ ...f, route: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Frequency
            <input
              className={FIELD_CLASS}
              value={prescribeForm.frequency}
              onChange={(e) => setPrescribeForm((f) => ({ ...f, frequency: e.target.value }))}
            />
          </label>
          <label className={LABEL_CLASS}>
            Duration
            <input
              className={FIELD_CLASS}
              value={prescribeForm.duration}
              onChange={(e) => setPrescribeForm((f) => ({ ...f, duration: e.target.value }))}
            />
          </label>
        </div>

        {drugMatches.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {drugMatches.map((d) => (
              <li
                key={d.code}
                className="flex items-center justify-between rounded-sm border border-surface-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-semibold">{d.generic_name}</span> {d.strength} ({d.form})
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm font-semibold text-brand-green hover:underline"
                  onClick={() => prescribe(d.code)}
                >
                  Prescribe
                </button>
              </li>
            ))}
          </ul>
        )}

        {prescribedItem && (
          <p className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
            Prescribed {prescribedItem.drug} — {prescribedItem.dose}, {prescribedItem.route}
          </p>
        )}
      </div>

      {prescribedItem && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
            2. Dispense (FEFO + POS Gate)
          </h2>
          <div className="flex items-end gap-3">
            <label className={LABEL_CLASS}>
              Store
              <select
                className={FIELD_CLASS}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Quantity
              <input
                type="number"
                min={1}
                className={`${FIELD_CLASS} w-24`}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={dispense}>
              Dispense
            </button>
          </div>
          {dispensed && (
            <div className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
              Dispensed {dispensed.reduce((sum, r) => sum + r.quantity_dispensed, 0)} unit(s) across{" "}
              {dispensed.length} batch(es) (earliest-expiring first).
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
