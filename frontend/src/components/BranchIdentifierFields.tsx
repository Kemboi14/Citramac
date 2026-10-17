import { AlertTriangle } from "lucide-react";
import type { Branch, LicenseStatus } from "../lib/branchesApi";
import {
  branchIdentifierIssues,
  licenseStatusLabel,
  type BranchIdentifierValues,
} from "../lib/branchIdentifiers";

// Form fields, licence badge, attention banner and history for a branch's
// registration identifiers — helpers live in lib/branchIdentifiers.ts.

const LICENSE_TINT: Record<LicenseStatus, string> = {
  VALID: "bg-brand-green-tint text-brand-green-dark",
  EXPIRING: "bg-status-amber-tint text-status-amber",
  EXPIRED: "bg-status-red-tint text-status-red",
  MISSING: "bg-surface-bg text-ink-500",
};

export function LicenseStatusBadge({ branch }: { branch: Branch }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${
        LICENSE_TINT[branch.license_status]
      }`}
      title={
        branch.facility_license_valid_until
          ? `Valid until ${branch.facility_license_valid_until}`
          : undefined
      }
    >
      {licenseStatusLabel(branch.license_status, branch.license_days_remaining)}
    </span>
  );
}

export function BranchIdentifierBanner({ branches }: { branches: Branch[] }) {
  const flagged = branches
    .filter((b) => b.is_active)
    .map((b) => ({ branch: b, issues: branchIdentifierIssues(b) }))
    .filter((row) => row.issues.length > 0);
  if (flagged.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-md border border-status-amber/40 bg-status-amber-tint px-4 py-3 text-sm text-ink-900"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-status-amber" />
      <div>
        <p className="font-semibold">Branch registration details need attention</p>
        <ul className="mt-1 list-disc pl-5">
          {flagged.map(({ branch, issues }) => (
            <li key={branch.id}>
              <span className="font-medium">{branch.name}</span>: {issues.join("; ")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface FieldsProps {
  values: BranchIdentifierValues;
  onChange: (patch: Partial<BranchIdentifierValues>) => void;
  /** true/false once the organisation type is known; undefined shows the rule as a hint. */
  kmpdcRequired: boolean | undefined;
  shaClaimsEnabled: boolean;
  errors?: Partial<Record<keyof BranchIdentifierValues, string>>;
  labelClassName: string;
  fieldClassName: string;
  rowClassName?: string;
}

function Required() {
  return <span className="text-status-red">*</span>;
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="text-xs font-normal text-status-red">{message}</span> : null;
}

export function BranchIdentifierFields({
  values,
  onChange,
  kmpdcRequired,
  shaClaimsEnabled,
  errors = {},
  labelClassName,
  fieldClassName,
  rowClassName = "flex flex-col gap-4",
}: FieldsProps) {
  const licenceTouched = Boolean(
    values.facility_license_number || values.facility_license_valid_until,
  );
  return (
    <div className={rowClassName}>
      <label className={labelClassName}>
        <span>KMPDC Registration No. {kmpdcRequired && <Required />}</span>
        <input
          className={fieldClassName}
          value={values.kmpdc_registration_number}
          onChange={(e) => onChange({ kmpdc_registration_number: e.target.value })}
          required={kmpdcRequired === true}
          aria-invalid={Boolean(errors.kmpdc_registration_number)}
        />
        {kmpdcRequired === undefined && (
          <span className="text-xs font-normal text-ink-500">
            Required for every branch of a registered health provider.
          </span>
        )}
        <FieldError message={errors.kmpdc_registration_number} />
      </label>
      <label className={labelClassName}>
        <span>SHA FR Code {shaClaimsEnabled && <Required />}</span>
        <input
          className={fieldClassName}
          value={values.sha_fr_code}
          onChange={(e) => onChange({ sha_fr_code: e.target.value })}
          required={shaClaimsEnabled}
          aria-invalid={Boolean(errors.sha_fr_code)}
        />
        <span className="text-xs font-normal text-ink-500">
          For facilities contracted by SHA — required before SHA claims can be submitted.
        </span>
        <FieldError message={errors.sha_fr_code} />
      </label>
      <label className={labelClassName}>
        <span>Facility Licence No. {licenceTouched && <Required />}</span>
        <input
          className={fieldClassName}
          value={values.facility_license_number}
          onChange={(e) => onChange({ facility_license_number: e.target.value })}
          required={licenceTouched}
          aria-invalid={Boolean(errors.facility_license_number)}
        />
        <FieldError message={errors.facility_license_number} />
      </label>
      <label className={labelClassName}>
        <span>Licence Valid Until {licenceTouched && <Required />}</span>
        <input
          type="date"
          className={fieldClassName}
          value={values.facility_license_valid_until}
          onChange={(e) => onChange({ facility_license_valid_until: e.target.value })}
          required={licenceTouched}
          aria-invalid={Boolean(errors.facility_license_valid_until)}
        />
        <span className="text-xs font-normal text-ink-500">
          Renewed yearly — Org Admins are reminded before it lapses. A renewal keeps the previous
          licence in the branch&apos;s history.
        </span>
        <FieldError message={errors.facility_license_valid_until} />
      </label>
    </div>
  );
}

export function BranchIdentifierHistory({ branch }: { branch: Branch }) {
  if (branch.identifier_history.length === 0) return null;
  return (
    <details className="rounded-md border border-surface-border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-ink-900">
        Identifier history ({branch.identifier_history.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {branch.identifier_history.map((change) => (
          <li key={change.id} className="text-xs text-ink-700">
            <span className="font-semibold">{change.field_label}</span>:{" "}
            {change.previous_value || "—"} → {change.new_value || "—"}
            <span className="text-ink-500">
              {" "}
              · {new Date(change.created_at).toLocaleDateString()}
              {change.changed_by_email ? ` · ${change.changed_by_email}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
