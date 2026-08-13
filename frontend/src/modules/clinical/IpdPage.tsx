import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { usePatientContext } from "../../clinical/PatientContext";
import { ApiError } from "../../lib/apiClient";
import {
  admitPatient,
  dischargeAdmission,
  listAdmissions,
  listBeds,
  listWards,
  transferAdmission,
  type Admission,
  type Bed,
  type Ward,
} from "../../lib/ipdApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark disabled:opacity-60";

const STATUS_TINT: Record<string, string> = {
  AVAILABLE: "bg-brand-green-tint text-brand-green-dark",
  OCCUPIED: "bg-status-red-tint text-status-red",
  MAINTENANCE: "bg-ink-100 text-ink-700",
};

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
        <Link to="/clinical" className="font-semibold text-brand-green hover:underline">
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

  const admit = async () => {
    if (!accessToken || !selectedBed) return;
    setError(null);
    setBusy(true);
    try {
      await admitPatient(accessToken, selected.patientId, selectedBed);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't admit the patient.");
    } finally {
      setBusy(false);
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
    <div className="flex flex-col gap-6">
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
          <h2 className="mb-4 font-display text-base font-semibold text-ink-900">Admit</h2>
          <div className="flex items-end gap-3">
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
            <button
              type="button"
              disabled={busy || !selectedBed}
              className={BUTTON_CLASS}
              onClick={admit}
            >
              Admit
            </button>
          </div>
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
              className={`rounded-sm px-3 py-2 text-sm font-medium ${STATUS_TINT[b.status] ?? ""}`}
            >
              {bedLabel(b.id)}
              <div className="text-xs opacity-80">{b.status}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}
    </div>
  );
}
