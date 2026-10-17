import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { ClientSearchBox } from "../../../clinical/ClientSearchBox";
import { usePatientContext } from "../../../clinical/usePatientContext";
import { ApiError } from "../../../lib/apiClient";
import {
  generateDocument,
  getDocumentTemplate,
  type DocInputs,
  type TemplateSpec,
} from "../../../lib/documentsApi";
import { BTN, BTN_GHOST, BTN_SM } from "../shared/styles";
import { Callout, Card, ErrorNote, PageHeader, Tag } from "../shared/ui";
import { DocumentInputsForm, type RecipientValues } from "./DocumentInputsForm";
import { useDocCatalogue } from "./useDocCatalogue";

// DOC-UX: Documents → category → document → CITRAMAC generates the draft.
// The record supplies everything it can; this screen asks only for the
// template's clinician-entered fields.

export function NewDocumentPage() {
  const { templateId = "" } = useParams();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { selected, selectPatient, clear } = usePatientContext();
  const { className } = useDocCatalogue();
  const [spec, setSpec] = useState<TemplateSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState<RecipientValues>({
    recipient_type: "",
    recipient_name: "",
    recipient_organization: "",
    purpose: "",
  });
  const [inputs, setInputs] = useState<DocInputs>({});

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getDocumentTemplate(accessToken, templateId)
      .then((data) => {
        if (cancelled) return;
        setSpec(data);
        setRecipient((prev) => ({
          ...prev,
          recipient_type: prev.recipient_type || data.disclosureRules.defaultRecipient,
        }));
      })
      .catch(
        (err) =>
          !cancelled && setError(err instanceof ApiError ? err.message : "Unknown document."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, templateId]);

  const generate = () => {
    if (!accessToken || !spec || !selected) return;
    setBusy(true);
    setError(null);
    generateDocument(accessToken, {
      template_id: spec.documentId,
      patient_id: selected.patientId,
      ...recipient,
      inputs,
    })
      .then((doc) => navigate(`/clinical/documents/generated/${doc.id}`))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't generate it."))
      .finally(() => setBusy(false));
  };

  const rule = spec?.disclosureRules.perRecipient[recipient.recipient_type];

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={spec ? `Documents · ${spec.categoryName}` : "Documents"}
        title={spec?.name ?? "New document"}
        subtitle={spec?.trigger}
        actions={
          <Link
            to={spec ? `/clinical/documents?category=${spec.category}` : "/clinical/documents"}
            className={`${BTN_GHOST} ${BTN_SM}`}
          >
            Back to {spec?.categoryName ?? "documents"}
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {spec && !spec.permissions.generate && (
        <Callout tone="danger" role="alert" className="mb-4">
          {spec.authorization.prescribingRestricted
            ? "Prescribing documents are restricted to credentialed prescribers (DOC-GOV-08). This action is unavailable for your role."
            : "Your role may not generate this document."}
        </Callout>
      )}
      {spec && spec.permissions.generate && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-4">
            <Card title="Client">
              {selected ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{selected.patientName}</strong>
                  <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={clear}>
                    Change client
                  </button>
                </div>
              ) : (
                <ClientSearchBox
                  onChoose={(c) => selectPatient(c.id, c.name || "Temporary client")}
                />
              )}
            </Card>
            {spec.contentStatus === "VERIFY" && (
              <Callout tone="warning">
                {spec.verifyNote}. This document can be generated only as a structured draft of
                record data; it cannot be signed or released until approved wording is configured.
              </Callout>
            )}
            {spec.highRisk && (
              <Callout tone="warning">
                High-risk output: mandatory independent review before signing (DOC-GOV-07).
              </Callout>
            )}
            <Card title="Only what the record cannot supply">
              <DocumentInputsForm
                idPrefix="new-doc"
                fields={spec.userEntered}
                recipientTypes={spec.disclosureRules.recipientTypes}
                rules={spec.disclosureRules.perRecipient}
                recipient={recipient}
                onRecipient={setRecipient}
                inputs={inputs}
                onInputs={setInputs}
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className={BTN}
                  disabled={!selected?.patientId || busy}
                  onClick={generate}
                >
                  {busy ? "Generating…" : "Generate draft"}
                </button>
              </div>
            </Card>
          </div>
          <Card title="Filled in from the record">
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {spec.autoPopulated.map((row) => (
                <li key={row.key} className="flex justify-between gap-2">
                  <span>{row.label}</span>
                  <span className="text-ink-500">{className(row.class)}</span>
                </li>
              ))}
            </ul>
            {rule && (
              <div className="mt-4 text-[12px] text-ink-500">
                <div className="mb-1 font-semibold text-ink-900">Disclosure to {rule.label}</div>
                {rule.external ? (
                  <>
                    <div>
                      Needs: {rule.consentType ? <Tag>{rule.consentType}</Tag> : "no consent"}
                    </div>
                    <div className="mt-1">
                      By default: {rule.defaultClasses.map(className).join(", ") || "—"}
                    </div>
                    <div className="mt-1">
                      Only if authorized:{" "}
                      {rule.authorizableClasses.map(className).join(", ") || "—"}
                    </div>
                    <div className="mt-1">
                      Never: {[...rule.excludedClasses, "PSYCHOTHERAPY"].map(className).join(", ")}
                    </div>
                  </>
                ) : (
                  <div>Internal / to the client — no external disclosure.</div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
