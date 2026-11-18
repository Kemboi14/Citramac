import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import type { Admission } from "../../lib/ipdApi";
import { getLegalWorkspace, type LegalWorkspace } from "../../lib/legalStatusApi";
import { formatDate, formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN_GHOST } from "./shared/styles";
import { Card, ErrorNote, PriorityPill, Tag } from "./shared/ui";
import type { ValueSetsApi } from "./shared/useValueSets";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[.5px] text-ink-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink-900">
        {children || <span className="text-ink-500">Not recorded</span>}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-surface-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[.5px] text-ink-500">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * A client who is already admitted: everything captured for the current
 * admission, read-only — admission, legal basis, consent and next of kin, risk.
 * Changes are made where they belong (Legal & consent, the client record).
 */
export function AdmissionSummary({
  admission,
  bedLabel,
  label,
  onClose,
}: {
  admission: Admission;
  bedLabel: string;
  label: ValueSetsApi["label"];
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const [legal, setLegal] = useState<LegalWorkspace["legal_status"] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    getLegalWorkspace(accessToken, admission.patient)
      .then((ws) => live && setLegal(ws.legal_status))
      .catch(() => {
        if (!live) return;
        setLegal(null);
        setError("Couldn't load the legal status for this admission.");
      });
    return () => {
      live = false;
    };
  }, [accessToken, admission.patient]);

  const risks = [
    admission.risk_self_harm && "Self-harm",
    admission.risk_to_others && "Harm to others",
    admission.risk_absconding && "Absconding",
    admission.risk_medical && "Medical",
  ].filter(Boolean) as string[];
  const legacy = !admission.legal_status_record;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {admission.patient_name}
          <span className="font-mono text-[12px] font-normal text-ink-500">
            {admission.patient_citramac_number}
          </span>
        </span>
      }
      aside={
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone="brand">Admitted</Tag>
          <Tag tone={admission.admission_type === "INVOLUNTARY" ? "risk" : "neutral"}>
            {label("admission-type", admission.admission_type)}
          </Tag>
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        <ErrorNote>{error}</ErrorNote>

        <Group title="Admission">
          <Row label="Bed">{bedLabel || admission.bed_label}</Row>
          <Row label="Admitted">{formatDateTime(admission.admitted_at)}</Row>
          <Row label="Clinical priority">
            {admission.clinical_priority ? (
              <PriorityPill priority={admission.clinical_priority} />
            ) : (
              ""
            )}
          </Row>
          <Row label="Reason for admission">{admission.reason_for_admission}</Row>
          <Row label="Responsible clinician">{admission.consultant_name}</Row>
          <Row label="Team">{admission.primary_care_team}</Row>
          <Row label="Primary diagnosis">{admission.primary_diagnosis}</Row>
          {admission.clinical_summary && (
            <Row label="Clinical summary">{admission.clinical_summary}</Row>
          )}
        </Group>

        <Group title="Legal basis">
          {legacy ? (
            <>
              <Row label="Legal status (recorded on the admission)">{admission.legal_status}</Row>
              <Row label="Order reference">{admission.legal_order_reference}</Row>
              <Row label="Order date">
                {admission.legal_order_date ? formatDate(admission.legal_order_date) : ""}
              </Row>
              <Row label="Review due">
                {admission.legal_review_due_date ? formatDate(admission.legal_review_due_date) : ""}
              </Row>
              <Row label="Authorising professional">{admission.authorizing_professional}</Row>
            </>
          ) : legal === undefined ? (
            <Row label="Legal status">Loading…</Row>
          ) : legal ? (
            <>
              <Row label="Category">
                {legal.category === "INVOLUNTARY" ? "Involuntary" : "Voluntary"}
              </Row>
              <Row label="Status">{titleCase(legal.status)}</Row>
              <Row label="Decision">
                {legal.decision_by
                  ? `Admitted by ${legal.decision_by}${legal.decision_role ? ` (${legal.decision_role})` : ""}${legal.decision_at ? `, ${formatDateTime(legal.decision_at)}` : ""}`
                  : ""}
              </Row>
              <Row label="Effective from">
                {legal.effective_from ? formatDateTime(legal.effective_from) : ""}
              </Row>
              {legal.category === "INVOLUNTARY" && (
                <Row label="Maximum expiry">
                  {legal.max_expiry_at ? formatDateTime(legal.max_expiry_at) : ""}
                </Row>
              )}
              <Row label="Statutory basis">
                {legal.statutory_basis
                  .map((s) => `${s.act}${s.section ? ` s.${s.section}` : ""}`)
                  .join("; ")}
              </Row>
            </>
          ) : (
            <Row label="Legal status">No legal status found</Row>
          )}
        </Group>

        <Group title="Consent & next of kin">
          <Row label="Consent">
            {admission.consent_status
              ? label("admission-consent-status", admission.consent_status)
              : ""}
            {admission.consent_at ? ` · ${formatDateTime(admission.consent_at)}` : ""}
          </Row>
          {admission.capacity_assessed !== null && (
            <Row label="Capacity (recorded on the admission)">
              {admission.capacity_assessed ? "Has capacity" : "Lacks capacity"}
            </Row>
          )}
          <Row label="Next of kin">
            {label("nok-notification", admission.next_of_kin_notification)}
          </Row>
          {admission.next_of_kin_notes && (
            <Row label="Next-of-kin notes">{admission.next_of_kin_notes}</Row>
          )}
        </Group>

        <Group title="Risk & observation">
          <Row label="Risks identified">{risks.join(", ") || "None recorded"}</Row>
          <Row label="Observation level">
            {admission.observation_level ? titleCase(admission.observation_level) : ""}
          </Row>
          {admission.risk_summary && <Row label="Risk summary">{admission.risk_summary}</Row>}
          {admission.safety_actions && <Row label="Safety actions">{admission.safety_actions}</Row>}
        </Group>

        <div className="flex flex-wrap gap-2 border-t border-surface-border pt-4">
          <Link to={clientRecordPath(admission.patient, "snapshot")} className={BTN_GHOST}>
            Open client record
          </Link>
          <Link to={clientRecordPath(admission.patient, "legal")} className={BTN_GHOST}>
            Legal &amp; consent
          </Link>
          <button type="button" className={BTN_GHOST} onClick={onClose}>
            Admit a different client
          </button>
        </div>
      </div>
    </Card>
  );
}
