import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import { getPatientMerges, reverseMerge, type PatientMerge } from "../../../lib/carePathwayApi";
import { formatDateTime } from "./format";
import { BTN_DANGER, BTN_GHOST, BTN_SM, INPUT } from "./styles";
import { Callout, Card, StatusPill } from "./ui";

/** Temporary records merged into this client (or this record merged away), with
 * who merged and why. An Org Admin can reverse a wrong merge: every record it
 * moved goes back to the temporary record. Rendered only when there is one. */
export function MergeHistory({
  patientId,
  onChanged,
}: {
  patientId: string;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [merges, setMerges] = useState<PatientMerge[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getPatientMerges(accessToken, patientId)
      .then((data) => {
        if (cancelled) return;
        setMerges(data.results);
        setLoadError(null);
      })
      .catch(
        (err) =>
          !cancelled &&
          setLoadError(
            err instanceof ApiError ? err.message : "Merge history could not be loaded.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId]);

  const confirmReverse = (mergeId: string) => {
    if (!accessToken || !reason.trim()) return;
    setBusy(true);
    setStatus("");
    reverseMerge(accessToken, mergeId, reason.trim())
      .then((updated) => {
        setMerges((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        setReversing(null);
        setReason("");
        setStatus("Merge reversed. The temporary record has its own history again.");
        onChanged();
      })
      .catch((err) =>
        setStatus(err instanceof ApiError ? err.message : "The merge could not be reversed."),
      )
      .finally(() => setBusy(false));
  };

  if (loadError) {
    return (
      <Callout tone="danger" role="alert" className="my-4">
        {loadError}
      </Callout>
    );
  }
  if (!merges.length) return null;

  return (
    <div className="my-4" aria-labelledby="merge-history-title">
      <Card title={<span id="merge-history-title">Merged temporary records</span>}>
        <div className="grid gap-2.5">
          {merges.map((merge) => (
            <article
              key={merge.id}
              className="rounded-[9px] border border-surface-border bg-surface-card p-3.5"
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-ink-900">
                  {merge.temporary.citramac_number} → {merge.surviving.name} ·{" "}
                  {merge.surviving.citramac_number}
                </h3>
                <StatusPill tone={merge.reversed ? "warning" : "neutral"}>
                  {merge.reversed ? "Reversed" : "Merged"}
                </StatusPill>
              </div>
              <div className="mb-2 text-[11px] text-ink-500">
                Merged by {merge.merged_by} · {formatDateTime(merge.merged_at)} ·{" "}
                {merge.records_moved} record{merge.records_moved === 1 ? "" : "s"} moved
              </div>
              {merge.temporary.description && (
                <p className="text-xs text-ink-900">
                  <strong>Arrived as:</strong> {merge.temporary.description}
                </p>
              )}
              <p className="text-xs text-ink-900">
                <strong>Reason:</strong> {merge.reason}
              </p>
              {merge.reversed && (
                <p className="mt-1 text-xs text-ink-900">
                  <strong>Reversed by {merge.reversed.by}</strong> ·{" "}
                  {formatDateTime(merge.reversed.at)}: {merge.reversed.reason}
                  {merge.reversed.not_restored > 0 &&
                    ` (${merge.reversed.not_restored} record${
                      merge.reversed.not_restored === 1 ? "" : "s"
                    } had since moved elsewhere and stayed there)`}
                </p>
              )}
              {merge.can_reverse && reversing !== merge.id && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM} mt-2`}
                  onClick={() => {
                    setReversing(merge.id);
                    setReason("");
                    setStatus("");
                  }}
                >
                  Reverse this merge
                </button>
              )}
              {reversing === merge.id && (
                <div className="mt-2 grid gap-2">
                  <label htmlFor={`reverse-${merge.id}`} className="text-xs font-semibold">
                    Why was this the wrong person?
                  </label>
                  <textarea
                    id={`reverse-${merge.id}`}
                    rows={2}
                    className={`${INPUT} resize-y`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="text-[11px] text-ink-500">
                    Everything the merge moved goes back to {merge.temporary.citramac_number}.
                    Records written on this client since the merge stay here.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${BTN_DANGER} ${BTN_SM}`}
                      disabled={busy || !reason.trim()}
                      onClick={() => confirmReverse(merge.id)}
                    >
                      Reverse merge
                    </button>
                    <button
                      type="button"
                      className={`${BTN_GHOST} ${BTN_SM}`}
                      disabled={busy}
                      onClick={() => setReversing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
        {status && (
          <p role="status" className="mt-2 text-xs text-ink-900">
            {status}
          </p>
        )}
      </Card>
    </div>
  );
}
