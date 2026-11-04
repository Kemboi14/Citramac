import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { createEncounter } from "../../lib/clinicalApi";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
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
import { PageHeader } from "../care/shared/ui";
import { ClientPicker } from "../../clinical/ClientPicker";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

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
  const { selected, setEncounter, clear: clearPatient } = usePatientContext();

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

  const loadQueue = useCallback(() => {
    if (!accessToken) return;
    listLabResults(accessToken)
      .then((res) => {
        setQueue(res.results.filter((r) => !r.is_validated));
        setQueueError(null);
      })
      .catch(() => setQueueError("Couldn't load the QC validation queue. Try refreshing."));
  }, [accessToken]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const changeClient = () => {
    clearPatient();
    setOrder(null);
    setSpecimen(null);
    setResult(null);
    setQuery("");
    setMatches([]);
    setSearchError(null);
    setError(null);
    setResultForm({ result_value: "", unit: "", reference_range: "", is_abnormal: false });
  };

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

  const submitResult = async () => {
    if (!accessToken || !order || !specimen) return;
    setError(null);
    setBusy(true);
    try {
      setResult(await recordLabResult(accessToken, order.id, specimen.id, resultForm));
      loadQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the result.");
      throw err;
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
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Lab operations"
        title="Laboratory workbench"
        subtitle="Manage test orders, specimen collection, result entry, and quality review."
      />

      <section aria-label="Laboratory overview" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-surface-border bg-surface-card px-4 py-3 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Results awaiting QC
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold text-ink-900">{queue.length}</span>
            <span className="text-xs text-ink-500">pending validation</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-card px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Order context
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-ink-900">
              {selected ? selected.patientName : "No client selected"}
            </div>
          </div>
          {selected && (
            <button
              type="button"
              onClick={changeClient}
              className="shrink-0 text-sm font-semibold text-brand-green hover:underline"
            >
              Change client
            </button>
          )}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)]">
        <section className="flex min-w-0 flex-col gap-4">
          {!selected ? (
            <ClientPicker
              action="order a laboratory test for"
              description="Search for the client whose encounter should be linked to the new laboratory order."
            />
          ) : (
            <>
              <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand-green">
                      Order workflow
                    </div>
                    <h2 className="mt-1 font-display text-base font-semibold text-ink-900">
                      Find a test
                    </h2>
                  </div>
                  <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
                    Step 1
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    className={`${FIELD_CLASS} flex-1`}
                    placeholder="Search LOINC, e.g. glucose, toxicology"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  />
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={runSearch}
                    disabled={!query.trim()}
                  >
                    Search
                  </button>
                </div>
                {searchError && <p className="mt-2 text-sm text-status-red">{searchError}</p>}
                {matches.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {matches.map((m) => (
                      <li
                        key={m.code}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm"
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
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-brand-green">
                        Order {order.id.slice(0, 8)}
                      </div>
                      <h2 className="mt-1 font-display text-base font-semibold text-ink-900">
                        Collect specimen
                      </h2>
                    </div>
                    <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
                      Step 2
                    </span>
                  </div>
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
                  onSubmit={(e) => e.preventDefault()}
                  className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-brand-green">
                        Specimen {specimen.barcode}
                      </div>
                      <h2 className="mt-1 font-display text-base font-semibold text-ink-900">
                        Record result
                      </h2>
                    </div>
                    <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
                      Step 3
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className={LABEL_CLASS}>
                      Value
                      <input
                        className={FIELD_CLASS}
                        value={resultForm.result_value}
                        onChange={(e) =>
                          setResultForm((r) => ({ ...r, result_value: e.target.value }))
                        }
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
                      onChange={(e) =>
                        setResultForm((r) => ({ ...r, is_abnormal: e.target.checked }))
                      }
                    />
                    Abnormal
                  </label>
                  <div className="mt-4">
                    <SaveButton onSave={submitResult} disabled={busy}>
                      {result ? "Update Result" : "Save Result"}
                    </SaveButton>
                  </div>
                </form>
              )}

              {result && (
                <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
                  <h2 className="mb-2 font-display text-base font-semibold text-ink-900">
                    Quality control
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

          {error && (
            <p role="alert" className="text-sm text-status-red">
              {error}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-surface-border bg-surface-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-ink-900">
                QC validation queue
              </h2>
              <p className="mt-1 text-xs text-ink-500">
                Unvalidated results require review before release.
              </p>
            </div>
            <button
              type="button"
              onClick={loadQueue}
              aria-label="Refresh QC queue"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-border text-ink-700 hover:bg-surface-bg"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="p-4">
            {queue.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-500">
                No unvalidated results are in the queue.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {queue.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-surface-border bg-surface-bg px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink-500">
                        Result <span className="font-mono">{r.id.slice(0, 8)}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-ink-900">
                        {r.result_value} {r.unit}
                      </div>
                      {r.is_abnormal && (
                        <span className="mt-1 inline-block rounded-full bg-priority-orange-tint px-2 py-0.5 text-xs font-semibold text-priority-orange">
                          Abnormal
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-sm font-semibold text-brand-green hover:underline disabled:opacity-60"
                      onClick={() => validate(r.id)}
                    >
                      Validate
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {queueError && (
              <p role="alert" className="mt-3 text-sm text-status-red">
                {queueError}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
