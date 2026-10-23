import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { fieldErrorsFrom, formErrorSummary } from "../../lib/formErrors";
import {
  getPractitionerCredential,
  HWR_REGULATORS,
  updatePractitionerCredential,
  type Credential,
  type CredentialUpdate,
  type HealthWorkerRegistrySummary,
  type HwrRegulator,
} from "../../lib/legalStatusApi";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const HELP_CLASS = "text-xs font-normal text-ink-500";
const ERROR_CLASS = "rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red";

// Fields this form shows inline; anything else the API refuses is shown once above.
const INLINE_FIELDS = [
  "registration_number",
  "hwr_regulator",
  "hwr_puid",
  "health_worker_registry",
];

interface FormState {
  registration_number: string;
  registration_body: string;
  qualifications: string;
  registration_verified: boolean;
  mha_recommendation_approved: boolean;
  hwr_regulator: HwrRegulator;
  hwr_puid: string;
}

function formFromCredential(c: Credential): FormState {
  return {
    registration_number: c.registration_number,
    registration_body: c.registration_body,
    qualifications: c.qualifications,
    registration_verified: Boolean(c.registration_verified_at),
    mha_recommendation_approved: c.mha_recommendation_approved,
    hwr_regulator: c.hwr_regulator,
    hwr_puid: c.health_worker_registry?.puid ?? "",
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="text-xs font-normal text-status-red">{message}</span>;
}

function RegistryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col py-1.5">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="text-sm text-ink-900">{value || "—"}</dd>
    </div>
  );
}

/** The Health Worker Registry's record as last checked — read-only, the registry's own words. */
function HealthWorkerRegistryPanel({ summary }: { summary: HealthWorkerRegistrySummary | null }) {
  if (!summary?.checked_at) {
    return <p className="text-sm text-ink-500">Not yet checked against the registry.</p>;
  }
  const checked = `Checked ${new Date(summary.checked_at).toLocaleString()}`;
  if (!summary.found) {
    return (
      <div className="flex flex-col gap-1">
        <p className="rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-ink-900">
          The Health Worker Registry has no record for this registration number and regulator.
        </p>
        <span className="text-xs text-ink-500">{checked}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-500">{checked}</span>
      <dl className="flex flex-col divide-y divide-surface-border">
        <RegistryRow label="Name" value={summary.full_name} />
        <RegistryRow label="Registration ID" value={summary.registration_id} />
        <RegistryRow label="Licensing body" value={summary.licensing_body} />
        <RegistryRow
          label="Active"
          value={summary.is_active === null ? "" : summary.is_active ? "Yes" : "No"}
        />
        <RegistryRow label="Cadre" value={summary.cadre} />
        <RegistryRow label="Specialty" value={summary.specialty} />
        <div className="flex flex-col py-1.5">
          <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Licences</dt>
          <dd className="text-sm text-ink-900">
            {summary.licenses.length === 0 ? (
              "—"
            ) : (
              <ul className="flex flex-col gap-0.5">
                {summary.licenses.map((lic, index) => (
                  <li key={`${lic.type}-${index}`}>
                    {lic.type || "—"} · {lic.start || "—"} to {lic.end || "—"}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Org Admin records and verifies a practitioner's registration (the
 * Mental Health Act recommendation gate, LGL-R-02) and links it to the DHA
 * Health Worker Registry: the regulator to look the number up with, the
 * registry's record, and the Practitioner Unique Identifier the Shared
 * Health Record asks for — typed from that record, never guessed.
 */
export function PractitionerCredentialDrawer({
  userId,
  staffName,
  onClose,
}: {
  /** The staff member's user id; null keeps the drawer closed. */
  userId: string | null;
  staffName?: string;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!accessToken || !userId) return;
    let cancelled = false;
    // Deferred one microtask so nothing setState's synchronously in the effect body.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setCredential(null);
      setForm(null);
      setLoadError(null);
      setError(null);
      setFieldErrors({});
      getPractitionerCredential(accessToken, userId)
        .then((c) => {
          if (cancelled) return;
          setCredential(c);
          setForm(formFromCredential(c));
        })
        .catch((err) => {
          if (!cancelled) {
            setLoadError(
              err instanceof ApiError ? err.message : "Couldn't load this practitioner's credential.",
            );
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, userId]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const payload = (f: FormState, c: Credential): CredentialUpdate => {
    const number = f.registration_number.trim();
    const wasVerified = Boolean(c.registration_verified_at);
    // A changed number clears its verification on the server, so a box
    // ticked again for the new number re-verifies it; otherwise only send a change.
    const verifyChanged =
      f.registration_verified !== wasVerified ||
      (f.registration_verified && number !== c.registration_number);
    return {
      registration_number: number,
      registration_body: f.registration_body.trim(),
      qualifications: f.qualifications.trim(),
      mha_recommendation_approved: f.mha_recommendation_approved,
      hwr_regulator: f.hwr_regulator,
      hwr_puid: f.hwr_puid.trim(),
      ...(verifyChanged ? { registration_verified: f.registration_verified } : {}),
    };
  };

  const submit = async (checkRegistry: boolean) => {
    if (!accessToken || !userId || !form || !credential) return;
    setError(null);
    setFieldErrors({});
    try {
      const updated = await updatePractitionerCredential(accessToken, userId, {
        ...payload(form, credential),
        ...(checkRegistry ? { check_registry: true } : {}),
      });
      setCredential(updated);
      setForm(formFromCredential(updated));
    } catch (err) {
      setFieldErrors(fieldErrorsFrom(err));
      setError(
        formErrorSummary(err, "Couldn't save this practitioner's credential.", INLINE_FIELDS),
      );
      // The other fields are saved before the registry lookup runs, so a
      // failed lookup can still have changed what is stored — refresh the
      // read-only parts without discarding what was typed.
      if (checkRegistry) {
        getPractitionerCredential(accessToken, userId)
          .then(setCredential)
          .catch(() => undefined);
      }
      throw err;
    }
  };

  const regulatorMissing = !form?.hwr_regulator || !form.registration_number.trim();

  return (
    <Drawer
      open={userId !== null}
      title="Practitioner Credential"
      subtitle={staffName}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
            onClick={onClose}
          >
            Close
          </button>
          <SaveButton onSave={() => submit(false)} className="flex-1" disabled={!form}>
            Save credential
          </SaveButton>
        </>
      }
    >
      {loadError && <p className={ERROR_CLASS}>{loadError}</p>}
      {!loadError && !form && <p className="text-sm text-ink-500">Loading…</p>}
      {form && credential && (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <span
            className={`w-fit rounded-sm px-2 py-0.5 text-xs font-semibold ${
              credential.can_sign
                ? "bg-brand-green-tint text-brand-green-dark"
                : "bg-status-amber-tint text-status-amber"
            }`}
          >
            {credential.can_sign
              ? "Can make Mental Health Act recommendations"
              : "Cannot make Mental Health Act recommendations"}
          </span>
          {credential.reason && <p className="text-xs text-ink-500">{credential.reason}</p>}

          <label className={LABEL_CLASS}>
            Registration Number
            <input
              className={FIELD_CLASS}
              value={form.registration_number}
              onChange={(e) =>
                // A different number is unverified until someone ticks the box again.
                updateForm({
                  registration_number: e.target.value,
                  ...(e.target.value.trim() !== credential.registration_number
                    ? { registration_verified: false }
                    : { registration_verified: Boolean(credential.registration_verified_at) }),
                })
              }
              aria-invalid={Boolean(fieldErrors.registration_number)}
            />
            <FieldError message={fieldErrors.registration_number} />
          </label>
          <label className={LABEL_CLASS}>
            Registration Body
            <input
              className={FIELD_CLASS}
              value={form.registration_body}
              onChange={(e) => updateForm({ registration_body: e.target.value })}
            />
          </label>
          <label className={LABEL_CLASS}>
            Qualifications
            <input
              className={FIELD_CLASS}
              value={form.qualifications}
              onChange={(e) => updateForm({ qualifications: e.target.value })}
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand-green"
              checked={form.registration_verified}
              onChange={(e) => updateForm({ registration_verified: e.target.checked })}
            />
            <span>
              Registration verified
              <span className={`block ${HELP_CLASS}`}>
                {credential.registration_verified_at
                  ? `Verified ${new Date(credential.registration_verified_at).toLocaleString()}. Changing the number clears this until you tick it again.`
                  : "Tick once you have confirmed the number with the regulator."}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand-green"
              checked={form.mha_recommendation_approved}
              onChange={(e) => updateForm({ mha_recommendation_approved: e.target.checked })}
            />
            <span>
              Approved to make recommendations under the Mental Health Act
              <span className={`block ${HELP_CLASS}`}>MHA_RECOMMENDATION_APPROVED</span>
            </span>
          </label>

          <div className="border-t border-surface-border pt-4">
            <h3 className="mb-3 text-sm font-semibold text-ink-900">DHA Health Worker Registry</h3>
            <div className="flex flex-col gap-4">
              <label className={LABEL_CLASS}>
                Regulator
                <select
                  className={FIELD_CLASS}
                  value={form.hwr_regulator}
                  onChange={(e) => updateForm({ hwr_regulator: e.target.value as HwrRegulator })}
                  aria-invalid={Boolean(fieldErrors.hwr_regulator)}
                >
                  <option value="">Not set</option>
                  {HWR_REGULATORS.map((regulator) => (
                    <option key={regulator} value={regulator}>
                      {regulator}
                    </option>
                  ))}
                </select>
                <span className={HELP_CLASS}>
                  The regulator that issued the registration number above. The Health Worker
                  Registry accepts only these four, so a practitioner registered with any other
                  body cannot be looked up.
                </span>
                <FieldError message={fieldErrors.hwr_regulator} />
              </label>
              <div className="flex flex-col gap-2">
                <div>
                  <SaveButton
                    onSave={() => submit(true)}
                    variant="ghost"
                    disabled={regulatorMissing}
                    savingLabel="Checking…"
                    savedLabel="Checked"
                  >
                    Check Health Worker Registry
                  </SaveButton>
                </div>
                <span className={HELP_CLASS}>
                  Saves this form, then looks the registration number up with the chosen
                  regulator.
                </span>
                <FieldError message={fieldErrors.health_worker_registry} />
              </div>
              <HealthWorkerRegistryPanel summary={credential.health_worker_registry} />
              <label className={LABEL_CLASS}>
                PUID
                <input
                  className={`${FIELD_CLASS} font-mono`}
                  value={form.hwr_puid}
                  onChange={(e) => updateForm({ hwr_puid: e.target.value })}
                  maxLength={64}
                  aria-invalid={Boolean(fieldErrors.hwr_puid)}
                />
                <span className={HELP_CLASS}>
                  Practitioner Unique Identifier — the identifier the Shared Health Record asks
                  for. Copy it exactly from the registry record; never guess or derive it. Leave
                  blank until you have it.
                </span>
                <FieldError message={fieldErrors.hwr_puid} />
              </label>
            </div>
          </div>

          {error && <p className={ERROR_CLASS}>{error}</p>}
        </form>
      )}
    </Drawer>
  );
}
