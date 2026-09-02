import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import { ApiError } from "../../lib/apiClient";
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
  type ObservationLevel,
  type Ward,
} from "../../lib/ipdApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

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
}[] = [
  { key: "risk_self_harm", label: "Self-harm / suicide risk" },
  { key: "risk_to_others", label: "Risk to others" },
  { key: "risk_absconding", label: "Absconding / wandering risk" },
  { key: "risk_medical", label: "Medical / physical risk" },
];

/** Module 7 — ADT ward/bed allocation, discharge planning — docs/07-CLINICAL-MODULES-SPEC.md §7.7. */
export function IpdPage() {
  const { accessToken } = useAuth();
  const { selected } = usePatientContext();

  const [wards, setWards] = useState<Ward[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [selectedBed, setSelectedBed] = useState("");
  const [dischargeSummary, setDischargeSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fhirPreview, setFhirPreview] = useState<string | null>(null);

  const [admissionType, setAdmissionType] = useState<AdmissionType>("VOLUNTARY");
  const [reasonForAdmission, setReasonForAdmission] = useState("");
  const [observationLevel, setObservationLevel] = useState<ObservationLevel>("ROUTINE");
  const [risks, setRisks] = useState({
    risk_self_harm: false,
    risk_to_others: false,
    risk_absconding: false,
    risk_medical: false,
  });
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>("");
  const [legalOrderReference, setLegalOrderReference] = useState("");
  const [legalReviewDueDate, setLegalReviewDueDate] = useState("");

  const refresh = async () => {
    if (!accessToken) return;
    const [wardRes, bedRes, admissionRes] = await Promise.all([
      listWards(accessToken),
      listBeds(accessToken),
      listAdmissions(accessToken),
    ]);
    setWards(wardRes.results);
    setBeds(bedRes.results);
    setAdmissions(admissionRes.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([listWards(accessToken), listBeds(accessToken), listAdmissions(accessToken)])
      .then(([wardRes, bedRes, admissionRes]) => {
        setWards(wardRes.results);
        setBeds(bedRes.results);
        setAdmissions(admissionRes.results);
      })
      .catch(() => setError("Couldn't load ward data."));
  }, [accessToken]);

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

  const availableBeds = beds.filter((b) => b.status === "AVAILABLE");
  const activeAdmission = admissions.find(
    (a) => a.patient === selected.patientId && a.status !== "DISCHARGED",
  );
  const patientAdmissions = admissions.filter((a) => a.patient === selected.patientId);

  const admit = async () => {
    if (!accessToken || !selectedBed) return;
    setError(null);
    setBusy(true);
    try {
      await admitPatient(accessToken, {
        patient: selected.patientId,
        bed: selectedBed,
        admission_type: admissionType,
        reason_for_admission: reasonForAdmission,
        observation_level: observationLevel,
        ...risks,
        ...(admissionType === "VOLUNTARY"
          ? { consent_status: consentStatus || undefined }
          : {
              legal_order_reference: legalOrderReference,
              legal_review_due_date: legalReviewDueDate || null,
            }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't admit the patient.");
    } finally {
      setBusy(false);
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
    setBusy(true);
    try {
      await dischargeAdmission(accessToken, activeAdmission.id, dischargeSummary);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't discharge the patient.");
    } finally {
      setBusy(false);
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

  const wardName = (wardId: string) => wards.find((w) => w.id === wardId)?.name ?? wardId;
  const bedLabel = (bedId: string) => {
    const bed = beds.find((b) => b.id === bedId);
    return bed ? `${wardName(bed.ward)} / Bed ${bed.bed_number}` : bedId;
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Module 7 · Inpatient &amp; Ward Management
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">
          Inpatient — {selected.patientName}
        </h1>
      </div>

      {!activeAdmission ? (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">New Admission</h2>
          <div className="mb-4 flex gap-2">
            {(["VOLUNTARY", "INVOLUNTARY"] as AdmissionType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAdmissionType(type)}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  admissionType === type
                    ? "border-brand-green bg-brand-green-tint text-brand-green-dark"
                    : "border-surface-border text-ink-700 hover:bg-brand-green-tint-2"
                }`}
              >
                {type === "VOLUNTARY" ? "Voluntary Admission" : "Involuntary Admission"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className={LABEL_CLASS}>
              Bed
              <select
                className={FIELD_CLASS}
                value={selectedBed}
                onChange={(e) => setSelectedBed(e.target.value)}
              >
                <option value="">Select a bed…</option>
                {availableBeds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {bedLabel(b.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Observation level
              <select
                className={FIELD_CLASS}
                value={observationLevel}
                onChange={(e) => setObservationLevel(e.target.value as ObservationLevel)}
              >
                <option value="ROUTINE">Routine observation</option>
                <option value="ENHANCED">Enhanced observation</option>
                <option value="CLOSE">Close observation</option>
                <option value="CONTINUOUS">Continuous observation</option>
              </select>
            </label>
            {admissionType === "VOLUNTARY" ? (
              <label className={LABEL_CLASS}>
                Consent status
                <select
                  className={FIELD_CLASS}
                  value={consentStatus}
                  onChange={(e) => setConsentStatus(e.target.value as ConsentStatus)}
                >
                  <option value="">Select status</option>
                  <option value="PENDING">Consent pending</option>
                  <option value="OBTAINED">Consent obtained</option>
                  <option value="DECLINED">Consent declined</option>
                </select>
              </label>
            ) : (
              <>
                <label className={LABEL_CLASS}>
                  Legal order reference
                  <input
                    className={FIELD_CLASS}
                    value={legalOrderReference}
                    onChange={(e) => setLegalOrderReference(e.target.value)}
                    placeholder="MHA-2026-014"
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Legal review due date
                  <input
                    type="date"
                    className={FIELD_CLASS}
                    value={legalReviewDueDate}
                    onChange={(e) => setLegalReviewDueDate(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>

          <label className={`${LABEL_CLASS} mt-3`}>
            Reason for admission
            <textarea
              className={FIELD_CLASS}
              rows={2}
              value={reasonForAdmission}
              onChange={(e) => setReasonForAdmission(e.target.value)}
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {RISK_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  // eslint-disable-next-line security/detect-object-injection -- `key` is destructured from the fixed local `RISK_FIELDS` array, not user input.
                  checked={risks[key]}
                  onChange={(e) => setRisks((prev) => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={busy || !selectedBed}
            className={`${BUTTON_CLASS} mt-4`}
            onClick={admit}
          >
            Submit admission
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">
            Current Admission
          </h2>
          <p className="text-sm text-ink-700">
            Bed: <span className="font-semibold">{bedLabel(activeAdmission.bed)}</span> · Status:{" "}
            {activeAdmission.status}
          </p>

          <div className="mt-4 flex items-end gap-3">
            <label className={LABEL_CLASS}>
              Transfer to
              <select
                className={FIELD_CLASS}
                onChange={(e) => e.target.value && transfer(e.target.value)}
                value=""
              >
                <option value="">Select a bed…</option>
                {availableBeds.map((b) => (
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
            <button type="button" disabled={busy} className={BUTTON_CLASS} onClick={discharge}>
              Discharge
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Bed Board</h2>
        <div className="grid grid-cols-4 gap-3">
          {beds.map((b) => (
            <div
              key={b.id}
              className={`rounded-sm px-3 py-2 text-sm font-medium transition-transform duration-150 hover:-translate-y-0.5 ${STATUS_TINT[b.status] ?? ""}`}
            >
              {bedLabel(b.id)}
              <div className="text-xs opacity-80">{b.status}</div>
            </div>
          ))}
        </div>
      </div>

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

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
