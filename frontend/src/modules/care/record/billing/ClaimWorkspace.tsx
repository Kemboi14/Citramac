import { useState, type ReactNode } from "react";
import { ApiError } from "../../../../lib/apiClient";
import {
  addClaimAttachment,
  createClaim,
  downloadBillingCsv,
  issueInvoice,
  recordClaimStatus,
  recordClientPayment,
  recordPreauthDecision,
  removeClaimAttachment,
  removeClaimLine,
  requestLinePreauth,
  submitClaim,
  updateClaimGuarantor,
  type BillingWorkspace,
  type ClaimLine,
  type PayerClaim,
} from "../../../../lib/claimsApi";
import { formatDateTime, newRequestId } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, Card, ErrorNote, Field, Tag } from "../../shared/ui";
import { printDocument } from "./billingPrint";
import { money, type Ask, type Run } from "./billingUtil";
import { Kv } from "./parts";
import { ShaAttachments, ShaClaimCard, ShaPreauthRequest, ShaSubmitForm } from "./ShaClaim";
import { ShaPanel } from "./ShaPanel";

// v4 mockup stageBilling()/billingExtras(): create claim from billable events,
// claim lines with payer codes, per-line pre-authorisation, finance review,
// Draft → Submitted → With payer → Adjudicated, minimum-necessary
// attachments, statement, invoice and payments. Every amount shown comes from
// the server; this file holds no rate, code or ceiling. SHA-payer clients add
// the SHA panel (eligibility, consented visits) and SHA's own claim flow
// through the DHA HIE (ShaPanel.tsx, ShaClaim.tsx).

const PAYER_STATUSES = [
  { value: "UNDER_REVIEW", label: "With payer (under review)" },
  { value: "APPROVED", label: "Approved" },
  { value: "PARTIALLY_APPROVED", label: "Partially approved" },
  { value: "REJECTED", label: "Rejected" },
];

function ClaimTimeline({ steps, stage }: { steps: string[]; stage: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[12px]" aria-label="Claim progress">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            aria-current={index === stage ? "step" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
              index <= stage
                ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                : "border-surface-border bg-surface-bg text-ink-500"
            }`}
          >
            <span className="font-mono">{index + 1}</span>
            {step}
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden className="text-ink-400">
              ›
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function lineStatus(line: ClaimLine): {
  label: string;
  tone: "brand" | "warn" | "risk" | "neutral";
} {
  const pa = line.pre_authorization;
  if (line.requires_preauth) {
    if (!pa) return { label: "Pre-auth needed", tone: "warn" };
    if (pa.status === "APPROVED" || pa.status === "PARTIALLY_APPROVED")
      return { label: `Pre-auth ${pa.approval_reference}`, tone: "brand" };
    if (pa.status === "REJECTED") return { label: "Pre-auth rejected", tone: "risk" };
    return { label: "Pre-auth requested", tone: "warn" };
  }
  return { label: "Ready", tone: "brand" };
}

function PreauthDecision({
  claim,
  line,
  run,
  accessToken,
}: {
  claim: PayerClaim;
  line: ClaimLine;
  run: Run;
  accessToken: string;
}) {
  const [decision, setDecision] = useState({ status: "", reference: "" });
  const pa = line.pre_authorization;
  if (!pa || pa.status !== "SUBMITTED" || claim.status !== "DRAFT") return null;
  const id = `pa-${line.id}`;
  return (
    <div className="mt-2 grid gap-1.5">
      <label className="sr-only" htmlFor={`${id}-status`}>
        Payer decision for {line.service}
      </label>
      <select
        id={`${id}-status`}
        className={INPUT}
        value={decision.status}
        onChange={(e) => setDecision((d) => ({ ...d, status: e.target.value }))}
      >
        <option value="">Payer decision…</option>
        <option value="APPROVED">Approved</option>
        <option value="PARTIALLY_APPROVED">Partially approved</option>
        <option value="REJECTED">Rejected</option>
      </select>
      {decision.status && decision.status !== "REJECTED" && (
        <>
          <label className="sr-only" htmlFor={`${id}-ref`}>
            Payer approval number
          </label>
          <input
            id={`${id}-ref`}
            className={INPUT}
            placeholder="Approval number as issued by the payer"
            value={decision.reference}
            onChange={(e) => setDecision((d) => ({ ...d, reference: e.target.value }))}
          />
        </>
      )}
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        disabled={!decision.status}
        onClick={() =>
          void run(
            () =>
              recordPreauthDecision(accessToken, pa.id, {
                status: decision.status,
                approval_reference: decision.reference,
              }),
            "Pre-authorisation decision recorded.",
          )
        }
      >
        Record decision
      </button>
    </div>
  );
}

function ClaimLines({
  claim,
  canEdit,
  run,
  accessToken,
}: {
  claim: PayerClaim;
  canEdit: boolean;
  run: Run;
  accessToken: string;
}) {
  const draft = claim.status === "DRAFT";
  const isSha = claim.payer === "SHA";
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-border">
      <table className={`${TABLE} min-w-[720px]`}>
        <thead>
          <tr>
            <th className={TH}>Delivered service</th>
            <th className={TH}>Payer code</th>
            <th className={`${TH} !text-right`}>Qty</th>
            <th className={`${TH} !text-right`}>Rate</th>
            <th className={`${TH} !text-right`}>Amount</th>
            <th className={TH}>Status</th>
            {isSha && <th className={TH}>On SHA claim</th>}
          </tr>
        </thead>
        <tbody>
          {claim.lines.map((line) => {
            const status = lineStatus(line);
            const canRequest =
              canEdit &&
              draft &&
              line.requires_preauth === true &&
              (!line.pre_authorization || line.pre_authorization.status === "REJECTED");
            return (
              <tr key={line.id}>
                <td className={TD}>{line.service}</td>
                <td className={TD}>
                  {line.payer_code ? (
                    <Tag>{line.payer_code}</Tag>
                  ) : (
                    <Tag tone="warn">Payer code not configured — VERIFY</Tag>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{line.quantity}</td>
                <td className={`${TD} text-right tabular-nums`}>{money(line.unit_price)}</td>
                <td className={`${TD} text-right font-semibold tabular-nums`}>
                  {money(line.amount)}
                </td>
                <td className={TD}>
                  <Tag tone={status.tone}>{status.label}</Tag>
                  {isSha && line.pre_authorization?.sha_state && (
                    <span className="mt-1 block text-[11px] text-ink-500">
                      SHA: {line.pre_authorization.sha_state}
                    </span>
                  )}
                  {line.requires_preauth === null && (
                    <span className="mt-1 block text-[11px] text-ink-500">
                      Pre-auth requirement unknown until the payer code is configured.
                    </span>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {canRequest && isSha && (
                      <ShaPreauthRequest
                        claim={claim}
                        line={line}
                        run={run}
                        accessToken={accessToken}
                      />
                    )}
                    {canRequest && !isSha && (
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() =>
                          void run(
                            () => requestLinePreauth(accessToken, claim.id, line.id),
                            "Pre-authorisation requested.",
                          )
                        }
                      >
                        Request pre-auth
                      </button>
                    )}
                    {canEdit && draft && claim.lines.length > 1 && (
                      <button
                        type="button"
                        className={`${BTN_GHOST} ${BTN_SM}`}
                        onClick={() =>
                          void run(
                            () => removeClaimLine(accessToken, claim.id, line.id),
                            `${line.service} removed from the claim — it stays billable to the client.`,
                          )
                        }
                      >
                        Remove from claim
                      </button>
                    )}
                  </div>
                  {canEdit && !isSha && (
                    <PreauthDecision
                      claim={claim}
                      line={line}
                      run={run}
                      accessToken={accessToken}
                    />
                  )}
                </td>
                {isSha && (
                  <td className={TD}>
                    {line.sent_to_sha ? <Tag tone="brand">Sent</Tag> : <Tag>Not sent yet</Tag>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Attachments({
  claim,
  workspace,
  canEdit,
  run,
  accessToken,
}: {
  claim: PayerClaim;
  workspace: BillingWorkspace;
  canEdit: boolean;
  run: Run;
  accessToken: string;
}) {
  const [category, setCategory] = useState("");
  const draft = claim.status === "DRAFT";
  const present = new Set(claim.attachments.map((a) => a.category));
  const available = workspace.attachment_categories.filter((c) => !present.has(c.value));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {claim.attachments.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1">
            <Tag tone="brand">{a.category}</Tag>
            {canEdit && draft && (
              <button
                type="button"
                className="text-[11px] font-semibold text-ink-500 underline-offset-2 hover:underline"
                aria-label={`Remove ${a.label} from the claim`}
                onClick={() => void run(() => removeClaimAttachment(accessToken, claim.id, a.id))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {workspace.excluded_attachment_categories.map((c) => (
          <span key={c} title="Never attached to a payer claim">
            <Tag tone="risk">
              <s>{c}</s>
            </Tag>
          </span>
        ))}
      </div>
      {canEdit && draft && available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add document" htmlFor={`attach-${claim.id}`} className="w-64">
            <select
              id={`attach-${claim.id}`}
              className={INPUT}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Choose a document…</option>
              {available.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            disabled={!category}
            onClick={async () => {
              if (await run(() => addClaimAttachment(accessToken, claim.id, category)))
                setCategory("");
            }}
          >
            Attach
          </button>
        </div>
      )}
    </div>
  );
}

function FinanceReview({
  claim,
  workspace,
  canEdit,
  run,
  ask,
  accessToken,
}: {
  claim: PayerClaim;
  workspace: BillingWorkspace;
  canEdit: boolean;
  run: Run;
  ask: Ask;
  accessToken: string;
}) {
  const [linesChecked, setLinesChecked] = useState(false);
  const [guarantor, setGuarantor] = useState(claim.guarantor);
  const [response, setResponse] = useState({ status: "", amount: "", note: "" });
  const draft = claim.status === "DRAFT";
  const adjudicated = claim.timeline_stage >= 3;
  const sha = claim.payer === "SHA" ? workspace.sha : null;
  const nextStatuses = PAYER_STATUSES.filter(
    (s) => claim.status === "SUBMITTED" || s.value !== "UNDER_REVIEW",
  );

  return (
    <Card title="Finance review before submission">
      <div className="grid gap-3">
        <ul className="grid gap-1.5">
          {claim.checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-[13px]">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                  item.ok
                    ? "bg-brand-green-tint text-brand-green"
                    : "bg-priority-red-tint text-priority-red"
                }`}
              >
                {item.ok ? "✓" : "✕"}
              </span>
              <span>
                <span className="font-semibold">{item.label}</span>
                <span className="sr-only">{item.ok ? " — done" : " — outstanding"}</span>
                <span className="block text-[12px] text-ink-500">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {draft && (
          <Field
            label="Guarantor (responsible adult) for any balance"
            htmlFor={`guarantor-${claim.id}`}
            hint="An acutely unwell person is not made responsible — record a guarantor (e.g. next of kin) or a waiver."
          >
            <div className="flex flex-wrap gap-2">
              <input
                id={`guarantor-${claim.id}`}
                className={`${INPUT} max-w-sm`}
                value={guarantor}
                disabled={!canEdit}
                onChange={(e) => setGuarantor(e.target.value)}
              />
              {canEdit && guarantor !== claim.guarantor && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() =>
                    void run(
                      () => updateClaimGuarantor(accessToken, claim.id, guarantor),
                      "Guarantor saved.",
                    )
                  }
                >
                  Save guarantor
                </button>
              )}
            </div>
          </Field>
        )}

        {draft ? (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="h-[17px] w-[17px] accent-[var(--green)]"
                checked={linesChecked}
                disabled={!canEdit}
                onChange={(e) => setLinesChecked(e.target.checked)}
              />
              I have checked that every line matches documented care
            </label>
            <div>
              {sha ? (
                <ShaSubmitForm
                  claim={claim}
                  sha={sha}
                  canEdit={canEdit}
                  linesChecked={linesChecked}
                  run={run}
                  ask={ask}
                  accessToken={accessToken}
                />
              ) : (
                <button
                  type="button"
                  className={BTN}
                  disabled={!canEdit}
                  onClick={() =>
                    void run(
                      () => submitClaim(accessToken, claim.id, linesChecked),
                      "Claim submitted.",
                    )
                  }
                >
                  Submit claim
                </button>
              )}
              {!canEdit && (
                <p className="mt-1.5 text-[12px] text-ink-500">
                  Only finance staff can submit claims. You can view this claim.
                </p>
              )}
            </div>
          </>
        ) : (
          <Callout tone="success">
            Submitted {formatDateTime(claim.submitted_at)} as{" "}
            <span className="font-mono">{claim.claim_number}</span>.
          </Callout>
        )}

        {claim.status_history.length > 0 && (
          <ol className="grid gap-1 text-[12px] text-ink-700" aria-label="Claim status history">
            {claim.status_history.map((h, index) => (
              <li key={index}>
                <span className="font-mono text-ink-500">{formatDateTime(h.at)}</span> ·{" "}
                <span className="font-semibold">{h.status.replace(/_/g, " ").toLowerCase()}</span>
                {h.by && ` · ${h.by}`}
                {h.note && ` — ${h.note}`}
              </li>
            ))}
          </ol>
        )}

        {sha && claim.sha_visit && !draft && (
          <p className="text-[12px] text-ink-500">
            SHA posts its own decisions on this claim — use “Refresh from SHA” above for the latest.
            They are never typed in here.
          </p>
        )}

        {canEdit && !draft && !adjudicated && !(sha && claim.sha_visit) && (
          <div className="grid gap-2 rounded-lg border border-surface-border bg-surface-bg p-3">
            <p className="text-[12px] text-ink-500">
              This payer has no electronic connection, so the payer’s response is recorded here from
              the payer’s own notice.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Payer response" htmlFor={`resp-${claim.id}`} className="w-56">
                <select
                  id={`resp-${claim.id}`}
                  className={INPUT}
                  value={response.status}
                  onChange={(e) => setResponse((r) => ({ ...r, status: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {nextStatuses.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {(response.status === "APPROVED" || response.status === "PARTIALLY_APPROVED") && (
                <Field label="Approved amount (KES)" htmlFor={`amt-${claim.id}`} className="w-44">
                  <input
                    id={`amt-${claim.id}`}
                    className={INPUT}
                    inputMode="decimal"
                    value={response.amount}
                    onChange={(e) => setResponse((r) => ({ ...r, amount: e.target.value }))}
                  />
                </Field>
              )}
              <Field label="Note" htmlFor={`note-${claim.id}`} className="w-64">
                <input
                  id={`note-${claim.id}`}
                  className={INPUT}
                  value={response.note}
                  onChange={(e) => setResponse((r) => ({ ...r, note: e.target.value }))}
                />
              </Field>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                disabled={!response.status}
                onClick={async () => {
                  const ok = await run(
                    () =>
                      recordClaimStatus(accessToken, claim.id, {
                        status: response.status,
                        approved_amount: response.amount || undefined,
                        note: response.note,
                      }),
                    "Payer response recorded.",
                  );
                  if (ok) setResponse({ status: "", amount: "", note: "" });
                }}
              >
                Record response
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PayerClaimTab({
  workspace,
  run,
  ask,
  accessToken,
  patientId,
}: {
  workspace: BillingWorkspace;
  run: Run;
  ask: Ask;
  accessToken: string;
  patientId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const claim = workspace.claims.find((c) => c.id === selectedId) ?? workspace.claims[0];
  if (!claim) {
    return (
      <p className="text-[13px] text-ink-500">
        No payer claim yet.{" "}
        {workspace.can_edit && workspace.payer.claimable
          ? "Use “Create claim” to draft one from the documented services."
          : workspace.payer.claimable
            ? "Finance staff create claims from the documented services."
            : "This client has no payer to claim from — use the invoice and payments."}
      </p>
    );
  }
  const held = claim.lines
    .filter(
      (l) =>
        l.requires_preauth &&
        !(
          l.pre_authorization &&
          ["APPROVED", "PARTIALLY_APPROVED"].includes(l.pre_authorization.status)
        ),
    )
    .reduce((sum, l) => sum + Number(l.amount), 0);
  const primary = claim.diagnoses.find((d) => d.is_primary) ?? claim.diagnoses[0];
  const diagnosisItem = claim.checklist.find((i) => i.key === "diagnosis");
  const sha = claim.payer === "SHA" ? workspace.sha : null;

  return (
    <div className="grid gap-4">
      {workspace.claims.length > 1 && (
        <Field label="Claim" htmlFor="claim-select" className="w-72">
          <select
            id="claim-select"
            className={INPUT}
            value={claim.id}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {workspace.claims.map((c) => (
              <option key={c.id} value={c.id}>
                {c.claim_number} · {c.status_label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {sha && (
        <ShaClaimCard
          key={claim.id}
          claim={claim}
          sha={sha}
          canEdit={workspace.can_edit}
          run={run}
          ask={ask}
          accessToken={accessToken}
        />
      )}
      <ClaimLines claim={claim} canEdit={workspace.can_edit} run={run} accessToken={accessToken} />
      <Kv
        rows={[
          ["Claim total", money(claim.total_claimed_amount)],
          ...(held > 0
            ? ([["Held — awaiting pre-auth", money(held)]] as [ReactNode, ReactNode][])
            : []),
          ...(claim.approved_amount != null
            ? ([["Approved by payer", money(claim.approved_amount)]] as [ReactNode, ReactNode][])
            : []),
          ["Client / guarantor (all services)", money(workspace.totals.outstanding)],
        ]}
      />
      <Card title="Payer claim · eClaims">
        <div className="grid gap-3">
          <Kv
            rows={[
              [
                "Claim reference",
                <span key="ref" className="font-mono">
                  {claim.claim_number}
                </span>,
              ],
              ["Payer", workspace.payer.label],
              [
                "Primary diagnosis (code only)",
                primary ? (
                  <span className="font-mono">ICD-11 {primary.code}</span>
                ) : diagnosisItem?.ok ? (
                  diagnosisItem.detail
                ) : (
                  <Tag tone="risk">None recorded — clinician must record at intake</Tag>
                ),
              ],
              [
                "Attachments (minimum necessary)",
                sha ? (
                  <ShaAttachments
                    key={`attachments-${claim.id}`}
                    claim={claim}
                    workspace={workspace}
                    sha={sha}
                    canEdit={workspace.can_edit}
                    run={run}
                    accessToken={accessToken}
                    patientId={patientId}
                  />
                ) : (
                  <Attachments
                    key="attachments"
                    claim={claim}
                    workspace={workspace}
                    canEdit={workspace.can_edit}
                    run={run}
                    accessToken={accessToken}
                  />
                ),
              ],
            ]}
          />
          <Callout>
            Treatment plans are attached as a summary; therapy and process notes and trauma history
            are never attached. Payer codes come only from the facility’s configured payer tariff. A
            package ceiling and emergency-fund routing are not applied — neither is configured
            (VERIFY against the payer’s benefit schedule).
          </Callout>
          <ClaimTimeline steps={workspace.timeline} stage={claim.timeline_stage} />
        </div>
      </Card>
      <FinanceReview
        key={claim.id}
        claim={claim}
        workspace={workspace}
        canEdit={workspace.can_edit}
        run={run}
        ask={ask}
        accessToken={accessToken}
      />
    </div>
  );
}

function InvoiceTab({
  workspace,
  patientLabel,
  run,
  accessToken,
  patientId,
}: {
  workspace: BillingWorkspace;
  patientLabel: string;
  run: Run;
  accessToken: string;
  patientId: string;
}) {
  const [payment, setPayment] = useState({
    amount: "",
    method: "",
    reference: "",
    claim: "",
    key: newRequestId(),
  });
  const canEdit = workspace.can_edit;
  const invoice = workspace.invoice;
  const remittable = workspace.claims.filter(
    (c) => c.status !== "DRAFT" && c.status !== "REJECTED",
  );

  if (!invoice) {
    return (
      <div className="grid gap-2">
        <p className="text-[13px] text-ink-500">No invoice has been generated yet.</p>
        <div>
          <button
            type="button"
            className={BTN}
            disabled={!canEdit || workspace.overview.events.length === 0}
            onClick={() =>
              void run(() => issueInvoice(accessToken, patientId), "Invoice generated.")
            }
          >
            Generate invoice
          </button>
        </div>
      </div>
    );
  }

  const printInvoice = () =>
    printDocument({
      title: `Invoice ${invoice.number}`,
      meta: [patientLabel, `Payer: ${workspace.payer.label}`, formatDateTime(invoice.created_at)],
      columns: [
        { label: "Service" },
        { label: "Qty", numeric: true },
        { label: "Amount", numeric: true },
      ],
      rows: invoice.lines.map((l) => [l.service, String(l.quantity), money(l.amount)]),
      summary: [
        ["Total", money(invoice.total)],
        ["Paid (all payments)", money(workspace.totals.paid)],
        ["Outstanding balance", money(workspace.totals.outstanding)],
      ],
    });

  const methodNeedsReference = payment.method === "MPESA" || payment.method === "INSURANCE";

  return (
    <div className="grid gap-4">
      <Kv
        rows={[
          [
            "Invoice",
            <span key="invoice" className="font-mono">
              {invoice.number} · {formatDateTime(invoice.created_at)}
            </span>,
          ],
          ["Total", money(invoice.total)],
          ["Paid", money(workspace.totals.paid)],
          [
            "Outstanding balance",
            <span
              key="balance"
              className={
                Number(workspace.totals.outstanding) > 0 ? "text-priority-red" : "text-brand-green"
              }
            >
              {money(workspace.totals.outstanding)}
            </span>,
          ],
        ]}
      />
      {invoice.stale && (
        <Callout tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Documented services changed since {invoice.number}.</span>
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={!canEdit}
              onClick={() =>
                void run(() => issueInvoice(accessToken, patientId), "Invoice re-issued.")
              }
            >
              Re-issue invoice
            </button>
          </div>
        </Callout>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={printInvoice}>
          Preview / print invoice
        </button>
      </div>

      {canEdit && (
        <form
          className="grid gap-2 rounded-lg border border-surface-border p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(
              () =>
                recordClientPayment(accessToken, patientId, {
                  amount: payment.amount,
                  method: payment.method,
                  reference: payment.reference,
                  claim: payment.method === "INSURANCE" ? payment.claim : undefined,
                  idempotency_key: payment.key,
                }),
              "Payment recorded.",
            );
            if (ok)
              setPayment({ amount: "", method: "", reference: "", claim: "", key: newRequestId() });
          }}
        >
          <h3 className="text-[13px] font-bold text-ink-900">Record payment</h3>
          <div className="grid gap-2 min-[700px]:grid-cols-4">
            <Field label="Amount (KES)" htmlFor="pay-amount">
              <input
                id="pay-amount"
                className={INPUT}
                inputMode="decimal"
                required
                value={payment.amount}
                onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
              />
            </Field>
            <Field label="Paid by / method" htmlFor="pay-method">
              <select
                id="pay-method"
                className={INPUT}
                required
                value={payment.method}
                onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}
              >
                <option value="">Choose…</option>
                {workspace.payment_methods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {payment.method === "INSURANCE" && (
              <Field label="Claim paid" htmlFor="pay-claim">
                <select
                  id="pay-claim"
                  className={INPUT}
                  required
                  value={payment.claim}
                  onChange={(e) => setPayment((p) => ({ ...p, claim: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {remittable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.claim_number}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label="Reference"
              htmlFor="pay-ref"
              hint={
                payment.method === "MPESA"
                  ? "M-Pesa transaction code"
                  : payment.method === "INSURANCE"
                    ? "Payer remittance number"
                    : undefined
              }
            >
              <input
                id="pay-ref"
                className={INPUT}
                required={methodNeedsReference}
                value={payment.reference}
                onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
              />
            </Field>
          </div>
          <div>
            <button type="submit" className={`${BTN} ${BTN_SM}`}>
              Record payment
            </button>
          </div>
        </form>
      )}

      {workspace.payments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className={`${TABLE} min-w-[600px]`}>
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Method</th>
                <th className={TH}>Reference</th>
                <th className={`${TH} !text-right`}>Amount</th>
                <th className={TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {workspace.payments.map((p) => (
                <tr key={p.id}>
                  <td className={TD}>{formatDateTime(p.paid_at)}</td>
                  <td className={TD}>{p.method_label}</td>
                  <td className={TD}>{p.reference || "—"}</td>
                  <td className={`${TD} text-right tabular-nums`}>{money(p.amount)}</td>
                  <td className={TD}>{p.received_by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Area = "top" | "sha" | "claim";

export function ClaimWorkspace({
  workspace,
  onChange,
  accessToken,
  patientId,
  patientLabel,
}: {
  workspace: BillingWorkspace;
  onChange: (next: BillingWorkspace) => void;
  accessToken: string;
  patientId: string;
  patientLabel: string;
}) {
  const [tab, setTab] = useState<"claim" | "invoice">("claim");
  const [busy, setBusy] = useState(false);
  // Outcome of the last action, shown next to the part of the screen it came
  // from (the SHA panel and the claim card are far apart).
  const [feedback, setFeedback] = useState<{
    area: Area;
    error: string | null;
    notice: string | null;
  }>({ area: "top", error: null, notice: null });
  const setError = (error: string | null, area: Area = "top") =>
    setFeedback({ area, error, notice: null });

  const runner = (area: Area): { run: Run; ask: Ask } => ({
    run: async (action, success) => {
      if (busy) return false;
      setBusy(true);
      setFeedback({ area, error: null, notice: null });
      try {
        onChange(await action());
        if (success) setFeedback({ area, error: null, notice: success });
        return true;
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "That could not be saved. Try again.",
          area,
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    ask: async (action, success) => {
      if (busy) return null;
      setBusy(true);
      setFeedback({ area, error: null, notice: null });
      try {
        const result = await action();
        const message = success?.(result);
        if (message) setFeedback({ area, error: null, notice: message });
        return result;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "That request failed. Try again.", area);
        return null;
      } finally {
        setBusy(false);
      }
    },
  });
  const top = runner("top");
  const shaArea = runner("sha");
  const claimArea = runner("claim");
  const run = top.run;

  const feedbackFor = (area: Area) =>
    feedback.area === area ? (
      <>
        {feedback.notice && (
          <Callout tone="success" role="status">
            {feedback.notice}
          </Callout>
        )}
        <ErrorNote>{feedback.error}</ErrorNote>
      </>
    ) : null;

  const draft = workspace.claims.find((c) => c.status === "DRAFT");
  const canCreate =
    workspace.can_edit && workspace.payer.claimable && workspace.unclaimed_charges.length > 0;
  const preauthSummary = (() => {
    const lines = workspace.claims.flatMap((c) => c.lines);
    const approved = lines
      .map((l) => l.pre_authorization)
      .filter((p) => p && ["APPROVED", "PARTIALLY_APPROVED"].includes(p.status))
      .map((p) => p!.approval_reference);
    if (approved.length) return `Approved · ${approved.join(", ")}`;
    if (lines.some((l) => l.requires_preauth)) return "Required · pending";
    if (lines.some((l) => l.requires_preauth === null))
      return "Unknown — payer codes not configured";
    return "Not required";
  })();

  const printStatement = () =>
    printDocument({
      title: "Statement (INS-08)",
      meta: [
        patientLabel,
        `Payer: ${workspace.payer.label}`,
        formatDateTime(new Date().toISOString()),
      ],
      columns: [
        { label: "Service" },
        { label: "Date" },
        { label: "Amount", numeric: true },
        { label: "Status" },
      ],
      rows: [...workspace.overview.events]
        .sort((a, b) => a.delivered_at.localeCompare(b.delivered_at))
        .map((e) => [e.service, formatDateTime(e.delivered_at), money(e.amount), e.status]),
      summary: [
        ["Total services", money(workspace.totals.services)],
        ["Unbilled", money(workspace.overview.summary.unbilled.amount)],
        ["Claimed (unpaid)", money(workspace.overview.summary.claimed.amount)],
        ["Paid", money(workspace.totals.paid)],
        ["Outstanding", money(workspace.totals.outstanding)],
      ],
    });

  const exportCsv = async () => {
    setError(null);
    try {
      const blob = await downloadBillingCsv(accessToken, patientId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `billing-${patientId}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The export could not be downloaded.");
    }
  };

  return (
    <div className="grid gap-4" aria-busy={busy}>
      <div className="grid gap-4 min-[1000px]:grid-cols-[1fr_300px]">
        <div className="flex flex-wrap items-start gap-2">
          {workspace.can_edit && (
            <button
              type="button"
              className={BTN_GHOST}
              disabled={!canCreate || busy}
              title={
                !workspace.payer.claimable
                  ? "This client has no payer to claim from"
                  : workspace.unclaimed_charges.length === 0
                    ? "Every priced service is already on a claim"
                    : undefined
              }
              onClick={async () => {
                if (
                  await run(
                    () => createClaim(accessToken, patientId),
                    draft ? "Services added to the draft claim." : "Claim created.",
                  )
                )
                  setTab("claim");
              }}
            >
              {draft ? "Add services to draft claim" : "Create claim"}
            </button>
          )}
          <button type="button" className={BTN_GHOST} onClick={printStatement}>
            Statement (INS-08)
          </button>
          {workspace.can_edit && (
            <button type="button" className={BTN_GHOST} onClick={() => void exportCsv()}>
              Export CSV
            </button>
          )}
        </div>
        <Card title="Payer">
          <Kv
            rows={[
              ["Scheme", workspace.payer.label],
              [
                "Coverage",
                workspace.payer.coverage
                  ? `${workspace.payer.coverage.scheme}${workspace.payer.coverage.verified ? " · verified" : " · not verified"}`
                  : "Not recorded",
              ],
              ["Pre-authorisation", preauthSummary],
            ]}
          />
        </Card>
      </div>
      <Callout>
        Billing follows services already documented: care-plan action → intervention → billable
        event → charge → claim → payment.
        {!workspace.can_edit && " You have view-only access to billing."}
      </Callout>

      {feedbackFor("top")}

      {workspace.sha && (
        <div className="grid gap-2">
          <ShaPanel
            sha={workspace.sha}
            canEdit={workspace.can_edit}
            busy={busy}
            run={shaArea.run}
            ask={shaArea.ask}
            accessToken={accessToken}
            patientId={patientId}
            onChange={onChange}
          />
          {feedbackFor("sha")}
        </div>
      )}

      <Card title="Claim and invoice details" bodyClassName="p-[18px] grid gap-4">
        <div role="tablist" aria-label="Billing details" className="flex gap-1.5">
          {(
            [
              ["claim", "Payer claim"],
              ["invoice", "Invoice & payments"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${
                tab === key
                  ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                  : "border-surface-border bg-surface-card text-ink-700"
              }`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {feedbackFor("claim")}
        <div role="tabpanel">
          {tab === "claim" ? (
            <PayerClaimTab
              workspace={workspace}
              run={claimArea.run}
              ask={claimArea.ask}
              accessToken={accessToken}
              patientId={patientId}
            />
          ) : (
            <InvoiceTab
              workspace={workspace}
              patientLabel={patientLabel}
              run={claimArea.run}
              accessToken={accessToken}
              patientId={patientId}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
