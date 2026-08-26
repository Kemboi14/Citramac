import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import { createPatient, type NewPatientPayload } from "../../lib/clinicalApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";

/**
 * Module 1 registration form — docs/07-CLINICAL-MODULES-SPEC.md §7.1. Covers
 * the fields the backend model supports (apps/client_registry/models.py);
 * simplified into one page rather than the mockup's seven lettered sections
 * (A-G) given the scope of building all thirteen modules at once — the data
 * captured is the same, just laid out more plainly.
 */
export function NewClientPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<NewPatientPayload>({
    first_name: "",
    last_name: "",
    middle_other_names: "",
    gender: "",
    date_of_birth: "",
    marital_status: "",
    nationality: "",
    uhid_number: "",
    contact_phone: "",
    contact_email: "",
    address: "",
    county: "",
    allergy_status: "UNKNOWN",
    patient_category: "OUTPATIENT",
    referral_source: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const set =
    (field: keyof NewPatientPayload) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await createPatient(accessToken, form);
      navigate("/clinical");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate("/clinical")}
        className="mb-4 text-sm font-medium text-brand-green hover:underline"
      >
        ← Back to Client Registry
      </button>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
        Module 1 · Client Registration Form
      </div>
      <h1 className="mb-5 font-display text-2xl font-bold text-ink-900">New Client Registration</h1>

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className={LABEL_CLASS}>
            First Name <span className="text-status-red">*</span>
            <input
              required
              className={FIELD_CLASS}
              value={form.first_name}
              onChange={set("first_name")}
            />
          </label>
          <label className={LABEL_CLASS}>
            Last Name <span className="text-status-red">*</span>
            <input
              required
              className={FIELD_CLASS}
              value={form.last_name}
              onChange={set("last_name")}
            />
          </label>
          <label className={LABEL_CLASS}>
            Middle / Other Names
            <input
              className={FIELD_CLASS}
              value={form.middle_other_names}
              onChange={set("middle_other_names")}
            />
          </label>
          <label className={LABEL_CLASS}>
            Gender <span className="text-status-red">*</span>
            <select required className={FIELD_CLASS} value={form.gender} onChange={set("gender")}>
              <option value="">Select…</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Date of Birth <span className="text-status-red">*</span>
            <input
              required
              type="date"
              className={FIELD_CLASS}
              value={form.date_of_birth}
              onChange={set("date_of_birth")}
            />
          </label>
          <label className={LABEL_CLASS}>
            Marital Status
            <select
              className={FIELD_CLASS}
              value={form.marital_status}
              onChange={set("marital_status")}
            >
              <option value="">Select…</option>
              <option value="SINGLE">Single</option>
              <option value="MARRIED">Married</option>
              <option value="DIVORCED">Divorced</option>
              <option value="WIDOWED">Widowed</option>
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Nationality
            <input
              className={FIELD_CLASS}
              value={form.nationality}
              onChange={set("nationality")}
              placeholder="e.g. Kenyan"
            />
          </label>
          <label className={LABEL_CLASS}>
            UHID Number
            <input
              className={FIELD_CLASS}
              value={form.uhid_number}
              onChange={set("uhid_number")}
              placeholder="Auto-generated if left blank"
            />
          </label>
          <label className={LABEL_CLASS}>
            Client Phone Number
            <input
              className={FIELD_CLASS}
              value={form.contact_phone}
              onChange={set("contact_phone")}
            />
          </label>
          <label className={LABEL_CLASS}>
            Client Email
            <input
              type="email"
              className={FIELD_CLASS}
              value={form.contact_email}
              onChange={set("contact_email")}
            />
          </label>
          <label className={`${LABEL_CLASS} col-span-2`}>
            Physical Address
            <input className={FIELD_CLASS} value={form.address} onChange={set("address")} />
          </label>
          <label className={LABEL_CLASS}>
            County
            <input className={FIELD_CLASS} value={form.county} onChange={set("county")} />
          </label>
          <label className={LABEL_CLASS}>
            Allergy Status
            <select
              className={FIELD_CLASS}
              value={form.allergy_status}
              onChange={set("allergy_status")}
            >
              <option value="UNKNOWN">Unknown</option>
              <option value="NONE">None</option>
              <option value="ACTIVE_ALLERGIES">Active Allergies</option>
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Care Type <span className="text-status-red">*</span>
            <select
              required
              className={FIELD_CLASS}
              value={form.patient_category}
              onChange={set("patient_category")}
            >
              <option value="OUTPATIENT">Outpatient</option>
              <option value="INPATIENT">Inpatient</option>
              <option value="POSTTREATMENT_SUPPORT">Posttreatment Support</option>
            </select>
          </label>
          <label className={LABEL_CLASS}>
            Referral Source
            <input
              className={FIELD_CLASS}
              value={form.referral_source}
              onChange={set("referral_source")}
              placeholder="e.g. Walk-in, referred by clinician"
            />
          </label>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150"
        >
          {isSubmitting ? "Registering…" : "Register Client"}
        </button>
      </form>
    </div>
  );
}
