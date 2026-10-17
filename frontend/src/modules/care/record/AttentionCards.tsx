import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  closeEpisode,
  decideProposal,
  getAttention,
  getProposals,
  startNewEpisode,
  type AttentionAlert,
  type AttentionItem,
  type RiskProposalRow,
} from "../../../lib/carePathwayApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../shared/styles";
import { Card, ErrorNote, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import { errorText } from "../triage/helpers";

/** Live risk register + what is outstanding, computed server-side from the one
 * record; findings the system noticed wait here for a clinician to decide. */
export function AttentionCard({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const [alerts, setAlerts] = useState<AttentionAlert[]>([]);
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [proposals, setProposals] = useState<RiskProposalRow[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    getAttention(accessToken, patientId).then((r) => { setAlerts(r.alerts); setItems(r.items); }).catch((e) => setError(errorText(e, "Couldn't load alerts.")));
    getProposals(accessToken, patientId).then((r) => setProposals(r.results)).catch(() => undefined);
  }, [accessToken, patientId]);
  useEffect(load, [load]);

  async function decide(id: string, action: "ADD" | "DEFER" | "DISMISS") {
    if (!accessToken) return;
    try {
      await decideProposal(accessToken, id, action, reason);
      setDismissing(null);
      setReason("");
      load();
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't save the decision."));
    }
  }

  const open = proposals.filter((p) => p.status === "PROPOSED" || p.status === "DEFERRED");
  return (
    <Card title="Risk register and what needs attention" className="lg:col-span-2">
      <ErrorNote>{error}</ErrorNote>
      {open.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {open.map((p) => (
            <div key={p.id} className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px]">
              <strong>Finding to review:</strong> {p.source} suggests <em>{p.row} — {p.option}</em>. It is not on the risk record until you add it.
              {dismissing === p.id ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className={INPUT} placeholder="Why dismiss?" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!reason.trim()} onClick={() => void decide(p.id, "DISMISS")}>Dismiss</button>
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setDismissing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void decide(p.id, "ADD")}>Add to risk record</button>
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void decide(p.id, "DEFER")}>Not now</button>
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setDismissing(p.id)}>Dismiss…</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {alerts.length === 0 ? (
        <p className="text-[13px] text-ink-500">No active risks on the record.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {alerts.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center gap-2 text-[13px]">
              <Tag tone={a.severity === "high" ? "risk" : "warn"}>{a.source}</Tag>
              {a.text}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-surface-border pt-3 text-[13px]">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-2">
              <Tag tone={i.overdue ? "risk" : "neutral"}>{i.category}</Tag>
              {i.text}
              {i.due_at && <span className="text-ink-500">{i.overdue ? "overdue since" : "due"} {formatDateTime(i.due_at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** End the episode with a recorded outcome, or open a new one for a returning client. */
export function EpisodeOutcomeCard({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [outcome, setOutcome] = useState("");
  const [destination, setDestination] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function close() {
    if (!accessToken) return;
    setError(null);
    try {
      await closeEpisode(accessToken, patientId, { outcome, destination, reason });
      setMessage("Episode closed. Open a new one if the client returns.");
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't close the episode."));
    }
  }
  async function reopen() {
    if (!accessToken) return;
    setError(null);
    try {
      await startNewEpisode(accessToken, patientId);
      setMessage("New episode started.");
      onChanged();
    } catch (e) {
      setError(errorText(e, "Couldn't start a new episode."));
    }
  }

  return (
    <Card title="Episode outcome" className="lg:col-span-2">
      <ErrorNote>{error}</ErrorNote>
      {message && <p className="mb-2 text-[13px] text-brand-green">{message}</p>}
      {outcome === "PLANNED" && (
        <p className="mb-2 text-[12px] text-ink-500">A planned discharge needs the discharge checklist complete (Outcomes → Discharge).</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT} aria-label="How the episode ended" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">How did this episode end?</option>
          {vs.options("episode-outcome").map((o) => (
            <option key={o.code} value={o.code}>{o.display}</option>
          ))}
        </select>
        {outcome && (
          <select className={INPUT} aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">{outcome === "TRANSFERRED" ? "Destination (required)" : "Destination"}</option>
            {vs.options("episode-destination").map((o) => (
              <option key={o.code} value={o.code}>{o.display}</option>
            ))}
          </select>
        )}
        {outcome && outcome !== "PLANNED" && <input className={INPUT} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!outcome} onClick={() => void close()}>Close episode</button>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void reopen()}>Start new episode</button>
      </div>
    </Card>
  );
}
