import { useEffect, useState } from "react";
import { KeyRound, MapPin, PlugZap, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { ApiError } from "../../lib/apiClient";
import {
  listBranches,
  setBranchCredentials,
  updateBranch,
  type Branch,
  type CcpRegistrationStatus,
} from "../../lib/branchesApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";

const FACILITY_LEVELS = ["L2", "L3", "L4", "L5", "L6"] as const;
const OWNERSHIP_TYPES = [
  "PRIVATE",
  "PUBLIC",
  "FAITH_BASED",
  "NGO",
  "PARTNERSHIP",
  "OTHER",
] as const;
const CCP_OPTIONS: { value: CcpRegistrationStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "WAITLIST", label: "Waitlist Only" },
  { value: "CLOSED", label: "Closed" },
];

interface FormState {
  name: string;
  facility_level: Branch["facility_level"];
  address: string;
  county: string;
  sub_county: string;
  ownership_type: Branch["ownership_type"];
  phone: string;
  email: string;
  outpatient_capacity_per_day: string;
  ccp_registration_status: CcpRegistrationStatus;
}

function formFromBranch(branch: Branch): FormState {
  return {
    name: branch.name,
    facility_level: branch.facility_level,
    address: branch.address,
    county: branch.county,
    sub_county: branch.sub_county,
    ownership_type: branch.ownership_type,
    phone: branch.phone,
    email: branch.email,
    outpatient_capacity_per_day:
      branch.outpatient_capacity_per_day === null ? "" : String(branch.outpatient_capacity_per_day),
    ccp_registration_status: branch.ccp_registration_status,
  };
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 font-display text-xl font-bold text-ink-900">{value}</div>
    </div>
  );
}

function StatusPill({
  ok,
  okLabel,
  pendingLabel,
}: {
  ok: boolean;
  okLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
        ok ? "bg-brand-green-tint text-brand-green-dark" : "bg-status-amber-tint text-status-amber"
      }`}
    >
      {ok ? okLabel : pendingLabel}
    </span>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 py-2">
      <span className="flex flex-col">
        <span className="text-sm font-medium text-ink-900">{label}</span>
        <span className="text-xs text-ink-500">{description}</span>
      </span>
      <input
        type="checkbox"
        className="mt-1 h-4 w-8 shrink-0 cursor-pointer accent-brand-green disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/**
 * Org Admin's own-branch settings screen — citramac_ORG-admin.html
 * "Branch Settings". An Org Admin's JWT scopes listBranches() to their own
 * organization, so results[0] is the branch this screen edits (typically
 * the only one). mfl_code is verification-controlled by the Super Admin's
 * DHA MFL process elsewhere and is read-only here.
 */
export function BranchSettingsPage() {
  const { accessToken } = useAuth();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingField, setTogglingField] = useState<string | null>(null);

  const [credentialValue, setCredentialValue] = useState("");
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialSaved, setCredentialSaved] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);

  const load = async () => {
    if (!accessToken) return;
    const res = await listBranches(accessToken);
    const first = res.results[0] ?? null;
    setBranch(first);
    setForm(first ? formFromBranch(first) : null);
  };

  useEffect(() => {
    if (!accessToken) return;
    // Deferred one microtask so nothing setState's synchronously in the
    // effect body itself — everything below runs inside this callback.
    void Promise.resolve().then(() =>
      load()
        .catch((err) =>
          setLoadError(err instanceof ApiError ? err.message : "Couldn't load branch settings."),
        )
        .finally(() => setLoading(false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  };

  const saveForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !branch || !form) return;
    setSaveError(null);
    setSaving(true);
    try {
      const payload: Partial<Branch> = {
        name: form.name,
        facility_level: form.facility_level,
        address: form.address,
        county: form.county,
        sub_county: form.sub_county,
        ownership_type: form.ownership_type,
        phone: form.phone,
        email: form.email,
        outpatient_capacity_per_day:
          form.outpatient_capacity_per_day === "" ? null : Number(form.outpatient_capacity_per_day),
        ccp_registration_status: form.ccp_registration_status,
      };
      const updated = await updateBranch(accessToken, branch.id, payload);
      setBranch(updated);
      setForm(formFromBranch(updated));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save branch settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleField = async (
    field: "sha_claims_enabled" | "mpesa_paybill_enabled" | "sms_reminders_enabled",
    next: boolean,
  ) => {
    if (!accessToken || !branch) return;
    setToggleError(null);
    setTogglingField(field);
    try {
      const updated = await updateBranch(accessToken, branch.id, { [field]: next });
      setBranch(updated);
      setForm(formFromBranch(updated));
    } catch (err) {
      setToggleError(err instanceof ApiError ? err.message : "Couldn't update the integration.");
    } finally {
      setTogglingField(null);
    }
  };

  const saveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !branch || !credentialValue) return;
    setCredentialError(null);
    setCredentialSaved(false);
    setSavingCredentials(true);
    try {
      await setBranchCredentials(accessToken, branch.id, credentialValue);
      setCredentialValue("");
      setCredentialSaved(true);
      await load();
    } catch (err) {
      setCredentialError(err instanceof ApiError ? err.message : "Couldn't save credentials.");
    } finally {
      setSavingCredentials(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Organization Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Branch Settings</h1>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}

      {!loading && !loadError && !branch && (
        <div className={CARD_CLASS}>
          <p className="text-sm text-ink-500">
            No branch is associated with your organization yet. Contact your Super Admin to have one
            set up.
          </p>
        </div>
      )}

      {branch && form && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex flex-col gap-6 lg:w-2/3">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatPill label="Wards" value={String(branch.ward_count)} />
              <StatPill label="Beds" value={String(branch.bed_count)} />
              <StatPill
                label="Outpatient Capacity/Day"
                value={
                  branch.outpatient_capacity_per_day === null
                    ? "—"
                    : String(branch.outpatient_capacity_per_day)
                }
              />
              <StatPill label="CCP Registration" value={humanize(branch.ccp_registration_status)} />
            </div>

            <form onSubmit={saveForm} className="flex flex-col gap-6">
              <div className={CARD_CLASS}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-ink-900">
                    Basic Details
                  </h2>
                  <div className="flex items-center gap-3">
                    {saved && <span className="text-sm font-medium text-brand-green">Saved</span>}
                    <button type="submit" disabled={saving} className={BUTTON_CLASS}>
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className={LABEL_CLASS}>
                    Branch Name
                    <input
                      className={FIELD_CLASS}
                      value={form.name}
                      onChange={(e) => updateForm({ name: e.target.value })}
                      required
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Facility Level
                    <select
                      className={FIELD_CLASS}
                      value={form.facility_level}
                      onChange={(e) =>
                        updateForm({ facility_level: e.target.value as Branch["facility_level"] })
                      }
                    >
                      {FACILITY_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>
                  <span className="inline-flex items-center gap-2">
                    <MapPin size={16} className="text-brand-green" />
                    Physical Address
                  </span>
                </h2>
                <div className="flex flex-col gap-4">
                  <label className={LABEL_CLASS}>
                    Address
                    <textarea
                      className={FIELD_CLASS}
                      rows={2}
                      value={form.address}
                      onChange={(e) => updateForm({ address: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className={LABEL_CLASS}>
                      County
                      <input
                        className={FIELD_CLASS}
                        value={form.county}
                        onChange={(e) => updateForm({ county: e.target.value })}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      Sub-County
                      <input
                        className={FIELD_CLASS}
                        value={form.sub_county}
                        onChange={(e) => updateForm({ sub_county: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>Registration &amp; Compliance</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
                    DHA MFL Code
                    <div className={`${FIELD_CLASS} bg-surface-bg font-mono text-ink-900`}>
                      {branch.mfl_code || "—"}
                    </div>
                    <span className="text-xs font-normal text-ink-500">
                      {branch.mfl_code ? "Verified by DHA MFL registry" : "Not yet verified"}
                    </span>
                  </div>
                  <label className={LABEL_CLASS}>
                    Ownership Type
                    <select
                      className={FIELD_CLASS}
                      value={form.ownership_type}
                      onChange={(e) =>
                        updateForm({ ownership_type: e.target.value as Branch["ownership_type"] })
                      }
                    >
                      {OWNERSHIP_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {humanize(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>Contact</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className={LABEL_CLASS}>
                    Phone
                    <input
                      className={FIELD_CLASS}
                      value={form.phone}
                      onChange={(e) => updateForm({ phone: e.target.value })}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Email
                    <input
                      type="email"
                      className={FIELD_CLASS}
                      value={form.email}
                      onChange={(e) => updateForm({ email: e.target.value })}
                    />
                  </label>
                </div>
              </div>

              <div className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>Capacity Configuration</h2>
                <div className="flex flex-col gap-4">
                  <label className={`${LABEL_CLASS} max-w-xs`}>
                    Outpatient Capacity/Day
                    <input
                      type="number"
                      min={0}
                      className={FIELD_CLASS}
                      value={form.outpatient_capacity_per_day}
                      onChange={(e) => updateForm({ outpatient_capacity_per_day: e.target.value })}
                    />
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-ink-700">
                      CCP Registration Availability
                    </span>
                    <div className="inline-flex w-fit overflow-hidden rounded-md border border-surface-border">
                      {CCP_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => updateForm({ ccp_registration_status: option.value })}
                          className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                            form.ccp_registration_status === option.value
                              ? "bg-brand-green text-white"
                              : "bg-surface-card text-ink-700 hover:bg-brand-green-tint"
                          } ${option.value !== "CLOSED" ? "border-r border-surface-border" : ""}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {saveError && (
                <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                  {saveError}
                </p>
              )}
            </form>
          </div>

          <div className="flex flex-col gap-6 lg:w-1/3">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck size={16} className="text-brand-green" />
                  Certification Status
                </span>
              </h2>
              <div className="flex flex-col divide-y divide-surface-border">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-ink-700">DHA MFL Verification</span>
                  <StatusPill
                    ok={Boolean(branch.mfl_code)}
                    okLabel="Verified"
                    pendingLabel="Pending"
                  />
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-ink-700">SHA Integration</span>
                  <StatusPill
                    ok={branch.sha_claims_enabled}
                    okLabel="Connected"
                    pendingLabel="Pending Setup"
                  />
                </div>
              </div>
            </div>

            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <PlugZap size={16} className="text-brand-green" />
                  Integrations
                </span>
              </h2>
              <div className="flex flex-col divide-y divide-surface-border">
                <ToggleRow
                  label="SHA Claims"
                  description="Submit claims to the SHA gateway."
                  checked={branch.sha_claims_enabled}
                  disabled={togglingField === "sha_claims_enabled"}
                  onChange={(next) => toggleField("sha_claims_enabled", next)}
                />
                <ToggleRow
                  label="M-Pesa Paybill"
                  description="Accept M-Pesa payments at this branch."
                  checked={branch.mpesa_paybill_enabled}
                  disabled={togglingField === "mpesa_paybill_enabled"}
                  onChange={(next) => toggleField("mpesa_paybill_enabled", next)}
                />
                <ToggleRow
                  label="SMS Reminders"
                  description="Send appointment reminders via SMS."
                  checked={branch.sms_reminders_enabled}
                  disabled={togglingField === "sms_reminders_enabled"}
                  onChange={(next) => toggleField("sms_reminders_enabled", next)}
                />
              </div>
              {toggleError && <p className="mt-2 text-sm text-status-red">{toggleError}</p>}
            </div>

            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <KeyRound size={16} className="text-brand-green" />
                  SHA Claims Credentials
                </span>
              </h2>
              <div className="mb-3">
                <StatusPill
                  ok={branch.has_sha_credentials}
                  okLabel="Configured"
                  pendingLabel="Not configured"
                />
              </div>
              <form onSubmit={saveCredentials} className="flex flex-col gap-3">
                <label className={LABEL_CLASS}>
                  New Credentials
                  <input
                    type="password"
                    className={FIELD_CLASS}
                    value={credentialValue}
                    onChange={(e) => {
                      setCredentialValue(e.target.value);
                      setCredentialSaved(false);
                    }}
                    placeholder="Paste SHA API credential string"
                    autoComplete="new-password"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingCredentials || !credentialValue}
                  className={BUTTON_CLASS}
                >
                  {savingCredentials ? "Saving…" : "Save Credentials"}
                </button>
                {credentialSaved && (
                  <span className="text-sm font-medium text-brand-green">Credentials saved</span>
                )}
                {credentialError && (
                  <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                    {credentialError}
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
