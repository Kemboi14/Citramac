import { useState } from "react";
import { DocumentActions } from "./DocumentActions";
import { Callout, StatusPill } from "../modules/care/shared/ui";
import { formatIsoDate } from "../lib/subscriptionDisplay";
import {
  subscriptionStatementPrintPath,
  type StatementLine,
  type SubscriptionBilling,
  type SubscriptionStatement,
} from "../lib/subscriptionsApi";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const TITLE_CLASS = "mb-3 font-display text-base font-semibold text-ink-900";
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500";
const TD = "px-3 py-2 text-sm text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark disabled:opacity-60 transition-colors duration-150";

function money(currency: string, value: string | null) {
  if (value === null) return "—";
  return `${currency} ${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-surface-border bg-surface-bg p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-ink-900">{value}</div>
      {hint && <div className="text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

function LinesTable({
  lines,
  currency,
  total,
  totalLabel,
}: {
  lines: StatementLine[];
  currency: string;
  total: string;
  totalLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-surface-border">
          <tr>
            <th className={TH}>Item</th>
            <th className={`${TH} text-right`}>Count</th>
            <th className={`${TH} text-right`}>Monthly rate</th>
            <th className={`${TH} text-right`}>Months</th>
            <th className={`${TH} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-surface-border last:border-0">
              <td className={TD}>{line.label}</td>
              <td className={`${TD} text-right`}>{line.count ?? ""}</td>
              <td className={`${TD} text-right`}>
                {line.rate === null ? (
                  <StatusPill tone="neutral">No rate set</StatusPill>
                ) : (
                  money(currency, line.rate)
                )}
              </td>
              <td className={`${TD} text-right`}>{line.months}</td>
              <td className={`${TD} text-right`}>
                {line.amount === null ? "Not charged" : money(currency, line.amount)}
              </td>
            </tr>
          ))}
          <tr>
            <td className={`${TD} font-semibold text-ink-900`} colSpan={4}>
              {totalLabel}
            </td>
            <td className={`${TD} text-right font-semibold text-ink-900`}>
              {money(currency, total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function statementStatus(statement: SubscriptionStatement) {
  if (statement.superseded) return <StatusPill tone="neutral">Replaced by a correction</StatusPill>;
  if (statement.method === "CORRECTION")
    return <StatusPill tone="info">Correction in force</StatusPill>;
  return <StatusPill tone="success">In force</StatusPill>;
}

/**
 * CITRAMAC subscription billing for one organisation (apps.tenancy
 * .subscription_billing): live usage by billing unit, the plan's monthly
 * rates and what a statement would be if counted now, and the statements
 * issued. Read-only for the Org Admin; Super Admin also gets "Issue statement
 * now" (only when nothing bills the current period) and "Correct" (a new,
 * superseding statement with a reason — the original never changes).
 */
export function SubscriptionBillingPanel({
  billing,
  canManage = false,
  busy = false,
  onIssue,
  onCorrect,
  unclassifiedHint,
}: {
  billing: SubscriptionBilling;
  canManage?: boolean;
  busy?: boolean;
  onIssue?: () => void;
  /** Resolves true once the correction is issued (errors are shown by the caller). */
  onCorrect?: (statement: SubscriptionStatement, reason: string) => Promise<boolean>;
  /** Where the viewer fixes an unclassified room (shown under the list). */
  unclassifiedHint?: string;
}) {
  const { usage, rates } = billing;
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const cycle = billing.months === 12 ? "Annual (12 × monthly)" : "Monthly";

  return (
    <div className="flex flex-col gap-6">
      <div className={CARD_CLASS}>
        <h2 className={TITLE_CLASS}>Current usage</h2>
        <p className="mb-4 text-sm text-ink-500">
          Counted live. Current period {formatIsoDate(billing.current_period.start)} –{" "}
          {formatIsoDate(billing.current_period.end)} · {cycle}.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Active branches" value={usage.branches} />
          <Tile label="Private rooms" value={usage.private_rooms} />
          <Tile label="Shared rooms" value={usage.shared_rooms} />
          <Tile label="Unclassified rooms" value={usage.unclassified_rooms} hint="Not charged" />
          <Tile label="Ward bays" value={usage.ward_bays} hint="Not rooms · not charged" />
          <Tile label="Beds not in a room" value={usage.beds_outside_rooms} hint="Not charged" />
        </div>
        {usage.unclassified.length > 0 && (
          <Callout tone="warning" className="mt-4" label="Unclassified">
            <p className="font-semibold">
              {usage.unclassified.length} room{usage.unclassified.length === 1 ? "" : "s"}{" "}
              can&rsquo;t be counted as private or shared:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {usage.unclassified.map((room) => (
                <li key={room.id}>
                  {room.room} — {room.reason}
                </li>
              ))}
            </ul>
            {unclassifiedHint && <p className="mt-2 text-ink-500">{unclassifiedHint}</p>}
          </Callout>
        )}
        {usage.notes.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-ink-500">
            {usage.notes.map((note) => (
              <li key={note.room}>
                {note.room}: {note.note}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={CARD_CLASS}>
        <h2 className={TITLE_CLASS}>Plan rates — {rates.plan_name}</h2>
        <p className="mb-3 text-sm text-ink-500">
          Monthly rates set by CITRAMAC. A unit with no rate set is not charged. Below is what a
          statement would be if it were counted now.
        </p>
        <LinesTable
          lines={billing.estimate.lines}
          currency={billing.estimate.currency}
          total={billing.estimate.total}
          totalLabel="Estimate if counted now"
        />
      </div>

      <div className={CARD_CLASS}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink-900">Statements</h2>
          {canManage && onIssue && !billing.current_period_has_statement && (
            <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onIssue}>
              {busy ? "Issuing…" : "Issue statement now"}
            </button>
          )}
        </div>
        <p className="mb-3 text-sm text-ink-500">
          Issued at the start of each billing period and never changed. A correction is a new
          statement that names the one it replaces.
        </p>
        {billing.statements.length === 0 ? (
          <p className="text-sm text-ink-500">No statements issued yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {billing.statements.map((statement) => (
              <div
                key={statement.id}
                className="rounded-md border border-surface-border bg-surface-bg p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-ink-900">{statement.reference}</div>
                    <div className="text-xs text-ink-500">
                      {formatIsoDate(statement.period_start)} –{" "}
                      {formatIsoDate(statement.period_end)} · {statement.plan_name} ·{" "}
                      {statement.method_label}
                      {statement.issued_by && ` (${statement.issued_by})`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {statementStatus(statement)}
                    <span className="font-semibold text-ink-900">
                      {money(statement.currency, statement.total)}
                    </span>
                  </div>
                </div>
                {statement.supersedes_reference && (
                  <p className="mt-2 text-xs text-ink-700">
                    Corrects {statement.supersedes_reference}: {statement.reason}
                  </p>
                )}
                <div className="mt-3">
                  <LinesTable
                    lines={statement.lines}
                    currency={statement.currency}
                    total={statement.total}
                    totalLabel="Total for the period"
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <DocumentActions
                    path={subscriptionStatementPrintPath(statement.id)}
                    filename={statement.reference}
                    label={`statement ${statement.reference}`}
                  />
                  {canManage &&
                    onCorrect &&
                    !statement.superseded &&
                    correcting !== statement.id && (
                      <button
                        type="button"
                        className="text-sm font-semibold text-brand-green hover:underline"
                        onClick={() => {
                          setReason("");
                          setCorrecting(statement.id);
                        }}
                      >
                        Correct…
                      </button>
                    )}
                </div>
                {canManage && onCorrect && correcting === statement.id && (
                  <form
                    className="mt-3 flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!reason.trim()) return;
                      void onCorrect(statement, reason.trim()).then(
                        (ok) => ok && setCorrecting(null),
                      );
                    }}
                  >
                    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
                      Why is this statement being corrected?
                      <textarea
                        className="rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green"
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
                      />
                    </label>
                    <p className="text-xs text-ink-500">
                      The correction is counted now, on the plan&rsquo;s current rates, for the same
                      period. {statement.reference} is kept unchanged.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        className={BUTTON_CLASS}
                        disabled={busy || !reason.trim()}
                      >
                        {busy ? "Issuing…" : "Issue correction"}
                      </button>
                      <button
                        type="button"
                        className="text-sm font-semibold text-ink-500 hover:text-ink-700"
                        onClick={() => setCorrecting(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
