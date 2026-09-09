import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import { PillRadio } from "../../components/PillRadio";
import { WideModal } from "../../components/WideModal";
import {
  createAllergyRecord,
  createEmergencyContact,
  createPatient,
  type NewPatientPayload,
} from "../../lib/clinicalApi";
import { listStaff, type Staff } from "../../lib/governanceApi";

const FIELD_CLASS =
  "w-full rounded-sm border border-surface-border px-3 py-2 text-[12.8px] text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green disabled:bg-surface-bg disabled:text-ink-400";
const LABEL_CLASS = "flex flex-col gap-1.5 text-[11.8px] font-semibold text-ink-700";
const SECTION_CLASS = "rounded-lg border border-surface-border bg-surface-card p-5 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-[14.5px] font-semibold text-ink-900";

const REFERRAL_SOURCES = [
  "Friend or Family Referral",
  "Doctor / Clinician Referral",
  "Social Media",
  "Walk-in",
  "Insurance Company",
  "Other Hospital / Facility",
  "Other",
];

function calcAge(dob: string): string {
  if (!dob) return "";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? `${age} years` : "";
}

interface FormState {
  first_name: string;
  last_name: string;
  middle_other_names: string;
  uhid_number: string;
  gender: string;
  date_of_birth: string;
  doctor: string;
  contact_phone: string;
  contact_email: string;
  kin_name: string;
  kin_relationship: string;
  kin_phone: string;
  kin_email: string;
  kin_location: string;
  referral_source: string;
  nationality: string;
  address: string;
  visit_type: "" | "OUTPATIENT" | "INPATIENT" | "POSTTREATMENT_SUPPORT";
  marital_status: string;
  occupation: string;
  insurer_details: string;
  allergy_status: "NONE" | "ACTIVE_ALLERGIES";
  medication_allergies: string;
  food_allergies: string;
  living_with_disability: "NO" | "YES";
  employment_status: string;
  referral_mode: string;
  referral_date: string;
}

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  middle_other_names: "",
  uhid_number: "",
  gender: "",
  date_of_birth: "",
  doctor: "",
  contact_phone: "",
  contact_email: "",
  kin_name: "",
  kin_relationship: "",
  kin_phone: "",
  kin_email: "",
  kin_location: "",
  referral_source: "",
  nationality: "",
  address: "",
  visit_type: "",
  marital_status: "",
  occupation: "",
  insurer_details: "",
  allergy_status: "NONE",
  medication_allergies: "",
  food_allergies: "",
  living_with_disability: "NO",
  employment_status: "",
  referral_mode: "",
  referral_date: "",
};

/**
 * "Register client" modal — the second clinical-workspace mockup's Add/Edit
 * Client Registration modal (wide, sectioned form + live summary sidebar),
 * replacing the old separate `/clinical/registry-new` page entirely. Covers
 * every field the mockup shows with one disclosed, deliberate omission: a
 * "Ward" selector for Inpatient visits — ward/bed allocation happens in the
 * Admission workflow (a real `ipd_ward.Bed` FK there), not at registration,
 * and `Patient` has no ward field of its own, so a ward dropdown here would
 * have nowhere real to write to. The "Privacy and care context" checkbox is
 * a client-side submit gate (staff attestation), not a persisted field —
 * no backend field exists for it and inventing one wasn't in scope; it's
 * disclosed here rather than silently faked as saved.
 */
export function PatientRegistrationModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const { accessToken, claims } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Deferred one microtask so these setState calls run inside a callback
    // rather than synchronously in the effect body — same pattern as
    // OrganizationsPage's drawer-reset effect.
    void Promise.resolve().then(() => {
      setForm(EMPTY_FORM);
      setAttested(false);
      setError(null);
    });
  }, [open]);

  useEffect(() => {
    if (!open || !accessToken) return;
    listStaff(accessToken)
      .then((res) => setStaff(res.results))
      .catch(() => setStaff([]));
  }, [open, accessToken]);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  // Doctors and Psychiatrists first, everyone else after — a facility
  // without those exact role names still sees the full staff list rather
  // than an empty picker.
  const doctorOptions = useMemo(() => {
    const isDoctorish = (s: Staff) =>
      s.role_names.some((r) => /doctor|psychiatrist|clinician/i.test(r));
    return [...staff].sort((a, b) => Number(isDoctorish(b)) - Number(isDoctorish(a)));
  }, [staff]);

  const age = calcAge(form.date_of_birth);
  const citramacNumberPreview = "Auto-generated on save";
  const nowLabel = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const staffRegisteringLabel =
    `${claims?.first_name ?? ""} ${claims?.last_name ?? ""}`.trim() || claims?.email || "—";

  const summaryRows: [string, string][] = [
    ["First Name", form.first_name],
    ["Last Name", form.last_name],
    ["Middle/Other Names", form.middle_other_names],
    ["UHID Number", form.uhid_number || "Auto-generated"],
    ["Gender", form.gender],
    ["Date Of Birth", form.date_of_birth],
    ["Age", age],
    [
      "Doctor's Name",
      doctorOptions.find((d) => d.id === form.doctor)?.first_name
        ? `${doctorOptions.find((d) => d.id === form.doctor)?.first_name} ${doctorOptions.find((d) => d.id === form.doctor)?.last_name}`
        : "",
    ],
    ["Client Phone Number", form.contact_phone],
    ["Client Email", form.contact_email],
    ["Name (Next of Kin)", form.kin_name],
    ["Relationship (Next of Kin)", form.kin_relationship],
    ["Phone (Next of Kin)", form.kin_phone],
    ["Email (Next of Kin)", form.kin_email],
    ["Location (Next of Kin)", form.kin_location],
    ["Referral Source", form.referral_source],
    ["Nationality", form.nationality],
    ["Client Physical Address", form.address],
    ["Visit Type", form.visit_type ? CARE_LABEL[form.visit_type] : ""],
    ["Marital Status", form.marital_status],
    ["Occupation", form.occupation],
    ["Insurer Details", form.insurer_details],
    [
      "Allergy Status",
      form.allergy_status === "ACTIVE_ALLERGIES" ? "Active Allergies" : "No Known Allergies",
    ],
    ["Medication Allergies", form.medication_allergies],
    ["Food Allergies", form.food_allergies],
    ["Living With Disability", form.living_with_disability === "YES" ? "Yes" : "No"],
    ["Employment Status", form.employment_status],
    ["Mode of Referral", form.referral_mode],
    ["Referral Date", form.referral_date],
    ["Staff Registering", staffRegisteringLabel],
    ["Date & Time Registered", nowLabel],
    ["Citramac Number", citramacNumberPreview],
  ];

  const canSubmit =
    form.first_name.trim() &&
    form.last_name.trim() &&
    form.gender &&
    form.date_of_birth &&
    form.visit_type &&
    attested;

  const handleSubmit = async () => {
    if (!accessToken || !canSubmit) return;
    setError(null);
    try {
      const payload: NewPatientPayload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        middle_other_names: form.middle_other_names.trim(),
        gender: form.gender,
        date_of_birth: form.date_of_birth,
        uhid_number: form.uhid_number.trim(),
        contact_phone: form.contact_phone.trim(),
        contact_email: form.contact_email.trim(),
        nationality: form.nationality.trim(),
        address: form.address.trim(),
        patient_category: form.visit_type,
        marital_status: form.marital_status,
        occupation: form.occupation.trim(),
        insurer_details: form.insurer_details.trim(),
        allergy_status: form.allergy_status,
        living_with_disability: form.living_with_disability === "YES",
        employment_status: form.employment_status,
        referral_source: form.referral_source,
        referral_mode: form.referral_mode.trim(),
        referral_date: form.referral_date || undefined,
        doctor: form.doctor || undefined,
      };
      const patient = await createPatient(accessToken, payload);

      if (form.kin_name.trim()) {
        await createEmergencyContact(accessToken, patient.id, {
          name: form.kin_name.trim(),
          relationship: form.kin_relationship.trim(),
          phone: form.kin_phone.trim(),
          email: form.kin_email.trim(),
          address: form.kin_location.trim(),
        });
      }

      if (form.allergy_status === "ACTIVE_ALLERGIES") {
        if (form.medication_allergies.trim()) {
          await createAllergyRecord(accessToken, patient.id, {
            substance: form.medication_allergies.trim(),
            reaction: "Medication allergy reported at registration",
          });
        }
        if (form.food_allergies.trim()) {
          await createAllergyRecord(accessToken, patient.id, {
            substance: form.food_allergies.trim(),
            reaction: "Food allergy reported at registration",
          });
        }
      }

      onRegistered();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't register this client.");
      throw err;
    }
  };

  return (
    <WideModal
      open={open}
      onClose={onClose}
      title="Register new client"
      subtitle="Complete the Client Registration form and other registration details below."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
          >
            Cancel
          </button>
          <SaveButton onSave={handleSubmit} disabled={!canSubmit} className="flex-1">
            Create client record
          </SaveButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_270px]">
        <div className="flex flex-col gap-4">
          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Client Information</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                First Name <span className="text-status-red">*</span>
                <input
                  className={FIELD_CLASS}
                  value={form.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Last Name <span className="text-status-red">*</span>
                <input
                  className={FIELD_CLASS}
                  value={form.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Middle/Other Names
                <input
                  className={FIELD_CLASS}
                  value={form.middle_other_names}
                  onChange={(e) => set("middle_other_names", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                UHID Number
                <input
                  className={FIELD_CLASS}
                  placeholder="Auto-generated if blank"
                  value={form.uhid_number}
                  onChange={(e) => set("uhid_number", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Gender <span className="text-status-red">*</span>
                <select
                  className={FIELD_CLASS}
                  value={form.gender}
                  onChange={(e) => set("gender", e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Date Of Birth <span className="text-status-red">*</span>
                <input
                  type="date"
                  className={FIELD_CLASS}
                  value={form.date_of_birth}
                  onChange={(e) => set("date_of_birth", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Age
                <input className={FIELD_CLASS} disabled value={age} placeholder="Auto-calculated" />
              </label>
              <label className={LABEL_CLASS}>
                Doctor&apos;s Name
                <select
                  className={FIELD_CLASS}
                  value={form.doctor}
                  onChange={(e) => set("doctor", e.target.value)}
                >
                  <option value="">Select…</option>
                  {doctorOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.first_name} {s.last_name}
                      {s.role_names.length ? ` — ${s.role_names[0]}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Client Phone Number
                <input
                  type="tel"
                  className={FIELD_CLASS}
                  placeholder="07XX XXX XXX"
                  value={form.contact_phone}
                  onChange={(e) => set("contact_phone", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Client Email
                <input
                  type="email"
                  className={FIELD_CLASS}
                  value={form.contact_email}
                  onChange={(e) => set("contact_email", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Next of Kin Information</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                Name
                <input
                  className={FIELD_CLASS}
                  value={form.kin_name}
                  onChange={(e) => set("kin_name", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Relationship
                <input
                  className={FIELD_CLASS}
                  placeholder="e.g. Mother, Spouse"
                  value={form.kin_relationship}
                  onChange={(e) => set("kin_relationship", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Phone
                <input
                  type="tel"
                  className={FIELD_CLASS}
                  value={form.kin_phone}
                  onChange={(e) => set("kin_phone", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Email
                <input
                  type="email"
                  className={FIELD_CLASS}
                  value={form.kin_email}
                  onChange={(e) => set("kin_email", e.target.value)}
                />
              </label>
              <label className={`${LABEL_CLASS} col-span-2`}>
                Location
                <input
                  className={FIELD_CLASS}
                  value={form.kin_location}
                  onChange={(e) => set("kin_location", e.target.value)}
                />
              </label>
              <label className={`${LABEL_CLASS} col-span-2`}>
                How did the client learn about the clinic? / Referral from
                <select
                  className={FIELD_CLASS}
                  value={form.referral_source}
                  onChange={(e) => set("referral_source", e.target.value)}
                >
                  <option value="">Select</option>
                  {REFERRAL_SOURCES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Client Demographics</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                Nationality
                <input
                  className={FIELD_CLASS}
                  placeholder="Kenyan"
                  value={form.nationality}
                  onChange={(e) => set("nationality", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Client Physical Address
                <input
                  className={FIELD_CLASS}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Visit Type</h3>
            <label className={LABEL_CLASS}>
              Type of visit <span className="text-status-red">*</span>
              <div className="mt-1">
                <PillRadio
                  value={form.visit_type}
                  onChange={(v) => set("visit_type", v)}
                  options={[
                    { value: "INPATIENT", label: "Inpatient" },
                    { value: "OUTPATIENT", label: "Outpatient" },
                    { value: "POSTTREATMENT_SUPPORT", label: "Posttreatment Support" },
                  ]}
                />
              </div>
            </label>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Personal &amp; Social Information</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                Marital Status
                <select
                  className={FIELD_CLASS}
                  value={form.marital_status}
                  onChange={(e) => set("marital_status", e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="SINGLE">Single</option>
                  <option value="MARRIED">Married</option>
                  <option value="DIVORCED">Divorced</option>
                  <option value="WIDOWED">Widowed</option>
                </select>
              </label>
              <label className={LABEL_CLASS}>
                Occupation
                <input
                  className={FIELD_CLASS}
                  value={form.occupation}
                  onChange={(e) => set("occupation", e.target.value)}
                />
              </label>
              <label className={`${LABEL_CLASS} col-span-2`}>
                Insurer Details
                <input
                  className={FIELD_CLASS}
                  placeholder="Insurance company and policy number"
                  value={form.insurer_details}
                  onChange={(e) => set("insurer_details", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Allergy Information</h3>
            <label className={LABEL_CLASS}>
              Allergy Status
              <div className="mt-1">
                <PillRadio
                  value={form.allergy_status}
                  onChange={(v) => set("allergy_status", v)}
                  warnValue="ACTIVE_ALLERGIES"
                  options={[
                    { value: "NONE", label: "No Known Allergies" },
                    { value: "ACTIVE_ALLERGIES", label: "Active Allergies" },
                  ]}
                />
              </div>
            </label>
            {form.allergy_status === "ACTIVE_ALLERGIES" && (
              <div className="mt-3.5 grid grid-cols-2 gap-3.5">
                <label className={LABEL_CLASS}>
                  Medication allergies reported
                  <input
                    className={FIELD_CLASS}
                    value={form.medication_allergies}
                    onChange={(e) => set("medication_allergies", e.target.value)}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Food allergies reported
                  <input
                    className={FIELD_CLASS}
                    value={form.food_allergies}
                    onChange={(e) => set("food_allergies", e.target.value)}
                  />
                </label>
              </div>
            )}
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Disability &amp; Employment</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                Living With Disability Status
                <div className="mt-1">
                  <PillRadio
                    value={form.living_with_disability}
                    onChange={(v) => set("living_with_disability", v)}
                    options={[
                      { value: "NO", label: "No" },
                      { value: "YES", label: "Yes" },
                    ]}
                  />
                </div>
              </label>
              <label className={LABEL_CLASS}>
                Employment Status
                <select
                  className={FIELD_CLASS}
                  value={form.employment_status}
                  onChange={(e) => set("employment_status", e.target.value)}
                >
                  <option value="">Select</option>
                  <option>Employed</option>
                  <option>Unemployed</option>
                  <option>Self-employed</option>
                  <option>Student</option>
                  <option>Retired</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Referral &amp; Registration Details</h3>
            <div className="grid grid-cols-2 gap-3.5">
              <label className={LABEL_CLASS}>
                Mode of Referral
                <input
                  className={FIELD_CLASS}
                  placeholder="e.g. Self, hospital, NGO"
                  value={form.referral_mode}
                  onChange={(e) => set("referral_mode", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Referral Date
                <input
                  type="date"
                  className={FIELD_CLASS}
                  value={form.referral_date}
                  onChange={(e) => set("referral_date", e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Staff Registering <span className="text-status-red">*</span>
                <input className={FIELD_CLASS} disabled value={staffRegisteringLabel} />
              </label>
              <label className={LABEL_CLASS}>
                Date and Time when client was Registered
                <input
                  className={FIELD_CLASS}
                  disabled
                  value={nowLabel}
                  placeholder="System generated"
                />
              </label>
              <label className={LABEL_CLASS}>
                Citramac Number
                <input className={FIELD_CLASS} disabled value={citramacNumberPreview} />
              </label>
            </div>
          </section>

          <section className={SECTION_CLASS}>
            <h3 className={SECTION_TITLE_CLASS}>Privacy and care context</h3>
            <label className="flex items-start gap-2.5 text-[12.5px] text-ink-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-green"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              I confirm the client identity has been verified and the appropriate consent or legal
              basis for care has been recorded. Access will be audited.
            </label>
          </section>

          {error && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {error}
            </p>
          )}
        </div>

        <aside className="h-fit rounded-lg border border-surface-border bg-surface-bg p-4 lg:sticky lg:top-0">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-brand-green-dark">
            Client Registration Details
          </h3>
          <div className="flex flex-col gap-2">
            {summaryRows.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-2 border-b border-dashed border-surface-border pb-1.5 text-[10.5px]"
              >
                <span className="text-ink-500">{label}</span>
                <strong className="max-w-[130px] break-words text-right text-ink-900">
                  {value || "—"}
                </strong>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </WideModal>
  );
}

const CARE_LABEL: Record<string, string> = {
  OUTPATIENT: "Outpatient",
  INPATIENT: "Inpatient",
  POSTTREATMENT_SUPPORT: "Posttreatment Support",
};
