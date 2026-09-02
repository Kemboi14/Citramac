import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  createEncounter,
  getPatient,
  listEncountersForPatient,
  searchIcd11,
  type EncounterRow,
  type Icd11Code,
} from "../../lib/clinicalApi";
import {
  createDiagnosis,
  listDiagnosesForPatient,
  updateDiagnosis,
  type Diagnosis,
} from "../../lib/diagnosesApi";
import {
  listAttachments,
  uploadAttachment,
  type Attachment,
  type AttachmentCategory,
} from "../../lib/attachmentsApi";
import { createAppointment, listAppointments, type Appointment } from "../../lib/appointmentsApi";
import {
  getAdmissionFhirBundle,
  listAdmissions,
  type Admission,
  type AdmissionType,
} from "../../lib/ipdApi";
import { ClientHistoryPage } from "./ClientHistoryPage";

interface PatientDetail {
  first_name: string;
  last_name: string;
  uhid_number: string;
  citramac_number: string;
  gender: string;
  age: number;
  allergy_status: string;
  patient_category: string;
  contact_phone: string;
}

const TABS = [
  "Overview",
  "Diagnoses",
  "Client History",
  "Admission",
  "Documents",
  "Appointments",
] as const;
type Tab = (typeof TABS)[number];

const ADMISSION_TYPE_TINT: Record<AdmissionType, string> = {
  VOLUNTARY: "bg-brand-green-tint text-brand-green-dark",
  INVOLUNTARY: "bg-status-amber-tint text-status-amber",
};

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const STATUS_BADGE = "rounded-full px-2.5 py-1 text-[10px] font-semibold";

const ALLERGY_BADGE: Record<string, string> = {
  ACTIVE_ALLERGIES: "bg-status-red-tint text-status-red",
  UNKNOWN: "bg-status-amber-tint text-status-amber",
  NONE: "bg-brand-green-tint text-brand-green-dark",
};

const CARE_LABEL_LOOKUP: Record<string, string> = {
  OUTPATIENT: "Outpatient",
  INPATIENT: "Inpatient",
  POSTTREATMENT_SUPPORT: "Post-treatment support",
};

/**
 * Unified per-client workspace — mockups/citramac_clinical_workspace.html's
 * patient banner + tabs (Overview/Diagnoses/Client History/Documents/
 * Appointments). Encounters/Clinical Notes/Assessments stay on their own
 * dedicated pages (Triage & MSE, Clinical Encounter, CCP sessions) rather
 * than being duplicated here — reached via the links below.
 */
export function PatientWorkspacePage() {
  const { accessToken } = useAuth();
  const { selected, setEncounter } = usePatientContext();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("Overview");
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [fhirPreview, setFhirPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedDiagnosis, setSelectedDiagnosis] = useState<Diagnosis | null>(null);
  const [showNewDiagnosis, setShowNewDiagnosis] = useState(false);
  const [icdQuery, setIcdQuery] = useState("");
  const [icdResults, setIcdResults] = useState<Icd11Code[]>([]);
  const [icdSelected, setIcdSelected] = useState<Icd11Code | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<AttachmentCategory>("CLINICAL");
  const [apptDateTime, setApptDateTime] = useState("");
  const [apptType, setApptType] = useState("");

  const refresh = () => {
    if (!accessToken || !selected) return;
    getPatient(accessToken, selected.patientId).then((data) =>
      setPatient(data as unknown as PatientDetail),
    );
    listDiagnosesForPatient(accessToken, selected.patientId).then((d) => setDiagnoses(d.results));
    listEncountersForPatient(accessToken, selected.patientId).then((d) => setEncounters(d.results));
    listAttachments(accessToken, { patient: selected.patientId }).then((d) =>
      setAttachments(d.results),
    );
    listAppointments(accessToken, { patient: selected.patientId }).then((d) =>
      setAppointments(d.results),
    );
    listAdmissions(accessToken, { patient: selected.patientId }).then((d) =>
      setAdmissions(d.results),
    );
  };

  useEffect(refresh, [accessToken, selected]);

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

  const ensureEncounterId = async (): Promise<string> => {
    if (selected.encounterId) return selected.encounterId;
    if (!accessToken) throw new Error("Not authenticated");
    const encounter = await createEncounter(accessToken, selected.patientId, "OUTPATIENT");
    setEncounter(encounter.id);
    return encounter.id;
  };

  const runIcdSearch = async (query: string) => {
    setIcdQuery(query);
    if (!accessToken || query.trim().length < 2) {
      setIcdResults([]);
      return;
    }
    try {
      setIcdResults(await searchIcd11(accessToken, query));
    } catch {
      setIcdResults([]);
    }
  };

  const submitDiagnosis = async () => {
    if (!accessToken || !icdSelected) return;
    setBusy(true);
    setError(null);
    try {
      const encounterId = await ensureEncounterId();
      await createDiagnosis(accessToken, {
        encounter: encounterId,
        icd11_code: icdSelected.code,
        is_primary: isPrimary,
      });
      setShowNewDiagnosis(false);
      setIcdQuery("");
      setIcdResults([]);
      setIcdSelected(null);
      setIsPrimary(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the diagnosis.");
    } finally {
      setBusy(false);
    }
  };

  const saveDiagnosisDetail = async (patch: Partial<Diagnosis>) => {
    if (!accessToken || !selectedDiagnosis) return;
    const updated = await updateDiagnosis(accessToken, selectedDiagnosis.id, patch);
    setSelectedDiagnosis(updated);
    refresh();
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

  const upload = async () => {
    if (!accessToken || !uploadFile) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAttachment(accessToken, {
        patient: selected.patientId,
        file: uploadFile,
        classification: "CURRENT",
        category: uploadCategory,
      });
      setUploadFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't upload the document.");
    } finally {
      setBusy(false);
    }
  };

  const bookAppointment = async () => {
    if (!accessToken || !apptDateTime) return;
    setBusy(true);
    setError(null);
    try {
      await createAppointment(accessToken, {
        patient: selected.patientId,
        scheduled_for: new Date(apptDateTime).toISOString(),
        appointment_type: apptType,
      });
      setApptDateTime("");
      setApptType("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't book the appointment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-4 rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand-green-tint text-lg font-bold text-brand-green-dark">
          {selected.patientName
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)}
        </div>
        <div className="min-w-[220px]">
          <h1 className="font-display text-lg font-bold text-ink-900">{selected.patientName}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {patient?.uhid_number || patient?.citramac_number || "—"} · {patient?.gender} ·{" "}
            {patient?.age} yrs
          </p>
        </div>
        {patient && (
          <span className={`${STATUS_BADGE} ${ALLERGY_BADGE[patient.allergy_status] ?? ""}`}>
            {patient.allergy_status.replace(/_/g, " ")}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => navigate("/clinical/encounter")}
          >
            + New encounter
          </button>
          {patient?.patient_category === "INPATIENT" && (
            <button
              type="button"
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-brand-green-tint-2"
              onClick={() => setTab("Admission")}
            >
              Admission
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-[11px] font-bold transition-colors duration-150 ${
              tab === t
                ? "border-brand-green text-brand-green-dark"
                : "border-transparent text-ink-500 hover:text-brand-green-dark"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      {tab === "Overview" && (
        <div className="grid animate-fade-in grid-cols-2 gap-4 max-lg:grid-cols-1">
          <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-3 font-display text-base font-semibold text-ink-900">
              Recent encounters
            </h2>
            {encounters.length === 0 && <p className="text-sm text-ink-500">No encounters yet.</p>}
            {encounters.slice(0, 5).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setEncounter(e.id);
                  navigate("/clinical/encounter");
                }}
                className="flex w-full items-center justify-between border-t border-surface-bg py-2.5 text-left first:border-t-0 hover:bg-brand-green-tint-2"
              >
                <span className="text-sm text-ink-700">{e.encounter_type || "Encounter"}</span>
                <span className="text-xs text-ink-500">
                  {new Date(e.opened_at).toLocaleDateString()} · {e.status}
                </span>
              </button>
            ))}
          </section>
          <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-3 font-display text-base font-semibold text-ink-900">Quick links</h2>
            <div className="flex flex-col gap-2 text-sm">
              <Link className="text-brand-green hover:underline" to="/clinical/triage">
                Triage &amp; MSE
              </Link>
              <Link className="text-brand-green hover:underline" to="/clinical/review">
                Clinical Review
              </Link>
              <Link className="text-brand-green hover:underline" to="/clinical/ipd">
                Inpatient &amp; Ward / Admission
              </Link>
              <Link className="text-brand-green hover:underline" to="/clinical/ccp/individual">
                Individual Psychotherapy
              </Link>
            </div>
          </section>
        </div>
      )}

      {tab === "Diagnoses" && (
        <div className="grid animate-fade-in grid-cols-[1fr_1.4fr] gap-4 max-lg:grid-cols-1">
          <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-ink-900">Diagnoses</h2>
              <button
                type="button"
                className="text-sm font-semibold text-brand-green"
                onClick={() => setShowNewDiagnosis((v) => !v)}
              >
                + New Diagnosis
              </button>
            </div>

            {showNewDiagnosis && (
              <div className="mb-4 flex animate-scale-in flex-col gap-2 rounded-md border border-surface-border p-3">
                <input
                  className={FIELD_CLASS}
                  placeholder="Search ICD-11..."
                  value={icdQuery}
                  onChange={(e) => runIcdSearch(e.target.value)}
                />
                {icdResults.length > 0 && (
                  <div className="max-h-40 overflow-auto rounded-sm border border-surface-border">
                    {icdResults.map((r) => (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => {
                          setIcdSelected(r);
                          setIcdQuery(`${r.code} — ${r.description}`);
                          setIcdResults([]);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-brand-green-tint-2"
                      >
                        {r.code} — {r.description}
                      </button>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    checked={isPrimary}
                    onChange={(e) => setIsPrimary(e.target.checked)}
                  />
                  Primary diagnosis
                </label>
                <button
                  type="button"
                  disabled={busy || !icdSelected}
                  className={BUTTON_CLASS}
                  onClick={submitDiagnosis}
                >
                  Save diagnosis
                </button>
              </div>
            )}

            {diagnoses.length === 0 && (
              <p className="text-sm text-ink-500">No diagnoses recorded yet.</p>
            )}
            {diagnoses.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDiagnosis(d)}
                className={`flex w-full items-center justify-between border-t border-surface-bg py-3 text-left first:border-t-0 ${
                  selectedDiagnosis?.id === d.id ? "bg-brand-green-tint-2" : ""
                }`}
              >
                <div>
                  <strong className="text-sm text-ink-900">
                    {d.icd11_code} — {d.icd11_description}
                  </strong>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(d.noted_at).toLocaleDateString()}
                    {d.is_primary && " · Primary"}
                  </p>
                </div>
                <span className={`${STATUS_BADGE} bg-brand-green-tint text-brand-green-dark`}>
                  {d.status}
                </span>
              </button>
            ))}
          </section>

          <section className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
            <h2 className="mb-3 font-display text-base font-semibold text-ink-900">
              Diagnosis details
            </h2>
            {!selectedDiagnosis && (
              <p className="text-sm text-ink-500">Select a diagnosis to view or edit details.</p>
            )}
            {selectedDiagnosis && (
              <div className="flex flex-col gap-3">
                <strong className="text-sm text-ink-900">
                  {selectedDiagnosis.icd11_code} — {selectedDiagnosis.icd11_description}
                </strong>
                <label className={LABEL_CLASS}>
                  Status
                  <select
                    className={FIELD_CLASS}
                    value={selectedDiagnosis.status}
                    onChange={(e) =>
                      saveDiagnosisDetail({ status: e.target.value as Diagnosis["status"] })
                    }
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="HISTORICAL">Historical</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Clinical description
                  <textarea
                    className={FIELD_CLASS}
                    rows={3}
                    defaultValue={selectedDiagnosis.clinical_notes}
                    onBlur={(e) => saveDiagnosisDetail({ clinical_notes: e.target.value })}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Diagnostic criteria met
                  <textarea
                    className={FIELD_CLASS}
                    rows={3}
                    defaultValue={selectedDiagnosis.diagnostic_criteria_met}
                    onBlur={(e) => saveDiagnosisDetail({ diagnostic_criteria_met: e.target.value })}
                  />
                </label>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "Client History" && <ClientHistoryPage />}

      {tab === "Admission" && (
        <section className="animate-fade-in rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-ink-900">Admission history</h2>
            <button
              type="button"
              className="text-sm font-semibold text-brand-green"
              onClick={() => navigate("/clinical/ipd")}
            >
              {patient?.patient_category === "INPATIENT" ? "Manage admission" : "Start admission"}
            </button>
          </div>
          {patient?.patient_category !== "INPATIENT" && (
            <p className="mb-4 text-xs text-status-amber">
              This client is registered as{" "}
              {CARE_LABEL_LOOKUP[patient?.patient_category ?? ""] ?? "—"}. Only Inpatient clients
              can be admitted.
            </p>
          )}
          {admissions.length === 0 && (
            <p className="text-sm text-ink-500">No admissions recorded yet.</p>
          )}
          {admissions.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 border-t border-surface-bg py-3 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
            >
              <span className={`${STATUS_BADGE} ${ADMISSION_TYPE_TINT[a.admission_type]}`}>
                {a.admission_type === "VOLUNTARY" ? "Voluntary" : "Involuntary"}
              </span>
              <div className="flex-1 text-sm text-ink-700">
                {a.bed_label} · {a.status} · {new Date(a.admitted_at).toLocaleDateString()}
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
          {fhirPreview && (
            <div className="animate-scale-in mt-4 rounded-md border border-surface-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-sm text-ink-900">FHIR Bundle</strong>
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-green"
                  onClick={() => setFhirPreview(null)}
                >
                  Close
                </button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-sm bg-surface-bg p-3 text-xs text-ink-700">
                {fhirPreview}
              </pre>
            </div>
          )}
        </section>
      )}

      {tab === "Documents" && (
        <section className="animate-fade-in rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Documents</h2>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className={LABEL_CLASS}>
              Category
              <select
                className={FIELD_CLASS}
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as AttachmentCategory)}
              >
                <option value="CLINICAL">Clinical Documents</option>
                <option value="IDENTITY">Identity Documents</option>
                <option value="ASSESSMENT">Assessments</option>
                <option value="CONSENT">Consents</option>
                <option value="LAB_RESULT">Lab Results</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
              <span className="text-[10px] text-ink-400">Up to 30MB</span>
            </div>
            <button
              type="button"
              disabled={busy || !uploadFile}
              className={BUTTON_CLASS}
              onClick={upload}
            >
              Upload
            </button>
          </div>
          {attachments.length === 0 && <p className="text-sm text-ink-500">No documents yet.</p>}
          {attachments.map((a) => (
            <a
              key={a.id}
              href={a.file}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between border-t border-surface-bg py-2.5 first:border-t-0 hover:bg-brand-green-tint-2"
            >
              <span className="text-sm text-brand-green">{a.file.split("/").pop()}</span>
              <span className="text-xs text-ink-500">
                {new Date(a.uploaded_at).toLocaleDateString()}
              </span>
            </a>
          ))}
        </section>
      )}

      {tab === "Appointments" && (
        <section className="animate-fade-in rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Appointments</h2>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className={LABEL_CLASS}>
              Date &amp; time
              <input
                type="datetime-local"
                className={FIELD_CLASS}
                value={apptDateTime}
                onChange={(e) => setApptDateTime(e.target.value)}
              />
            </label>
            <label className={LABEL_CLASS}>
              Type
              <input
                className={FIELD_CLASS}
                value={apptType}
                onChange={(e) => setApptType(e.target.value)}
                placeholder="Psychiatric review"
              />
            </label>
            <button
              type="button"
              disabled={busy || !apptDateTime}
              className={BUTTON_CLASS}
              onClick={bookAppointment}
            >
              Book
            </button>
          </div>
          {appointments.length === 0 && (
            <p className="text-sm text-ink-500">No appointments yet.</p>
          )}
          {appointments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between border-t border-surface-bg py-2.5 transition-colors duration-150 first:border-t-0 hover:bg-brand-green-tint-2"
            >
              <span className="text-sm text-ink-700">{a.appointment_type || "Appointment"}</span>
              <span className="text-xs text-ink-500">
                {new Date(a.scheduled_for).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span className={`${STATUS_BADGE} bg-brand-green-tint text-brand-green-dark`}>
                {a.status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
