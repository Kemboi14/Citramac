import { Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import {
  cosignPrescription,
  decideCosign,
  getPrescribing,
  type MedicationOrder,
  type PrescribingState,
} from "../../../lib/carePathwayApi";
import { MedsSection } from "../record/intake/MedsSection";
import { PrescribingModule } from "../record/modules/PrescribingModule";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Card, ErrorNote, Tag } from "../shared/ui";
import { errorText } from "../triage/helpers";

type Order = PrescribingState["orders"][number];

function typeLabel(type: MedicationOrder["order_type"]) {
  return type === "PRN" ? "PRN (nurse)" : type === "TELEPHONE" ? "Telephone order" : "Prescription";
}

function orderText(o: MedicationOrder) {
  return o.is_prn
    ? `${o.dose} ${o.route} · PRN, max ${o.prn_max_per_24h ?? "—"}/24 h`
    : `${o.dose} ${o.route} · ${o.frequency}`;
}

function statusTag(o: MedicationOrder) {
  switch (o.confirmation.state) {
    case "AWAITING":
      return <Tag tone="warn">Awaiting approval</Tag>;
    case "DECLINED":
      return <Tag tone="risk">Declined</Tag>;
    default:
      return <Tag tone="brand">Active</Tag>;
  }
}

/** The Psychiatry Medication tab: orders nurses placed that wait for the
 * psychiatrist (approve / decline with a reason), the client's orders, the PRN
 * doses given under them, and — on request — a new order and the shared
 * medication history. One store each: PrescriptionItem (MedicationRequest),
 * CosignRequest for the approval, the MAR (MedicationAdministration). */
export function PsychiatryMedicationPanel({ patientId }: { patientId: string }) {
  const { accessToken } = useAuth();
  const [state, setState] = useState<PrescribingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOrder, setNewOrder] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(() => {
    if (!accessToken) return;
    getPrescribing(accessToken, patientId)
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((e) => setError(errorText(e, "Couldn't load the client's medication.")));
  }, [accessToken, patientId]);
  useEffect(load, [load]);

  if (!state) {
    return error ? (
      <ErrorNote>{error}</ErrorNote>
    ) : (
      <p className="text-[13px] text-ink-500">Loading medication…</p>
    );
  }

  const awaiting = state.orders.filter((o) => o.confirmation.state === "AWAITING");
  const others = state.orders.filter((o) => o.confirmation.state !== "AWAITING");

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>

      <Card
        title={
          <span className="flex items-center gap-2">
            Awaiting approval
            {awaiting.length > 0 && <Tag tone="warn">{awaiting.length}</Tag>}
          </span>
        }
      >
        {awaiting.length === 0 ? (
          <p className="text-[13px] text-ink-500">No orders are waiting for approval.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {awaiting.map((o) => (
              <AwaitingOrder
                key={o.id}
                patientId={patientId}
                order={o}
                onDone={setState}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Medication orders"
        aside={
          state.can_prescribe && (
            <button
              type="button"
              className={`${newOrder ? BTN_GHOST : BTN} ${BTN_SM}`}
              onClick={() => setNewOrder((v) => !v)}
            >
              {newOrder ? (
                "Close"
              ) : (
                <>
                  <Plus aria-hidden className="h-4 w-4" /> New order
                </>
              )}
            </button>
          )
        }
        bodyClassName=""
      >
        {newOrder && (
          <div className="border-b border-surface-border bg-surface-bg p-[18px]">
            <PrescribingModule patientId={patientId} showOrders={false} onOrdersChange={load} />
          </div>
        )}
        {others.length === 0 ? (
          <p className="p-[18px] text-[13px] text-ink-500">No medication orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[720px]`}>
              <thead>
                <tr>
                  <th className={TH}>Medication</th>
                  <th className={TH}>Dose · route · frequency</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Ordered</th>
                </tr>
              </thead>
              <tbody>
                {others.map((o) => (
                  <tr key={o.id}>
                    <td className={TD}>
                      <strong>{o.drug}</strong>
                      {o.controlled_drug && (
                        <span className="ml-1.5 text-[11px] font-semibold text-priority-orange">
                          Controlled
                        </span>
                      )}
                      {o.is_prn && o.indication && (
                        <span className="block text-xs text-ink-500">For: {o.indication}</span>
                      )}
                    </td>
                    <td className={TD}>{orderText(o)}</td>
                    <td className={TD}>{typeLabel(o.order_type)}</td>
                    <td className={TD}>
                      {statusTag(o)}
                      {o.confirmation.state === "DECLINED" && o.confirmation.reason && (
                        <span className="mt-1 block text-xs text-ink-500">
                          {o.confirmation.reason}
                        </span>
                      )}
                      {o.confirmation.state === "CONFIRMED" && o.cosigned_by && (
                        <span className="mt-1 block text-xs text-ink-500">
                          Approved by {o.cosigned_by}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {o.prescribed_by}
                      <span className="block text-xs text-ink-500">
                        {formatDateTime(o.prescribed_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="PRN given — last 14 days" bodyClassName="">
        {state.prn_given.length === 0 ? (
          <p className="p-[18px] text-[13px] text-ink-500">
            No PRN doses were given in the last 14 days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[720px]`}>
              <thead>
                <tr>
                  <th className={TH}>Given</th>
                  <th className={TH}>Medication</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Effect</th>
                  <th className={TH}>Given by</th>
                </tr>
              </thead>
              <tbody>
                {state.prn_given.map((d) => (
                  <tr key={d.id}>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(d.given_at)}</td>
                    <td className={TD}>
                      <strong>{d.drug || "—"}</strong>
                      <span className="block text-xs text-ink-500">
                        {[d.dose, d.route].filter(Boolean).join(" ")}
                      </span>
                      {d.over_max_reason && (
                        <span className="mt-1 block text-xs text-priority-orange">
                          Over the 24 h maximum: {d.over_max_reason}
                        </span>
                      )}
                    </td>
                    <td className={TD}>{d.reason || "—"}</td>
                    <td className={TD}>
                      {d.effect || <span className="text-ink-500">Not yet recorded</span>}
                    </td>
                    <td className={TD}>{d.given_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          {showHistory ? "Hide medication history" : "Show medication history"}
        </button>
        {showHistory && (
          <div className="mt-3">
            <MedsSection
              patientId={patientId}
              source="Psychiatry"
              onListChanged={() => undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** One order waiting for the psychiatrist. Approve confirms it (it becomes
 * administerable); Decline needs a reason, shown to the nurse who placed it. */
function AwaitingOrder({
  patientId,
  order: o,
  onDone,
  onError,
}: {
  patientId: string;
  order: Order;
  onDone: (state: PrescribingState) => void;
  onError: (message: string | null) => void;
}) {
  const { accessToken } = useAuth();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    if (!accessToken) return;
    setBusy(true);
    onError(null);
    try {
      onDone(await cosignPrescription(accessToken, o.id));
    } catch (e) {
      onError(errorText(e, "Couldn't approve the order."));
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    if (!accessToken || !o.confirmation.request_id) return;
    setBusy(true);
    onError(null);
    try {
      await decideCosign(accessToken, o.confirmation.request_id, "DECLINE", reason.trim());
      onDone(await getPrescribing(accessToken, patientId));
    } catch (e) {
      onError(errorText(e, "Couldn't decline the order."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-priority-orange/40 bg-priority-orange-tint/30 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink-900">
            {o.drug} <span className="font-medium text-ink-700">· {orderText(o)}</span>
          </p>
          {o.indication && <p className="text-[13px] text-ink-700">For: {o.indication}</p>}
          <p className="mt-1 text-xs text-ink-500">
            {typeLabel(o.order_type)} · placed by {o.prescribed_by},{" "}
            {formatDateTime(o.prescribed_at)}
            {o.order_type === "TELEPHONE" && o.authorised_by
              ? ` · given by phone by ${o.authorised_by}`
              : ""}
          </p>
        </div>
        {o.can_confirm ? (
          !declining && (
            <div className="flex gap-2">
              <button
                type="button"
                className={`${BTN} ${BTN_SM}`}
                disabled={busy}
                onClick={() => void approve()}
              >
                <Check aria-hidden className="h-4 w-4" /> Approve
              </button>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={busy || !o.confirmation.request_id}
                onClick={() => setDeclining(true)}
              >
                <X aria-hidden className="h-4 w-4" /> Decline
              </button>
            </div>
          )
        ) : (
          <span className="text-xs text-ink-500">
            {o.order_type === "TELEPHONE" && o.authorised_by
              ? `Only ${o.authorised_by} can confirm this order.`
              : "Waiting for a senior clinician."}
          </span>
        )}
      </div>
      {declining && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-[13px] font-medium text-ink-700">
            Reason for declining (shown to the nurse)
            <input
              className={`${INPUT} mt-1`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Use the regular dose; review tomorrow"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={busy || reason.trim().length < 5}
              onClick={() => void decline()}
            >
              Decline order
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setDeclining(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
