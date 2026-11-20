import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { IntakeSummary } from "../../../../lib/carePathwayApi";
import { AnswerList } from "../../shared/AnswerList";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { ApiError } from "../../../../lib/apiClient";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { BTN, BTN_SM, FIELD_LABEL, INPUT } from "../../shared/styles";
import { Callout, Card, Tag } from "../../shared/ui";

/**
 * The signed intake as what was recorded: who signed it and when, the key
 * findings, then every answered section. It is never edited in place: Edit
 * opens the next version (filled from this one) and earlier versions stay
 * listed exactly as signed.
 */
export function IntakeSummaryView({
  summaries,
  editInProgress = false,
  onEdit,
}: {
  /** Signed intakes, newest first. */
  summaries: IntakeSummary[];
  /** Unsigned changes to the next version exist. */
  editInProgress?: boolean;
  onEdit: (reason?: string) => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState(summaries[0]?.id ?? "");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const startEdit = async () => {
    if (reason.trim().length < 5) {
      setReasonError("Give the reason for the edit (at least 5 characters).");
      return;
    }
    setBusy(true);
    setReasonError(null);
    try {
      await onEdit(reason.trim());
    } catch (err) {
      setReasonError(
        err instanceof ApiError ? err.message : "Couldn't open the intake for editing.",
      );
      setBusy(false);
    }
  };
  const shown = summaries.find((item) => item.id === selectedId) ?? summaries[0];
  if (!shown) return null;
  const current = shown.id === summaries[0].id;
  const key: [string, string | number | null][] = [
    ["Presenting concern", shown.presenting_concern],
    ["Risk level", shown.risk_level],
    ["Risk notes", shown.risk_notes],
    ["Formulation", shown.formulation],
    ["Clinical decision", shown.clinical_decision],
    ["PHQ-9", shown.phq9_score],
    ["GAD-7", shown.gad7_score],
  ];
  const keyRows = key.filter(([, value]) => value !== null && value !== "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
        <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-[var(--green)]" />
        <div className="mr-auto min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
            Intake completed
            {shown.completeness && shown.completeness !== "Complete" && (
              <Tag tone="warn">{shown.completeness}</Tag>
            )}
          </p>
          <p className="text-[12.5px] text-ink-500">
            Signed {shown.signed_on}
            {shown.signed_by ? ` by ${shown.signed_by}` : ""}
            {summaries.length > 1 ? ` · version ${shown.version} of ${summaries[0].version}` : ""}
          </p>
        </div>
        {current && (
          <button
            type="button"
            className={`${BTN} ${BTN_SM}`}
            onClick={() => {
              if (editInProgress) {
                void onEdit();
                return;
              }
              setReason("");
              setReasonError(null);
              setAsking(true);
            }}
          >
            {editInProgress ? "Continue editing" : "Edit"}
          </button>
        )}
      </div>

      {summaries.length > 1 && (
        <Card title="Versions">
          <ol className="flex flex-col gap-1.5">
            {summaries.map((item, index) => {
              const selected = item.id === shown.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={selected ? "true" : undefined}
                    className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                      selected
                        ? "border-[var(--green)] bg-surface-card"
                        : "border-surface-border bg-surface-bg"
                    }`}
                  >
                    <span className="font-semibold text-ink-900">
                      Version {item.version}
                      {index === 0 ? " (current)" : ""}
                    </span>
                    <span className="text-ink-500">
                      {item.signed_on} · {item.signed_by}
                    </span>
                    {item.edit_reason && (
                      <span className="basis-full text-ink-700">Edited: {item.edit_reason}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {!current && (
        <Callout tone="warning" label="Earlier version">
          You are viewing an earlier version, kept exactly as it was signed.
        </Callout>
      )}
      {shown.edit_reason && (
        <Callout tone="info" label="Reason for edit">
          {shown.edit_reason}
        </Callout>
      )}
      {shown.outstanding.length > 0 && (
        <Callout tone="warning" label="Signed with items outstanding">
          <ul className="ml-4 list-disc">
            {shown.outstanding.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Callout>
      )}

      {keyRows.length > 0 && (
        <Card title="Key findings">
          <AnswerList rows={keyRows.map(([label, value]) => ({ label, value: String(value) }))} />
        </Card>
      )}

      {shown.sections.map((section) => (
        <Card key={section.title} title={section.title}>
          <AnswerList rows={section.rows} />
        </Card>
      ))}
      <ConfirmDialog
        open={asking}
        title="Edit this intake?"
        confirmLabel="Edit intake"
        busyLabel="Opening…"
        busy={busy}
        error={reasonError}
        onConfirm={() => void startEdit()}
        onCancel={() => setAsking(false)}
      >
        <p>
          The intake opens filled with what was signed. Update what has changed and sign it; it is
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
