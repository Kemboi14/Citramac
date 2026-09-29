import { useEffect, useState } from "react";
import { AlertTriangle, Archive, BellRing, CheckCircle2, Plus, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SaveButton } from "../../components/SaveButton";
import {
  getSubscriptionPolicy,
  updateSubscriptionPolicy,
  type SubscriptionPolicy,
} from "../../lib/subscriptionsApi";
import {
  getRetentionPlatformSettings,
  updateRetentionPlatformSettings,
  type RetentionPlatformSettings,
} from "../../lib/retentionApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-1 font-display text-base font-semibold text-ink-900";
const HELP_CLASS = "text-xs font-normal text-ink-500";
const FIELD_ERROR_CLASS = "text-xs font-medium text-status-red";

// Mirrors the backend serializers' own bounds (SubscriptionPolicySerializer,
// RetentionPlatformSettingsSerializer) so an out-of-range entry is caught
// before the round-trip; the API remains the source of truth.
const MAX_REMINDER_DAYS = 365;
const MAX_GRACE_DAYS = 90;
const MAX_FORECAST_DAYS = 3650;

type FieldErrors = Record<string, string>;

/** Flattens ApiError.fields (DRF's `{field: [messages]}`) into one message per field. */
function toFieldErrors(err: unknown): FieldErrors {
  if (!(err instanceof ApiError) || !err.fields) return {};
  const result: FieldErrors = {};
  for (const [field, value] of Object.entries(err.fields)) {
    // eslint-disable-next-line security/detect-object-injection -- `field` is a key of the API's own error payload, written into a fresh local object.
    result[field] = Array.isArray(value) ? value.map(String).join(" ") : String(value);
  }
  return result;
}

function FieldError({ errors, field }: { errors: FieldErrors; field: string }) {
  // eslint-disable-next-line security/detect-object-injection -- `field` is a compile-time literal at every call site.
  const message = errors[field];
  return message ? <span className={FIELD_ERROR_CLASS}>{message}</span> : null;
}

function sameList(a: number[], b: number[]) {
  // eslint-disable-next-line security/detect-object-injection -- `i` is the numeric index `every` itself supplies.
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Chip-list editor for a set of whole-day values (reminder schedule,
 * forecast windows). Keeps the list sorted largest-first and de-duplicated,
 * the same normalisation the backend applies on save, so what the admin sees
 * before saving is exactly what gets stored.
 */
function DaysListEditor({
  label,
  help,
  values,
  onChange,
  max,
  allowEmpty,
  serverError,
}: {
  label: string;
  help: string;
  values: number[];
  onChange: (next: number[]) => void;
  max: number;
  allowEmpty: boolean;
  serverError?: string;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      setLocalError(`Enter a whole number of days between 1 and ${max}.`);
      return;
    }
    if (values.includes(value)) {
      setLocalError(`${value} days is already in the list.`);
      return;
    }
    setLocalError(null);
    setDraft("");
    onChange([...values, value].sort((a, b) => b - a));
  };

  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
      {label}
      <div className="flex flex-wrap items-center gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-brand-green-tint py-1 pl-3 pr-1.5 text-xs font-semibold text-brand-green-dark"
          >
            {value} day{value === 1 ? "" : "s"}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              disabled={!allowEmpty && values.length === 1}
              aria-label={`Remove ${value} days`}
              className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-surface-card disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className={HELP_CLASS}>None set.</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={max}
          className={`${FIELD_CLASS} w-32`}
          value={draft}
          placeholder="Days"
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
      <span className={HELP_CLASS}>{help}</span>
      {localError && <span className={FIELD_ERROR_CLASS}>{localError}</span>}
      {serverError && <span className={FIELD_ERROR_CLASS}>{serverError}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// a. Subscription reminders & grace
// ---------------------------------------------------------------------------

interface PolicyForm {
  reminder_days_before: number[];
  grace_period_days: string;
  renewal_contact: string;
}

function policyToForm(policy: SubscriptionPolicy): PolicyForm {
  return {
    reminder_days_before: policy.reminder_days_before,
    grace_period_days: String(policy.grace_period_days),
    renewal_contact: policy.renewal_contact,
  };
}

function SubscriptionPolicyCard() {
  const { accessToken } = useAuth();
  const [policy, setPolicy] = useState<SubscriptionPolicy | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!accessToken) return;
    getSubscriptionPolicy(accessToken)
      .then((p) => {
        setPolicy(p);
        setForm(policyToForm(p));
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Couldn't load the subscription policy.",
        ),
      );
  }, [accessToken]);

  const save = async () => {
    if (!accessToken || !form) return;
    setSaveError(null);
    setFieldErrors({});
    const grace = Number(form.grace_period_days);
    const localErrors: FieldErrors = {};
    if (form.reminder_days_before.length === 0) {
      localErrors.reminder_days_before = "Add at least one reminder.";
    }
    if (form.grace_period_days.trim() === "" || !Number.isInteger(grace) || grace < 0) {
      localErrors.grace_period_days = "Enter a whole number of days.";
    } else if (grace > MAX_GRACE_DAYS) {
      localErrors.grace_period_days = `At most ${MAX_GRACE_DAYS} days.`;
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      throw new Error("invalid");
    }
    try {
      const updated = await updateSubscriptionPolicy(accessToken, {
        reminder_days_before: form.reminder_days_before,
        grace_period_days: grace,
        renewal_contact: form.renewal_contact.trim(),
      });
      setPolicy(updated);
      setForm(policyToForm(updated));
    } catch (err) {
      setFieldErrors(toFieldErrors(err));
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save the subscription policy.",
      );
      throw err;
    }
  };

  return (
    <div className={CARD_CLASS}>
      <h2 className={SECTION_TITLE_CLASS}>
        <span className="inline-flex items-center gap-2">
          <BellRing size={16} className="text-brand-green" />
          Subscription reminders &amp; grace
        </span>
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        Org Admins are reminded in CITRAMAC, by email and by SMS on each of these days before their
        subscription ends, on the day itself, and daily through the grace period. After the grace
        period the organisation becomes read-only — staff keep read and export access and no data is
        deleted.
      </p>

      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}
      {!policy && !loadError && <p className="text-sm text-ink-500">Loading…</p>}

      {policy && form && (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <DaysListEditor
            label="Remind this many days before the period ends"
            help={`Whole days between 1 and ${MAX_REMINDER_DAYS}. At least one is required.`}
            values={form.reminder_days_before}
            onChange={(next) =>
              setForm((prev) => (prev ? { ...prev, reminder_days_before: next } : prev))
            }
            max={MAX_REMINDER_DAYS}
            allowEmpty={false}
            serverError={fieldErrors.reminder_days_before}
          />
          <label className={LABEL_CLASS}>
            Grace period (days)
            <input
              type="number"
              min={0}
              max={MAX_GRACE_DAYS}
              className={`${FIELD_CLASS} w-32`}
              value={form.grace_period_days}
              onChange={(e) => {
                const value = e.target.value;
                setForm((prev) => (prev ? { ...prev, grace_period_days: value } : prev));
              }}
            />
            <span className={HELP_CLASS}>
              Full access continues this long after the period ends. At most {MAX_GRACE_DAYS} days.
            </span>
            <FieldError errors={fieldErrors} field="grace_period_days" />
          </label>
          <label className={LABEL_CLASS}>
            Renewal contact
            <input
              type="text"
              maxLength={255}
              className={FIELD_CLASS}
              value={form.renewal_contact}
              placeholder="Email address or phone number"
              onChange={(e) => {
                const value = e.target.value;
                setForm((prev) => (prev ? { ...prev, renewal_contact: value } : prev));
              }}
            />
            <span className={HELP_CLASS}>
              Shown in every reminder and on each tenant&rsquo;s subscription banner as &ldquo;To
              renew, contact …&rdquo;.
            </span>
            <FieldError errors={fieldErrors} field="renewal_contact" />
          </label>
          {saveError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {saveError}
            </p>
          )}
          <div>
            <SaveButton onSave={save}>Save Reminders</SaveButton>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// b. Records retention floor
// ---------------------------------------------------------------------------

interface FloorForm {
  clinical_floor_years: string;
  mental_health_floor_years: string;
  financial_floor_years: string;
  minor_clock_enabled: boolean;
  minor_clock_start_age: string;
  forecast_windows_days: number[];
  floor_source: string;
}

type FloorYearsKey = "clinical_floor_years" | "mental_health_floor_years" | "financial_floor_years";

const FLOOR_YEAR_FIELDS: { key: FloorYearsKey; label: string; help: string }[] = [
  {
    key: "clinical_floor_years",
    label: "Clinical records (years)",
    help: "General clinical records.",
  },
  {
    key: "mental_health_floor_years",
    label: "Mental health & SUD records (years)",
    help: "Psychiatric, psychotherapy and substance-use treatment records.",
  },
  {
    key: "financial_floor_years",
    label: "Financial records (years)",
    help: "Invoices, payments and claims.",
  },
];

function settingsToForm(settings: RetentionPlatformSettings): FloorForm {
  return {
    clinical_floor_years: String(settings.clinical_floor_years),
    mental_health_floor_years: String(settings.mental_health_floor_years),
    financial_floor_years: String(settings.financial_floor_years),
    minor_clock_enabled: settings.minor_clock_start_age !== null,
    minor_clock_start_age:
      settings.minor_clock_start_age === null ? "" : String(settings.minor_clock_start_age),
    forecast_windows_days: settings.forecast_windows_days,
    floor_source: settings.floor_source,
  };
}

function RetentionFloorCard() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<RetentionPlatformSettings | null>(null);
  const [form, setForm] = useState<FloorForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getRetentionPlatformSettings(accessToken)
      .then((s) => {
        setSettings(s);
        setForm(settingsToForm(s));
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Couldn't load the retention settings.",
        ),
      );
  }, [accessToken]);

  const applySettings = (updated: RetentionPlatformSettings) => {
    setSettings(updated);
    setForm(settingsToForm(updated));
  };

  // Figures whose change clears verification server-side — the three
  // floors and the minor clock-start age (RetentionPlatformSettingsSerializer.validate).
  const figuresDirty =
    settings !== null &&
    form !== null &&
    (FLOOR_YEAR_FIELDS.some(
      // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
      ({ key }) => form[key].trim() !== String(settings[key]),
    ) ||
      (form.minor_clock_enabled
        ? form.minor_clock_start_age.trim() !== String(settings.minor_clock_start_age ?? "")
        : settings.minor_clock_start_age !== null));

  const windowsDirty =
    settings !== null &&
    form !== null &&
    !sameList(form.forecast_windows_days, settings.forecast_windows_days);
  // The source text is sent with "Mark as verified" itself, so only unsaved
  // figure/window edits have to be saved before verifying.
  const verifyBlocked = figuresDirty || windowsDirty;
  const anyDirty =
    verifyBlocked ||
    (form !== null && settings !== null && form.floor_source !== settings.floor_source);

  const save = async () => {
    if (!accessToken || !form || !settings) return;
    setSaveError(null);
    setFieldErrors({});
    const localErrors: FieldErrors = {};
    const payload: Parameters<typeof updateRetentionPlatformSettings>[1] = {};
    for (const { key } of FLOOR_YEAR_FIELDS) {
      // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
      const years = Number(form[key]);
      // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
      if (form[key].trim() === "" || !Number.isInteger(years) || years < 1) {
        // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
        localErrors[key] = "At least 1 year, in whole years.";
        // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
      } else if (years !== settings[key]) {
        // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
        payload[key] = years;
      }
    }
    let minorAge: number | null = null;
    if (form.minor_clock_enabled) {
      minorAge = Number(form.minor_clock_start_age);
      if (form.minor_clock_start_age.trim() === "" || !Number.isInteger(minorAge) || minorAge < 1) {
        localErrors.minor_clock_start_age = "Enter an age in whole years.";
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      throw new Error("invalid");
    }
    if (minorAge !== settings.minor_clock_start_age) payload.minor_clock_start_age = minorAge;
    if (!sameList(form.forecast_windows_days, settings.forecast_windows_days)) {
      payload.forecast_windows_days = form.forecast_windows_days;
    }
    if (form.floor_source !== settings.floor_source) payload.floor_source = form.floor_source;
    try {
      applySettings(await updateRetentionPlatformSettings(accessToken, payload));
    } catch (err) {
      setFieldErrors(toFieldErrors(err));
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save the retention settings.");
      throw err;
    }
  };

  const markVerified = async () => {
    if (!accessToken || !form) return;
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      applySettings(
        await updateRetentionPlatformSettings(accessToken, {
          floor_verified: true,
          floor_source: form.floor_source.trim(),
        }),
      );
      setFieldErrors({});
      setConfirmOpen(false);
    } catch (err) {
      setFieldErrors(toFieldErrors(err));
      setVerifyError(
        err instanceof ApiError ? err.message : "Couldn't mark the retention floor verified.",
      );
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <h2 className={SECTION_TITLE_CLASS}>
        <span className="inline-flex items-center gap-2">
          <Archive size={16} className="text-brand-green" />
          Records retention floor
        </span>
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        The minimum time every organisation must keep each kind of record after a client&rsquo;s
        last activity. Organisations may keep records longer, never shorter. At the end of the
        period records are archived — read-only and restorable — never deleted.
      </p>

      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}
      {!settings && !loadError && <p className="text-sm text-ink-500">Loading…</p>}

      {settings && form && (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-5">
          {settings.floor_verified ? (
            <div className="flex items-start gap-2 rounded-md border border-surface-border bg-brand-green-tint px-4 py-3 text-sm text-brand-green-dark">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-semibold">
                  Verified by {settings.verified_by_name ?? "an unknown user"} on{" "}
                  {formatDateTime(settings.verified_at)}
                </div>
                <div className="mt-0.5 whitespace-pre-line text-ink-700">
                  {settings.floor_source}
                </div>
              </div>
            </div>
          ) : (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-status-red bg-status-red-tint px-4 py-3 text-sm text-status-red"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-semibold">NOT VERIFIED</div>
                <div className="mt-0.5">
                  These figures are provisional. Archiving is disabled for every organisation until
                  the statutory retention periods are confirmed with legal counsel / DHA and
                  recorded here.
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {FLOOR_YEAR_FIELDS.map(({ key, label, help }) => (
              <label key={key} className={LABEL_CLASS}>
                {label}
                <input
                  type="number"
                  min={1}
                  className={FIELD_CLASS}
                  // eslint-disable-next-line security/detect-object-injection -- `key` comes from the fixed `FLOOR_YEAR_FIELDS` const array, not user input.
                  value={form[key]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
                  }}
                />
                <span className={HELP_CLASS}>{help}</span>
                <FieldError errors={fieldErrors} field={key} />
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-[15px] w-[15px] accent-brand-green"
                checked={form.minor_clock_enabled}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((prev) => (prev ? { ...prev, minor_clock_enabled: checked } : prev));
                }}
              />
              For clients who were minors, start the retention clock at a set age
            </label>
            {form.minor_clock_enabled && (
              <label className={LABEL_CLASS}>
                Minor clock-start age (years)
                <input
                  type="number"
                  min={1}
                  className={`${FIELD_CLASS} w-32`}
                  value={form.minor_clock_start_age}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => (prev ? { ...prev, minor_clock_start_age: value } : prev));
                  }}
                />
              </label>
            )}
            <span className={HELP_CLASS}>
              When off, a minor&rsquo;s records follow the same clock as everyone else&rsquo;s (from
              their last activity).
            </span>
            <FieldError errors={fieldErrors} field="minor_clock_start_age" />
          </div>

          <DaysListEditor
            label="Forecast windows"
            help={`How far ahead each organisation's retention scan counts records coming due. Whole days between 1 and ${MAX_FORECAST_DAYS}.`}
            values={form.forecast_windows_days}
            onChange={(next) =>
              setForm((prev) => (prev ? { ...prev, forecast_windows_days: next } : prev))
            }
            max={MAX_FORECAST_DAYS}
            allowEmpty
            serverError={fieldErrors.forecast_windows_days}
          />

          {/* Locked while verified: the recorded source is what the verification
              attests to, so it only becomes editable again once a figure change
              has cleared verification. */}
          {!settings.floor_verified && (
            <label className={LABEL_CLASS}>
              Verification source
              <textarea
                rows={3}
                className={FIELD_CLASS}
                value={form.floor_source}
                placeholder="The legal instrument or DHA guidance these figures were confirmed against"
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((prev) => (prev ? { ...prev, floor_source: value } : prev));
                }}
              />
              <span className={HELP_CLASS}>
                The legal instrument or DHA guidance these figures were confirmed against. Required
                before the figures can be marked verified.
              </span>
              <FieldError errors={fieldErrors} field="floor_source" />
            </label>
          )}

          {settings.floor_verified && figuresDirty && (
            <p className="flex items-start gap-2 rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-status-amber">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Saving a changed retention figure clears verification — archiving will be disabled for
              every organisation until the new figures are verified again.
            </p>
          )}
          {!settings.floor_verified && (
            <p className={HELP_CLASS}>
              Changing any retention figure or the minor clock-start age always clears verification.
            </p>
          )}

          {saveError && (
            <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
              {saveError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <SaveButton onSave={save} disabled={!anyDirty}>
              Save Retention Settings
            </SaveButton>
            {!settings.floor_verified && (
              <button
                type="button"
                disabled={verifyBlocked || !form.floor_source.trim()}
                onClick={() => {
                  setVerifyError(null);
                  setConfirmOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-md border border-brand-green px-4 py-2 text-sm font-semibold text-brand-green-dark hover:bg-brand-green-tint disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                Mark as verified
              </button>
            )}
          </div>
          {!settings.floor_verified && verifyBlocked && (
            <p className={HELP_CLASS}>Save your changes before marking the figures verified.</p>
          )}
          {!settings.floor_verified && !verifyBlocked && !form.floor_source.trim() && (
            <p className={HELP_CLASS}>
              Record the verification source above before marking the figures verified.
            </p>
          )}
        </form>
      )}

      {settings && form && (
        <ConfirmDialog
          open={confirmOpen}
          title="Mark retention floor as verified?"
          confirmLabel="Mark as verified"
          busyLabel="Verifying…"
          busy={verifyBusy}
          error={verifyError}
          onConfirm={markVerified}
          onCancel={() => setConfirmOpen(false)}
        >
          <p>You are confirming that these minimum retention periods have been checked:</p>
          <ul className="list-disc pl-5">
            <li>Clinical records: {settings.clinical_floor_years} years</li>
            <li>Mental health &amp; SUD records: {settings.mental_health_floor_years} years</li>
            <li>Financial records: {settings.financial_floor_years} years</li>
            <li>
              Minor clock-start age:{" "}
              {settings.minor_clock_start_age === null
                ? "not applied"
                : `${settings.minor_clock_start_age} years`}
            </li>
          </ul>
          <p>
            against: <span className="whitespace-pre-line font-semibold">{form.floor_source}</span>
          </p>
          <p>
            Once verified, organisations can approve archive batches based on these figures. Your
            name and the time are recorded against this verification.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * Super Admin — Data Lifecycle: what happens to a tenant when its CITRAMAC
 * subscription ends (reminder schedule, grace period, who to contact), and
 * the platform-wide records retention floor that gates every archive
 * approval. Nothing on this screen deletes data: an expired tenant becomes
 * read-only, and a record past its retention period is archived, not
 * removed.
 */
export function DataLifecyclePage() {
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Data Lifecycle</h1>
        <p className="mt-1 text-sm text-ink-500">
          Subscription renewal reminders and grace, and the minimum records retention periods
          applied to every organisation.
        </p>
      </div>
      <SubscriptionPolicyCard />
      <RetentionFloorCard />
    </div>
  );
}
