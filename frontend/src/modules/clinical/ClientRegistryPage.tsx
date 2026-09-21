import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { usePatientContext } from "../../clinical/usePatientContext";
import {
  getPatient,
  listPatients,
  type PatientDetail,
  type PatientListRow,
} from "../../lib/clinicalApi";
import { PatientRegistrationModal } from "./PatientRegistrationModal";
import { PatientDetailsModal } from "./PatientDetailsModal";
import { ResponsiveTable, type ResponsiveTableColumn } from "../../components/ResponsiveTable";

const ALLERGY_BADGE: Record<string, string> = {
  ACTIVE_ALLERGIES: "bg-status-red-tint text-status-red",
  UNKNOWN: "bg-status-amber-tint text-status-amber",
  NONE: "bg-brand-green-tint text-brand-green-dark",
};

const CARE_LABEL: Record<string, string> = {
  OUTPATIENT: "Outpatient",
  INPATIENT: "Inpatient",
  POSTTREATMENT_SUPPORT: "Post-treatment support",
};

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-[12.6px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";

function initialsFor(patient: PatientListRow) {
  return `${patient.first_name[0] ?? ""}${patient.last_name[0] ?? ""}`.toUpperCase() || "?";
}

/**
 * Module 1 — Client Registry, rebuilt against the second (2026-09)
 * clinical-workspace mockup: Client/UHID combined cell (photo or initials),
 * Care/Contact/Status columns, a "Register client" modal (not a separate
 * page — see PatientRegistrationModal.tsx, which replaces the old
 * `/clinical/registry-new` route entirely), and a read-only "View details"
 * modal. "Status" has one honest simplification: the backend has no
 * registration-approval workflow, so rather than fabricate the mockup's
 * "Pending" state, it's derived from a real signal — whether any government
 * ID (UPI/IPRS or National ID) is on file yet — and labelled accordingly.
 */
export function ClientRegistryPage() {
  const { accessToken } = useAuth();
  const { selectPatient } = usePatientContext();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<PatientListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [careFilter, setCareFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [detailsPatient, setDetailsPatient] = useState<PatientDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<string | null>(null);

  const reload = () => {
    if (!accessToken) return;
    setIsLoading(true);
    listPatients(accessToken)
      .then((data) => setPatients(data.results))
      .catch(() => setError("Couldn't load the client registry."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // Deferred one microtask so `reload`'s setState calls don't run
    // synchronously in the effect body itself.
    void Promise.resolve().then(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reload` is redefined each render but only depends on `accessToken`, already listed.
  }, [accessToken]);

  const openPatient = (patient: PatientListRow) => {
    selectPatient(patient.id, `${patient.first_name} ${patient.last_name}`);
    navigate("/clinical/patient");
  };

  const viewDetails = async (patient: PatientListRow, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!accessToken) return;
    setDetailsLoading(patient.id);
    try {
      setDetailsPatient(await getPatient(accessToken, patient.id));
    } finally {
      setDetailsLoading(null);
    }
  };

  const statusFor = (patient: PatientListRow): "Active" | "ID Pending" =>
    patient.upi || patient.national_id ? "Active" : "ID Pending";

  const query = search.trim().toLowerCase();
  const filteredPatients = patients.filter((patient) => {
    const matchesSearch =
      !query ||
      [patient.first_name, patient.last_name, patient.uhid_number, patient.citramac_number]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesCare = !careFilter || patient.patient_category === careFilter;
    const matchesStatus = !statusFilter || statusFor(patient) === statusFilter;
    return matchesSearch && matchesCare && matchesStatus;
  });

  const registryColumns: ResponsiveTableColumn<PatientListRow>[] = [
    {
      key: "client",
      header: "Client / UHID",
      cardTitle: true,
      cell: (patient) => (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-green-tint text-[11px] font-bold text-brand-green-dark">
            {patient.photo ? (
              <img src={patient.photo} alt="" className="h-full w-full object-cover" />
            ) : (
              initialsFor(patient)
            )}
          </div>
          <div>
            <div className="font-semibold text-ink-900">
              {patient.first_name} {patient.last_name}
            </div>
            <div className="font-mono text-[10.5px] text-ink-500">
              {patient.uhid_number || patient.citramac_number}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "gender_dob",
      header: "Gender / DOB",
      cell: (patient) => (
        <>
          {patient.gender}
          <div className="text-[10.5px] text-ink-500">{patient.date_of_birth}</div>
        </>
      ),
    },
    {
      key: "care",
      header: "Care",
      cell: (patient) => (
        <span className="rounded-full bg-brand-green-tint px-2.5 py-1 text-xs font-semibold text-brand-green-dark">
          {CARE_LABEL[patient.patient_category] ?? patient.patient_category}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (patient) => (
        <>
          {patient.contact_phone || "—"}
          <div className="text-[10.5px] text-ink-500">Mobile · Kenya</div>
        </>
      ),
    },
    {
      key: "allergy",
      header: "Allergy",
      cell: (patient) => (
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ALLERGY_BADGE[patient.allergy_status] ?? ""}`}
        >
          {patient.allergy_status.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cardBadge: true,
      cell: (patient) => {
        const status = statusFor(patient);
        return (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === "Active" ? "bg-brand-green-tint text-brand-green-dark" : "bg-status-amber-tint text-status-amber"}`}
          >
            {status}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      hideInCard: true,
      className: "px-4 py-3 text-right",
      cell: (patient) => (
        <button
          type="button"
          onClick={(e) => viewDetails(patient, e)}
          disabled={detailsLoading === patient.id}
          className="text-[11.5px] font-semibold text-brand-green hover:underline disabled:opacity-50"
        >
          {detailsLoading === patient.id ? "Loading…" : "Open"}
        </button>
      ),
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            FHIR-aligned patient identity and access
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Client Registry</h1>
          <p className="mt-1 text-[12.5px] text-ink-500">
            Register, find and safely manage clients across every care pathway.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRegister(true)}
          className="flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-brand-green-dark"
        >
          <Plus className="h-4 w-4" />
          Register client
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-72 pl-8`}
            placeholder="Search name, UHID or client number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={FIELD_CLASS}
          value={careFilter}
          onChange={(e) => setCareFilter(e.target.value)}
        >
          <option value="">All care</option>
          <option value="OUTPATIENT">Outpatient</option>
          <option value="INPATIENT">Inpatient</option>
          <option value="POSTTREATMENT_SUPPORT">Post-treatment support</option>
        </select>
        <select
          className={FIELD_CLASS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="ID Pending">ID Pending</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap gap-6 text-[11.5px] text-ink-500">
        <span>
          <strong className="mr-1 font-display text-base text-ink-900">
            {filteredPatients.length}
          </strong>
          clients shown
        </span>
        <span>
          <strong className="mr-1 font-display text-base text-ink-900">FHIR R4</strong>
          Patient resource
        </span>
      </div>

      {isLoading ? (
        <p className="rounded-lg border border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-ink-500 shadow-sm">
          Loading…
        </p>
      ) : error ? (
        <p className="rounded-lg border border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-status-red shadow-sm">
          {error}
        </p>
      ) : (
        <ResponsiveTable
          columns={registryColumns}
          rows={filteredPatients}
          rowKey={(patient) => patient.id}
          onRowClick={openPatient}
          renderCardActions={(patient) => (
            <button
              type="button"
              onClick={(e) => viewDetails(patient, e)}
              disabled={detailsLoading === patient.id}
              className="w-full text-center text-[11.5px] font-semibold text-brand-green hover:underline disabled:opacity-50"
            >
              {detailsLoading === patient.id ? "Loading…" : "Open"}
            </button>
          )}
          emptyMessage={
            patients.length === 0
              ? "No clients registered yet."
              : "No clients match these filters."
          }
        />
      )}

      <PatientRegistrationModal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={reload}
      />
      <PatientDetailsModal
        open={detailsPatient !== null}
        onClose={() => setDetailsPatient(null)}
        patient={detailsPatient}
      />
    </div>
  );
}
