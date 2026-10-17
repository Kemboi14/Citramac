import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  checkPrescribing,
  getPrescribing,
  placeOrder,
  requestCosign,
  type PrescribingCheck,
  type PrescribingState,
} from "../../../../lib/carePathwayApi";
import { searchDrugIndex, type DrugIndexEntry } from "../../../../lib/pharmacyApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_DANGER, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";

interface OrderForm {
  dose: string;
  route: string;
  frequency: string;
  is_prn: boolean;
  max: string;
  indication: string;
  controlled: boolean;
}
const EMPTY: OrderForm = { dose: "", route: "", frequency: "", is_prn: false, max: "", indication: "", controlled: false };

/** Structured medication orders. Checks run before the order exists: a recorded
 * allergy is a hard stop (cancel, or override with a reason — a junior's override
 * goes to a senior for co-signature), warnings must be acknowledged, and with
 * allergy status unknown prescribing is locked. Allergy and duplicate checks only —
 * no interaction, maximum-dose or QTc rules are applied (no licensed source). */
export function PrescribingModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [state, setState] = useState<PrescribingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DrugIndexEntry[]>([]);
  const [drug, setDrug] = useState<DrugIndexEntry | null>(null);
  const [form, setForm] = useState<OrderForm>(EMPTY);
  const [checks, setChecks] = useState<PrescribingCheck | null>(null);
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState<string | null>(null);
  const [reviewRequested, setReviewRequested] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setState(await getPrescribing(accessToken, patientId));
    } catch (e) {
      setError(errorText(e, "Couldn't load prescribing."));
    }
  }, [accessToken, patientId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  const resetChecks = () => {
    setChecks(null);
    setAck(false);
    setOverride(null);
  };
  const edit = (p: Partial<OrderForm>) => {
    setForm((f) => ({ ...f, ...p }));
    resetChecks();
  };

  async function search() {
    if (!accessToken || query.trim().length < 2) return;
    try {
      setMatches(await searchDrugIndex(accessToken, query.trim()));
    } catch (e) {
      setError(errorText(e, "Couldn't search the drug index."));
    }
  }

  const missing = [
    !drug && "medicine",
    !form.dose.trim() && "dose",
    !form.route && "route",
    !form.is_prn && !form.frequency && "frequency (or mark PRN)",
    form.is_prn && !(Number(form.max) > 0) && "maximum PRN doses in 24 h",
    form.is_prn && !form.indication.trim() && "PRN indication",
  ].filter(Boolean);

  async function runChecks() {
    if (!accessToken || !drug) return;
    setError(null);
    try {
      const result = await checkPrescribing(accessToken, patientId, drug.generic_name);
      setChecks(result);
      setAck(false);
      setOverride(result.blocking.length ? "" : null);
    } catch (e) {
      setError(errorText(e, "Couldn't run the check."));
    }
  }

  async function place() {
    if (!accessToken || !drug) return;
    setError(null);
    try {
      setState(await placeOrder(accessToken, patientId, {
        drug: drug.code, dose: form.dose.trim(), route: form.route, frequency: form.is_prn ? "" : form.frequency,
        is_prn: form.is_prn, prn_max_per_24h: form.is_prn ? Number(form.max) : undefined, indication: form.indication.trim(),
        controlled_drug: form.controlled, acknowledged_warnings: ack, override_reason: override ?? undefined,
      }));
      setDrug(null);
      setQuery("");
      setMatches([]);
      setForm(EMPTY);
      resetChecks();
    } catch (e) {
      setError(errorText(e, "Couldn't place the order."));
    }
  }

  async function requestReview() {
    if (!accessToken) return;
    try {
      await requestCosign(accessToken, patientId, "Psychiatrist review requested — SBAR handover on the record");
      setReviewRequested(true);
    } catch (e) {
      setError(errorText(e, "Couldn't request the review."));
    }
  }

  if (!state) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  const hard = checks?.blocking ?? [];
  const warn = checks?.warnings ?? [];
  const canPlace = checks && (!warn.length || ack) && (!hard.length || (override ?? "").trim().length >= 5);
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {state.locked ? (
        <Callout tone="danger" role="alert">
          <strong>Prescribing locked — allergy status unknown.</strong> Record the allergy status in Intake (Allergies) first.
        </Callout>
      ) : (
        <div className="flex flex-wrap gap-2 text-[13px]">
          <Tag tone={state.allergy_status === "NONE" ? "brand" : "risk"}>{state.allergy_text}</Tag>
        </div>
      )}
      {!state.locked && !state.can_prescribe && <Callout>Only a prescriber can place medication orders. Request a psychiatrist review below.</Callout>}
      {!state.locked && state.can_prescribe && (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border p-3">
          <div className={FIELD_LABEL}>New order — checks run before the order is placed</div>
          {drug ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <strong>{drug.generic_name}</strong>
              <span className="text-ink-500">{[drug.strength, drug.form].filter(Boolean).join(" · ")}</span>
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => { setDrug(null); resetChecks(); }}>Change</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input className={`${INPUT} max-w-sm`} aria-label="Search medicine" placeholder="Search the national drug index" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={query.trim().length < 2} onClick={() => void search()}>Search</button>
              {matches.length > 0 && (
                <select className={`${INPUT} max-w-md`} aria-label="Medicine" value="" onChange={(e) => { setDrug(matches.find((m) => m.code === e.target.value) ?? null); resetChecks(); }}>
                  <option value="">— choose the medicine —</option>
                  {matches.map((m) => (
                    <option key={m.code} value={m.code}>{m.generic_name} {m.strength} {m.form}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input className={INPUT} aria-label="Dose" placeholder="Dose as prescribed (e.g. with unit)" value={form.dose} onChange={(e) => edit({ dose: e.target.value })} />
            <select className={INPUT} aria-label="Route" value={form.route} onChange={(e) => edit({ route: e.target.value })}>
              <option value="">— route —</option>
              {vs.options("medication-route").map((o) => <option key={o.code} value={o.code}>{o.display}</option>)}
            </select>
            {!form.is_prn && (
              <select className={INPUT} aria-label="Frequency" value={form.frequency} onChange={(e) => edit({ frequency: e.target.value })}>
                <option value="">— frequency —</option>
                {state.frequencies.map((f) => <option key={f}>{f}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.is_prn} onChange={(e) => edit({ is_prn: e.target.checked })} /> PRN (as needed)</label>
            {form.is_prn && <input className={INPUT} type="number" min={1} aria-label="Maximum doses in 24 hours" placeholder="Maximum doses in 24 h" value={form.max} onChange={(e) => edit({ max: e.target.value })} />}
            <input className={INPUT} aria-label="Indication" placeholder={form.is_prn ? "PRN indication (required)" : "Indication"} value={form.indication} onChange={(e) => edit({ indication: e.target.value })} />
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.controlled} onChange={(e) => edit({ controlled: e.target.checked })} /> Controlled drug (MAR asks for a witness)</label>
          </div>
          {missing.length > 0 && <p className="text-[11px] text-ink-500">Still needed: {missing.join(", ")}.</p>}
          {!checks && (
            <button type="button" className={`${BTN} ${BTN_SM} self-start`} disabled={missing.length > 0} onClick={() => void runChecks()}>Check order</button>
          )}
          {checks && (
            <div className="flex flex-col gap-2">
              {hard.length > 0 && (
                <div className="rounded-lg border border-priority-red p-3">
                  <Callout tone="danger" role="alert">
                    <strong>Hard stop — allergy.</strong> {drug?.generic_name} should not be given:
                    <ul className="ml-4 list-disc">{hard.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Callout>
                  <p className="mt-2 text-[12px] text-ink-500">Cancelling is the safe default. Override only with a clear clinical reason; the override is recorded{state.is_senior ? "." : " and a senior clinician is asked to co-sign it."}</p>
                  <textarea className={`${INPUT} mt-2`} rows={2} aria-label="Reason for overriding the allergy hard stop" placeholder="Clinical reason for overriding" value={override ?? ""} onChange={(e) => setOverride(e.target.value)} />
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-2`} onClick={() => { setForm(EMPTY); setDrug(null); setQuery(""); setMatches([]); resetChecks(); }}>Cancel order</button>
                </div>
              )}
              {warn.length > 0 && (
                <div className="rounded-lg border border-priority-orange p-3">
                  <Callout tone="warning">
                    <strong>Review before placing this order</strong>
                    <ul className="ml-4 list-disc">{warn.map((m) => <li key={m}>{m}</li>)}</ul>
                  </Callout>
                  <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have reviewed these warnings and the order is clinically appropriate</label>
                </div>
              )}
              {!hard.length && !warn.length && <Callout tone="success">No allergy match or duplicate found on the record.</Callout>}
              {checks.not_checked.map((m) => <Callout key={m}>{m}</Callout>)}
              <button type="button" className={`${hard.length ? BTN_DANGER : BTN} ${BTN_SM} self-start`} disabled={!canPlace} onClick={() => void place()}>
                {hard.length ? "Override hard stop and place order" : warn.length ? "Place order with acknowledged warnings" : "Place order"}
              </button>
            </div>
          )}
        </div>
      )}
      {state.orders.length > 0 && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th className={TH}>Order</th><th className={TH}>Checks</th><th className={TH}>By</th></tr></thead>
            <tbody>
              {state.orders.map((o) => (
                <tr key={o.id}>
                  <td className={TD}>
                    {o.drug} {o.dose} {o.route} {o.is_prn ? `PRN (max ${o.prn_max_per_24h}/24 h) — ${o.indication}` : o.frequency}
                    {o.controlled_drug && <> <Tag>CD</Tag></>}
                  </td>
                  <td className={TD}>
                    {o.allergy_override_reason && <Tag tone="risk">allergy override</Tag>}{" "}
                    {o.findings.length ? `${o.findings.length} finding(s) acknowledged` : "clear"}
                  </td>
                  <td className={TD}>{o.prescribed_by} · {formatDateTime(o.prescribed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!state.is_senior && (
        <div className="border-t border-surface-border pt-3">
          <div className={FIELD_LABEL}>Escalate to psychiatrist</div>
          <p className="mt-1 text-[12px] text-ink-500">Raises a review request with the SBAR built from the record; it appears in the psychiatrist’s “Needs my decision” inbox.</p>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM} mt-2`} disabled={reviewRequested} onClick={() => void requestReview()}>
            {reviewRequested ? "Review requested" : "Request psychiatrist review (SBAR)"}
          </button>
        </div>
      )}
    </div>
  );
}
