import { WideModal } from "../../components/WideModal";
import type { PatientDetail } from "../../lib/clinicalApi";

const SECTION_CLASS = "rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm";
const SECTION_TITLE_CLASS = "mb-3 font-display text-[13.5px] font-semibold text-ink-900";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="border-b border-dashed border-surface-border py-2">
      <div className="text-[9.5px] font-bold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 break-words text-[12px] font-medium text-ink-900">
        {value === "" || value === null || value === undefined ? "Not recorded" : String(value)}
      </div>
    </div>
  );
}

const CARE_LABEL: Record<string, string> = {
  OUTPATIENT: "Outpatient",
  INPATIENT: "Inpatient",
  POSTTREATMENT_SUPPORT: "Posttreatment Support",
};

/**
 * Read-only "Client Registration Details" — the second clinical-workspace
 * mockup's full-field dump opened from a patient's "View details" button.
 * Every field mirrors `PatientRegistrationModal`'s sections exactly, sourced
 * from the same `PatientDetailSerializer` payload.
 */
export function PatientDetailsModal({
  open,
  onClose,
  patient,
}: {
  open: boolean;
  onClose: () => void;
  patient: PatientDetail | null;
}) {
  if (!patient) return null;
  const kin = patient.emergency_contacts.find((c) => c.id === patient.next_of_kin) ?? null;

  return (
    <WideModal
      open={open}
      onClose={onClose}
      title="Client Registration Details"
      subtitle={`${patient.first_name} ${patient.last_name} · ${patient.uhid_number || patient.citramac_number}`}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark"
        >
          Close
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Client Information</h3>
          <Field label="First Name" value={patient.first_name} />
          <Field label="Last Name" value={patient.last_name} />
          <Field label="Middle/Other Names" value={patient.middle_other_names} />
          <Field label="UHID Number" value={patient.uhid_number} />
          <Field label="Gender" value={patient.gender} />
          <Field label="Date Of Birth" value={patient.date_of_birth} />
          <Field label="Age" value={`${patient.age} years`} />
          <Field label="Doctor's Name" value={patient.doctor_name} />
          <Field label="Client Phone Number" value={patient.contact_phone} />
          <Field label="Client Email" value={patient.contact_email} />
        </section>

        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Next of Kin Information</h3>
          <Field label="Name" value={kin?.name} />
          <Field label="Relationship" value={kin?.relationship} />
          <Field label="Phone" value={kin?.phone} />
          <Field label="Email" value={kin?.email} />
          <Field label="Location" value={kin?.address} />
          <Field label="Referral Source" value={patient.referral_source} />
        </section>

        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Demographics &amp; Visit</h3>
          <Field label="Nationality" value={patient.nationality} />
          <Field label="Client Physical Address" value={patient.address} />
          <Field label="County" value={patient.county} />
          <Field
            label="Visit Type"
            value={CARE_LABEL[patient.patient_category] ?? patient.patient_category}
          />
        </section>

        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Personal &amp; Social</h3>
          <Field label="Marital Status" value={patient.marital_status} />
          <Field label="Occupation" value={patient.occupation} />
          <Field label="Insurer Details" value={patient.insurer_details} />
        </section>

        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Allergy Information</h3>
          <Field
            label="Allergy Status"
            value={
              patient.allergy_status === "ACTIVE_ALLERGIES"
                ? "Active Allergies"
                : "No Known Allergies"
            }
          />
          {patient.allergy_records.length === 0 && (
            <p className="pt-2 text-[11px] text-ink-400">No allergy records on file.</p>
          )}
          {patient.allergy_records.map((rec) => (
            <Field key={rec.id} label={rec.reaction || "Allergy"} value={rec.substance} />
          ))}
        </section>

        <section className={SECTION_CLASS}>
          <h3 className={SECTION_TITLE_CLASS}>Disability &amp; Employment</h3>
          <Field
            label="Living With Disability"
            value={patient.living_with_disability ? "Yes" : "No"}
          />
          <Field label="Employment Status" value={patient.employment_status} />
        </section>

        <section className={`${SECTION_CLASS} md:col-span-2`}>
          <h3 className={SECTION_TITLE_CLASS}>Referral &amp; Registration Details</h3>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-3">
            <Field label="Mode of Referral" value={patient.referral_mode} />
            <Field label="Referral Date" value={patient.referral_date} />
            <Field label="Staff Registering" value={patient.registered_by_name} />
            <Field
              label="Date and Time Registered"
              value={new Date(patient.registered_at).toLocaleString()}
            />
            <Field label="Citramac Number" value={patient.citramac_number} />
            <Field label="UPI (IPRS)" value={patient.upi} />
          </div>
        </section>
      </div>
    </WideModal>
  );
}
