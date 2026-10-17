import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  editGeneratedDocument,
  getGeneratedDocument,
  transitionDocument,
  type DocAction,
  type DocInputs,
  type GeneratedDocument,
} from "../../../lib/documentsApi";
import { formatDateTime } from "../shared/format";
import { BTN, BTN_DANGER, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "../shared/ui";
import { AuthorizationForm } from "./AuthorizationForm";
import { DocumentInputsForm, type RecipientValues } from "./DocumentInputsForm";
import { DocumentPreview } from "./DocumentPreview";
import { useDocCatalogue } from "./useDocCatalogue";

// DOC-WF workspace: draft → review → sign → release → file, with the consent
// block (DOC-CI-06), rule trace, version history (X-03) and disclosure log.

const ACTION_LABEL: Record<Exclude<DocAction, "edit">, string> = {
  submit: "Submit for review",
  return: "Return to author",
  approve: "Record review",
  sign: "Authorize & sign",
  release: "Release",
  file: "File in chart",
  recheck_consent: "Re-check consent",
  amend: "Correct (new version)",
};
const NEEDS_REASON = new Set(["return", "amend"]);
const STATUS_TONE: Record<string, "neutral" | "risk" | "brand" | "warn"> = {
  DRAFT: "warn",
  IN_REVIEW: "warn",
  SIGNED: "brand",
  RELEASED: "brand",
  FILED: "neutral",
  BLOCKED_CONSENT: "risk",
};

export function GeneratedDocumentPage() {
  const { id = "" } = useParams();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { className, recipientLabel } = useDocCatalogue();
  const [doc, setDoc] = useState<GeneratedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<RecipientValues>({
    recipient_type: "",
    recipient_name: "",
    recipient_organization: "",
    purpose: "",
  });
  const [inputs, setInputs] = useState<DocInputs>({});
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState("RECORDED_RELEASE");

  const adopt = useCallback((data: GeneratedDocument) => {
    setDoc(data);
    setRecipient({
      recipient_type: data.recipient_type,
      recipient_name: data.recipient_name,
      recipient_organization: data.recipient_organization,
      purpose: data.purpose,
    });
    setInputs(data.inputs);
  }, []);

  const load = useCallback(() => {
    if (!accessToken) return;
    getGeneratedDocument(accessToken, id)
      .then(adopt)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load it."));
  }, [accessToken, id, adopt]);

  useEffect(load, [load]);

  const run = (promise: Promise<GeneratedDocument>, onDone?: (d: GeneratedDocument) => void) => {
    setBusy(true);
    setError(null);
    promise
      .then((data) => {
        adopt(data);
        setReason("");
        onDone?.(data);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) load();
        setError(err instanceof ApiError ? err.message : "That didn't work.");
      })
      .finally(() => setBusy(false));
  };

  const act = (action: Exclude<DocAction, "edit">) => {
    if (!accessToken || !doc) return;
    run(transitionDocument(accessToken, doc.id, action, { reason, channel }), (data) => {
      if (data.id !== doc.id) navigate(`/clinical/documents/generated/${data.id}`);
    });
  };

  const save = () => {
    if (!accessToken || !doc) return;
    run(editGeneratedDocument(accessToken, doc.id, { ...recipient, inputs }));
  };

  if (!doc) {
    return (
      <div className="animate-fade-in">
        <PageHeader eyebrow="Documents" title="Document" />
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-ink-500">Loading…</p>}
      </div>
    );
  }

  const editable = doc.allowed_actions.includes("edit");
  const blocked = doc.status === "BLOCKED_CONSENT" ? doc.block.blocked : null;
  const actions = doc.allowed_actions.filter((a): a is Exclude<DocAction, "edit"> => a !== "edit");
  const rule = Object.entries(doc.disclosure_rules).find(([c]) => c === doc.recipient_type)?.[1];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={`Documents · ${doc.categoryName}`}
        title={doc.name}
        subtitle={
          <>
            {doc.document_number} · v{doc.version} · {doc.patient_name} ·{" "}
            <Tag tone={STATUS_TONE[doc.status] ?? "neutral"}>{doc.status_label}</Tag>
          </>
        }
        actions={
          <>
            <Link
              to={`/clinical/documents?patient=${doc.patient_id}`}
              className={`${BTN_GHOST} ${BTN_SM}`}
            >
              Client&rsquo;s documents
            </Link>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => window.print()}
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          </>
        }
      />
      {error && (
        <div className="mb-4 print:hidden">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <div className="min-w-0">
          <DocumentPreview doc={doc} />
        </div>

        <div className="flex flex-col gap-4 print:hidden">
          {blocked && (
            <Callout tone="danger" role="alert">
              <strong>Release blocked ({blocked.rule}).</strong> {blocked.message}
              {blocked.alternative_bases && blocked.alternative_bases.length > 0 && (
                <div className="mt-1">
                  A lawful basis other than consent may apply here (
                  {blocked.alternative_bases.join(", ")}); a senior clinician records it on the
                  draft with its reference.
                </div>
              )}
              <AuthorizationForm
                patientId={doc.patient_id}
                block={blocked}
                recipient={doc.recipient_organization || doc.recipient_name}
                purpose={doc.purpose}
                offeredClasses={rule?.authorizableClasses ?? []}
                onRecorded={() => act("recheck_consent")}
              />
            </Callout>
          )}
          {doc.content_status === "VERIFY" && (
            <Callout tone="warning">
              {doc.verify_note}. Structured draft only — cannot be signed or released.
            </Callout>
          )}
          {(doc.block.warnings ?? []).map((w) => (
            <Callout key={w} tone="warning">
              {w}
            </Callout>
          ))}
          {doc.correction_reason && (
            <Callout>
              Correction of v{doc.version - 1}: {doc.correction_reason}
            </Callout>
          )}

          <Card title="Actions">
            {actions.length === 0 && !editable && (
              <p className="text-[12.5px] text-ink-500">No action available to your role.</p>
            )}
            {(doc.block.missing ?? []).length > 0 && (
              <p className="mb-2 text-[12.5px] text-priority-red">
                Still needed: {(doc.block.missing ?? []).join(", ").replace(/_/g, " ")}
              </p>
            )}
            {actions.some((a) => NEEDS_REASON.has(a)) && (
              <Field label="Reason (return / correction)" htmlFor="doc-reason" className="mb-2">
                <input
                  id="doc-reason"
                  className={INPUT}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
            {actions.includes("release") && (
              <Field
                label="Output"
                htmlFor="doc-channel"
                className="mb-2"
                hint="Release records who it went to and why. CITRAMAC sends nothing itself."
              >
                <select
                  id="doc-channel"
                  className={INPUT}
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {doc.outputs.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ").toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={
                    action === "return"
                      ? BTN_DANGER
                      : action === "sign" || action === "release"
                        ? BTN
                        : BTN_GHOST
                  }
                  disabled={busy || (NEEDS_REASON.has(action) && !reason.trim())}
                  onClick={() => act(action)}
                >
                  {
                    // eslint-disable-next-line security/detect-object-injection -- typed action union.
                    ACTION_LABEL[action]
                  }
                </button>
              ))}
            </div>
          </Card>

          {editable && (
            <Card title="Review & edit draft">
              <DocumentInputsForm
                idPrefix="doc-edit"
                fields={doc.user_fields}
                recipientTypes={Object.keys(doc.disclosure_rules)}
                rules={doc.disclosure_rules}
                recipient={recipient}
                onRecipient={setRecipient}
                inputs={inputs}
                onInputs={setInputs}
                missing={doc.block.missing}
                dynamic={doc.block.dynamic}
                disabled={busy}
              />
              <OmitItems doc={doc} inputs={inputs} onInputs={setInputs} />
              <div className="mt-3 flex justify-end">
                <button type="button" className={BTN} disabled={busy} onClick={save}>
                  Save & re-organize
                </button>
              </div>
            </Card>
          )}

          <Card title="Why this content (rule trace)">
            <div className="mb-2 text-[12px]">
              Included: {doc.included_classes.map(className).join(", ") || "—"}
            </div>
            <ul className="mb-2 flex flex-col gap-1 text-[12px] text-ink-500">
              {doc.excluded_classes.map((x) => (
                <li key={x.class}>
                  <strong className="text-ink-900">{className(x.class)}</strong> excluded —{" "}
                  {x.reason}
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1 text-[12px]">
              {doc.rule_trace
                .filter((t) => t.fired)
                .map((t) => (
                  <li key={t.rule}>
                    <Tag>{t.rule}</Tag> {t.outcome}
                  </li>
                ))}
            </ul>
            <div className="mt-2 text-[11px] text-ink-500">
              Labels: {doc.security_labels.confidentiality} ·{" "}
              {(doc.security_labels.sensitivity ?? []).join(", ")}
            </div>
          </Card>

          <Card title="Versions & history" bodyClassName="p-0">
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {doc.versions.map((v) => (
                <Link
                  key={v.id}
                  to={`/clinical/documents/generated/${v.id}`}
                  className={`${BTN_GHOST} ${BTN_SM} ${v.id === doc.id ? "!border-brand-green" : ""}`}
                >
                  v{v.version} · {v.status_label}
                </Link>
              ))}
            </div>
            <table className={`${TABLE} mt-3`} aria-label="Document audit history">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Who</th>
                  <th className={TH}>What</th>
                </tr>
              </thead>
              <tbody>
                {doc.events.map((e) => (
                  <tr key={e.id}>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(e.at)}</td>
                    <td className={TD}>
                      {e.actor || "—"}
                      <div className="text-[11px] text-ink-500">{e.roles}</div>
                    </td>
                    <td className={TD}>
                      {e.action.replace(/_/g, " ")}
                      {e.from || e.to ? ` (${e.from || "—"} → ${e.to || "—"})` : ""}
                      {e.reason && <div className="text-[11px] text-ink-500">{e.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Disclosure log" bodyClassName="p-0">
            {doc.disclosures.length === 0 ? (
              <p className="px-4 py-3 text-[12.5px] text-ink-500">Not released.</p>
            ) : (
              <table className={TABLE} aria-label="Disclosure log">
                <thead>
                  <tr>
                    <th className={TH}>Released</th>
                    <th className={TH}>To / purpose</th>
                    <th className={TH}>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.disclosures.map((d) => (
                    <tr key={d.id}>
                      <td className={TD}>
                        {formatDateTime(d.released_at)}
                        <div className="text-[11px] text-ink-500">
                          {d.released_by} · v{d.version} · {d.channel}
                        </div>
                      </td>
                      <td className={TD}>
                        {recipientLabel(d.recipient_type)}
                        {d.recipient_organization && ` — ${d.recipient_organization}`}
                        <div className="text-[11px] text-ink-500">{d.purpose}</div>
                      </td>
                      <td className={TD}>
                        {d.legal_basis}
                        {d.legal_basis_reference && (
                          <div className="text-[11px] text-ink-500">{d.legal_basis_reference}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Minimum necessary: the reviewer may leave out individual record items. */
function OmitItems({
  doc,
  inputs,
  onInputs,
}: {
  doc: GeneratedDocument;
  inputs: DocInputs;
  onInputs: (update: (prev: DocInputs) => DocInputs) => void;
}) {
  const omitted = Array.isArray(inputs.omit) ? (inputs.omit as string[]) : [];
  const items = doc.content.sections.flatMap((s) => s.items);
  const removed = omitted.filter((k) => !items.some((i) => i.key === k));
  if (!items.length && !removed.length) return null;
  const toggle = (key: string, keep: boolean) =>
    onInputs((prev) => {
      const current = Array.isArray(prev.omit) ? (prev.omit as string[]) : [];
      return { ...prev, omit: keep ? current.filter((k) => k !== key) : [...current, key] };
    });
  return (
    <details className="mt-3 text-[12.5px]">
      <summary className="cursor-pointer font-semibold text-ink-900">
        Leave out record items
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        {items.map((item) => (
          <label key={item.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!omitted.includes(item.key)}
              onChange={(e) => toggle(item.key, e.target.checked)}
            />
            {item.label}
          </label>
        ))}
        {removed.map((key) => (
          <label key={key} className="flex items-center gap-2 text-ink-500">
            <input type="checkbox" checked={false} onChange={() => toggle(key, true)} />
            {key} (left out)
          </label>
        ))}
      </div>
    </details>
  );
}
