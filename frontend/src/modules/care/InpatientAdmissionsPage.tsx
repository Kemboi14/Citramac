import { AutoResizeTextarea } from "./shared/AutoResizeTextarea";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getClientBanner, type PriorityOrBlank } from "../../lib/carePathwayApi";
import { getLegalWorkspace, type LegalWorkspace } from "../../lib/legalStatusApi";
import {
  admitPatient,
  listAllBeds,
  listAllWards,
  listCurrentAdmissions,
  listEligibleAdmissionPatients,
  type Admission,
  type Bed,
  type EligiblePatient,
  type NokNotification,
  type Ward,
} from "../../lib/ipdApi";
import { getMhpTeamRoster, type MhpTeamRosterRow } from "../../lib/mhpExtrasApi";
import { AdmissionSummary } from "./AdmissionSummary";
import { LegalAdmissionStatus } from "./record/legal/LegalAdmissionStatus";
import { formatDate } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, INPUT, TABLE, TD, TH } from "./shared/styles";
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
import DateInput from "../../components/DateInput";

// Inpatient Admissions — docs/15-CLINICAL-WORKSPACE-V3.md §1.10, mockup `inpatient()`.
// The admission is an Encounter (class IMP) inside the client's EpisodeOfCare;
// the server opens/links both on create (guide.md §4).
//
// One guided path (owner decision 2026-11-18): 1 client & reason → 2 voluntary or
// involuntary, then that type's legal steps (voluntary: capacity, the client's or
// guardian's application, the admitting officer's decision; involuntary: the
// related person's application, the medical recommendation(s), the decision) →
// 3 bed & admit. This page is the only place an admission is started. The
// admission is saved only once the legal status is Active and takes its type
// from it; there is no free-text legal basis.

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

// Next-of-kin options come from the served value set nok-notification. Capacity
// is not asked here: it is the formal capacity assessment the voluntary
// application requires (recorded once).

type LegalState = LegalWorkspace["legal_status"];

type FieldErrors = Partial<Record<string, string>>;

/** Fields rendered with an inline error; any other server error goes to the summary. */
const SHOWN_FIELDS = new Set([
  "patient",
  "legal_status_record",
  "admitted_at",
  "clinical_priority",
  "reason_for_admission",
  "consultant",
  "primary_care_team",
  "bed",
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
  if (admission.legal_status_record) {
    return <Tag tone="brand">Legal status active</Tag>;
  }
  // Admissions recorded before legal status first: their own legacy fields.
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
  admissionDate: string;
  priority: PriorityOrBlank;
  priorityTouched: boolean;
  reason: string;
  consultant: string;
  teamName: string;
  bed: string;
  nokNotification: NokNotification;
  nokNotes: string;
}

const emptyForm = (): FormState => ({
  clientText: "",
  patientId: "",
  admissionDate: todayIso(),
  priority: "",
  priorityTouched: false,
  reason: "",
  consultant: "",
  teamName: "",
  bed: "",
  nokNotification: "NOT_NOTIFIED",
  nokNotes: "",
});

const legalActive = (legal: LegalState) => legal?.status === "ACTIVE";

function validate(form: FormState, legal: LegalState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.patientId) errors.patient = "Choose a client from the list.";
  else if (!legalActive(legal)) {
    errors.legal_status_record =
      "Complete step 2 — the admission is saved once the legal status is approved.";
  }
  if (!form.admissionDate) errors.admitted_at = "Enter the admission date.";
  else if (form.admissionDate > todayIso())
    errors.admitted_at = "The admission date can't be in the future.";
  if (!form.bed) errors.bed = "Assign an available bed.";
  return errors;
}

/** What the admission itself records beside the legal status. */
function admissionExtras(form: FormState): Partial<Admission> {
  return {
    next_of_kin_notification: form.nokNotification,
    next_of_kin_notes: form.nokNotes.trim(),
  };
}

/** The admission's progress: each step done, current or still to come. */
function AdmissionSteps({ steps }: { steps: { label: string; done: boolean }[] }) {
  const current = steps.findIndex((st) => !st.done);
  return (
    <ol aria-label="Admission progress" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((st, i) => (
        <li key={st.label} className="flex items-center gap-2">
          <span
            aria-current={i === current ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-medium ${st.done ? "bg-brand-green-tint text-brand-green" : i === current ? "bg-ink-900 text-surface-card" : "bg-surface-bg text-ink-500"}`}
          >
            <span aria-hidden="true">{st.done ? "✓" : i + 1}</span>
            {st.label}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="text-ink-300">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function InpatientAdmissionsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from a client's Interventions → Admission: offer the way back.
  const backTo = (location.state as { from?: string } | null)?.from;
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
  // The chosen client's legal admission status (the single store), refetched
  // whenever the inline workflow changes it.
  const [loadedLegal, setLoadedLegal] = useState<{ patientId: string; legal: LegalState } | null>(
    null,
  );
  const [legalVersion, setLegalVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  const formRef = useRef<HTMLElement>(null);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const bannerRequest = useRef(0);
  // `?patient=<id>` (the client record's Admission module) preselects that
  // client once, when the eligible list first loads.
  const [params] = useSearchParams();
  const requestedPatient = useRef(params.get("patient"));

  // Bumped after an admission so the lists, beds and eligible clients refresh.
  const [reloadKey, setReloadKey] = useState(0);
  // The current admission shown as a summary (a client opened who is already admitted).
  const [summaryFor, setSummaryFor] = useState<string | null>(null);

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
        const requested = eligibleRows.find((p) => p.id === requestedPatient.current);
        const admitted = admissionRows.find((a) => a.patient === requestedPatient.current);
        requestedPatient.current = null;
        // Already admitted: show what was captured instead of a new admission.
        if (!requested && admitted) setSummaryFor(admitted.id);
        if (requested) {
          setForm((prev) => ({
            ...prev,
            clientText: patientLabel(requested),
            patientId: requested.id,
          }));
          const request = ++bannerRequest.current;
          getClientBanner(accessToken, requested.id)
            .then((banner) => {
              if (request !== bannerRequest.current) return;
              setForm((prev) =>
                prev.patientId === requested.id && !prev.priorityTouched
                  ? { ...prev, priority: banner.priority }
                  : prev,
              );
            })
            .catch(() => {
              // No banner (e.g. never triaged): the priority stays for the clinician to choose.
            });
        }
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

  useEffect(() => {
    const patientId = form.patientId;
    if (!accessToken || !patientId) return;
    let cancelled = false;
    getLegalWorkspace(accessToken, patientId)
      .then((ws) => !cancelled && setLoadedLegal({ patientId, legal: ws.legal_status }))
      .catch(() => !cancelled && setLoadedLegal({ patientId, legal: null }));
    return () => {
      cancelled = true;
    };
  }, [accessToken, form.patientId, legalVersion]);
  const legal = loadedLegal?.patientId === form.patientId ? loadedLegal.legal : null;

  const wardsById = new Map(wards.map((w) => [w.id, w]));
  const summaryAdmission = admissions.find((a) => a.id === summaryFor) ?? null;
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
    setSummaryFor(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    clientInputRef.current?.focus({ preventScroll: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setSuccess(null);
    const errors = validate(form, legal);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError("Some required details are missing — see the highlighted fields.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const admission = await admitPatient(accessToken, {
        patient: form.patientId,
        bed: form.bed,
        admitted_at: admittedAtFor(form.admissionDate),
        clinical_priority: form.priority,
        reason_for_admission: form.reason.trim(),
        consultant: form.consultant || null,
        primary_care_team: form.teamName.trim(),
        ...admissionExtras(form),
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
            {backTo && (
              <Link to={backTo} className={BTN_GHOST}>
                ← Back to client record
              </Link>
            )}
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => navigate("/clinical/inpatient/ward")}
            >
              Bed Management
            </button>
            <button type="button" className={BTN} onClick={startNewAdmission}>
              + New admission
            </button>
          </>
        }
      />

      <ErrorNote>{loadError}</ErrorNote>
      <ErrorNote>{valueSets.error}</ErrorNote>

      {summaryAdmission && (
        <AdmissionSummary
          admission={summaryAdmission}
          bedLabel={bedLabel(bedsById.get(summaryAdmission.bed), wardsById)}
          label={valueSets.label}
          onClose={() => setSummaryFor(null)}
        />
      )}

      <section
        ref={formRef}
        hidden={Boolean(summaryAdmission)}
        className="scroll-mt-4"
        aria-label="New admission"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <AdmissionSteps
            steps={[
              { label: "Client & reason", done: Boolean(form.patientId) },
              { label: "Admission type", done: Boolean(legal) && legal?.status !== "NOT_ADMITTED" },
              { label: "Legal steps", done: legalActive(legal) },
              { label: "Bed & admit", done: false },
            ]}
          />

          <Card title="1 · Client & reason">
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
              <Field label="Admission date" htmlFor="adm-date">
                <DateInput
                  id="adm-date"
                  className={INPUT}
                  value={form.admissionDate}
                  max={todayIso()}
                  required
                  {...invalid("admitted_at", "adm-date")}
                  onChange={(e) => update({ admissionDate: e.target.value })}
                />
                {errorFor("admitted_at", "adm-date")}
              </Field>
              <Field label="Reason for admission" htmlFor="adm-reason">
                <AutoResizeTextarea
                  id="adm-reason"
                  rows={2}
                  value={form.reason}
                  {...invalid("reason_for_admission", "adm-reason")}
                  onChange={(e) => update({ reason: e.target.value })}
                />
                {errorFor("reason_for_admission", "adm-reason")}
              </Field>
              <Field label="Clinical priority" htmlFor="adm-priority">
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
              <Field label="Responsible clinician & team" htmlFor="adm-consultant">
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
            </div>
          </Card>

          <Card title="2 · Admission type & legal steps">
            {form.patientId ? (
              <>
                {errorFor("legal_status_record", "adm-legal")}
                <LegalAdmissionStatus
                  mode="admission"
                  patientId={form.patientId}
                  onChanged={() => setLegalVersion((v) => v + 1)}
                />
              </>
            ) : (
              <p className="text-[13px] text-ink-500">Choose the client first.</p>
            )}
          </Card>

          <Card title="3 · Bed & admit">
            {!legalActive(legal) && (
              <p className="mb-3 text-[13px] text-ink-500">
                Available once the admission is approved in step 2.
              </p>
            )}
            <fieldset
              disabled={!legalActive(legal)}
              className="grid grid-cols-1 gap-x-4 gap-y-3 disabled:opacity-60 sm:grid-cols-2"
            >
              <Field label="Bed" htmlFor="adm-bed">
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
                      {bedLabel(bed, wardsById)}
                    </option>
                  ))}
                </select>
                {errorFor("bed", "adm-bed")}
              </Field>
              <Field label="Next of kin notified" htmlFor="adm-nok">
                <select
                  id="adm-nok"
                  className={INPUT}
                  value={form.nokNotification}
                  {...invalid("next_of_kin_notification", "adm-nok")}
                  onChange={(e) => update({ nokNotification: e.target.value as NokNotification })}
                >
                  {valueSets.options("nok-notification").map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
                {errorFor("next_of_kin_notification", "adm-nok")}
              </Field>
              <Field label="Next-of-kin notes" htmlFor="adm-nok-notes">
                <AutoResizeTextarea
                  id="adm-nok-notes"
                  rows={2}
                  value={form.nokNotes}
                  {...invalid("next_of_kin_notes", "adm-nok-notes")}
                  onChange={(e) => update({ nokNotes: e.target.value })}
                />
                {errorFor("next_of_kin_notes", "adm-nok-notes")}
              </Field>
            </fieldset>
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
                <button type="submit" className={BTN} disabled={isSaving || !legalActive(legal)}>
                  {isSaving ? "Admitting…" : "Admit client"}
                </button>
              </div>
            </div>
          </Card>
        </form>
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
