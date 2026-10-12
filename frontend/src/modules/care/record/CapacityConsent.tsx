import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  completeDeferredConsent,
  getCapacity,
  getVisitConsents,
  recordCapacity,
  recordVisitConsent,
  type CapacityRow,
  type VisitConsentRow,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { Callout, Card, ErrorNote, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { errorText } from "../triage/helpers";

const QUESTIONS = [
  ["understand", "Understands the information"],
  ["retain", "Retains it long enough to decide"],
  ["weigh", "Weighs it up to reach a decision"],
  ["communicate", "Communicates the decision"],
] as const;
const PARTIES = [
  ["PATIENT", "Patient"],
  ["GUARDIAN", "Parent / guardian (minor)"],
  ["SUBSTITUTE", "Substitute decision-maker"],
  ["DEFERRED", "Deferred — emergency"],
] as const;

/** Decision-specific capacity and consent. Capacity is judged per decision, never
 * as a blanket label, and each assessment is kept (a new one supersedes it). */
export function CapacityConsentCard({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [current, setCurrent] = useState<CapacityRow[]>([]);
  const [consents, setConsents] = useState<VisitConsentRow[]>([]);
  const [cap, setCap] = useState<Record<string, string>>({});
  const [con, setCon] = useState<Record<string, string>>({ party: "PATIENT" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    getCapacity(accessToken, patientId).then((r) => setCurrent(r.current)).catch((e) => setError(errorText(e, "Couldn't load capacity.")));
    getVisitConsents(accessToken, patientId).then((r) => setConsents(r.results)).catch(() => undefined);
  }, [accessToken, patientId]);
  useEffect(load, [load]);

  async function run(work: () => Promise<unknown>, after: () => void) {
    setError(null);
    try {
      await work();
      after();
      load();
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
    }
  }

  const capReady = cap.decision && QUESTIONS.every(([k]) => cap[k]);
  return (
    <Card title="Capacity and consent for specific decisions">
      <ErrorNote>{error}</ErrorNote>
      {current.length === 0 ? <p className="text-[13px] text-ink-500">No capacity assessments recorded.</p> : (
        <ul className="mb-3 flex flex-col gap-1 text-[13px]">
          {current.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <Tag tone={c.outcome === "Has capacity" ? "brand" : c.outcome === "Lacks capacity" ? "risk" : "warn"}>{c.outcome}</Tag>
              {vs.label("capacity-decision", c.decision)}{c.other_decision ? ` — ${c.other_decision}` : ""}
              <span className="text-ink-500">{c.assessed_by}, {formatDateTime(c.assessed_at)}{c.reassess_by ? ` · reassess by ${c.reassess_by}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-surface-border p-3">
        <legend className="px-1 text-xs font-semibold">New capacity assessment</legend>
        <select className={INPUT} aria-label="Decision" value={cap.decision ?? ""} onChange={(e) => setCap({ ...cap, decision: e.target.value })}>
          <option value="">Decision in question…</option>
          {vs.options("capacity-decision").map((o) => <option key={o.code} value={o.code}>{o.display}</option>)}
        </select>
        {cap.decision === "OTHER" && <input className={INPUT} placeholder="Specify" value={cap.other_decision ?? ""} onChange={(e) => setCap({ ...cap, other_decision: e.target.value })} />}
        {QUESTIONS.map(([k, label]) => (
          <select key={k} className={INPUT} aria-label={label} value={cap[k] ?? ""} onChange={(e) => setCap({ ...cap, [k]: e.target.value })}>
            <option value="">{label}…</option>
            <option>Yes</option><option>No</option><option>Unsure</option>
          </select>
        ))}
        <input type="date" className={INPUT} aria-label="Reassess by" value={cap.reassess_by ?? ""} onChange={(e) => setCap({ ...cap, reassess_by: e.target.value })} />
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!capReady} onClick={() => void run(() => recordCapacity(accessToken!, patientId, cap), () => setCap({}))}>Record</button>
      </fieldset>

      <h3 className="mb-1 text-sm font-semibold">Consent for this visit</h3>
      {consents.map((c) => (
        <div key={c.id} className="mb-1 text-[13px]">
          <Tag tone={c.open_deferred ? "risk" : "neutral"}>{c.open_deferred ? "Deferred — open" : PARTIES.find(([v]) => v === c.party)?.[1]}</Tag> {c.scope}
          {c.given_by_name && ` — ${c.given_by_name}`} <span className="text-ink-500">{formatDateTime(c.recorded_at)}</span>
          {c.warnings.map((w) => <Callout key={w} tone="warning" className="mt-1">{w}</Callout>)}
          {c.open_deferred && <button type="button" className={`${BTN_GHOST} ${BTN_SM} ml-2`} onClick={() => void run(() => completeDeferredConsent(accessToken!, c.id), () => undefined)}>Mark completed</button>}
        </div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className={INPUT} placeholder="What is the consent for?" value={con.scope ?? ""} onChange={(e) => setCon({ ...con, scope: e.target.value })} />
        <select className={INPUT} aria-label="Who is consenting" value={con.party} onChange={(e) => setCon({ ...con, party: e.target.value })}>
          {PARTIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {(con.party === "GUARDIAN" || con.party === "SUBSTITUTE") && <input className={INPUT} placeholder="Name of person consenting" value={con.given_by_name ?? ""} onChange={(e) => setCon({ ...con, given_by_name: e.target.value })} />}
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!con.scope?.trim()} onClick={() => void run(() => recordVisitConsent(accessToken!, patientId, con), () => setCon({ party: "PATIENT" }))}>Record consent</button>
      </div>
    </Card>
  );
}
