import { useState } from "react";
import { acknowledgeLab, enterLabResult, getLabs, orderLabs, type LabsState } from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { Row } from "./ClinicalExtras";
import { useModule } from "./useModule";

type Flag = "NORMAL" | "ABNORMAL" | "CRITICAL";
const FLAGS: [Flag, string][] = [["NORMAL", "Normal"], ["ABNORMAL", "Abnormal"], ["CRITICAL", "Critical"]];
const ORDER_STATUS: Record<string, string> = {
  ORDERED: "Ordered",
  SPECIMEN_COLLECTED: "Specimen collected",
  RESULT_PENDING: "Result entered — awaiting laboratory validation",
  RESULT_VALIDATED: "Resulted",
  CANCELLED: "Cancelled",
};

/** Lab work over the lims store. Order sets and tests come from configuration
 * (LAB_ORDER_SETS); a result is typed from the laboratory report with the flag
 * the report gives, then validated by the laboratory before it shows here.
 * Abnormal results stay open until a prescriber acknowledges them. */
export function LabsModule({ patientId }: { patientId: string }) {
  const { data, error, act } = useModule<LabsState>(patientId, getLabs);
  const [entry, setEntry] = useState<Record<string, { value: string; unit: string; ref: string; flag: Flag }>>({});
  const blank = { value: "", unit: "", ref: "", flag: "NORMAL" as Flag };
  const patch = (id: string, p: Partial<typeof blank>) => setEntry((x) => ({ ...x, [id]: { ...(x[id] ?? blank), ...p } }));
  const sets = Object.entries(data?.order_sets ?? {});
  const awaiting = (data?.orders ?? []).filter((o) => o.status !== "RESULT_VALIDATED" && o.status !== "CANCELLED");
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {sets.length === 0 && <Callout>No order sets are configured for this facility yet — tests and their codes come from the facility’s laboratory configuration.</Callout>}
      {sets.length > 0 && (
        <Row>
          {sets.map(([name, codes]) => (
            <button key={name} type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void act((t) => orderLabs(t, patientId, codes))}>Order set: {name}</button>
          ))}
        </Row>
      )}
      {awaiting.length > 0 && (
        <ul className="flex flex-col gap-2">
          {awaiting.map((o) => {
            const x = entry[o.id] ?? blank;
            return (
              <li key={o.id} className="rounded-lg border border-surface-border p-2.5 text-[13px]">
                <Row>
                  <strong>{o.name}</strong>
                  <span className="text-ink-500">ordered {formatDateTime(o.ordered_at)}{o.ordered_by ? ` · ${o.ordered_by}` : ""}</span>
                  <Tag tone={o.status === "RESULT_PENDING" ? "warn" : "neutral"}>{ORDER_STATUS[o.status] ?? o.status}</Tag>
                </Row>
                {o.status !== "RESULT_PENDING" && (
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-5">
                    <input className={INPUT} aria-label="Result value" placeholder="Result value" value={x.value} onChange={(e) => patch(o.id, { value: e.target.value })} />
                    <input className={INPUT} aria-label="Unit" placeholder="Unit (as reported)" value={x.unit} onChange={(e) => patch(o.id, { unit: e.target.value })} />
                    <input className={INPUT} aria-label="Reference range" placeholder="Reference range (as reported)" value={x.ref} onChange={(e) => patch(o.id, { ref: e.target.value })} />
                    <select className={INPUT} aria-label="Flag" value={x.flag} onChange={(e) => patch(o.id, { flag: e.target.value as Flag })}>
                      {FLAGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      disabled={!x.value.trim()}
                      onClick={() => void act((t) => enterLabResult(t, o.id, { value: x.value.trim(), interpretation: x.flag, unit: x.unit, reference_range: x.ref })).then((ok) => ok && setEntry((prev) => { const next = { ...prev }; delete next[o.id]; return next; }))}
                    >
                      Enter result
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data?.results.length === 0 && <p className="text-[13px] text-ink-500">No validated results yet.</p>}
      {data && data.results.length > 0 && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th className={TH}>Test</th><th className={TH}>Result</th><th className={TH}>Reference</th><th className={TH}>Status</th></tr></thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.id}>
                  <td className={TD}><strong>{r.name}</strong><div className="text-[11px] text-ink-500">ordered {formatDateTime(r.ordered_at)}{r.ordered_by ? ` · ${r.ordered_by}` : ""}</div></td>
                  <td className={TD}>
                    <strong>{r.value}</strong> {r.unit}{" "}
                    {r.critical ? <Tag tone="risk">Critical</Tag> : r.abnormal ? <Tag tone="warn">Abnormal</Tag> : <Tag tone="brand">Normal</Tag>}
                  </td>
                  <td className={TD}>{r.reference_range || "—"}</td>
                  <td className={TD}>
                    {r.acknowledged ? (
                      <span className="text-[12px] text-ink-500">acknowledged {r.acknowledged_by} {formatDateTime(r.acknowledged_at)}</span>
                    ) : r.abnormal ? (
                      data.can_acknowledge ? (
                        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void act((t) => acknowledgeLab(t, r.id))}>Acknowledge</button>
                      ) : (
                        <span className="text-[12px] text-priority-red">awaiting prescriber acknowledgement</span>
                      )
                    ) : (
                      <span className="text-[12px] text-ink-500">{formatDateTime(r.recorded_at)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-500">Reference ranges come from the laboratory report, not this screen.</p>
    </div>
  );
}
