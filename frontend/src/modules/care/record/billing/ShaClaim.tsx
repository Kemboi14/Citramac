import { useEffect, useState } from "react";
import { ApiError } from "../../../../lib/apiClient";
import { listAttachments, type Attachment } from "../../../../lib/attachmentsApi";
import {
  addClaimAttachment,
  billClaimAgainstVisit,
  previewShaClaim,
  refreshShaClaim,
  removeClaimAttachment,
  requestLinePreauth,
  resubmitShaClaim,
  sendShaDischargeOtp,
  submitClaim,
  syncShaClaim,
  type BillingWorkspace,
  type ClaimLine,
  type PayerClaim,
  type ShaSection,
} from "../../../../lib/claimsApi";
import { formatDate } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, Card, Field, Tag } from "../../shared/ui";
import { shaDocumentsEditable, type Ask, type Run } from "./billingUtil";
import { Kv, RawJson } from "./parts";
import { ShaVisitSummary } from "./ShaPanel";

// SHA claim pieces for the Payer claim tab: the consented visit the claim is
// billed against, pushing lines/diagnoses/documents to SHA, SHA's preview and
// payer status, labelled documents, SHA pre-authorisation and the discharge
// that dispatches the claim. SHA posts its own decisions — none is typed in.

export function ShaClaimCard({
  claim,
  sha,
  canEdit,
  run,
  ask,
  accessToken,
}: {
  claim: PayerClaim;
  sha: ShaSection;
  canEdit: boolean;
  run: Run;
  ask: Ask;
  accessToken: string;
}) {
  const [visitId, setVisitId] = useState("");
  const [preview, setPreview] = useState<{ value: unknown } | null>(null);
  const visit = claim.sha_visit;
  const draft = claim.status === "DRAFT";
  const openVisits = sha.visits.filter((v) => v.status === "OPEN" && v.id !== visit?.id);
  const canBind = canEdit && draft && (!visit || visit.status !== "OPEN");

  return (
    <Card title="SHA visit for this claim">
      <div className="grid gap-3">
        {visit ? (
          <ShaVisitSummary visit={visit} />
        ) : (
          <p className="text-[13px] text-ink-500">
            Not billed against an SHA visit yet. Every SHA claim belongs to a visit opened with the
            client’s consent.
          </p>
        )}
        {canBind &&
          (openVisits.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Bill against visit" htmlFor={`bind-${claim.id}`} className="w-80">
                <select
                  id={`bind-${claim.id}`}
                  className={INPUT}
                  value={visitId}
                  onChange={(e) => setVisitId(e.target.value)}
                >
                  <option value="">Choose an open visit…</option>
                  {openVisits.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.branch.name} · {v.service_type} · {v.intervention_codes.join(", ")}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM} mb-[2px]`}
                disabled={!visitId}
                onClick={async () => {
                  if (
                    await run(
                      () => billClaimAgainstVisit(accessToken, claim.id, visitId),
                      "Claim billed against the SHA visit.",
                    )
                  )
                    setVisitId("");
                }}
              >
                Bill against this visit
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-500">
              No open SHA visit — open one in the SHA panel above while the client is present.
            </p>
          ))}

        {visit && (
          <>
            {visit.payer_workflow_state && (
              <Kv
                rows={[["SHA payer workflow", <Tag key="pws">{visit.payer_workflow_state}</Tag>]]}
              />
            )}
            {claim.status === "RETURNED" && (
              <Callout tone="warning">
                SHA returned this claim — the reason is in the claim history below. Fix what SHA
                asks for (documents or lines), push the changes to SHA, then resubmit.
              </Callout>
            )}
            <div className="flex flex-wrap gap-2">
              {canEdit && shaDocumentsEditable(claim) && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() =>
                    void run(
                      () => syncShaClaim(accessToken, claim.id),
                      "Lines, diagnoses and documents pushed to SHA.",
                    )
                  }
                >
                  Push to SHA now
                </button>
              )}
              <button
                type="button"
                className={`${BTN_GHOST} ${BTN_SM}`}
                onClick={async () => {
                  const result = await ask(() => previewShaClaim(accessToken, claim.id));
                  if (result) setPreview({ value: result.preview });
                }}
              >
                Preview
              </button>
              {!draft && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() =>
                    void run(
                      () => refreshShaClaim(accessToken, claim.id),
                      "Claim and pre-authorisation status refreshed from SHA.",
                    )
                  }
                >
                  Refresh from SHA
                </button>
              )}
              {canEdit && claim.status === "RETURNED" && (
                <button
                  type="button"
                  className={`${BTN} ${BTN_SM}`}
                  onClick={() =>
                    void run(
                      () => resubmitShaClaim(accessToken, claim.id),
                      "Claim resubmitted to SHA.",
                    )
                  }
                >
                  Resubmit
                </button>
              )}
            </div>
            {preview && (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-ink-500">
                    SHA’s preview of this claim, exactly as SHA returned it.
                  </span>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-ink-500 underline-offset-2 hover:underline"
                    onClick={() => setPreview(null)}
                  >
                    Hide preview
                  </button>
                </div>
                <RawJson value={preview.value} label="SHA claim preview" />
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function fileLabel(a: Attachment) {
  const name = a.file.split("?")[0].split("/").pop() || "Document";
  const kind = a.document_type || a.category;
  return `${kind} · ${decodeURIComponent(name)}${a.document_date ? ` · ${formatDate(a.document_date)}` : ""}`;
}

export function ShaAttachments({
  claim,
  workspace,
  sha,
  canEdit,
  run,
  accessToken,
  patientId,
}: {
  claim: PayerClaim;
  workspace: BillingWorkspace;
  sha: ShaSection;
  canEdit: boolean;
  run: Run;
  accessToken: string;
  patientId: string;
}) {
  const editable = canEdit && shaDocumentsEditable(claim);
  const [filed, setFiled] = useState<{ items: Attachment[] | null; error: string | null }>({
    items: null,
    error: null,
  });
  const [form, setForm] = useState({ category: "", file: "", docType: "", intervention: "" });

  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    listAttachments(accessToken, { patient: patientId, status: "ACTIVE" })
      .then((page) => !cancelled && setFiled({ items: page.results, error: null }))
      .catch(
        (err) =>
          !cancelled &&
          setFiled({
            items: null,
            error:
              err instanceof ApiError
                ? err.message
                : "The client’s filed documents could not be loaded.",
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, patientId, editable]);

  const required = new Set(
    (claim.sha_visit?.interventions ?? []).flatMap((i) => i.applicable_document_types),
  );
  const missing = new Set(claim.sha_missing_documents);
  const lockedCategories = new Set(
    claim.attachments.filter((a) => a.sent_to_sha).map((a) => a.category),
  );
  const categories = workspace.attachment_categories.filter((c) => !lockedCategories.has(c.value));
  const docTypes = [
    ...sha.document_types.filter((t) => required.has(t)),
    ...sha.document_types.filter((t) => !required.has(t)),
  ];

  return (
    <div className="grid gap-2">
      {claim.sha_missing_documents.length > 0 && (
        <Callout tone="warning">
          SHA requires these documents for the visit’s interventions:{" "}
          {claim.sha_missing_documents.map((d) => (
            <span key={d} className="mr-1">
              <Tag tone="warn">{d}</Tag>
            </span>
          ))}
        </Callout>
      )}
      {claim.attachments.length > 0 ? (
        <ul className="grid gap-1.5">
          {claim.attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <Tag tone="brand">{a.category}</Tag>
              {a.file ? <span>{a.file.name}</span> : <Tag tone="warn">No file chosen</Tag>}
              {a.sha_document_type ? (
                <Tag>{a.sha_document_type}</Tag>
              ) : (
                <Tag tone="warn">No SHA document type</Tag>
              )}
              {a.intervention_code && <span className="font-mono">{a.intervention_code}</span>}
              {a.sent_to_sha ? <Tag tone="brand">On SHA claim</Tag> : <Tag>Not sent yet</Tag>}
              {editable && (
                <button
                  type="button"
                  className="text-[11px] font-semibold text-ink-500 underline-offset-2 hover:underline"
                  aria-label={`Remove ${a.label} from the claim`}
                  onClick={() => void run(() => removeClaimAttachment(accessToken, claim.id, a.id))}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-500">No documents on this claim yet.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {workspace.excluded_attachment_categories.map((c) => (
          <span key={c} title="Never attached to a payer claim">
            <Tag tone="risk">
              <s>{c}</s>
            </Tag>
          </span>
        ))}
      </div>
      {editable && (
        <form
          className="grid gap-2 rounded-lg border border-surface-border bg-surface-bg p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(
              () =>
                addClaimAttachment(accessToken, claim.id, form.category, {
                  file: form.file,
                  sha_document_type: form.docType,
                  intervention_code: form.intervention || undefined,
                }),
              "Document added — it goes to SHA with the next push.",
            );
            if (ok) setForm({ category: "", file: "", docType: "", intervention: "" });
          }}
        >
          <div className="grid gap-2 min-[700px]:grid-cols-2">
            <Field label="Category" htmlFor={`sa-cat-${claim.id}`}>
              <select
                id={`sa-cat-${claim.id}`}
                className={INPUT}
                required
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Client’s filed document"
              htmlFor={`sa-file-${claim.id}`}
              error={filed.error ?? undefined}
              hint={
                filed.items && filed.items.length === 0
                  ? "No documents are filed for this client — file the document in their record first."
                  : undefined
              }
            >
              <select
                id={`sa-file-${claim.id}`}
                className={INPUT}
                required
                value={form.file}
                disabled={!filed.items}
                onChange={(e) => setForm((f) => ({ ...f, file: e.target.value }))}
              >
                <option value="">{filed.items ? "Choose…" : "Loading…"}</option>
                {(filed.items ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {fileLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="SHA document type" htmlFor={`sa-type-${claim.id}`}>
              <select
                id={`sa-type-${claim.id}`}
                className={INPUT}
                required
                value={form.docType}
                onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}
              >
                <option value="">Choose…</option>
                {docTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {missing.has(t) ? " — required, missing" : required.has(t) ? " — required" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {claim.sha_visit && claim.sha_visit.interventions.length > 1 && (
              <Field label="For intervention (optional)" htmlFor={`sa-iv-${claim.id}`}>
                <select
                  id={`sa-iv-${claim.id}`}
                  className={INPUT}
                  value={form.intervention}
                  onChange={(e) => setForm((f) => ({ ...f, intervention: e.target.value }))}
                >
                  <option value="">The whole visit</option>
                  {claim.sha_visit.interventions.map((i) => (
                    <option key={i.code} value={i.code}>
                      {i.code} {i.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div>
            <button
              type="submit"
              className={`${BTN_GHOST} ${BTN_SM}`}
              disabled={!form.category || !form.file || !form.docType}
            >
              Attach
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ShaPreauthRequest({
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
  const [form, setForm] = useState({ open: false, start: "", end: "", email: "" });
  if (!form.open) {
    return (
      <button
        type="button"
        className={`${BTN_GHOST} ${BTN_SM}`}
        onClick={() => setForm((f) => ({ ...f, open: true }))}
      >
        Request pre-auth from SHA
      </button>
    );
  }
  const id = `sha-pa-${line.id}`;
  return (
    <form
      className="mt-1 grid w-full gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          () =>
            requestLinePreauth(accessToken, claim.id, line.id, {
              service_start: new Date(form.start).toISOString(),
              service_end: new Date(form.end).toISOString(),
              notification_email: form.email.trim(),
            }),
          "Pre-authorisation requested from SHA.",
        );
        if (ok) setForm({ open: false, start: "", end: "", email: "" });
      }}
    >
      <Field label="Service starts" htmlFor={`${id}-start`}>
        <input
          id={`${id}-start`}
          type="datetime-local"
          className={INPUT}
          required
          value={form.start}
          onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
        />
      </Field>
      <Field label="Service ends" htmlFor={`${id}-end`}>
        <input
          id={`${id}-end`}
          type="datetime-local"
          className={INPUT}
          required
          min={form.start || undefined}
          value={form.end}
          onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
        />
      </Field>
      <Field label="Email SHA notifies" htmlFor={`${id}-email`}>
        <input
          id={`${id}-email`}
          type="email"
          className={INPUT}
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </Field>
      <div className="flex gap-1.5">
        <button type="submit" className={`${BTN_GHOST} ${BTN_SM}`}>
          Send to SHA
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          onClick={() => setForm({ open: false, start: "", end: "", email: "" })}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Submission for an SHA claim: the visit's discharge, authorised by the
 * client's discharge OTP or a fingerprint discharge authorisation. */
export function ShaSubmitForm({
  claim,
  sha,
  canEdit,
  linesChecked,
  run,
  ask,
  accessToken,
}: {
  claim: PayerClaim;
  sha: ShaSection;
  canEdit: boolean;
  linesChecked: boolean;
  run: Run;
  ask: Ask;
  accessToken: string;
}) {
  const visit = claim.sha_visit;
  const inpatient = visit?.service_type === "INPATIENT";
  const reasons = inpatient ? sha.inpatient_discharge_reasons : sha.outpatient_discharge_reasons;
  const [form, setForm] = useState({
    reason: "",
    authorisation: "OTP" as "OTP" | "FINGERPRINT",
    otp: "",
    guid: "",
    status: "FULL" as "FULL" | "PARTIAL",
    notes: "",
  });
  const id = `sha-submit-${claim.id}`;
  const authorised = form.authorisation === "OTP" ? form.otp.trim() : form.guid.trim();

  if (!visit || visit.status !== "OPEN") {
    return (
      <p className="text-[12.5px] text-ink-500">
        Bill this claim against an open SHA visit before submitting it.
      </p>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-surface-border p-3">
      <h4 className="text-[13px] font-bold text-ink-900">
        Discharge and submit to SHA ({inpatient ? "inpatient" : "outpatient"} visit)
      </h4>
      <div className="grid gap-2 min-[700px]:grid-cols-2">
        <Field label="Discharge reason (SHA’s list)" htmlFor={`${id}-reason`}>
          <select
            id={`${id}-reason`}
            className={INPUT}
            value={form.reason}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          >
            <option value="">Choose…</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        {!inpatient && (
          <Field label="Discharge" htmlFor={`${id}-status`}>
            <select
              id={`${id}-status`}
              className={INPUT}
              value={form.status}
              disabled={!canEdit}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as "FULL" | "PARTIAL" }))
              }
            >
              <option value="FULL">FULL</option>
              <option value="PARTIAL">PARTIAL</option>
            </select>
          </Field>
        )}
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Client’s discharge authorisation
        </legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name={`${id}-auth`}
            className="accent-[var(--green)]"
            checked={form.authorisation === "OTP"}
            disabled={!canEdit}
            onChange={() => setForm((f) => ({ ...f, authorisation: "OTP" }))}
          />
          Discharge OTP sent to the client
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name={`${id}-auth`}
            className="accent-[var(--green)]"
            checked={form.authorisation === "FINGERPRINT"}
            disabled={!canEdit}
            onChange={() => setForm((f) => ({ ...f, authorisation: "FINGERPRINT" }))}
          />
          Fingerprint discharge authorisation
        </label>
      </fieldset>
      {form.authorisation === "OTP" ? (
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM} mb-[2px]`}
            disabled={!canEdit}
            onClick={() =>
              void ask(
                () => sendShaDischargeOtp(accessToken, claim.id),
                (r) => r.message,
              )
            }
          >
            Send discharge OTP
          </button>
          <Field label="Discharge OTP" htmlFor={`${id}-otp`} className="w-48">
            <input
              id={`${id}-otp`}
              className={INPUT}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={form.otp}
              disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, otp: e.target.value }))}
            />
          </Field>
        </div>
      ) : (
        <Field
          label="Discharge authorisation GUID"
          htmlFor={`${id}-guid`}
          hint="As issued by SHA when the client authorised discharge by fingerprint."
        >
          <input
            id={`${id}-guid`}
            className={`${INPUT} max-w-md font-mono`}
            value={form.guid}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, guid: e.target.value }))}
          />
        </Field>
      )}
      {!inpatient && (
        <Field label="Notes to SHA (optional)" htmlFor={`${id}-notes`}>
          <input
            id={`${id}-notes`}
            className={INPUT}
            maxLength={500}
            value={form.notes}
            disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </Field>
      )}
      <div>
        <button
          type="button"
          className={BTN}
          disabled={!canEdit || !form.reason || !authorised}
          onClick={() =>
            void run(
              () =>
                submitClaim(accessToken, claim.id, linesChecked, {
                  discharge_reason: form.reason,
                  ...(form.authorisation === "OTP"
                    ? { otp: form.otp.trim() }
                    : { discharge_auth_guid: form.guid.trim() }),
                  ...(inpatient
                    ? {}
                    : { discharge_status: form.status, notes: form.notes.trim() || undefined }),
                }),
              "Claim submitted to SHA.",
            )
          }
        >
          Submit claim to SHA
        </button>
      </div>
    </div>
  );
}
