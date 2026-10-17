import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  administerDose,
  administerOrder,
  getMar,
  recordPrnEffect,
  type DoseDocumentation,
  type MarEntry,
  type MarOrder,
  type MarState,
} from "../../../../lib/carePathwayApi";
import { formatDateTime, formatTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { errorText } from "../../triage/helpers";
import { SbarModule } from "./SmallModules";

const STATE_TONE: Record<string, "neutral" | "warn" | "brand" | "risk"> = { given: "brand", declined: "risk", withheld: "warn", due: "warn", late: "risk", missed: "risk", future: "neutral" };
const OPEN_STATES = ["due", "late", "missed", "future"];
const OUTCOMES: [DoseDocumentation["outcome"], string, string][] = [
  ["ADMINISTERED", "Given", BTN],
  ["REFUSED", "Declined", BTN_GHOST],
  ["WITHHELD", "Withheld", BTN_GHOST],
];

interface DoseForm {
  slot: string;
  notes: string;
  indication: string;
  witness: string;
  own: boolean;
  override: string;
}
const EMPTY: DoseForm = { slot: "", notes: "", indication: "", witness: "", own: false, override: "" };

const openSlots = (o: MarOrder) => o.slots.filter((s) => OPEN_STATES.includes(s.state));
/** The dose most likely being given now: the first due, late or missed one. */
const defaultSlot = (o: MarOrder) => openSlots(o).find((s) => s.state !== "future")?.time ?? "";

function orderTitle(o: MarOrder) {
  return `${o.drug} ${o.dose} ${o.route}`;
}

/** Medication administration record — today. Doses are charted against the
 * order: at one of today's dose times or as an unscheduled dose. A PRN order's
 * written maximum per 24 h is enforced; giving another needs a recorded reason. */
export function MarModule({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [mar, setMar] = useState<MarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, DoseForm>>({});
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

  const formFor = (key: string, slot = "") => forms[key] ?? { ...EMPTY, slot };
  const patch = (key: string, slot: string, p: Partial<DoseForm>) =>
    setForms((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { ...EMPTY, slot }), ...p } }));

  async function chart(key: string, work: (t: string, doc: DoseForm) => Promise<MarState>, slot = "") {
    if (!accessToken) return;
    setError(null);
    try {
      setMar(await work(accessToken, formFor(key, slot)));
      setForms((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setError(errorText(e, "Couldn't record the dose."));
    }
  }

  const doc = (outcome: DoseDocumentation["outcome"], x: DoseForm): DoseDocumentation => ({
    outcome, notes: x.notes, prn_indication: x.indication, witness_name: x.witness, own_supply: x.own, override_reason: x.override,
  });

  if (!mar) return error ? <ErrorNote>{error}</ErrorNote> : <p className="text-[13px] text-ink-500">Loading…</p>;
  if (!mar.admission) return <Callout>This client is not currently admitted, so there is no medication administration record. Orders placed for an admission appear here.</Callout>;
  const unlinked = mar.entries.filter((e) => !e.order && e.status === "SCHEDULED");
  const recorded = mar.entries.filter((e) => e.status !== "SCHEDULED").slice(-8).reverse();
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
      {mar.orders.length === 0 && unlinked.length === 0 && <p className="text-[13px] text-ink-500">No active orders. Orders placed in Psychiatry appear here.</p>}
      <ul className="flex flex-col gap-2">
        {mar.orders.map((o) => {
          const x = formFor(o.id, defaultSlot(o));
          return (
            <li key={o.id} className="rounded-lg border border-surface-border p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold">{orderTitle(o)}</span>
                {o.is_prn ? <Tag>PRN · max {o.prn_max_per_24h}/24 h · {o.indication}</Tag> : <span className="text-ink-500">{o.frequency}</span>}
                {o.controlled_drug && <Tag tone="warn">Controlled drug — witness required</Tag>}
                {o.is_prn && <Tag tone={o.at_max ? "risk" : "neutral"}>{o.given_24h} of {o.prn_max_per_24h} given in 24 h</Tag>}
              </div>
              {o.slots.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {o.slots.map((s) => (
                    <Tag key={s.time} tone={STATE_TONE[s.state]}>{formatTime(s.time)} · {s.state}</Tag>
                  ))}
                </div>
              )}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {!o.is_prn && (
                  <select className={INPUT} aria-label="Dose time" value={x.slot} onChange={(e) => patch(o.id, defaultSlot(o), { slot: e.target.value })}>
                    <option value="">— unscheduled dose —</option>
                    {openSlots(o).map((s) => (
                      <option key={s.time} value={s.time}>{formatTime(s.time)} ({s.state})</option>
                    ))}
                  </select>
                )}
                {o.is_prn && <input className={INPUT} aria-label="Indication" placeholder={`Why now (indication) — ${o.indication}`} value={x.indication} onChange={(e) => patch(o.id, "", { indication: e.target.value })} />}
                {o.controlled_drug && <input className={INPUT} aria-label="Witness" placeholder="Second signature — witness name" value={x.witness} onChange={(e) => patch(o.id, defaultSlot(o), { witness: e.target.value })} />}
                <input className={INPUT} aria-label="Reason" placeholder="Reason (required if declined or withheld)" value={x.notes} onChange={(e) => patch(o.id, defaultSlot(o), { notes: e.target.value })} />
                {o.at_max && (
                  <div className="sm:col-span-2">
                    <Callout tone="danger" role="alert">Maximum {o.prn_max_per_24h} doses in 24 h already given — review with the prescriber. A further dose needs the reason recorded.</Callout>
                    <input className={`${INPUT} mt-2`} aria-label="Reason for exceeding the maximum" placeholder="Reason for giving beyond the written maximum" value={x.override} onChange={(e) => patch(o.id, "", { override: e.target.value })} />
                  </div>
                )}
                <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={x.own} onChange={(e) => patch(o.id, defaultSlot(o), { own: e.target.checked })} /> Patient’s own medicine used</label>
                <div className="flex gap-2 sm:col-span-2">
                  {OUTCOMES.map(([outcome, label, cls]) => (
                    <button
                      key={outcome}
                      type="button"
                      className={`${cls} ${BTN_SM}`}
                      disabled={outcome === "ADMINISTERED" && o.at_max && !x.override.trim()}
                      onClick={() => void chart(o.id, (t, f) => administerOrder(t, patientId, o.id, { ...doc(outcome, f), slot: f.slot }), defaultSlot(o))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
        {unlinked.map((e) => (
          <UnlinkedDose key={e.id} entry={e} form={formFor(e.id)} onChange={(p) => patch(e.id, "", p)} onChart={(outcome) => void chart(e.id, (t, f) => administerDose(t, e.id, doc(outcome, f)))} />
        ))}
      </ul>
      {recorded.length > 0 && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th className={TH}>Time</th><th className={TH}>Medicine</th><th className={TH}>Status</th><th className={TH}>By · witness</th></tr></thead>
            <tbody>
              {recorded.map((e) => (
                <tr key={e.id}>
                  <td className={TD}>{formatDateTime(e.administered_at ?? e.scheduled_time)}</td>
                  <td className={TD}>{e.drug} {e.dose}</td>
                  <td className={TD}>
                    {e.status}{e.notes ? ` — ${e.notes}` : ""}
                    {e.prn_indication && <div className="text-[11px] text-ink-500">for {e.prn_indication}</div>}
                    {e.prn_max_override_reason && <div className="text-[11px] text-priority-red">over the PRN maximum: {e.prn_max_override_reason}</div>}
                    {e.effect && <div className="text-[11px] text-ink-500">effect: {e.effect}</div>}
                  </td>
                  <td className={TD}>{e.by}{e.witness_name ? ` · ${e.witness_name}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={FIELD_LABEL}>Controlled-drug register numbers are issued by the facility’s own register — none is generated here. Dose times follow the facility’s drug-round configuration.</p>
      <div className="border-t border-surface-border pt-3">
        <div className={`${FIELD_LABEL} mb-2`}>SBAR shift handover</div>
        <SbarModule patientId={patientId} />
      </div>
    </div>
  );
}

/** A scheduled MAR row created outside an order (e.g. from the ward module). */
function UnlinkedDose({ entry, form, onChange, onChart }: {
  entry: MarEntry;
  form: DoseForm;
  onChange: (p: Partial<DoseForm>) => void;
  onChart: (outcome: DoseDocumentation["outcome"]) => void;
}) {
  return (
    <li className="rounded-lg border border-surface-border p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold">{entry.drug || "Medicine"} {entry.dose}</span>
        <span className="text-ink-500">{formatDateTime(entry.scheduled_time)}</span>
        <Tag tone={STATE_TONE[entry.state]}>{entry.state}</Tag>
        {entry.is_prn && <Tag>PRN</Tag>}
        {entry.controlled_drug && <Tag tone="warn">Controlled drug — witness required</Tag>}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entry.is_prn && <input className={INPUT} aria-label="Indication" placeholder="Why now (indication)" value={form.indication} onChange={(e) => onChange({ indication: e.target.value })} />}
        {entry.controlled_drug && <input className={INPUT} aria-label="Witness" placeholder="Second signature — witness name" value={form.witness} onChange={(e) => onChange({ witness: e.target.value })} />}
        <input className={INPUT} aria-label="Reason" placeholder="Reason (required if declined or withheld)" value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={form.own} onChange={(e) => onChange({ own: e.target.checked })} /> Patient’s own medicine used</label>
        <div className="flex gap-2 sm:col-span-2">
          {OUTCOMES.map(([outcome, label, cls]) => (
            <button key={outcome} type="button" className={`${cls} ${BTN_SM}`} onClick={() => onChart(outcome)}>{label}</button>
          ))}
        </div>
      </div>
    </li>
  );
}
