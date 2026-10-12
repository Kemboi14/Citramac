import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { acknowledgeCosign, decideCosign, getDecisionInbox, type CosignRow } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "./shared/styles";
import { Card, ErrorNote, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

/** "Needs my decision": co-signature requests waiting for a senior, declined
 * requests that came back, and discussions awaiting a reply. */
export function DecisionInbox() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<CosignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: "DECLINE" | "DISCUSS" } | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setItems((await getDecisionInbox(accessToken)).results);
    } catch (e) {
      setError(errorText(e, "Couldn't load your decisions."));
    }
  }, [accessToken]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount.
    void load();
  }, [load]);

  async function act(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      setOpen(null);
      setNote("");
      await load();
    } catch (e) {
      setError(errorText(e, "Couldn't save the decision."));
    }
  }

  return (
    <Card title={<>Needs my decision {items && <Tag>{items.length}</Tag>}</>}>
      <ErrorNote>{error}</ErrorNote>
      {!items ? (
        <p className="text-[13px] text-ink-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-500">Nothing waiting for your decision.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-lg border border-surface-border p-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={clientRecordPath(r.patient_id, "care-plan")} className="font-semibold text-brand-green hover:underline">
                  {r.patient_name}
                </Link>
                <Tag tone={r.inbox_kind === "returned" ? "risk" : "warn"}>
                  {r.inbox_kind === "cosign" ? "Co-sign" : r.inbox_kind === "returned" ? "Returned" : "Discuss"}
                </Tag>
                <span className="text-[11px] text-ink-500">requested {formatDateTime(r.requested_at)} by {r.requested_by}</span>
              </div>
              <p className="mt-1">{r.what}</p>
              {r.decline_reason && <p className="mt-1 text-ink-500">Reason: “{r.decline_reason}”</p>}
              {r.thread.length > 0 && <p className="mt-1 text-ink-500">“{r.thread[r.thread.length - 1].note}”</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.inbox_kind === "cosign" && (
                  <>
                    <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => accessToken && void act(() => decideCosign(accessToken, r.id, "SIGN"))}>
                      Approve &amp; sign
                    </button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen({ id: r.id, mode: "DISCUSS" })}>Discuss…</button>
                    <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen({ id: r.id, mode: "DECLINE" })}>Decline…</button>
                  </>
                )}
                {r.inbox_kind === "returned" && (
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => accessToken && void act(() => acknowledgeCosign(accessToken, r.id))}>
                    Acknowledge
                  </button>
                )}
              </div>
              {open?.id === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input className={`${INPUT} max-w-md`} aria-label={open.mode === "DECLINE" ? "Reason for declining" : "What to discuss"} placeholder={open.mode === "DECLINE" ? "Reason for declining (returned to the requester)" : "What do you want to discuss?"} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="button" className={`${BTN} ${BTN_SM}`} disabled={note.trim().length < 5} onClick={() => accessToken && void act(() => decideCosign(accessToken, r.id, open.mode, note))}>
                    {open.mode === "DECLINE" ? "Decline with reason" : "Send to requester"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
