import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { ApiError } from "../../../lib/apiClient";
import {
  getSignedAssessment,
  requestFullRetriage,
  startNewTriage,
  type TriageEncounterDetail,
} from "../../../lib/carePathwayApi";
import { SignedTriageSections, type SignedAssessment } from "../SignedTriageDocumentPage";
import { AutoResizeTextarea } from "../shared/AutoResizeTextarea";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, FIELD_LABEL, INPUT } from "../shared/styles";
import { Callout, Card, ErrorNote, PriorityPill } from "../shared/ui";

/**
 * A signed triage, shown as what was done: priority, who signed and when, then
 * every answered section, the tasks it raised and the re-checks since. A signed
 * triage is never edited: Re-triage opens a new version filled from this one,
 * with a reason, and the earlier versions stay listed exactly as signed.
 */
export function TriageSummaryView({
  detail,
  onRetriage,
}: {
  detail: TriageEncounterDetail;
  onRetriage: () => void;
}) {
  const { accessToken } = useAuth();
  const versions = detail.versions;
  const current = versions[0];
  const [selectedId, setSelectedId] = useState(current?.id ?? "");
  const [record, setRecord] = useState<SignedAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [retriageError, setRetriageError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !selectedId) return;
    let cancelled = false;
    getSignedAssessment(accessToken, selectedId)
      .then((data) => {
        if (!cancelled) {
          setRecord(data);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : "Couldn't load this signed triage.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedId]);

  const retriage = async () => {
    if (!accessToken) return;
    if (reason.trim().length < 5) {
      setRetriageError("Give the reason for the edit (at least 5 characters).");
      return;
    }
    setBusy(true);
    setRetriageError(null);
    try {
      await requestFullRetriage(accessToken, detail.id, reason.trim());
      setAsking(false);
      onRetriage();
    } catch (err) {
      setRetriageError(
        err instanceof ApiError ? err.message : "Couldn't open the triage for editing.",
      );
    } finally {
      setBusy(false);
    }
  };

  // A new arrival's triage for this client, opened straight on the triage form.
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const newTriage = async () => {
    if (!accessToken) return;
    setStarting(true);
    try {
      const { id } = await startNewTriage(accessToken, detail.patient_id, requestId);
      navigate(`/clinical/triage/${id}`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't start a new triage.");
      setStarting(false);
    }
  };

  const shown = versions.find((version) => version.id === selectedId) ?? current;
  const viewingCurrent = shown?.id === current?.id;
  const number = (id: string) => versions.length - versions.findIndex((v) => v.id === id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
        <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-[var(--green)]" />
        <div className="mr-auto min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
            Triage completed
            {shown?.final_priority && <PriorityPill priority={shown.final_priority} long />}
          </p>
          <p className="text-[12.5px] text-ink-500">
            Signed {formatDateTime(shown?.signed_at ?? null)}
            {shown?.signed_by ? ` by ${shown.signed_by}` : ""}
            {versions.length > 1 && shown
              ? ` · version ${number(shown.id)} of ${versions.length}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={starting}
          onClick={() => void newTriage()}
        >
          {starting ? "Starting…" : "New triage"}
        </button>
        {viewingCurrent && (
          <button
            type="button"
            className={`${BTN} ${BTN_SM}`}
            onClick={() => {
              setReason("");
              setRetriageError(null);
              setAsking(true);
            }}
          >
            Edit
          </button>
        )}
      </div>

      {versions.length > 1 && (
        <Card title="Versions">
          <ol className="flex flex-col gap-1.5">
            {versions.map((version, index) => {
              const selected = version.id === shown?.id;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(version.id)}
                    aria-current={selected ? "true" : undefined}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                      selected
                        ? "border-[var(--green)] bg-surface-card"
                        : "border-surface-border bg-surface-bg"
                    }`}
                  >
                    <span className="font-semibold text-ink-900">
                      Version {versions.length - index}
                      {index === 0 ? " (current)" : ""}
                    </span>
                    {version.final_priority && <PriorityPill priority={version.final_priority} />}
                    <span className="text-ink-500">
                      {formatDateTime(version.signed_at)} · {version.signed_by}
                    </span>
                    {version.retriage_reason && (
                      <span className="basis-full text-ink-700">
                        Edited: {version.retriage_reason}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {!viewingCurrent && (
        <Callout tone="warning" label="Earlier version">
          You are viewing an earlier version, kept exactly as it was signed. The current version is
          at the top of Versions.
        </Callout>
      )}
      {shown?.retriage_reason && (
        <Callout tone="info" label="Reason for edit">
          {shown.retriage_reason}
        </Callout>
      )}

      {detail.rechecks.length > 0 && viewingCurrent && (
        <Card title={`Re-checks since triage (${detail.rechecks.length})`}>
          <ol className="flex flex-col gap-1.5">
            {[...detail.rechecks]
              .sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))
              .map((recheck) => (
                <li
                  key={recheck.id}
                  className="rounded-lg border border-surface-border bg-surface-bg px-3 py-2 text-[13px] text-ink-900"
                >
                  <span className="font-medium">{formatDateTime(recheck.signed_at)}</span>
                  {recheck.signed_by ? ` · ${recheck.signed_by}` : ""}
                  {recheck.note && <span className="block text-ink-700">{recheck.note}</span>}
                </li>
              ))}
          </ol>
        </Card>
      )}

      <ErrorNote>{loadError}</ErrorNote>
      {record && record.id === selectedId ? (
        <SignedTriageSections record={record} />
      ) : (
        !loadError && <p className="text-[13px] text-ink-500">Loading the signed triage…</p>
      )}

      <ConfirmDialog
        open={asking}
        title="Edit this triage?"
        confirmLabel="Edit triage"
        busyLabel="Starting…"
        busy={busy}
        error={retriageError}
        onConfirm={() => void retriage()}
        onCancel={() => setAsking(false)}
      >
        <p>
          The triage opens filled with what was signed. Update what has changed and sign it; it is
          saved as a new version and the signed one stays on record unchanged.
        </p>
        <label className="mt-3 block">
          <span className={FIELD_LABEL}>Reason for the edit (required)</span>
          <AutoResizeTextarea
            className={INPUT}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
