import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Layers,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { Drawer } from "../../components/Drawer";
import {
  createOrganization,
  listOrganizations,
  setOrganizationStatus,
  updateOrganization,
  uploadOrganizationLogo,
  type CreateOrganizationPayload,
  type Organization,
  type OrgType,
  type OrganizationStatus,
  type OwnershipType,
} from "../../lib/organizationsApi";
import { listSubscriptionPlans, type SubscriptionPlan } from "../../lib/subscriptionsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_PRIMARY =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";

// Matches DRF's default PageNumberPagination (REST_FRAMEWORK.PAGE_SIZE in
// config/settings/base.py) — the organizations endpoint is genuinely
// paginated server-side, so we page against it rather than faking it.
const PAGE_SIZE = 25;

// Matches the backend's LOGO_MAX_SIZE_BYTES (apps.tenancy.views) — checked
// client-side too so a too-large file is rejected instantly, not after a
// full upload round-trip.
const LOGO_MAX_SIZE_BYTES = 30 * 1024 * 1024;

const STATUS_TINT: Record<OrganizationStatus, string> = {
  ACTIVE: "bg-brand-green-tint text-brand-green-dark",
  PENDING_VERIFICATION: "bg-status-amber-tint text-status-amber",
  SUSPENDED: "bg-status-red-tint text-status-red",
};

const STATUS_LABEL: Record<OrganizationStatus, string> = {
  ACTIVE: "Active",
  PENDING_VERIFICATION: "Pending Verification",
  SUSPENDED: "Suspended",
};

const STATUS_FILTERS: { label: string; value: OrganizationStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Active", value: "ACTIVE" },
  { label: "Pending Verification", value: "PENDING_VERIFICATION" },
  { label: "Suspended", value: "SUSPENDED" },
];

const ORG_TYPE_LABEL: Record<OrgType, string> = {
  HOSPITAL: "Hospital / Healthcare Provider",
  SCHOOL: "School",
  UNIVERSITY: "University",
  CORPORATE: "Corporate",
  INDIVIDUAL: "Individual Practitioner",
};

// Which identity code each org type registers under — mirrors the backend's
// per-vertical verification rules (docs/09-SECURITY-COMPLIANCE.md). Shown
// dynamically here since a brand-new org has no identity_code_label from the
// API yet; existing rows in the table use the API's own label instead.
const IDENTITY_CODE_LABEL: Record<OrgType, string> = {
  HOSPITAL: "DHA Facility Code (MFL)",
  SCHOOL: "MoE Registration Number",
  UNIVERSITY: "CUE Charter Number",
  CORPORATE: "BRS Registration Number",
  INDIVIDUAL: "Professional Council License Number",
};

const IDENTITY_CODE_PLACEHOLDER: Record<OrgType, string> = {
  HOSPITAL: "MFL-10234",
  SCHOOL: "MOE-01-02-345",
  UNIVERSITY: "CUE/UN/2011/03",
  CORPORATE: "PVT-4F82K1",
  INDIVIDUAL: "KMPDC-A12345",
};

// Client-side, cosmetic-only hints — the backend remains the source of truth
// on submit (it checks these codes against the real registries).
const IDENTITY_CODE_PATTERN: Record<OrgType, RegExp> = {
  HOSPITAL: /^MFL-\d{4,6}$/i,
  SCHOOL: /^MOE-\d{2}-\d{2}-\d{2,4}$/i,
  UNIVERSITY: /^CUE\/[A-Z]{2,3}\/\d{4}\/\d{1,3}$/i,
  CORPORATE: /^PVT-[A-Z0-9]{6,10}$/i,
  INDIVIDUAL: /^[A-Z]{2,5}-[A-Z0-9]{3,8}$/i,
};

const IDENTITY_CODE_REGISTRY: Record<OrgType, string> = {
  HOSPITAL: "DHA Master Facility List",
  SCHOOL: "Ministry of Education register",
  UNIVERSITY: "Commission for University Education register",
  CORPORATE: "Business Registration Service register",
  INDIVIDUAL: "professional council register",
};

const IDENTITY_CODE_HINT: Record<OrgType, string> = {
  HOSPITAL: "Expected format: MFL-XXXX (4–6 digits), e.g. MFL-10234",
  SCHOOL: "Expected format: MOE-XX-XX-XXX, e.g. MOE-01-02-345",
  UNIVERSITY: "Expected format: CUE/XX/YYYY/N, e.g. CUE/UN/2011/03",
  CORPORATE: "Expected format: PVT-XXXXXX (6–10 alphanumeric), e.g. PVT-4F82K1",
  INDIVIDUAL: "Expected format: council prefix + license, e.g. KMPDC-A12345",
};

const FACILITY_TYPE_OPTIONS = [
  { value: "GENERAL_HOSPITAL", label: "General Hospital" },
  { value: "MENTAL_HEALTH_CCP", label: "Mental Health CCP" },
  { value: "DISPENSARY", label: "Dispensary" },
  { value: "CLINIC", label: "Clinic" },
];

const OWNERSHIP_TYPE_OPTIONS: { value: OwnershipType; label: string }[] = [
  { value: "PRIVATE", label: "Private" },
  { value: "PUBLIC", label: "Public" },
  { value: "FAITH_BASED", label: "Faith-Based" },
  { value: "NGO", label: "NGO" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "OTHER", label: "Other" },
];

const OWNERSHIP_TYPE_LABEL: Record<OwnershipType, string> = OWNERSHIP_TYPE_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<OwnershipType, string>,
);

type GroupBy = "none" | "org_type" | "county" | "ownership_type";

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "org_type", label: "Organization type" },
  { value: "county", label: "County" },
  { value: "ownership_type", label: "Ownership" },
];

function groupKeyFor(org: Organization, groupBy: GroupBy): string {
  switch (groupBy) {
    case "org_type":
      return ORG_TYPE_LABEL[org.org_type] ?? org.org_type;
    case "county":
      return org.county || "No county on file";
    case "ownership_type":
      return OWNERSHIP_TYPE_LABEL[org.ownership_type] ?? org.ownership_type;
    default:
      return "";
  }
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function StatusBadge({ status }: { status: OrganizationStatus }) {
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `status` is the compile-time-checked `OrganizationStatus` prop union, not user input.
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TINT[status] ?? ""}`}
    >
      {/* eslint-disable-next-line security/detect-object-injection -- `status` is the compile-time-checked `OrganizationStatus` prop union, not user input. */}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function IdentityCodeStatus({ orgType, value }: { orgType: OrgType; value: string }) {
  const trimmed = value.trim();
  if (!trimmed) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-400">
        <Circle className="h-3 w-3 flex-shrink-0" />
        Enter the code exactly as it appears on the{" "}
        {/* eslint-disable-next-line security/detect-object-injection -- `orgType` is the compile-time-checked `OrgType` prop union, not user input. */}
        {IDENTITY_CODE_REGISTRY[orgType]}.
      </p>
    );
  }
  // eslint-disable-next-line security/detect-object-injection -- `orgType` is the compile-time-checked `OrgType` prop union, not user input.
  const ok = IDENTITY_CODE_PATTERN[orgType].test(trimmed);
  if (ok) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-green-dark">
        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
        Format recognized — will be checked against the registry on save.
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-status-red">
      <AlertCircle className="h-3 w-3 flex-shrink-0" />
      {/* eslint-disable-next-line security/detect-object-injection -- `orgType` is the compile-time-checked `OrgType` prop union, not user input. */}
      {IDENTITY_CODE_HINT[orgType]}
    </p>
  );
}

type OrgFormState = {
  name: string;
  slug: string;
  org_type: OrgType;
  facility_type: string;
  ownership_type: OwnershipType;
  dha_facility_code: string;
  county: string;
  sub_county: string;
  subscription_plan_code: string;
  billing_cycle: "MONTHLY" | "ANNUAL";
  logo_url: string;
  tagline: string;
  primary_color: string;
  support_email: string;
  support_phone: string;
  website: string;
  org_admin: { email: string; first_name: string; last_name: string; phone: string };
};

const EMPTY_FORM: OrgFormState = {
  name: "",
  slug: "",
  org_type: "HOSPITAL",
  facility_type: "",
  ownership_type: "PRIVATE",
  dha_facility_code: "",
  county: "",
  sub_county: "",
  subscription_plan_code: "",
  billing_cycle: "ANNUAL",
  logo_url: "",
  tagline: "",
  primary_color: "#006e51",
  support_email: "",
  support_phone: "",
  website: "",
  org_admin: { email: "", first_name: "", last_name: "", phone: "" },
};

function organizationToFormState(org: Organization): OrgFormState {
  return {
    name: org.name,
    slug: org.slug,
    org_type: org.org_type,
    facility_type: org.facility_type ?? "",
    ownership_type: org.ownership_type,
    dha_facility_code: org.dha_facility_code ?? "",
    county: org.county ?? "",
    sub_county: org.sub_county ?? "",
    subscription_plan_code: "",
    billing_cycle: "ANNUAL",
    logo_url: org.logo_url ?? "",
    tagline: org.tagline ?? "",
    primary_color: org.primary_color || "#006e51",
    support_email: org.support_email ?? "",
    support_phone: org.support_phone ?? "",
    website: org.website ?? "",
    org_admin: { email: "", first_name: "", last_name: "", phone: "" },
  };
}

// Platform-wide security baseline — always enforced for every organization,
// never per-org configurable (apps.security's SecurityPolicy is a single
// platform-wide record, not one per tenant). Shown here as honest
// informational content matching the real invariant, not an editable form —
// citramac_SUPER-ADMIN-v4.html's "Security Configuration" + "Security
// Readiness" panels on the Add Organization drawer.
const MANDATORY_CONTROLS: { label: string; value: string }[] = [
  { label: "MFA", value: "Required" },
  { label: "Password Policy", value: "12+ characters" },
  { label: "Session Policy", value: "30 minutes" },
  { label: "RBAC", value: "Enabled" },
  { label: "Audit Logging", value: "Enabled" },
  { label: "Tenant Isolation", value: "Enabled" },
  { label: "API Security", value: "Authenticated" },
];

/**
 * Add/Edit Organization side drawer (citramac_SUPER-ADMIN.html "Add
 * Organization" drawer). Editing an existing org PATCHes it via
 * updateOrganization; the Org Admin fields only apply at creation time (the
 * backend provisions that user + activation invite as part of POST) so they
 * are hidden in edit mode rather than faked against an endpoint that doesn't
 * accept them.
 */
function OrganizationDrawer({
  open,
  organization,
  onClose,
  onSaved,
}: {
  open: boolean;
  organization: Organization | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const isEdit = Boolean(organization);
  const [form, setForm] = useState<OrgFormState>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const formId = "organization-form";

  useEffect(() => {
    if (!open) return;
    // Deferred one microtask so these setState calls run inside a callback
    // rather than synchronously in the effect body (see the same pattern in
    // OrganizationsPage's own refresh effect below).
    void Promise.resolve().then(() => {
      setError(null);
      setLogoFile(null);
      setSlugTouched(Boolean(organization));
      setForm(organization ? organizationToFormState(organization) : EMPTY_FORM);
    });
  }, [open, organization]);

  useEffect(() => {
    if (!open || isEdit || !accessToken) return;
    listSubscriptionPlans(accessToken)
      .then((res) => setPlans(res.results.filter((p) => p.is_active)))
      .catch(() => setPlans([]));
  }, [open, isEdit, accessToken]);

  const selectedPlan = plans.find((p) => p.code === form.subscription_plan_code) ?? null;

  const logoPreviewUrl = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : null),
    [logoFile],
  );
  useEffect(() => {
    return () => {
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
    };
  }, [logoPreviewUrl]);

  const setField = <K extends keyof OrgFormState>(field: K, value: OrgFormState[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleNameChange = (value: string) => {
    setField("name", value);
    if (!slugTouched) setField("slug", slugify(value));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;
    setError(null);
    setIsSubmitting(true);
    try {
      let saved: Organization;
      if (isEdit && organization) {
        const payload: Partial<Organization> = {
          name: form.name,
          slug: form.slug,
          org_type: form.org_type,
          ownership_type: form.ownership_type,
          dha_facility_code: form.dha_facility_code,
          county: form.county,
          sub_county: form.sub_county,
          logo_url: form.logo_url,
          tagline: form.tagline,
          primary_color: form.primary_color,
          support_email: form.support_email,
          support_phone: form.support_phone,
          website: form.website,
        };
        if (form.org_type === "HOSPITAL") payload.facility_type = form.facility_type;
        saved = await updateOrganization(accessToken, organization.id, payload);
      } else {
        const payload: CreateOrganizationPayload = { ...form };
        if (form.org_type !== "HOSPITAL") delete payload.facility_type;
        saved = await createOrganization(accessToken, payload);
      }
      if (logoFile) {
        // A separate real upload call rather than bundling the file into the
        // create/update payload — CreateOrganizationSerializer's org_admin
        // sub-object doesn't survive multipart form-encoding, and the
        // organization needs to exist first anyway for a new one.
        await uploadOrganizationLogo(accessToken, saved.id, logoFile);
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Couldn't ${isEdit ? "update" : "create"} the organization.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={isEdit ? "Edit Organization" : "Add Organization"}
      subtitle={isEdit ? form.name : "Provision a new tenant on the platform"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isSubmitting}
            className={`${BUTTON_PRIMARY} flex-1`}
          >
            {isSubmitting
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save Changes"
                : "Create Organization"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className={LABEL_CLASS}>
          Organization Name <span className="text-status-red">*</span>
          <input
            required
            className={FIELD_CLASS}
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Slug <span className="text-status-red">*</span>
          <input
            required
            className={FIELD_CLASS}
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setField("slug", e.target.value);
            }}
          />
        </label>
        <label className={LABEL_CLASS}>
          Organization Type <span className="text-status-red">*</span>
          <select
            required
            className={FIELD_CLASS}
            value={form.org_type}
            onChange={(e) => setField("org_type", e.target.value as OrgType)}
          >
            {(Object.keys(ORG_TYPE_LABEL) as OrgType[]).map((type) => (
              <option key={type} value={type}>
                {/* eslint-disable-next-line security/detect-object-injection -- `type` is iterated from `Object.keys(ORG_TYPE_LABEL)`, not user input. */}
                {ORG_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL_CLASS}>
          Ownership Type <span className="text-status-red">*</span>
          <select
            required
            className={FIELD_CLASS}
            value={form.ownership_type}
            onChange={(e) => setField("ownership_type", e.target.value as OwnershipType)}
          >
            {OWNERSHIP_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {form.org_type === "HOSPITAL" && (
          <label className={LABEL_CLASS}>
            Facility Type <span className="text-status-red">*</span>
            <select
              required
              className={FIELD_CLASS}
              value={form.facility_type}
              onChange={(e) => setField("facility_type", e.target.value)}
            >
              <option value="">Select…</option>
              {FACILITY_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <label className={LABEL_CLASS}>
            {IDENTITY_CODE_LABEL[form.org_type]}
            <input
              className={FIELD_CLASS}
              placeholder={IDENTITY_CODE_PLACEHOLDER[form.org_type]}
              value={form.dha_facility_code}
              onChange={(e) => setField("dha_facility_code", e.target.value)}
            />
          </label>
          <IdentityCodeStatus orgType={form.org_type} value={form.dha_facility_code} />
        </div>

        <label className={LABEL_CLASS}>
          County
          <input
            className={FIELD_CLASS}
            value={form.county}
            onChange={(e) => setField("county", e.target.value)}
          />
        </label>
        <label className={LABEL_CLASS}>
          Sub-County
          <input
            className={FIELD_CLASS}
            value={form.sub_county}
            onChange={(e) => setField("sub_county", e.target.value)}
          />
        </label>

        {!isEdit && (
          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">Subscription</h3>
            <div className="flex flex-col gap-4">
              <label className={LABEL_CLASS}>
                Subscription Plan
                <select
                  className={FIELD_CLASS}
                  value={form.subscription_plan_code}
                  onChange={(e) => setField("subscription_plan_code", e.target.value)}
                >
                  <option value="">No plan (assign later)</option>
                  {plans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name} —{" "}
                      {plan.max_staff_seats
                        ? `up to ${plan.max_staff_seats} seats`
                        : "unlimited seats"}
                    </option>
                  ))}
                </select>
              </label>
              {form.subscription_plan_code && (
                <label className={LABEL_CLASS}>
                  Billing Cycle
                  <select
                    className={FIELD_CLASS}
                    value={form.billing_cycle}
                    onChange={(e) =>
                      setField("billing_cycle", e.target.value as "MONTHLY" | "ANNUAL")
                    }
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </label>
              )}
              {selectedPlan && (
                <p className="-mt-1 rounded-sm border border-surface-border bg-surface-bg px-3 py-2 text-xs leading-relaxed text-ink-500">
                  {selectedPlan.name} — KES {Number(selectedPlan.price_monthly).toLocaleString()} /
                  month
                  {form.billing_cycle === "ANNUAL" ? ", billed annually" : ""}. Includes{" "}
                  {selectedPlan.max_staff_seats
                    ? `up to ${selectedPlan.max_staff_seats} user seats`
                    : "unlimited user seats"}
                  {selectedPlan.included_modules.length > 0 &&
                    ` and ${selectedPlan.included_modules.length} bundled modules`}
                  .
                </p>
              )}
            </div>
          </div>
        )}

        {isEdit ? (
          <p className="rounded-sm bg-surface-bg px-3 py-2 text-xs text-ink-500">
            Org Admin is provisioned once, at creation. Manage that user from the
            organization&apos;s member list.
          </p>
        ) : (
          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">
              Contact Person (Org Admin)
            </h3>
            <div className="flex flex-col gap-4">
              <label className={LABEL_CLASS}>
                Email <span className="text-status-red">*</span>
                <input
                  required
                  type="email"
                  className={FIELD_CLASS}
                  value={form.org_admin.email}
                  onChange={(e) =>
                    setField("org_admin", { ...form.org_admin, email: e.target.value })
                  }
                />
              </label>
              <label className={LABEL_CLASS}>
                First Name <span className="text-status-red">*</span>
                <input
                  required
                  className={FIELD_CLASS}
                  value={form.org_admin.first_name}
                  onChange={(e) =>
                    setField("org_admin", { ...form.org_admin, first_name: e.target.value })
                  }
                />
              </label>
              <label className={LABEL_CLASS}>
                Last Name <span className="text-status-red">*</span>
                <input
                  required
                  className={FIELD_CLASS}
                  value={form.org_admin.last_name}
                  onChange={(e) =>
                    setField("org_admin", { ...form.org_admin, last_name: e.target.value })
                  }
                />
              </label>
              <label className={LABEL_CLASS}>
                Phone
                <input
                  type="tel"
                  className={FIELD_CLASS}
                  placeholder="+254 7XX XXX XXX"
                  value={form.org_admin.phone}
                  onChange={(e) =>
                    setField("org_admin", { ...form.org_admin, phone: e.target.value })
                  }
                />
              </label>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">Branding</h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-700">Logo</span>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md border border-surface-border bg-surface-bg">
                  {logoPreviewUrl ? (
                    <img
                      src={logoPreviewUrl}
                      alt="Selected logo preview"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : form.logo_url ? (
                    <img
                      src={form.logo_url}
                      alt="Current logo"
                      className="h-full w-full object-contain p-1"
                    />
                  ) : (
                    <span className="text-[9px] font-semibold text-ink-400">No logo</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file && file.size > LOGO_MAX_SIZE_BYTES) {
                        setError("Logo must be 30MB or smaller.");
                        e.target.value = "";
                        return;
                      }
                      setError(null);
                      setLogoFile(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-surface-bg"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {logoFile ? logoFile.name : "Upload Logo"}
                  </button>
                  <span className="text-[11px] text-ink-400">
                    PNG, JPG, WEBP, or SVG, up to 30MB
                  </span>
                </div>
              </div>
            </div>
            <label className={LABEL_CLASS}>
              Logo URL
              <input
                type="url"
                className={FIELD_CLASS}
                placeholder="https://…/logo.png"
                value={form.logo_url}
                onChange={(e) => setField("logo_url", e.target.value)}
              />
              <span className="mt-1 block text-[11px] font-normal text-ink-400">
                Only used if no file is uploaded above.
              </span>
            </label>
            <label className={LABEL_CLASS}>
              Tagline
              <input
                className={FIELD_CLASS}
                value={form.tagline}
                onChange={(e) => setField("tagline", e.target.value)}
              />
            </label>
            <label className={LABEL_CLASS}>
              Primary Color
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-9 flex-shrink-0 cursor-pointer rounded-sm border border-surface-border p-0.5"
                  value={form.primary_color}
                  onChange={(e) => setField("primary_color", e.target.value)}
                />
                <input
                  className={`${FIELD_CLASS} flex-1`}
                  value={form.primary_color}
                  onChange={(e) => setField("primary_color", e.target.value)}
                />
              </span>
            </label>
            <label className={LABEL_CLASS}>
              Support Email
              <input
                type="email"
                className={FIELD_CLASS}
                value={form.support_email}
                onChange={(e) => setField("support_email", e.target.value)}
              />
            </label>
            <label className={LABEL_CLASS}>
              Support Phone
              <input
                type="tel"
                className={FIELD_CLASS}
                value={form.support_phone}
                onChange={(e) => setField("support_phone", e.target.value)}
              />
            </label>
            <label className={LABEL_CLASS}>
              Website
              <input
                type="url"
                className={FIELD_CLASS}
                value={form.website}
                onChange={(e) => setField("website", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">
            Security Configuration
          </h3>
          <p className="mb-3 rounded-sm border border-surface-border bg-brand-green-tint-2 px-3 py-2 text-xs leading-relaxed text-brand-green-dark">
            Security Baseline: CITRAMAC Platform. Mandatory controls are inherited automatically and
            cannot be weakened by Tenant Administrators.
          </p>
          <div className="flex flex-col divide-y divide-surface-border rounded-md border border-surface-border">
            {MANDATORY_CONTROLS.map((control) => (
              <div
                key={control.label}
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-ink-900">{control.label}</span>
                <span className="text-ink-500">{control.value}</span>
                <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-brand-green-tint px-2 py-0.5 font-bold text-brand-green-dark">
                  <Lock className="h-2.5 w-2.5" />
                  Enforced
                </span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
          >
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}

/** Small dropdown menu, similar visual weight to the status filter chips. */
function GroupByMenu({ value, onChange }: { value: GroupBy; onChange: (v: GroupBy) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = GROUP_BY_OPTIONS.find((o) => o.value === value)?.label ?? "No grouping";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-surface-border px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-surface-bg"
      >
        <Layers className="h-3.5 w-3.5" />
        Group by: {current}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-md border border-surface-border bg-surface-card py-1 shadow-md">
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-bg ${
                value === opt.value ? "font-semibold text-brand-green-dark" : "text-ink-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Row actions: edit (pencil) + a kebab menu for view/edit and suspend/reactivate. */
function RowActionsMenu({
  org,
  busy,
  onEdit,
  onToggleStatus,
}: {
  org: Organization;
  busy: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const iconButtonClass =
    "flex h-7 w-7 items-center justify-center rounded-md border border-surface-border text-ink-500 hover:border-brand-green hover:text-brand-green";

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${org.name}`}
        className={iconButtonClass}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`More actions for ${org.name}`}
          className={iconButtonClass}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-md border border-surface-border bg-surface-card py-1 shadow-md">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 hover:bg-surface-bg"
            >
              <Pencil className="h-3.5 w-3.5" />
              View / Edit organization
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onToggleStatus();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-bg disabled:opacity-60 ${
                org.status === "SUSPENDED" ? "text-brand-green-dark" : "text-status-red"
              }`}
            >
              {org.status === "SUSPENDED" ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Reactivate access
                </>
              ) : (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  Suspend access
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = Array.from(keep)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("...");
    result.push(p);
    prev = p;
  }
  return result;
}

/** Real server-side pagination — the organizations endpoint already uses
 * DRF's PageNumberPagination (see config/settings/base.py). Dot-style pager
 * per the mockup. */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const navButtonClass =
    "flex h-7 w-7 items-center justify-center rounded-full border border-surface-border text-ink-500 hover:border-brand-green hover:text-brand-green disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-surface-border py-3">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
        className={navButtonClass}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {getPageNumbers(page, totalPages).map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-1 text-xs text-ink-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              p === page
                ? "bg-brand-green text-white"
                : "border border-surface-border text-ink-700 hover:bg-surface-bg"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
        className={navButtonClass}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Platform Super Admin organizations registry — citramac_SUPER-ADMIN.html
 * "Organizations" tab. CITRAMAC is multi-vertical: an "organization" may be
 * a hospital, school, university, corporate, or individual practitioner,
 * each verified against a different identity code (DHA MFL code, MoE
 * registration, CUE charter, BRS registration, professional council
 * license) — see apps.tenancy's OrganizationSerializer.
 */
export function OrganizationsPage() {
  const { accessToken } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrganizationStatus | "">("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; organization: Organization | null }>({
    open: false,
    organization: null,
  });

  const refresh = () => {
    if (!accessToken) return;
    setIsLoading(true);
    setError(null);
    listOrganizations(accessToken, {
      q: search || undefined,
      status: statusFilter || undefined,
      page,
    })
      .then((res) => {
        setOrganizations(res.results);
        setCount(res.count);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load organizations."),
      )
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // Deferred one microtask so `refresh`'s own setIsLoading(true) runs
    // inside a callback rather than synchronously in the effect body.
    void Promise.resolve().then(() => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, search, statusFilter, page]);

  const toggleStatus = async (org: Organization) => {
    if (!accessToken) return;
    const nextStatus: OrganizationStatus = org.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    setBusyId(org.id);
    setError(null);
    try {
      await setOrganizationStatus(accessToken, org.id, nextStatus);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the organization status.");
    } finally {
      setBusyId(null);
    }
  };

  const groupedRows = useMemo(() => {
    if (groupBy === "none") return [{ label: null as string | null, orgs: organizations }];
    const order: string[] = [];
    const map = new Map<string, Organization[]>();
    for (const org of organizations) {
      const key = groupKeyFor(org, groupBy);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(org);
    }
    return order.map((label) => ({ label, orgs: map.get(label)! }));
  }, [organizations, groupBy]);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
            Platform Console
          </div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Organizations</h1>
        </div>
        <button
          type="button"
          onClick={() => setDrawer({ open: true, organization: null })}
          className={`${BUTTON_PRIMARY} flex items-center gap-1.5`}
        >
          <Plus className="h-4 w-4" />
          Add Organization
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className={`${FIELD_CLASS} w-72 pl-9`}
            placeholder="Search organizations…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => {
                setStatusFilter(filter.value);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                statusFilter === filter.value
                  ? "bg-brand-green text-white"
                  : "border border-surface-border text-ink-700 hover:bg-surface-bg"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <GroupByMenu value={groupBy} onChange={setGroupBy} />
        </div>
      </div>

      {error && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Identity Code</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">County</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Branches</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupedRows.map((group) => (
              <Fragment key={group.label ?? "__all__"}>
                {group.label !== null && (
                  <tr>
                    <td
                      colSpan={7}
                      className="bg-surface-bg px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-500"
                    >
                      {group.label}
                      <span className="ml-1.5 font-normal normal-case text-ink-400">
                        ({group.orgs.length})
                      </span>
                    </td>
                  </tr>
                )}
                {group.orgs.map((org) => (
                  <tr key={org.id} className="border-b border-surface-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-900">{org.name}</div>
                      <div className="text-xs text-ink-500">{org.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="w-fit rounded px-2 py-0.5 font-mono text-xs bg-surface-bg border border-surface-border">
                          {org.dha_facility_code || "—"}
                        </span>
                        <span className="text-[11px] text-ink-500">{org.identity_code_label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      {ORG_TYPE_LABEL[org.org_type] ?? org.org_type}
                    </td>
                    <td className="px-4 py-3 text-ink-700">{org.county || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={org.status} />
                    </td>
                    <td className="px-4 py-3 text-ink-700">{org.branch_count}</td>
                    <td className="px-4 py-3">
                      <RowActionsMenu
                        org={org}
                        busy={busyId === org.id}
                        onEdit={() => setDrawer({ open: true, organization: org })}
                        onToggleStatus={() => toggleStatus(org)}
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {!isLoading && organizations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  No organizations found.
                </td>
              </tr>
            )}
            {isLoading && organizations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      <OrganizationDrawer
        open={drawer.open}
        organization={drawer.organization}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={() => {
          setDrawer((d) => ({ ...d, open: false }));
          refresh();
        }}
      />
    </div>
  );
}
