import { useId, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { ApiError } from "../../../../lib/apiClient";
import {
  voidIntervention,
  type InterventionModule,
  type InterventionRecord,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN_DANGER, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Card, ErrorNote, Tag } from "../../shared/ui";

/** History tab: this module's deliveries, newest first. A corrected record
 * stays visible, tagged "Corrected", with its correction reason. */
export function ModuleHistory({
  module,
  records,
  clientName,
  onCorrected,
}: {
  module: InterventionModule;
  records: InterventionRecord[];
  clientName: string;
  onCorrected: (message: string) => void;
}) {
  if (records.length === 0) {
    return (
      <p className="mb-3.5 text-xs text-ink-500">
        No {module.name.toLowerCase()} entries are recorded for {clientName}.
      </p>
    );
  }
  return (
    <Card title={`Recorded ${module.name} activity`} bodyClassName="p-[18px] text-[13px]">
      <ol className="flex flex-col">
        {records.map((record) => (
          <HistoryItem key={record.id} record={record} module={module} onCorrected={onCorrected} />
        ))}
      </ol>
    </Card>
  );
}

function HistoryItem({
  record,
  module,
  onCorrected,
}: {
  record: InterventionRecord;
  module: InterventionModule;
  onCorrected: (message: string) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voided = Boolean(record.voided_at);

  const submit = async () => {
    if (!accessToken) return;
    if (reason.trim().length < 5) {
      setError("Give the reason for the correction (at least 5 characters).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await voidIntervention(accessToken, record.id, reason.trim());
      onCorrected("Record corrected; it no longer counts towards delivered totals or billing.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't correct this record.");
      setSaving(false);
    }
  };

  return (
    <li className="border-l-2 border-surface-border py-2 pl-3.5">
      <div className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
        {record.intervention || module.name}
        <Tag tone={voided ? "warn" : "neutral"}>
          {voided ? "Corrected" : formatDateTime(record.performed_at)}
        </Tag>
        {record.quantity > 1 && <span className="text-xs text-ink-500">× {record.quantity}</span>}
      </div>
      <div className="mt-1 text-[12.5px] text-ink-700">
        {record.note}
        {voided && <div>Corrected; excluded from delivered intervention totals.</div>}
        {record.void_reason && <div>Correction: {record.void_reason}</div>}
        {record.response && <div>Response: {record.response}</div>}
        {record.outcome && <div>Outcome: {record.outcome}</div>}
        {record.next_action && <div>Next: {record.next_action}</div>}
        {record.activity_title && <div>Linked action: {record.activity_title}</div>}
        <div className="text-ink-500">{record.provider_name || "Provider not recorded"}</div>
      </div>
      {!voided && !correcting && (
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM} mt-2`}
          onClick={() => setCorrecting(true)}
        >
          Correct this record
        </button>
      )}
      {correcting && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={`${id}-reason`} className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Reason for correction
          </label>
          <input
            id={`${id}-reason`}
            className={INPUT}
            value={reason}
            minLength={5}
            required
            onChange={(e) => setReason(e.target.value)}
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={`${BTN_DANGER} ${BTN_SM}`} disabled={saving}>
              {saving ? "Correcting…" : "Mark as recorded in error"}
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => {
                setCorrecting(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
