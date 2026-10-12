import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  administerDose,
  checkPrescribing,
  getMar,
  getSbar,
  recordPrnEffect,
  type MarState,
  type PrescribingCheck,
} from "../../../../lib/carePathwayApi";
import { formatDateTime, formatTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";

/** SBAR handover — built from the record, nothing retyped. */
export function SbarModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    getSbar(accessToken, patientId).then((r) => setText(r.text)).catch((e) => setError(errorText(e, "Couldn't build the SBAR.")));
  }, [accessToken, patientId]);
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote>{error}</ErrorNote>
      <pre className="whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-bg p-3 text-[12.5px] leading-relaxed">{text ?? "Building…"}</pre>
      <div>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!text} onClick={() => text && void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy SBAR"}
        </button>
      </div>
    </div>
  );
}

/** Prescribing check — allergy and exact-duplicate only, and it says so. */
export function PrescribingModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [drug, setDrug] = useState("");
  const [result, setResult] = useState<PrescribingCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!accessToken) return;
    setError(null);
    try {
      setResult(await checkPrescribing(accessToken, patientId, drug));
    } catch (e) {
      setError(errorText(e, "Couldn't run the check."));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <input className={`${INPUT} max-w-sm`} aria-label="Medicine" placeholder="Medicine name" value={drug} onChange={(e) => setDrug(e.target.value)} />
        <button type="button" className={BTN} disabled={!drug.trim()} onClick={() => void run()}>Check before prescribing</button>
      </div>
      {result && (
        <div className="flex flex-col gap-2">
          {result.blocking.map((m) => (<Callout key={m} tone="danger" role="alert">{m}</Callout>))}
          {result.warnings.map((m) => (<Callout key={m} tone="warning">{m}</Callout>))}
          {result.blocking.length === 0 && result.warnings.length === 0 && <Callout tone="success">No allergy match or duplicate found on the record.</Callout>}
          {result.not_checked.map((m) => (<Callout key={m}>{m}</Callout>))}
        </div>
      )}
    </div>
  );
}

const STATE_TONE: Record<string, "neutral" | "warn" | "brand" | "risk"> = { given: "brand", declined: "risk", withheld: "warn", due: "warn", late: "risk", missed: "risk", future: "neutral" };

/** Medication administration record — today. */
export function MarModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [mar, setMar] = useState<MarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { notes: string; indication: string; witness: string; own: boolean }>>({});
  const [effect, setEffect] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setMar(await getMar(accessToken, patientId));
    } catch (e) {
      setError(errorText(e, "Couldn't load the MAR."));
    }
  }, [accessToken, patientId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  const f = (id: string) => form[id] ?? { notes: "", indication: "", witness: "", own: false };
  const patch = (id: string, p: Partial<ReturnType<typeof f>>) => setForm((prev) => ({ ...prev, [id]: { ...f(id), ...p } }));

  async function give(id: string, outcome: "ADMINISTERED" | "REFUSED" | "WITHHELD") {
    if (!accessToken) return;
    setError(null);
    const x = f(id);
    try {
      setMar(await administerDose(accessToken, id, { outcome, notes: x.notes, prn_indication: x.indication, witness_name: x.witness, own_supply: x.own }));
    } catch (e) {
      setError(errorText(e, "Couldn't record the dose."));
    }
  }

  if (!mar) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  if (!mar.admission) return <Callout>This client is not currently admitted, so there is no medication administration record. Orders placed for an admission appear here.</Callout>;
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {mar.pending_effects.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-priority-orange p-2.5 text-[13px]">
          <span>PRN effect — {p.drug} given {p.administered_at ? formatTime(p.administered_at) : ""} (check at 30–60 min)</span>
          <input className={`${INPUT} max-w-sm`} aria-label={`Effect of ${p.drug}`} value={effect[p.id] ?? ""} onChange={(e) => setEffect((x) => ({ ...x, [p.id]: e.target.value }))} />
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!(effect[p.id] ?? "").trim()} onClick={() => accessToken && void recordPrnEffect(accessToken, p.id, effect[p.id]).then(setMar).catch((e) => setError(errorText(e, "Couldn't record the effect.")))}>
            Record effect
          </button>
        </div>
      ))}
      {mar.entries.length === 0 && <p className="text-[13px] text-ink-500">No doses are scheduled.</p>}
      <ul className="flex flex-col gap-2">
        {mar.entries.map((e) => {
          const open = ["due", "late", "missed", "future"].includes(e.state) && e.status !== "ADMINISTERED";
          const x = f(e.id);
          return (
            <li key={e.id} className="rounded-lg border border-surface-border p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold">{e.drug || "Medicine"} {e.dose}</span>
                <span className="text-ink-500">{formatDateTime(e.scheduled_time)}</span>
                <Tag tone={STATE_TONE[e.state]}>{e.state}</Tag>
                {e.is_prn && <Tag>PRN</Tag>}
                {e.controlled_drug && <Tag tone="warn">Controlled drug — witness required</Tag>}
                {e.by && <span className="text-[11px] text-ink-500">{e.by}{e.witness_name ? ` · witness ${e.witness_name}` : ""}</span>}
              </div>
              {e.notes && <p className="mt-1 text-[12px] text-ink-500">{e.notes}</p>}
              {e.effect && <p className="mt-1 text-[12px] text-ink-500">Effect: {e.effect}</p>}
              {open && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {e.is_prn && <input className={INPUT} aria-label="Indication" placeholder="Why now (indication)" value={x.indication} onChange={(ev) => patch(e.id, { indication: ev.target.value })} />}
                  {e.controlled_drug && <input className={INPUT} aria-label="Witness" placeholder="Second signature — witness name" value={x.witness} onChange={(ev) => patch(e.id, { witness: ev.target.value })} />}
                  <input className={INPUT} aria-label="Reason" placeholder="Reason (required if declined or withheld)" value={x.notes} onChange={(ev) => patch(e.id, { notes: ev.target.value })} />
                  <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={x.own} onChange={(ev) => patch(e.id, { own: ev.target.checked })} /> Patient’s own medicine used</label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void give(e.id, "ADMINISTERED")}>Given</button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void give(e.id, "REFUSED")}>Declined</button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void give(e.id, "WITHHELD")}>Withheld</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className={FIELD_LABEL}>Controlled-drug register numbers are issued by the facility’s own register — none is generated here.</p>
    </div>
  );
}
