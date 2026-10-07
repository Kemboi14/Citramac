import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getClientBanner, type PriorityOrBlank } from "../../lib/carePathwayApi";
import {
  admitPatient,
  listAllBeds,
  listAllWards,
  listCurrentAdmissions,
  listEligibleAdmissionPatients,
  type Admission,
  type AdmissionType,
  type Bed,
  type ConsentStatus,
  type EligiblePatient,
  type NokNotification,
  type Ward,
} from "../../lib/ipdApi";
import { getMhpTeamRoster, type MhpTeamRosterRow } from "../../lib/mhpExtrasApi";
import { formatDate } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, GROUP_LABEL, INPUT, TABLE, TD, TH } from "./shared/styles";
import {
  Callout,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  PriorityPill,
  SelectChoices,
  Tag,
} from "./shared/ui";
import { useValueSets, type ValueSetsApi } from "./shared/useValueSets";

// Inpatient Admissions — docs/15-CLINICAL-WORKSPACE-V3.md §1.10, mockup `inpatient()`.
// The admission is an Encounter (class IMP) inside the client's EpisodeOfCare;
// the server opens/links both on create (CLAUDE.md §4).

const pad = (n: number) => String(n).padStart(2, "0");
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today → now; any other date → midday of that date (local time). */
function admittedAtFor(date: string) {
  if (date === todayIso()) return new Date().toISOString();
  return new Date(`${date}T12:00:00`).toISOString();
}

function patientName(p: EligiblePatient) {
  return [p.first_name, p.middle_other_names, p.last_name].filter(Boolean).join(" ");
}

function patientLabel(p: EligiblePatient) {
  return `${patientName(p)} (${p.citramac_number || p.uhid_number || "no ID"})`;
}

function rosterName(member: MhpTeamRosterRow) {
  return `${member.first_name} ${member.last_name}`.trim() || member.email;
}

function bedLabel(bed: Bed | undefined, wardsById: Map<string, Ward>) {
  if (!bed) return "";
  return `${wardsById.get(bed.ward)?.name ?? "Ward"} — Bed ${bed.bed_number}`;
}

// Legal basis at admission: consent status, capacity and next-of-kin options come
// from the served value sets admission-consent-status, capacity-assessed and
// nok-notification. Legal status stays free text — no source for its categories.
type Capacity = "NOT_ASSESSED" | "YES" | "NO";

type FieldErrors = Partial<Record<string, string>>;

/** Fields rendered with an inline error; any other server error goes to the summary. */
const SHOWN_FIELDS = new Set([
  "patient",
  "admission_type",
  "admitted_at",
  "clinical_priority",
  "reason_for_admission",
  "consultant",
  "primary_care_team",
  "bed",
  "consent_status",
  "capacity_assessed",
  "consent_notes",
  "legal_status",
  "legal_order_reference",
  "legal_order_date",
  "legal_review_due_date",
  "authorizing_professional",
  "legal_rationale",
  "oversight_notes",
  "next_of_kin_notification",
  "next_of_kin_notes",
]);

function serverFieldErrors(fields: Record<string, unknown> | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const [field, detail] of Object.entries(fields ?? {})) {
    // eslint-disable-next-line security/detect-object-injection -- keys come from the API error body.
    out[field] = Array.isArray(detail) ? detail.map(String).join(" ") : String(detail);
  }
  return out;
}

/** Red text under a field, linked via aria-describedby. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="text-xs text-status-red">
      {message}
    </span>
  );
}

function LegalTag({ admission, label }: { admission: Admission; label: ValueSetsApi["label"] }) {
  if (admission.admission_type === "INVOLUNTARY") {
    if (!admission.legal_review_due_date) return <Tag tone="warn">Review date not set</Tag>;
    const overdue = admission.legal_review_due_date < todayIso();
    return (
      <Tag tone={overdue ? "risk" : "neutral"}>
        Review due {admission.legal_review_due_date}
        {overdue && " (overdue)"}
      </Tag>
    );
  }
  return admission.consent_status ? (
    <Tag>{label("admission-consent-status", admission.consent_status)}</Tag>
  ) : (
    <Tag tone="warn">Consent not recorded</Tag>
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface FormState {
  clientText: string;
  patientId: string;
  admissionType: AdmissionType | "";
  admissionDate: string;
  priority: PriorityOrBlank;
  priorityTouched: boolean;
  reason: string;
  consultant: string;
  teamName: string;
  bed: string;
  // Voluntary
  consentStatus: ConsentStatus;
  capacity: Capacity;
  consentNotes: string;
  // Involuntary
  legalStatus: string;
  legalOrderReference: string;
  legalOrderDate: string;
  legalReviewDueDate: string;
  authorizingProfessional: string;
  legalRationale: string;
  oversightNotes: string;
  // Both
  nokNotification: NokNotification;
  nokNotes: string;
}

const emptyForm = (): FormState => ({
  clientText: "",
  patientId: "",
  admissionType: "",
  admissionDate: todayIso(),
  priority: "",
  priorityTouched: false,
  reason: "",
  consultant: "",
  teamName: "",
  bed: "",
  consentStatus: "",
  capacity: "NOT_ASSESSED",
  consentNotes: "",
  legalStatus: "",
  legalOrderReference: "",
  legalOrderDate: "",
  legalReviewDueDate: "",
  authorizingProfessional: "",
  legalRationale: "",
  oversightNotes: "",
  nokNotification: "NOT_NOTIFIED",
  nokNotes: "",
});

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.patientId) errors.patient = "Choose a client from the list.";
  if (!form.admissionType) errors.admission_type = "Choose the admission type.";
  if (!form.admissionDate) errors.admitted_at = "Enter the admission date.";
  else if (form.admissionDate > todayIso())
    errors.admitted_at = "The admission date can't be in the future.";
  if (!form.bed) errors.bed = "Assign an available bed.";
  if (form.admissionType === "VOLUNTARY" && !form.consentStatus) {
    errors.consent_status = "Record the consent status for a voluntary admission.";
  }
  if (form.admissionType === "INVOLUNTARY") {
    const required = "Required for an involuntary admission.";
    if (!form.legalStatus.trim()) errors.legal_status = required;
    if (!form.legalOrderReference.trim()) errors.legal_order_reference = required;
    if (!form.legalOrderDate) errors.legal_order_date = required;
    else if (form.legalOrderDate > todayIso())
      errors.legal_order_date = "The legal order date can't be in the future.";
    if (!form.authorizingProfessional.trim()) errors.authorizing_professional = required;
  }
  return errors;
}

/** The legal-basis fields for the chosen admission type only. */
function legalPayload(form: FormState): Partial<Admission> {
  const shared = {
    next_of_kin_notification: form.nokNotification,
    next_of_kin_notes: form.nokNotes.trim(),
  };
  if (form.admissionType === "INVOLUNTARY") {
    return {
      ...shared,
      legal_status: form.legalStatus.trim(),
      legal_order_reference: form.legalOrderReference.trim(),
      legal_order_date: form.legalOrderDate || null,
      legal_review_due_date: form.legalReviewDueDate || null,
      authorizing_professional: form.authorizingProfessional.trim(),
      legal_rationale: form.legalRationale.trim(),
      oversight_notes: form.oversightNotes.trim(),
    };
  }
  return {
    ...shared,
    consent_status: form.consentStatus,
    capacity_assessed: form.capacity === "NOT_ASSESSED" ? null : form.capacity === "YES",
    consent_notes: form.consentNotes.trim(),
  };
}

export function InpatientAdmissionsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const valueSets = useValueSets();

  const [eligible, setEligible] = useState<EligiblePatient[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [roster, setRoster] = useState<MhpTeamRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  const formRef = useRef<HTMLElement>(null);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const bannerRequest = useRef(0);

  // Bumped after an admission so the lists, beds and eligible clients refresh.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([
      listEligibleAdmissionPatients(accessToken, { all: true }),
      listAllWards(accessToken),
      listAllBeds(accessToken),
      listCurrentAdmissions(accessToken),
    ])
      .then(([eligibleRows, wardRows, bedRows, admissionRows]) => {
        if (cancelled) return;
        setEligible(eligibleRows);
        setWards(wardRows);
        setBeds(bedRows);
        setAdmissions(admissionRows);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError ? err.message : "Couldn't load admissions and bed availability.",
        );
      })
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getMhpTeamRoster(accessToken)
      .then((rows) => !cancelled && setRoster(rows))
      .catch(
        () =>
          !cancelled &&
          setRosterError("Couldn't load the care team roster; the responsible team can't be set."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const wardsById = new Map(wards.map((w) => [w.id, w]));
  const bedsById = new Map(beds.map((b) => [b.id, b]));
  const availableBeds = beds.filter((b) => b.status === "AVAILABLE");
  const labelToPatient = new Map(eligible.map((p) => [patientLabel(p), p]));

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const chooseClient = (text: string) => {
    const match = labelToPatient.get(text);
    const patientId = match?.id ?? "";
    setForm((prev) => ({
      ...prev,
      clientText: text,
      patientId,
      priority: prev.priorityTouched ? prev.priority : "",
    }));
    if (!match || !accessToken) return;
    // Default the clinical priority to the client's latest signed triage priority.
    const request = ++bannerRequest.current;
    getClientBanner(accessToken, match.id)
      .then((banner) => {
        if (request !== bannerRequest.current) return;
        setForm((prev) =>
          prev.patientId === match.id && !prev.priorityTouched
            ? { ...prev, priority: banner.priority }
            : prev,
        );
      })
      .catch(() => {
        // No banner (e.g. never triaged): the priority stays for the clinician to choose.
      });
  };

  const resetForm = () => {
    bannerRequest.current += 1;
    setForm(emptyForm());
    setSaveError(null);
    setFieldErrors({});
  };

  const startNewAdmission = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    clientInputRef.current?.focus({ preventScroll: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setSuccess(null);
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !form.admissionType) {
      setSaveError("Some required details are missing — see the highlighted fields.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const admission = await admitPatient(accessToken, {
        patient: form.patientId,
        bed: form.bed,
        admission_type: form.admissionType,
        admitted_at: admittedAtFor(form.admissionDate),
        clinical_priority: form.priority,
        reason_for_admission: form.reason.trim(),
        consultant: form.consultant || null,
        primary_care_team: form.teamName.trim(),
        ...legalPayload(form),
      });
      const name = admission.patient_name || form.clientText;
      setSuccess(`${name} admitted to ${bedLabel(bedsById.get(form.bed), wardsById)}.`);
      bannerRequest.current += 1;
      setForm(emptyForm());
      setReloadKey((key) => key + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        const serverErrors = serverFieldErrors(err.fields);
        setFieldErrors(serverErrors);
        // Errors on fields the form doesn't show still reach the clinician.
        const unshown = Object.entries(serverErrors)
          .filter(([field]) => !SHOWN_FIELDS.has(field))
          .map(([field, detail]) => `${field}: ${detail}`)
          .join("; ");
        setSaveError(unshown ? `${err.message} (${unshown})` : err.message);
      } else {
        setSaveError("Couldn't record the admission. Check your connection and try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const teamPrefix = form.teamName.trim() || "Team";
  const invalid = (field: string, id: string) =>
    // eslint-disable-next-line security/detect-object-injection -- fixed field names.
    fieldErrors[field] ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  const errorFor = (field: string, id: string) => (
    // eslint-disable-next-line security/detect-object-injection -- fixed field names.
    <FieldError id={`${id}-error`} message={fieldErrors[field]} />
  );

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <PageHeader
        title="Inpatient Admissions"
        subtitle="Manage inpatient admissions and bed allocation"
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => navigate("/clinical/inpatient/ward")}
            >
              Bed Management
            </button>
            <button type="button" className={BTN} onClick={startNewAdmission}>
              + New Admission
            </button>
          </>
        }
      />

      <ErrorNote>{loadError}</ErrorNote>
      <ErrorNote>{valueSets.error}</ErrorNote>

      <section ref={formRef} className="scroll-mt-4" aria-label="New Admission Record">
        <Card title="New Admission Record">
          <form onSubmit={submit} noValidate>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Client" htmlFor="adm-client">
                <input
                  id="adm-client"
                  ref={clientInputRef}
                  type="search"
                  list="adm-client-options"
                  className={INPUT}
                  value={form.clientText}
                  placeholder={isLoading ? "Loading clients…" : "Search by name or CITRAMAC ID"}
                  autoComplete="off"
                  {...invalid("patient", "adm-client")}
                  onChange={(e) => chooseClient(e.target.value)}
                />
                <datalist id="adm-client-options">
                  {eligible.map((p) => (
                    <option key={p.id} value={patientLabel(p)} />
                  ))}
                </datalist>
                {errorFor("patient", "adm-client")}
              </Field>
              <Field label="Admission Type" htmlFor="adm-type">
                <SelectChoices
                  id="adm-type"
                  options={valueSets.options("admission-type")}
                  value={form.admissionType}
                  placeholder="Select admission type"
                  required
                  onChange={(code) => update({ admissionType: code as AdmissionType | "" })}
                />
                {errorFor("admission_type", "adm-type")}
              </Field>
              {form.admissionType && (
                <fieldset className="rounded-lg border border-surface-border p-3.5 sm:col-span-2">
                  <legend className={`${GROUP_LABEL} !my-0 px-1`}>
                    {form.admissionType === "INVOLUNTARY"
                      ? "Legal basis — involuntary admission"
                      : "Consent — voluntary admission"}
                  </legend>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    {form.admissionType === "VOLUNTARY" ? (
                      <>
                        <Field label="Consent status *" htmlFor="adm-consent">
                          <select
                            id="adm-consent"
                            className={INPUT}
                            value={form.consentStatus}
                            required
                            {...invalid("consent_status", "adm-consent")}
                            onChange={(e) =>
                              update({ consentStatus: e.target.value as ConsentStatus })
                            }
                          >
                            <option value="">Select consent status</option>
                            {valueSets.options("admission-consent-status").map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.display}
                              </option>
                            ))}
                          </select>
                          {errorFor("consent_status", "adm-consent")}
                        </Field>
                        <Field label="Capacity assessed" htmlFor="adm-capacity">
                          <select
                            id="adm-capacity"
                            className={INPUT}
                            value={form.capacity}
                            {...invalid("capacity_assessed", "adm-capacity")}
                            onChange={(e) => update({ capacity: e.target.value as Capacity })}
                          >
                            {valueSets.options("capacity-assessed").map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.display}
                              </option>
                            ))}
                          </select>
                          {errorFor("capacity_assessed", "adm-capacity")}
                        </Field>
                        <Field
                          label="Consent notes"
                          htmlFor="adm-consent-notes"
                          className="sm:col-span-2"
                        >
                          <textarea
                            id="adm-consent-notes"
                            rows={2}
                            className={INPUT}
                            value={form.consentNotes}
                            {...invalid("consent_notes", "adm-consent-notes")}
                            onChange={(e) => update({ consentNotes: e.target.value })}
                          />
                          {errorFor("consent_notes", "adm-consent-notes")}
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field label="Legal status *" htmlFor="adm-legal-status">
                          <input
                            id="adm-legal-status"
                            type="text"
                            className={INPUT}
                            value={form.legalStatus}
                            required
                            maxLength={150}
                            {...invalid("legal_status", "adm-legal-status")}
                            onChange={(e) => update({ legalStatus: e.target.value })}
                          />
                          {errorFor("legal_status", "adm-legal-status")}
                        </Field>
                        <Field label="Legal order reference *" htmlFor="adm-order-ref">
                          <input
                            id="adm-order-ref"
                            type="text"
                            className={INPUT}
                            value={form.legalOrderReference}
                            required
                            maxLength={100}
                            {...invalid("legal_order_reference", "adm-order-ref")}
                            onChange={(e) => update({ legalOrderReference: e.target.value })}
                          />
                          {errorFor("legal_order_reference", "adm-order-ref")}
                        </Field>
                        <Field label="Legal order date *" htmlFor="adm-order-date">
                          <input
                            id="adm-order-date"
                            type="date"
                            className={INPUT}
                            value={form.legalOrderDate}
                            max={todayIso()}
                            required
                            {...invalid("legal_order_date", "adm-order-date")}
                            onChange={(e) => update({ legalOrderDate: e.target.value })}
                          />
                          {errorFor("legal_order_date", "adm-order-date")}
                        </Field>
                        <Field label="Legal review due date" htmlFor="adm-review-date">
                          <input
                            id="adm-review-date"
                            type="date"
                            className={INPUT}
                            value={form.legalReviewDueDate}
                            {...invalid("legal_review_due_date", "adm-review-date")}
                            onChange={(e) => update({ legalReviewDueDate: e.target.value })}
                          />
                          {errorFor("legal_review_due_date", "adm-review-date")}
                        </Field>
                        <Field label="Authorising professional *" htmlFor="adm-authoriser">
                          <input
                            id="adm-authoriser"
                            type="text"
                            className={INPUT}
                            value={form.authorizingProfessional}
                            required
                            maxLength={255}
                            {...invalid("authorizing_professional", "adm-authoriser")}
                            onChange={(e) => update({ authorizingProfessional: e.target.value })}
                          />
                          {errorFor("authorizing_professional", "adm-authoriser")}
                        </Field>
                        <Field label="Legal rationale" htmlFor="adm-rationale">
                          <textarea
                            id="adm-rationale"
                            rows={2}
                            className={INPUT}
                            value={form.legalRationale}
                            {...invalid("legal_rationale", "adm-rationale")}
                            onChange={(e) => update({ legalRationale: e.target.value })}
                          />
                          {errorFor("legal_rationale", "adm-rationale")}
                        </Field>
                        <Field
                          label="Oversight notes"
                          htmlFor="adm-oversight"
                          className="sm:col-span-2"
                        >
                          <textarea
                            id="adm-oversight"
                            rows={2}
                            className={INPUT}
                            value={form.oversightNotes}
                            {...invalid("oversight_notes", "adm-oversight")}
                            onChange={(e) => update({ oversightNotes: e.target.value })}
                          />
                          {errorFor("oversight_notes", "adm-oversight")}
                        </Field>
                      </>
                    )}
                    <Field label="Next-of-kin notification" htmlFor="adm-nok">
                      <select
                        id="adm-nok"
                        className={INPUT}
                        value={form.nokNotification}
                        {...invalid("next_of_kin_notification", "adm-nok")}
                        onChange={(e) =>
                          update({ nokNotification: e.target.value as NokNotification })
                        }
                      >
                        {valueSets.options("nok-notification").map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.display}
                          </option>
                        ))}
                      </select>
                      {errorFor("next_of_kin_notification", "adm-nok")}
                    </Field>
                    <Field label="NOK notes" htmlFor="adm-nok-notes">
                      <textarea
                        id="adm-nok-notes"
                        rows={2}
                        className={INPUT}
                        value={form.nokNotes}
                        {...invalid("next_of_kin_notes", "adm-nok-notes")}
                        onChange={(e) => update({ nokNotes: e.target.value })}
                      />
                      {errorFor("next_of_kin_notes", "adm-nok-notes")}
                    </Field>
                  </div>
                </fieldset>
              )}
              <Field label="Admission Date" htmlFor="adm-date">
                <input
                  id="adm-date"
                  type="date"
                  className={INPUT}
                  value={form.admissionDate}
                  max={todayIso()}
                  required
                  {...invalid("admitted_at", "adm-date")}
                  onChange={(e) => update({ admissionDate: e.target.value })}
                />
                {errorFor("admitted_at", "adm-date")}
              </Field>
              <Field label="Clinical Priority" htmlFor="adm-priority">
                <SelectChoices
                  id="adm-priority"
                  options={valueSets.options("triage-priority")}
                  value={form.priority}
                  placeholder="Not set"
                  onChange={(code) =>
                    update({ priority: code as PriorityOrBlank, priorityTouched: true })
                  }
                />
                {errorFor("clinical_priority", "adm-priority")}
              </Field>
              <Field label="Reason" htmlFor="adm-reason">
                <textarea
                  id="adm-reason"
                  rows={2}
                  className={INPUT}
                  value={form.reason}
                  {...invalid("reason_for_admission", "adm-reason")}
                  onChange={(e) => update({ reason: e.target.value })}
                />
                {errorFor("reason_for_admission", "adm-reason")}
              </Field>
              <Field label="Responsible Team" htmlFor="adm-consultant">
                <select
                  id="adm-consultant"
                  className={INPUT}
                  value={form.consultant}
                  {...invalid("consultant", "adm-consultant")}
                  onChange={(e) => update({ consultant: e.target.value })}
                >
                  <option value="">Select responsible clinician</option>
                  {roster.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {teamPrefix} — {rosterName(member)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  className={INPUT}
                  aria-label="Team name"
                  {...invalid("primary_care_team", "adm-team")}
                  placeholder="Team name (optional)"
                  value={form.teamName}
                  onChange={(e) => update({ teamName: e.target.value })}
                />
                {errorFor("consultant", "adm-consultant")}
                {errorFor("primary_care_team", "adm-team")}
                {rosterError && <span className="text-xs text-status-red">{rosterError}</span>}
              </Field>
              <Field label="Bed Assignment" htmlFor="adm-bed">
                <select
                  id="adm-bed"
                  className={INPUT}
                  value={form.bed}
                  required
                  {...invalid("bed", "adm-bed")}
                  onChange={(e) => update({ bed: e.target.value })}
                >
                  <option value="">
                    {availableBeds.length === 0 && !isLoading
                      ? "No beds available"
                      : "Select an available bed"}
                  </option>
                  {availableBeds.map((bed) => (
                    <option key={bed.id} value={bed.id}>
                      {bedLabel(bed, wardsById)} (Available)
                    </option>
                  ))}
                </select>
                {errorFor("bed", "adm-bed")}
              </Field>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <ErrorNote>{saveError}</ErrorNote>
              {success && (
                <Callout tone="success" role="status">
                  {success}
                </Callout>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={resetForm}>
                  Cancel
                </button>
                <button type="submit" className={BTN} disabled={isSaving}>
                  {isSaving ? "Approving…" : "Approve Admission"}
                </button>
              </div>
            </div>
          </form>
        </Card>
      </section>

      <Card title={`Current Inpatients (${admissions.length})`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[760px]`}>
            <thead>
              <tr>
                <th className={TH}>Bed</th>
                <th className={TH}>Client</th>
                <th className={TH}>Type</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Admitted</th>
                <th className={TH}>Diagnosis</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className={`${TD} text-center text-ink-500`}>
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && admissions.length === 0 && (
                <tr>
                  <td colSpan={7} className={`${TD} py-6 text-center text-ink-500`}>
                    No clients are currently admitted.
                  </td>
                </tr>
              )}
              {admissions.map((admission) => (
                <tr key={admission.id} className="hover:bg-surface-bg">
                  <td className={TD}>
                    {bedLabel(bedsById.get(admission.bed), wardsById) ||
                      admission.bed_label.replace(" / ", " — ")}
                  </td>
                  <td className={TD}>
                    <Link
                      to={clientRecordPath(admission.patient, "intake")}
                      className="font-bold text-ink-900 hover:text-brand-green hover:underline"
                    >
                      {admission.patient_name}
                    </Link>
                    <br />
                    <span className="font-mono text-[11px] text-ink-500">
                      {admission.patient_citramac_number || "—"}
                    </span>
                  </td>
                  <td className={TD}>
                    <div className="flex flex-col items-start gap-1">
                      <Tag>{valueSets.label("admission-type", admission.admission_type)}</Tag>
                      <LegalTag admission={admission} label={valueSets.label} />
                    </div>
                  </td>
                  <td className={TD}>
                    {admission.clinical_priority ? (
                      <PriorityPill priority={admission.clinical_priority} />
                    ) : (
                      <Tag>—</Tag>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDate(admission.admitted_at)}</td>
                  <td className={`${TD} max-w-[200px]`}>
                    {admission.primary_diagnosis || "Not recorded"}
                  </td>
                  <td className={TD}>
                    <Tag>{titleCase(admission.status)}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
