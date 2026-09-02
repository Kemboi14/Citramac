import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { createEncounter } from "../../lib/clinicalApi";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  collectSpecimen,
  createLabOrder,
  listLabResults,
  recordLabResult,
  searchLoinc,
  validateLabResult,
  type LabOrder,
  type LabResult,
  type LabSpecimen,
  type LoincCode,
} from "../../lib/limsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

/**
 * Module 4 — LIMS: order a lab test against a LOINC code, collect a
 * specimen, record a result, and (senior lab staff only, enforced
 * server-side) validate it before it's released to the ordering
 * clinician — docs/07-CLINICAL-MODULES-SPEC.md §7.4.
 *
 * The QC validation queue below is independent of the currently selected
 * patient — a lab technician lands here to clear their worklist, not to
 * follow one patient's chart, so it fetches whatever the backend's
 * `can_see_unvalidated_results` gate allows this user to see.
 */
export function LimsPage() {
  const { accessToken } = useAuth();
  const { selected, setEncounter } = usePatientContext();

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LoincCode[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [order, setOrder] = useState<LabOrder | null>(null);
  const [specimen, setSpecimen] = useState<LabSpecimen | null>(null);
  const [specimenType, setSpecimenType] = useState("Venous blood");
  const [result, setResult] = useState<LabResult | null>(null);
  const [resultForm, setResultForm] = useState({
    result_value: "",
    unit: "",
    reference_range: "",
    is_abnormal: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [queue, setQueue] = useState<LabResult[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);

  const loadQueue = () => {
    if (!accessToken) return;
    listLabResults(accessToken)
      .then((res) => setQueue(res.results.filter((r) => !r.is_validated)))
      .catch(() => setQueueError("Couldn't load the QC validation queue."));
  };

  useEffect(loadQueue, [accessToken]);

  const ensureEncounter = async (): Promise<string> => {
    if (!accessToken || !selected) throw new Error("No client selected.");
    if (selected.encounterId) return selected.encounterId;
    const encounter = await createEncounter(accessToken, selected.patientId, "OUTPATIENT");
    setEncounter(encounter.id);
    return encounter.id;
  };

  const runSearch = async () => {
    if (!accessToken || !query.trim()) return;
    setSearchError(null);
    try {
      setMatches(await searchLoinc(accessToken, query));
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Search failed.");
    }
  };

  const orderTest = async (loincCode: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const encounterId = await ensureEncounter();
      setOrder(await createLabOrder(accessToken, encounterId, loincCode));
      setSpecimen(null);
      setResult(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the lab order.");
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    if (!accessToken || !order) return;
    setError(null);
    setBusy(true);
    try {
      setSpecimen(await collectSpecimen(accessToken, order.id, specimenType));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't collect the specimen.");
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !order || !specimen) return;
    setError(null);
    setBusy(true);
    try {
      setResult(await recordLabResult(accessToken, order.id, specimen.id, resultForm));
      loadQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the result.");
    } finally {
      setBusy(false);
    }
  };

  const validate = async (resultId: string) => {
    if (!accessToken) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await validateLabResult(accessToken, resultId);
      if (result?.id === resultId) setResult(updated);
      loadQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't validate the result.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 4 · Laboratory Information Management
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          LIMS{selected ? ` — ${selected.patientName}` : ""}
        </h1>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
          QC Validation Queue
        </h2>
        <p className="mb-3 text-xs text-ink-500">
          Unvalidated results — visible only to lab staff/auditors until validated here, per the QC
          gate in docs/07-CLINICAL-MODULES-SPEC.md §7.4.
        </p>
        {queue.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing pending validation.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {queue.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-sm border border-surface-border px-3 py-2 text-sm"
              >
                <span>
                  Result <span className="font-mono">{r.id.slice(0, 8)}</span> — {r.result_value}{" "}
                  {r.unit} {r.is_abnormal ? "(abnormal)" : ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm font-semibold text-brand-green hover:underline"
                  onClick={() => validate(r.id)}
                >
                  Validate
                </button>
              </li>
            ))}
          </ul>
        )}
        {queueError && <p className="mt-2 text-sm text-status-red">{queueError}</p>}
      </div>

      {!selected ? (
        <p className="text-ink-500">Select a client from the Client Registry to order a test.</p>
      ) : (
        <>
          <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
              1. Order a Lab Test (LOINC)
            </h2>
            <div className="flex gap-2">
              <input
                className={`${FIELD_CLASS} flex-1`}
                placeholder="Search LOINC, e.g. glucose, toxicology"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
              />
              <button type="button" className={BUTTON_CLASS} onClick={runSearch}>
                Search
              </button>
            </div>
            {searchError && <p className="mt-2 text-sm text-status-red">{searchError}</p>}
            {matches.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {matches.map((m) => (
                  <li
                    key={m.code}
                    className="flex items-center justify-between rounded-sm border border-surface-border px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-semibold">{m.code}</span> — {m.description}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline"
                      onClick={() => orderTest(m.code)}
                    >
                      Order
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {order && (
              <p className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
                Ordered {order.loinc_code} — status: {order.status}
              </p>
            )}
          </div>

          {order && (
            <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
                2. Collect Specimen
              </h2>
              <div className="flex gap-2">
                <input
                  className={`${FIELD_CLASS} flex-1`}
                  value={specimenType}
                  onChange={(e) => setSpecimenType(e.target.value)}
                  disabled={!!specimen}
                />
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={busy || !!specimen}
                  onClick={collect}
                >
                  {specimen ? "Collected" : "Collect"}
                </button>
              </div>
              {specimen && (
                <p className="mt-3 text-sm text-ink-700">
                  Barcode: <span className="font-mono font-semibold">{specimen.barcode}</span>
                </p>
              )}
            </div>
          )}

          {specimen && !result?.is_validated && (
            <form
              onSubmit={submitResult}
              className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
            >
              <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
                3. Record Result
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <label className={LABEL_CLASS}>
                  Value
                  <input
                    className={FIELD_CLASS}
                    value={resultForm.result_value}
                    onChange={(e) => setResultForm((r) => ({ ...r, result_value: e.target.value }))}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Unit
                  <input
                    className={FIELD_CLASS}
                    value={resultForm.unit}
                    onChange={(e) => setResultForm((r) => ({ ...r, unit: e.target.value }))}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Reference range
                  <input
                    className={FIELD_CLASS}
                    value={resultForm.reference_range}
                    onChange={(e) =>
                      setResultForm((r) => ({ ...r, reference_range: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-ink-700">
                <input
                  type="checkbox"
                  checked={resultForm.is_abnormal}
                  onChange={(e) => setResultForm((r) => ({ ...r, is_abnormal: e.target.checked }))}
                />
                Abnormal
              </label>
              <button type="submit" disabled={busy} className={`${BUTTON_CLASS} mt-4`}>
                {result ? "Update Result" : "Save Result"}
              </button>
            </form>
          )}

          {result && (
            <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
              <h2 className="mb-2 font-display text-base font-semibold text-ink-900">
                4. QC Validation
              </h2>
              <p className="text-sm text-ink-700">
                {result.is_validated
                  ? "Validated — visible to the ordering clinician."
                  : "Pending senior lab scientist validation (see the queue above, or use the button below)."}
              </p>
              {!result.is_validated && (
                <button
                  type="button"
                  disabled={busy}
                  className={`${BUTTON_CLASS} mt-3`}
                  onClick={() => validate(result.id)}
                >
                  Validate Result
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-status-red">{error}</p>}
    </div>
  );
}
