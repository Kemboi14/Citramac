import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import { PillRadio } from "../../components/PillRadio";
import { SaveButton } from "../../components/SaveButton";
import { listAttachments, uploadAttachment, type Attachment } from "../../lib/attachmentsApi";
import { listStaff, type Staff } from "../../lib/governanceApi";
import {
  admitPatient,
  dischargeAdmission,
  getAdmissionFhirBundle,
  listAdmissions,
  listBeds,
  listWards,
  transferAdmission,
  type Admission,
  type AdmissionType,
  type Bed,
  type ConsentStatus,
  type NokNotification,
  type ObservationLevel,
  type Ward,
} from "../../lib/ipdApi";

const FIELD_CLASS =
  "w-full rounded-sm border border-surface-border px-3 py-2 text-[12.6px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-[11.8px] font-semibold text-ink-700";
const SECTION_CLASS = "rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm";
const SECTION_TITLE_CLASS =
  "mb-4 flex items-center gap-2.5 font-display text-[14px] font-semibold text-ink-900";

const STATUS_TINT: Record<string, string> = {
  AVAILABLE: "bg-brand-green-tint text-brand-green-dark",
  OCCUPIED: "bg-status-red-tint text-status-red",
  MAINTENANCE: "bg-ink-100 text-ink-700",
};

const ADMISSION_TYPE_TINT: Record<AdmissionType, string> = {
  VOLUNTARY: "bg-brand-green-tint text-brand-green-dark",
  INVOLUNTARY: "bg-status-amber-tint text-status-amber",
};

const RISK_FIELDS: {
  key: "risk_self_harm" | "risk_to_others" | "risk_absconding" | "risk_medical";
  label: string;
  hint: string;
}[] = [
  {
    key: "risk_self_harm",
    label: "Self-harm / suicide risk",
    hint: "Risk identified and requires documented assessment.",
  },
  {
    key: "risk_to_others",
    label: "Risk to others",
    hint: "Aggression, violence or other immediate safety concern.",
  },
  {
    key: "risk_absconding",
    label: "Absconding / wandering risk",
    hint: "Consider enhanced observation and safe placement.",
  },
  {
    key: "risk_medical",
    label: "Medical / physical risk",
    hint: "Physical health concern requiring additional monitoring.",
  },
];

function SectionNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-brand-green-tint font-display text-[11px] font-bold text-brand-green-dark">
      {n}
    </span>
  );
}

interface FormState {
  admittedDate: string;
  admittedTime: string;
  admissionType: AdmissionType;
  admissionSource: string;
  priority: "ROUTINE" | "URGENT" | "EMERGENCY";
  reasonForAdmission: string;
  clinicalSummary: string;
  primaryDiagnosis: string;
  associatedConditions: string;
  risks: {
    risk_self_harm: boolean;
    risk_to_others: boolean;
    risk_absconding: boolean;
    risk_medical: boolean;
  };
  observationLevel: ObservationLevel;
  safetyActions: string;
  riskSummary: string;
  ward: string;
  bed: string;
  primaryCareTeam: string;
  consultant: string;
  initialCarePriorities: string;
  consentStatus: ConsentStatus;
  consentObtainedBy: string;
  capacityAssessed: "" | "YES" | "NO";
  consentNotes: string;
  legalStatus: string;
  legalOrderReference: string;
  legalOrderDate: string;
  legalReviewDueDate: string;
  authorizingProfessional: string;
  legalRationale: string;
  oversightNotes: string;
  nokNotification: NokNotification;
  nokNotes: string;
  handoverNote: string;
}

function emptyForm(): FormState {
  const now = new Date();
  return {
    admittedDate: now.toISOString().slice(0, 10),
    admittedTime: now.toTimeString().slice(0, 5),
    admissionType: "VOLUNTARY",
    admissionSource: "",
    priority: "ROUTINE",
    reasonForAdmission: "",
    clinicalSummary: "",
    primaryDiagnosis: "",
    associatedConditions: "",
    risks: {
      risk_self_harm: false,
      risk_to_others: false,
      risk_absconding: false,
      risk_medical: false,
    },
    observationLevel: "ROUTINE",
    safetyActions: "",
    riskSummary: "",
    ward: "",
    bed: "",
    primaryCareTeam: "",
    consultant: "",
    initialCarePriorities: "",
    consentStatus: "",
    consentObtainedBy: "",
    capacityAssessed: "",
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
    handoverNote: "",
  };
}

const REQUIRED_KEYS: (keyof FormState)[] = ["reasonForAdmission"];

/**
 * Module 7 — Admission, rebuilt against the second (2026-09) clinical-
 * workspace mockup's 7-section form (details / clinical reason / risk &
 * safety / ward+bed+care-team / consent-or-legal / next-of-kin /
 * attachments+handover). Every field maps to a real, already-existing
 * `ipd_ward.Admission` column — this was almost entirely a frontend
 * rebuild, see /home/nick/.claude/plans/drifting-baking-falcon.md Phase 3.
 * Two disclosed simplifications: there's no draft/pending-review admission
 * status in the backend (only ADMITTED/DISCHARGED/TRANSFERRED), so the
 * mockup's "Admission status" selector is omitted rather than faked; and
 * next-of-kin here is the admission's own notification status/notes field
 * (`next_of_kin_notification`), not a name/phone sub-form — that richer
 * contact detail already lives on `Patient.next_of_kin` from registration.
 */
export function IpdPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [admissionAttachments, setAdmissionAttachments] = useState<Attachment[]>([]);
  const [dischargeSummary, setDischargeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fhirPreview, setFhirPreview] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [showBedBoard, setShowBedBoard] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const refresh = async () => {
    if (!accessToken) return;
    const [wardRes, bedRes, admissionRes, staffRes] = await Promise.all([
      listWards(accessToken),
      listBeds(accessToken),
      listAdmissions(accessToken),
      listStaff(accessToken),
    ]);
    setWards(wardRes.results);
    setBeds(bedRes.results);
    setAdmissions(admissionRes.results);
    setStaff(staffRes.results);
  };

  const activeAdmission = admissions.find(
    (a) => a.patient === selected?.patientId && a.status !== "DISCHARGED",
  );

  useEffect(() => {
    if (!accessToken) return;
    // Deferred one microtask so `refresh`'s setState calls don't run
    // synchronously in the effect body itself.
    void Promise.resolve().then(() => refresh().catch(() => setError("Couldn't load ward data.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only depends on accessToken, already listed.
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !activeAdmission) return;
    listAttachments(accessToken, { admission: activeAdmission.id }).then((d) =>
      setAdmissionAttachments(d.results),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the id, not the whole `activeAdmission` object (which is a new reference every render).
  }, [accessToken, activeAdmission?.id]);

  if (!selected) {
    return (
      <p className="text-ink-500">
        Select a client from the{" "}
        <Link to="/clinical/registry" className="font-semibold text-brand-green hover:underline">
          Client Registry
        </Link>{" "}
        first.
      </p>
    );
  }

  const availableBeds = beds.filter(
    (b) => b.status === "AVAILABLE" && (!form.ward || b.ward === form.ward),
  );
  const patientAdmissions = admissions.filter((a) => a.patient === selected.patientId);
  const canSubmit =
    form.bed &&
    // eslint-disable-next-line security/detect-object-injection -- `k` is iterated from the fixed `REQUIRED_KEYS` const array, not user input.
    REQUIRED_KEYS.every((k) => String(form[k]).trim());

  const admit = async () => {
    if (!accessToken || !canSubmit) return;
    setError(null);
    try {
      const admittedAt = new Date(
        `${form.admittedDate}T${form.admittedTime || "00:00"}`,
      ).toISOString();
      await admitPatient(accessToken, {
        patient: selected.patientId,
        bed: form.bed,
        admitted_at: admittedAt,
        admission_type: form.admissionType,
        admission_source: form.admissionSource,
        priority: form.priority,
        reason_for_admission: form.reasonForAdmission,
        clinical_summary: form.clinicalSummary,
        primary_diagnosis: form.primaryDiagnosis,
        associated_conditions: form.associatedConditions,
        ...form.risks,
        observation_level: form.observationLevel,
        safety_actions: form.safetyActions,
        risk_summary: form.riskSummary,
        primary_care_team: form.primaryCareTeam,
        consultant: form.consultant || undefined,
        initial_care_priorities: form.initialCarePriorities,
        ...(form.admissionType === "VOLUNTARY"
          ? {
              consent_status: form.consentStatus || undefined,
              consent_obtained_by: form.consentObtainedBy || undefined,
              capacity_assessed: form.capacityAssessed ? form.capacityAssessed === "YES" : null,
              consent_notes: form.consentNotes,
            }
          : {
              legal_status: form.legalStatus,
              legal_order_reference: form.legalOrderReference,
              legal_order_date: form.legalOrderDate || null,
              legal_review_due_date: form.legalReviewDueDate || null,
              authorizing_professional: form.authorizingProfessional,
              legal_rationale: form.legalRationale,
              oversight_notes: form.oversightNotes,
            }),
        next_of_kin_notification: form.nokNotification,
        next_of_kin_notes: form.nokNotes,
        handover_note: form.handoverNote,
      });
      setForm(emptyForm());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't admit the patient.");
      throw err;
    }
  };

  const viewFhirBundle = async (admissionId: string) => {
    if (!accessToken) return;
    try {
      const bundle = await getAdmissionFhirBundle(accessToken, admissionId);
      setFhirPreview(JSON.stringify(bundle, null, 2));
    } catch {
      setError("Couldn't build the FHIR bundle for this admission.");
    }
  };

  const discharge = async () => {
    if (!accessToken || !activeAdmission) return;
    setError(null);
    try {
      await dischargeAdmission(accessToken, activeAdmission.id, dischargeSummary);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't discharge the patient.");
      throw err;
    }
  };

  const transfer = async (newBedId: string) => {
    if (!accessToken || !activeAdmission) return;
    setError(null);
    setBusy(true);
    try {
      await transferAdmission(accessToken, activeAdmission.id, newBedId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't transfer the patient.");
    } finally {
      setBusy(false);
    }
  };

  const uploadAdmissionDocument = async () => {
    if (!accessToken || !uploadFile || !activeAdmission) return;
    setError(null);
    try {
      await uploadAttachment(accessToken, {
        patient: selected.patientId,
        admission: activeAdmission.id,
        file: uploadFile,
        classification: "CURRENT",
        category: "CLINICAL",
        description: "Uploaded via Admission handover",
      });
      setUploadFile(null);
      const res = await listAttachments(accessToken, { admission: activeAdmission.id });
      setAdmissionAttachments(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the document.");
      throw err;
    }
  };

  const wardName = (wardId: string) => wards.find((w) => w.id === wardId)?.name ?? wardId;
  const bedLabel = (bedId: string) => {
    const bed = beds.find((b) => b.id === bedId);
    return bed ? `${wardName(bed.ward)} / Bed ${bed.bed_number}` : bedId;
  };
  const staffName = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.first_name} ${s.last_name}` : "—";
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-brand-green">
            Inpatient Admission
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {activeAdmission ? "Admission" : "New Admission"} — {selected.patientName}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowBedBoard((v) => !v)}
          className="rounded-md border border-surface-border bg-white px-3 py-2 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-bg"
        >
          {showBedBoard ? "Hide bed board" : "Show bed board"}
        </button>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {!activeAdmission ? (
        <>
          <div className="rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
            <label className={LABEL_CLASS}>
              Admission type
              <div className="mt-1">
                <PillRadio
                  value={form.admissionType}
                  onChange={(v) => set("admissionType", v)}
                  warnValue="INVOLUNTARY"
                  options={[
                    { value: "VOLUNTARY", label: "Voluntary Admission" },
                    { value: "INVOLUNTARY", label: "Involuntary Admission" },
                  ]}
                />
              </div>
            </label>
          </div>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={1} />
              Admission details
            </h2>
            <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
              <label className={LABEL_CLASS}>
                Admission date <span className="text-status-red">*</span>
                <input
                  type="date"
                  className={FIELD_CLASS}
                  value={form.admittedDate}
                  onChange={(e) => set("admittedDate", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Admission time <span className="text-status-red">*</span>
                <input
                  type="time"
                  className={FIELD_CLASS}
                  value={form.admittedTime}
                  onChange={(e) => set("admittedTime", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Admission source
                <select
                  className={FIELD_CLASS}
                  value={form.admissionSource}
                  onChange={(e) => set("admissionSource", e.target.value)}
                >
                  <option value="">Select source</option>
                  <option>Emergency / urgent referral</option>
                  <option>Outpatient service</option>
                  <option>Community / CCP referral</option>
                  <option>Other health facility</option>
                  <option>Self / family presentation</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Admission priority
                <select
                  className={FIELD_CLASS}
                  value={form.priority}
                  onChange={(e) => set("priority", e.target.value as FormState["priority"])}
                >
                  <option value="ROUTINE">Routine</option>
                  <option value="URGENT">Urgent</option>
                  <option value="EMERGENCY">Emergency</option>
                </select>
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={2} />
              Clinical reason for admission
            </h2>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <label className={`${LABEL_CLASS} md:col-span-2`}>
                Presenting problem / reason for admission <span className="text-status-red">*</span>
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={form.reasonForAdmission}
                  onChange={(e) => set("reasonForAdmission", e.target.value)}
                />
              </label>
              <label className={`${LABEL_CLASS} md:col-span-2`}>
                Clinical summary / admission assessment
                <textarea
                  className={FIELD_CLASS}
                  rows={3}
                  value={form.clinicalSummary}
                  onChange={(e) => set("clinicalSummary", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Primary diagnosis / working diagnosis
                <input
                  className={FIELD_CLASS}
                  value={form.primaryDiagnosis}
                  onChange={(e) => set("primaryDiagnosis", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Associated conditions
                <input
                  className={FIELD_CLASS}
                  value={form.associatedConditions}
                  onChange={(e) => set("associatedConditions", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={3} />
              Risk and immediate safety
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {RISK_FIELDS.map(({ key, label, hint }) => (
                <label
                  key={key}
                  className="flex items-start gap-2.5 rounded-md border border-surface-border bg-surface-bg p-2.5"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-green"
                    // eslint-disable-next-line security/detect-object-injection -- `key` is destructured from the fixed local `RISK_FIELDS` array, not user input.
                    checked={form.risks[key]}
                    onChange={(e) => set("risks", { ...form.risks, [key]: e.target.checked })}
                  />
                  <span>
                    <strong className="block text-[12px] text-ink-900">{label}</strong>
                    <span className="text-[10.5px] text-ink-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <label className={LABEL_CLASS}>
                Observation level <span className="text-status-red">*</span>
                <select
                  className={FIELD_CLASS}
                  value={form.observationLevel}
                  onChange={(e) => set("observationLevel", e.target.value as ObservationLevel)}
                >
                  <option value="ROUTINE">Routine observation</option>
                  <option value="ENHANCED">Enhanced observation</option>
                  <option value="CLOSE">Close observation</option>
                  <option value="CONTINUOUS">Continuous observation</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Immediate safety actions
                <input
                  className={FIELD_CLASS}
                  placeholder="Precautions, belongings, environment, escort or monitoring"
                  value={form.safetyActions}
                  onChange={(e) => set("safetyActions", e.target.value)}
                />
              </label>
              <label className={`${LABEL_CLASS} md:col-span-2`}>
                Risk assessment summary
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={form.riskSummary}
                  onChange={(e) => set("riskSummary", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={4} />
              Ward, bed and care team
            </h2>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <label className={LABEL_CLASS}>
                Ward
                <select
                  className={FIELD_CLASS}
                  value={form.ward}
                  onChange={(e) => set("ward", e.target.value)}
                >
                  <option value="">All wards</option>
                  {wards.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Bed <span className="text-status-red">*</span>
                <select
                  className={FIELD_CLASS}
                  value={form.bed}
                  onChange={(e) => set("bed", e.target.value)}
                >
                  <option value="">Select available bed…</option>
                  {availableBeds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {bedLabel(b.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Primary care team
                <input
                  className={FIELD_CLASS}
                  placeholder="e.g. Female Ward Team"
                  value={form.primaryCareTeam}
                  onChange={(e) => set("primaryCareTeam", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Consultant / responsible clinician
                <select
                  className={FIELD_CLASS}
                  value={form.consultant}
                  onChange={(e) => set("consultant", e.target.value)}
                >
                  <option value="">Select…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.first_name} {s.last_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${LABEL_CLASS} md:col-span-2`}>
                Initial care priorities
                <textarea
                  className={FIELD_CLASS}
                  rows={2}
                  value={form.initialCarePriorities}
                  onChange={(e) => set("initialCarePriorities", e.target.value)}
                />
              </label>
            </div>
          </section>

          {form.admissionType === "VOLUNTARY" ? (
            <section className={SECTION_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <SectionNumber n={5} />
                Voluntary admission and consent
              </h2>
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                <label className={LABEL_CLASS}>
                  Consent status
                  <select
                    className={FIELD_CLASS}
                    value={form.consentStatus}
                    onChange={(e) => set("consentStatus", e.target.value as ConsentStatus)}
                  >
                    <option value="">Select status</option>
                    <option value="PENDING">Consent pending</option>
                    <option value="OBTAINED">Consent obtained</option>
                    <option value="DECLINED">Consent declined</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Consent obtained by
                  <select
                    className={FIELD_CLASS}
                    value={form.consentObtainedBy}
                    onChange={(e) => set("consentObtainedBy", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.first_name} {s.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Capacity / understanding documented
                  <select
                    className={FIELD_CLASS}
                    value={form.capacityAssessed}
                    onChange={(e) =>
                      set("capacityAssessed", e.target.value as FormState["capacityAssessed"])
                    }
                  >
                    <option value="">Not assessed</option>
                    <option value="YES">Yes</option>
                    <option value="NO">No</option>
                  </select>
                </label>
                <label className={`${LABEL_CLASS} md:col-span-2`}>
                  Consent / admission notes
                  <textarea
                    className={FIELD_CLASS}
                    rows={2}
                    value={form.consentNotes}
                    onChange={(e) => set("consentNotes", e.target.value)}
                  />
                </label>
              </div>
            </section>
          ) : (
            <section className={SECTION_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <SectionNumber n={5} />
                Legal status and involuntary admission
              </h2>
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
                <label className={LABEL_CLASS}>
                  Legal status / order
                  <input
                    className={FIELD_CLASS}
                    placeholder="Involuntary admission order"
                    value={form.legalStatus}
                    onChange={(e) => set("legalStatus", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Order / reference number <span className="text-status-red">*</span>
                  <input
                    className={FIELD_CLASS}
                    placeholder="MHA-2026-014"
                    value={form.legalOrderReference}
                    onChange={(e) => set("legalOrderReference", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Order date
                  <input
                    type="date"
                    className={FIELD_CLASS}
                    value={form.legalOrderDate}
                    onChange={(e) => set("legalOrderDate", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Review due date <span className="text-status-red">*</span>
                  <input
                    type="date"
                    className={FIELD_CLASS}
                    value={form.legalReviewDueDate}
                    onChange={(e) => set("legalReviewDueDate", e.target.value)}
                  />
                </label>
                <label className={`${LABEL_CLASS} md:col-span-2`}>
                  Authorizing professional / authority
                  <input
                    className={FIELD_CLASS}
                    value={form.authorizingProfessional}
                    onChange={(e) => set("authorizingProfessional", e.target.value)}
                  />
                </label>
                <label className={`${LABEL_CLASS} md:col-span-2`}>
                  Legal / clinical rationale
                  <textarea
                    className={FIELD_CLASS}
                    rows={2}
                    value={form.legalRationale}
                    onChange={(e) => set("legalRationale", e.target.value)}
                  />
                </label>
                <label className={`${LABEL_CLASS} md:col-span-2`}>
                  Review Board / oversight notes
                  <textarea
                    className={FIELD_CLASS}
                    rows={2}
                    value={form.oversightNotes}
                    onChange={(e) => set("oversightNotes", e.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2 rounded-md border border-status-amber/40 bg-status-amber-tint p-2.5 text-[11.5px] text-status-amber">
                Set the review due date and keep the legal record linked to this same admission.
              </div>
            </section>
          )}

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={6} />
              Next of kin and notifications
            </h2>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <label className={LABEL_CLASS}>
                Notification status
                <select
                  className={FIELD_CLASS}
                  value={form.nokNotification}
                  onChange={(e) => set("nokNotification", e.target.value as NokNotification)}
                >
                  <option value="NOT_NOTIFIED">Not yet notified</option>
                  <option value="NOTIFIED">Notified</option>
                  <option value="NOT_APPLICABLE">Notification not applicable</option>
                  <option value="UNABLE_TO_REACH">Unable to reach</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Notification notes
                <input
                  className={FIELD_CLASS}
                  placeholder="Date/time, person contacted and outcome"
                  value={form.nokNotes}
                  onChange={(e) => set("nokNotes", e.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-[10.5px] text-ink-400">
              Contact details for the client&apos;s next of kin are captured once, at registration
              (Client Registry) — this section only tracks whether/how they were notified of this
              admission.
            </p>
          </section>

          <section className={SECTION_CLASS}>
            <h2 className={SECTION_TITLE_CLASS}>
              <SectionNumber n={7} />
              Handover
            </h2>
            <label className={LABEL_CLASS}>
              Handover / admission note
              <textarea
                className={FIELD_CLASS}
                rows={3}
                placeholder="Key information for nursing and multidisciplinary care team at admission."
                value={form.handoverNote}
                onChange={(e) => set("handoverNote", e.target.value)}
              />
            </label>
            <p className="mt-2 text-[10.5px] text-ink-400">
              Document attachments (referral, consent, legal order) can be added once this admission
              is submitted, from the Current Admission card below.
            </p>
          </section>

          <div className="flex justify-end">
            <SaveButton onSave={admit} disabled={!canSubmit}>
              Submit admission
            </SaveButton>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-ink-900">Current Admission</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${ADMISSION_TYPE_TINT[activeAdmission.admission_type]}`}
            >
              {activeAdmission.admission_type === "VOLUNTARY" ? "Voluntary" : "Involuntary"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12.5px] text-ink-700 md:grid-cols-4">
            <div>
              <span className="text-ink-400">Bed</span>
              <div className="font-semibold">{bedLabel(activeAdmission.bed)}</div>
            </div>
            <div>
              <span className="text-ink-400">Status</span>
              <div className="font-semibold">{activeAdmission.status}</div>
            </div>
            <div>
              <span className="text-ink-400">Observation</span>
              <div className="font-semibold">{activeAdmission.observation_level}</div>
            </div>
            <div>
              <span className="text-ink-400">Consultant</span>
              <div className="font-semibold">{staffName(activeAdmission.consultant)}</div>
            </div>
          </div>
          {activeAdmission.reason_for_admission && (
            <p className="mt-3 text-[12.5px] text-ink-700">
              <span className="text-ink-400">Reason: </span>
              {activeAdmission.reason_for_admission}
            </p>
          )}
          {activeAdmission.legal_review_due_date && (
            <p className="mt-2 text-[11.5px] font-semibold text-status-amber">
              Legal review due {activeAdmission.legal_review_due_date}
            </p>
          )}

          <div className="mt-4 flex items-end gap-3">
            <label className={`${LABEL_CLASS} flex-1`}>
              Transfer to
              <select
                className={FIELD_CLASS}
                onChange={(e) => e.target.value && transfer(e.target.value)}
                value=""
              >
                <option value="">Select a bed…</option>
                {beds
                  .filter((b) => b.status === "AVAILABLE")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {bedLabel(b.id)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex items-end gap-3">
            <label className={`${LABEL_CLASS} flex-1`}>
              Discharge summary
              <textarea
                className={FIELD_CLASS}
                rows={2}
                value={dischargeSummary}
                onChange={(e) => setDischargeSummary(e.target.value)}
              />
            </label>
            <SaveButton onSave={discharge}>Discharge</SaveButton>
          </div>

          <div className="mt-5 border-t border-surface-border pt-4">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">
              Attachments &amp; handover
            </h3>
            {activeAdmission.handover_note && (
              <p className="mb-2 whitespace-pre-wrap rounded-md bg-surface-bg p-2.5 text-[12px] text-ink-700">
                {activeAdmission.handover_note}
              </p>
            )}
            {admissionAttachments.map((a) => (
              <a
                key={a.id}
                href={a.file}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between border-t border-surface-bg py-2 text-[12px] first:border-t-0 hover:bg-brand-green-tint-2"
              >
                <span className="text-brand-green">{a.file.split("/").pop()}</span>
                <span className="text-ink-500">{new Date(a.uploaded_at).toLocaleDateString()}</span>
              </a>
            ))}
            <div className="mt-2 flex items-center gap-2">
              <input
                type="file"
                className="text-[11.5px]"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <SaveButton onSave={uploadAdmissionDocument} disabled={!uploadFile} variant="ghost">
                Upload
              </SaveButton>
            </div>
          </div>
        </div>
      )}

      {showBedBoard && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Bed Board</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {beds.map((b) => (
              <div
                key={b.id}
                className={`rounded-sm px-3 py-2 text-sm font-medium transition-transform duration-150 hover:-translate-y-0.5 ${STATUS_TINT[b.status] ?? ""} ${busy ? "opacity-60" : ""}`}
              >
                {bedLabel(b.id)}
                <div className="text-xs opacity-80">{b.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {patientAdmissions.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
            Admission History
          </h2>
          <div className="flex flex-col">
            {patientAdmissions.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 border-t border-surface-bg py-3 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
              >
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${ADMISSION_TYPE_TINT[a.admission_type]}`}
                >
                  {a.admission_type === "VOLUNTARY" ? "Voluntary" : "Involuntary"}
                </span>
                <div className="flex-1 text-sm text-ink-700">
                  {bedLabel(a.bed)} · {a.status} · {new Date(a.admitted_at).toLocaleDateString()}
                  {a.legal_review_due_date && (
                    <span className="ml-2 text-status-amber">
                      Legal review due {a.legal_review_due_date}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-sm border border-surface-border px-2 py-1 text-[11px] font-semibold text-ink-700 hover:bg-brand-green-tint-2"
                  onClick={() => viewFhirBundle(a.id)}
                >
                  View FHIR bundle
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {fhirPreview && (
        <div className="animate-scale-in rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-ink-900">FHIR Bundle</h2>
            <button
              type="button"
              className="text-sm font-semibold text-brand-green"
              onClick={() => setFhirPreview(null)}
            >
              Close
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-sm bg-surface-bg p-3 text-xs text-ink-700">
            {fhirPreview}
          </pre>
        </div>
      )}
    </div>
  );
}
