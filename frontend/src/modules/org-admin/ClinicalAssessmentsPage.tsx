import { useId, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import {
  approveAssessment,
  getApprovedAssessments,
  type ApprovedAssessmentPurpose,
  type ApprovedAssessments,
} from "../../lib/carePathwayApi";
import { formatDateTime } from "../care/shared/format";
import { BTN, BTN_GHOST, INPUT } from "../care/shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, SelectChoices, Tag } from "../care/shared/ui";
import { useRecordData } from "../care/record/useRecordData";
import { errorText } from "../care/triage/helpers";

/** Org Admin: the assessments the organisation has approved for clinical use —
 * the trauma assessment intake recommends (spec 6.1) and the benzodiazepine
 * withdrawal assessment triage and the withdrawal chart open (spec item 9).
 * None is approved by default; approving names the clinical lead and needs the
 * attestation. Every change is a new version and an audit entry. */
export function ClinicalAssessmentsPage() {
  const { data, error } = useRecordData(
    "approved-assessments",
    0,
    (token) => getApprovedAssessments(token),
    "Couldn't load the approved assessments.",
  );
  const [saved, setSaved] = useState<ApprovedAssessments | null>(null);
  const settings = saved ?? data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Organization · Clinical governance"
        title="Clinical Assessments"
        subtitle="The assessments your organisation has approved for clinical use. Findings recommend only an approved assessment; with none approved, clinicians use clinical judgement."
      />
      <ErrorNote>{error}</ErrorNote>
      {!settings
        ? !error && <p className="text-[13px] text-ink-500">Loading…</p>
        : settings.purposes.map((purpose) => (
            <PurposeCard
              key={purpose.purpose}
              purpose={purpose}
              attest={settings.attest}
              canEdit={settings.can_edit}
              onSaved={setSaved}
            />
          ))}
    </div>
  );
}

function PurposeCard({
  purpose,
  attest: attestText,
  canEdit,
  onSaved,
}: {
  purpose: ApprovedAssessmentPurpose;
  attest: string;
  canEdit: boolean;
  onSaved: (settings: ApprovedAssessments) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [instrument, setInstrument] = useState(purpose.instrument);
  const [lead, setLead] = useState(purpose.clinical_lead);
  const [attest, setAttest] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current = purpose.options.find((o) => o.code === purpose.instrument);
  const chosen = purpose.options.find((o) => o.code === instrument);
  const ready =
    instrument === "" || (lead.trim().length >= 3 && attest && (!chosen?.confirm || confirm));

  const save = async () => {
    if (!accessToken) return;
    setBusy(true);
    setSaveError(null);
    try {
      onSaved(
        await approveAssessment(accessToken, {
          purpose: purpose.purpose,
          instrument,
          clinical_lead: instrument ? lead.trim() : undefined,
          attest: instrument ? attest : undefined,
          confirm: chosen?.confirm ? confirm : undefined,
        }),
      );
      setEditing(false);
      setAttest(false);
      setConfirm(false);
    } catch (err) {
      setSaveError(errorText(err, "Couldn't save the approval."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={purpose.title}
      aside={
        <Tag tone={current ? "brand" : "neutral"}>{current ? "Approved" : "None approved"}</Tag>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-700">{purpose.what}</p>
        {current ? (
          <p className="text-[13px] text-ink-900">
            <strong>{current.name}</strong> — approved by clinical lead {purpose.clinical_lead}
            {purpose.approved_at &&
              ` · recorded by ${purpose.approved_by} · ${formatDateTime(purpose.approved_at)}`}
          </p>
        ) : (
          <p className="text-[13px] text-ink-500">
            No assessment is approved. Clinicians see the finding and use clinical judgement; no
            score is recorded.
          </p>
        )}
        <ErrorNote>{saveError}</ErrorNote>
        {!canEdit ? (
          <p className="text-xs text-ink-500">Only an Org Admin can change this.</p>
        ) : !editing ? (
          <div>
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => {
                setInstrument(purpose.instrument);
                setLead(purpose.clinical_lead);
                setEditing(true);
              }}
            >
              Change…
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-surface-border p-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Approved assessment" htmlFor={`${id}-instrument`}>
                <SelectChoices
                  id={`${id}-instrument`}
                  options={[
                    { code: "", display: "None — clinical judgement" },
                    ...purpose.options.map((o) => ({ code: o.code, display: o.name })),
                  ]}
                  value={instrument}
                  onChange={(code) => {
                    setInstrument(code);
                    setConfirm(false);
                  }}
                />
              </Field>
              {instrument && (
                <Field label="Clinical lead who approved it" htmlFor={`${id}-lead`}>
                  <input
                    id={`${id}-lead`}
                    className={INPUT}
                    value={lead}
                    onChange={(e) => setLead(e.target.value)}
                  />
                </Field>
              )}
            </div>
            {instrument && (
              <Callout tone="warning">
                <div className="flex flex-col gap-2 text-xs">
                  <label htmlFor={`${id}-attest`} className="flex items-start gap-2">
                    <input
                      id={`${id}-attest`}
                      type="checkbox"
                      className="mt-0.5"
                      checked={attest}
                      onChange={(e) => setAttest(e.target.checked)}
                    />
                    <span>{attestText} My name and the time are recorded.</span>
                  </label>
                  {chosen?.confirm && (
                    <label htmlFor={`${id}-confirm`} className="flex items-start gap-2">
                      <input
                        id={`${id}-confirm`}
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                      />
                      <span>{chosen.confirm}</span>
                    </label>
                  )}
                </div>
              </Callout>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN}
                disabled={!ready || busy}
                onClick={() => void save()}
              >
                Save
              </button>
              <button type="button" className={BTN_GHOST} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
