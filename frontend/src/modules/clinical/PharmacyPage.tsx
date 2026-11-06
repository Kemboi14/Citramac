import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import type { MedicationOrder } from "../../lib/carePathwayApi";
import {
  dispenseMedication,
  listStores,
  type DispenseRecord,
  type Store,
} from "../../lib/pharmacyApi";
import { PrescribingModule } from "../care/record/modules/PrescribingModule";
import { PageHeader } from "../care/shared/ui";
import { ClientPicker } from "../../clinical/ClientPicker";
import { ClientContext } from "../../clinical/ClientContext";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

/**
 * Prescribe, then dispense with FEFO batch selection. Orders are placed through
 * the same structured prescribing module as the client record (allergy lock and
 * hard stop, acknowledged warnings, coded route, prescriber and licence checks,
 * billing clearance) and land in the one MedicationRequest store; dispensing is
 * against one of those orders.
 */
export function PharmacyPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [orderId, setOrderId] = useState("");
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

  if (!selected) return <ClientPicker action="prescribe or dispense for" />;

  const order = orders.find((o) => o.id === orderId) ?? null;

  const dispense = async () => {
    if (!accessToken || !order || !storeId) return;
    setError(null);
    setBusy(true);
    try {
      setDispensed(await dispenseMedication(accessToken, order.id, storeId, quantity));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't dispense — check billing/stock.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ClientContext />
      <PageHeader
        eyebrow="Pharmacy & medication"
        title={"Medication orders & review"}
        subtitle={selected.patientName}
      />

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">1. Prescribe</h2>
        <PrescribingModule
          key={selected.patientId}
          patientId={selected.patientId}
          onOrdersChange={setOrders}
        />
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          2. Dispense (FEFO + POS Gate)
        </h2>
        {orders.length === 0 ? (
          <p className="text-sm text-ink-500">No medication orders for this client yet.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className={LABEL_CLASS}>
              Order
              <select
                className={FIELD_CLASS}
                value={orderId}
                onChange={(e) => {
                  setOrderId(e.target.value);
                  setDispensed(null);
                }}
              >
                <option value="">Choose an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.drug} — {o.dose}, {o.route}
                    {o.is_prn ? " PRN" : o.frequency ? `, ${o.frequency}` : ""}
                  </option>
                ))}
              </select>
            </label>
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
            <button
              type="button"
              disabled={busy || !order || !storeId}
              className={BUTTON_CLASS}
              onClick={dispense}
            >
              Dispense
            </button>
          </div>
        )}
        {dispensed && (
          <div className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
            Dispensed {dispensed.reduce((sum, r) => sum + r.quantity_dispensed, 0)} unit(s) across{" "}
            {dispensed.length} batch(es) (earliest-expiring first).
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
