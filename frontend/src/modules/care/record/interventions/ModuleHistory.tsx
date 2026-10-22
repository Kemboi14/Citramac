import { Fragment, useId, useState } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { ApiError } from "../../../../lib/apiClient";
import {
  voidIntervention,
  type InterventionModule,
  type InterventionRecord,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN_DANGER, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Card, ErrorNote, Tag } from "../../shared/ui";

/** History tab (v4 `appendModuleHistory`): when · who, quantity, intervention,
 * client response · outcome, next action — newest first. A corrected record
 * stays visible, tagged, with its reason. Group-session attendances are
 * corrected where they were documented, so they carry no Correct button here. */
export function ModuleHistory({
  module,
  records,
  onCorrected,
}: {
  module: InterventionModule;
  records: InterventionRecord[];
  onCorrected: (message: string) => void;
}) {
  if (records.length === 0) {
    return (
      <p className="text-[13px] text-ink-500">
        No {module.name.toLowerCase()} delivery has been recorded for this client.
      </p>
    );
  }
  return (
    <Card bodyClassName="overflow-x-auto">
      <table className={`${TABLE} min-w-[720px]`}>
        <thead>
          <tr>
            <th className={TH}>When · who</th>
            <th className={`${TH} text-right`}>Qty</th>
            <th className={TH}>Intervention</th>
            <th className={TH}>Client response · outcome</th>
            <th className={TH}>Next action</th>
            <th className={TH}>
              <span className="sr-only">Correction</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <HistoryRow key={record.id} record={record} onCorrected={onCorrected} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function HistoryRow({
  record,
  onCorrected,
}: {
  record: InterventionRecord;
  onCorrected: (message: string) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voided = Boolean(record.voided_at);
  const fromGroup = record.module === "group_psychotherapy";

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
    <Fragment>
      <tr className={voided ? "opacity-60" : undefined}>
        <td className={`${TD} whitespace-nowrap`}>
          {formatDateTime(record.performed_at)}
          <div className="text-xs text-ink-500">{record.provider_name || "Provider not recorded"}</div>
        </td>
        <td className={`${TD} text-right tabular-nums`}>{record.quantity}</td>
        <td className={TD}>
          <b>{record.intervention}</b>
          {record.note && <> · {record.note}</>}
          {fromGroup && <div className="text-xs text-ink-500">Group session</div>}
          {record.activity_title && (
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[.4px] text-ink-400">
              ↳ {record.activity_title}
            </div>
          )}
          {voided && (
            <div className="mt-1">
              <Tag tone="warn">Corrected</Tag>
              {record.void_reason && (
                <span className="ml-1 text-xs text-ink-500">{record.void_reason}</span>
              )}
            </div>
          )}
        </td>
        <td className={TD}>
          {record.response || "—"}
          {record.outcome && <div className="text-ink-500">{record.outcome}</div>}
        </td>
        <td className={TD}>{record.next_action || "—"}</td>
        <td className={`${TD} text-right`}>
          {!voided && !fromGroup && !correcting && (
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setCorrecting(true)}>
              Correct
            </button>
          )}
        </td>
      </tr>
      {correcting && (
        <tr>
          <td colSpan={6} className={TD}>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label
                htmlFor={`${id}-reason`}
                className="text-[11px] font-semibold uppercase tracking-wide text-ink-500"
              >
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
          </td>
        </tr>
      )}
    </Fragment>
  );
}
