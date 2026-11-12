import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import {
  acknowledgeCosign,
  completePsychiatricReviewRequest,
  decideCosign,
  getDecisionInbox,
  startPsychiatricReviewRequest,
  type CosignRow,
} from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "./shared/styles";
import { Card, ErrorNote, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";
import { useValueSets } from "./shared/useValueSets";

/** "Needs my decision": co-signature requests and psychiatric reviews waiting
 * for a senior, plus returned requests and discussions awaiting a reply. */
export function DecisionInbox() {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [items, setItems] = useState<CosignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; mode: "DECLINE" | "DISCUSS" } | null>(null);
  const [note, setNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState("");
  const [reviewNote, setReviewNote] = useState("");

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
      setReviewOpen(null);
      setReviewOutcome("");
      setReviewNote("");
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
                <Link
                  to={clientRecordPath(r.patient_id, "care-plan")}
                  className="font-semibold text-brand-green hover:underline"
                >
                  {r.patient_name}
                </Link>
                <Tag tone={r.inbox_kind === "returned" ? "risk" : "warn"}>
                  {r.inbox_kind === "psychiatric_review"
                    ? "Psychiatric review"
                    : r.inbox_kind === "cosign"
                      ? "Co-sign"
                      : r.inbox_kind === "returned"
                        ? "Returned"
                        : "Discuss"}
                </Tag>
                <span className="text-[11px] text-ink-500">
                  requested {formatDateTime(r.requested_at)} by {r.requested_by}
                </span>
              </div>
              <p className="mt-1">{r.what}</p>
              {r.inbox_kind !== "psychiatric_review" && r.decline_reason && (
                <p className="mt-1 text-ink-500">Reason: “{r.decline_reason}”</p>
              )}
              {r.inbox_kind !== "psychiatric_review" && r.thread.length > 0 && (
                <p className="mt-1 text-ink-500">“{r.thread[r.thread.length - 1].note}”</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.inbox_kind === "psychiatric_review" ? (
                  <>
                    <details className="w-full rounded-md bg-surface-bg p-3">
                      <summary className="cursor-pointer font-semibold text-ink-700">
                        View SBAR handover
                      </summary>
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] text-ink-700">
                        {r.sbar}
                      </pre>
                    </details>
                    {r.status === "INITIATED" && (
                      <button
                        type="button"
                        className={`${BTN} ${BTN_SM}`}
                        onClick={() =>
                          accessToken &&
                          void act(() => startPsychiatricReviewRequest(accessToken, r.id))
                        }
                      >
                        Start review
                      </button>
                    )}
                    {r.status === "PENDING" &&
                      (reviewOpen === r.id ? (
                        <div className="flex w-full flex-col gap-2">
                          <ErrorNote>{vs.error}</ErrorNote>
                          <label className="flex max-w-md flex-col gap-1 text-[12px] font-medium text-ink-700">
                            Review outcome
                            <select
                              className={INPUT}
                              aria-label="Psychiatric review outcome"
                              value={reviewOutcome}
                              onChange={(e) => setReviewOutcome(e.target.value)}
                            >
                              <option value="">— choose outcome —</option>
                              {vs.options("psychiatric-review-outcome").map((option) => (
                                <option key={option.code} value={option.code}>
                                  {option.display}
                                </option>
                              ))}
                            </select>
                          </label>
                          <input
                            className={`${INPUT} max-w-md`}
                            aria-label="Outcome note (optional)"
                            placeholder="Outcome note (optional)"
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`${BTN} ${BTN_SM}`}
                              disabled={!reviewOutcome || !vs.ready}
                              onClick={() =>
                                accessToken &&
                                void act(() =>
                                  completePsychiatricReviewRequest(
                                    accessToken,
                                    r.id,
                                    reviewOutcome,
                                    reviewNote.trim(),
                                  ),
                                )
                              }
                            >
                              Complete review
                            </button>
                            <button
                              type="button"
                              className={`${BTN_GHOST} ${BTN_SM}`}
                              onClick={() => setReviewOpen(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`${BTN} ${BTN_SM}`}
                          onClick={() => {
                            setReviewOpen(r.id);
                            setReviewOutcome("");
                            setReviewNote("");
                          }}
                        >
                          Complete review…
                        </button>
                      ))}
                  </>
                ) : (
                  <>
                    {r.inbox_kind === "cosign" && (
                      <>
                        <button
                          type="button"
                          className={`${BTN} ${BTN_SM}`}
                          onClick={() =>
                            accessToken && void act(() => decideCosign(accessToken, r.id, "SIGN"))
                          }
                        >
                          Approve &amp; sign
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => setOpen({ id: r.id, mode: "DISCUSS" })}
                        >
                          Discuss…
                        </button>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => setOpen({ id: r.id, mode: "DECLINE" })}
                        >
                          Decline…
                        </button>
                      </>
                    )}
                    {r.inbox_kind === "returned" && (
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() =>
                          accessToken && void act(() => acknowledgeCosign(accessToken, r.id))
                        }
                      >
                        Acknowledge
                      </button>
                    )}
                  </>
                )}
              </div>
              {r.inbox_kind !== "psychiatric_review" && open?.id === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className={`${INPUT} max-w-md`}
                    aria-label={
                      open.mode === "DECLINE" ? "Reason for declining" : "What to discuss"
                    }
                    placeholder={
                      open.mode === "DECLINE"
                        ? "Reason for declining (returned to the requester)"
                        : "What do you want to discuss?"
                    }
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`${BTN} ${BTN_SM}`}
                    disabled={note.trim().length < 5}
                    onClick={() =>
                      accessToken &&
                      void act(() => decideCosign(accessToken, r.id, open.mode, note))
                    }
                  >
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
