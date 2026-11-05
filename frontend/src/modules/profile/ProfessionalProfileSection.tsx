import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import { Callout, StatusPill } from "../care/shared/ui";
import {
  downloadMyProfessionalDocument,
  getMyProfessionalProfile,
  openBlob,
  STATUS_LABEL,
  STATUS_TONE,
  submitMyProfessionalProfile,
  updateMyProfessionalProfile,
  uploadMyProfessionalDocument,
  type DocumentKind,
  type ProfessionalProfile,
  type ProfessionalProfileFields,
} from "../../lib/professionalProfileApi";

const INPUT =
  "w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none transition-colors focus:border-brand-green focus:bg-surface-card";
const LABEL = "mb-1.5 block text-[11.5px] font-semibold text-ink-700";
const SUBHEAD = "mt-6 mb-3 text-[12px] font-bold uppercase tracking-wide text-ink-500";
const GHOST =
  "rounded-md border border-surface-border px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60";

const REQUIRED_DOCS: DocumentKind[] = ["registration", "licence", "qualification"];
const OPTIONAL_DOCS: DocumentKind[] = ["indemnity", "nacada"];

type Form = ProfessionalProfileFields;

function formFrom(profile: ProfessionalProfile): Form {
  const f = profile.fields;
  return {
    ...f,
    regulator: f.regulator || profile.suggested_regulators[0] || "",
    licence_issued_on: f.licence_issued_on ?? "",
    licence_expires_on: f.licence_expires_on ?? "",
    indemnity_expires_on: f.indemnity_expires_on ?? "",
    nacada_issued_on: f.nacada_issued_on ?? "",
    nacada_expires_on: f.nacada_expires_on ?? "",
  };
}

function message(err: unknown, fallback: string) {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

function dateText(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
}

/**
 * "Professional profile" on My Profile: what this person's roles require
 * (registration, current practising licence, qualifications and a document
 * for each), saved as they go and then submitted for an Org Admin or a
 * credentials verifier to check. Nothing here can mark itself verified.
 */
export function ProfessionalProfileSection() {
  const { accessToken, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    getMyProfessionalProfile(accessToken)
      .then((data) => {
        setProfile(data);
        setForm(formFrom(data));
      })
      .catch((err) => setError(message(err, "Couldn't load your professional profile.")));
  }, [accessToken]);

  // Arriving from a notification or the banner (#professional-profile).
  useEffect(() => {
    if (profile && window.location.hash === "#professional-profile") {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [profile]);

  if (!accessToken) return null;
  if (!profile || !form) {
    return error ? <Callout tone="danger">{error}</Callout> : null;
  }

  const set = (patch: Partial<Form>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  // An upload must not wipe details typed but not yet saved, so only a save or
  // a submit reloads the form from the server.
  const applied = async (next: ProfessionalProfile, reloadForm = true) => {
    setProfile(next);
    if (reloadForm) setForm(formFrom(next));
    await refreshProfile();
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    try {
      const next = await updateMyProfessionalProfile(accessToken, {
        regulator: form.regulator,
        registration_body: form.registration_body,
        registration_number: form.registration_number,
        qualifications: form.qualifications,
        licence_number: form.licence_number,
        licence_issued_on: form.licence_issued_on || null,
        licence_expires_on: form.licence_expires_on || null,
        indemnity_number: form.indemnity_number,
        indemnity_expires_on: form.indemnity_expires_on || null,
        nacada: {
          number: form.nacada_number,
          category: form.nacada_category,
          issued_on: form.nacada_issued_on || null,
          expires_on: form.nacada_expires_on || null,
        },
      });
      await applied(next);
    } catch (err) {
      setError(message(err, "Couldn't save your professional profile."));
      throw err;
    }
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    try {
      const next = await submitMyProfessionalProfile(accessToken);
      await applied(next);
      setNotice("Submitted. Your Org Admin has been told and will verify it.");
    } catch (err) {
      setError(message(err, "Couldn't submit your profile."));
      throw err;
    }
  };

  const upload = async (kind: DocumentKind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(kind);
    try {
      await applied(await uploadMyProfessionalDocument(accessToken, kind, file), false);
    } catch (err) {
      setError(message(err, "Couldn't upload the document."));
    } finally {
      setUploading(null);
    }
  };

  const view = async (kind: DocumentKind) => {
    try {
      openBlob(await downloadMyProfessionalDocument(accessToken, kind));
    } catch (err) {
      setError(message(err, "Couldn't open the document."));
    }
  };

  const status = profile.status;
  const canSubmit =
    profile.credentials_required &&
    profile.missing_items.length === 0 &&
    (status === "DRAFT" || status === "RETURNED");

  const docRow = (kind: DocumentKind, required: boolean) => {
    // eslint-disable-next-line security/detect-object-injection -- `kind` is a fixed union.
    const doc = profile.documents[kind];
    return (
      <li
        key={kind}
        className="flex flex-wrap items-center gap-2 border-b border-surface-border py-2.5 last:border-b-0"
      >
        <div className="min-w-0 flex-1 text-[13px] text-ink-900">
          {doc.label}
          {!required && (
            <span className="ml-1.5 text-[11.5px] text-ink-500">(if you have one)</span>
          )}
        </div>
        <StatusPill tone={doc.uploaded ? "success" : required ? "warning" : "neutral"}>
          {doc.uploaded ? "Uploaded" : "Not uploaded"}
        </StatusPill>
        {doc.uploaded && (
          <button type="button" className={GHOST} onClick={() => void view(kind)}>
            View
          </button>
        )}
        <label className={`${GHOST} cursor-pointer`}>
          {uploading === kind ? "Uploading…" : doc.uploaded ? "Replace" : "Upload"}
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="sr-only"
            disabled={uploading !== null}
            onChange={(e) => {
              void upload(kind, e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </li>
    );
  };

  return (
    <div
      ref={sectionRef}
      id="professional-profile"
      className="scroll-mt-24 rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-ink-900">
            Professional profile
          </h2>
          <p className="mt-1 text-[13px] text-ink-500">
            {profile.credentials_required
              ? "Your registration, current practising licence and qualifications, with a document for each. Save as you go, then submit it to be verified."
              : "Your roles don't need a professional registration. Keep your mobile number up to date above."}
          </p>
        </div>
        {status && (
          // eslint-disable-next-line security/detect-object-injection -- `status` is a fixed union.
          <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {profile.signing_block && (
          <Callout tone="danger" role="alert" label="Signing blocked">
            {profile.signing_block}
          </Callout>
        )}
        {status === "RETURNED" && profile.returned_reason && (
          <Callout tone="warning" label="Returned">
            <strong>What needs changing:</strong> {profile.returned_reason}
          </Callout>
        )}
        {profile.missing_items.length > 0 && (
          <Callout tone="warning" label="Still needed">
            <ul className="list-disc pl-4">
              {profile.missing_items.map((item) => (
                <li key={item.key}>{item.label}</li>
              ))}
            </ul>
          </Callout>
        )}
        {status === "VERIFIED" && (
          <Callout tone="success" label="Verified">
            Verified by {profile.verified.licence_by || profile.verified.registration_by} on{" "}
            {dateText(profile.verified.licence_at || profile.verified.registration_at)}. Changing a
            number, date or document sends it back for verification.
          </Callout>
        )}
        {profile.licence_status === "EXPIRING" && (
          <Callout tone="warning" label="Expiring">
            Your practising licence expires on {dateText(profile.licence_expires_on)}. Record the
            renewal here once you have it.
          </Callout>
        )}
      </div>

      {profile.credentials_required && (
        <form onSubmit={(e) => e.preventDefault()}>
          <div className={SUBHEAD}>Registration</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="pp-regulator">
                Regulatory body
              </label>
              <select
                id="pp-regulator"
                className={INPUT}
                value={form.regulator}
                onChange={(e) => set({ regulator: e.target.value })}
              >
                <option value="">Choose…</option>
                {profile.regulator_choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {form.regulator === "OTHER" && (
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="pp-body">
                  Name of the regulatory body
                </label>
                <input
                  id="pp-body"
                  className={INPUT}
                  value={form.registration_body}
                  onChange={(e) => set({ registration_body: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className={LABEL} htmlFor="pp-reg">
                Registration number
              </label>
              <input
                id="pp-reg"
                className={INPUT}
                value={form.registration_number}
                onChange={(e) => set({ registration_number: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-qual">
                Qualifications
              </label>
              <input
                id="pp-qual"
                className={INPUT}
                value={form.qualifications}
                onChange={(e) => set({ qualifications: e.target.value })}
                placeholder="e.g. MBChB, MMed Psychiatry"
              />
            </div>
          </div>

          <div className={SUBHEAD}>Current practising licence</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={LABEL} htmlFor="pp-lic">
                Licence number
              </label>
              <input
                id="pp-lic"
                className={INPUT}
                value={form.licence_number}
                onChange={(e) => set({ licence_number: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-lic-from">
                Issued on
              </label>
              <input
                id="pp-lic-from"
                type="date"
                className={INPUT}
                value={form.licence_issued_on ?? ""}
                onChange={(e) => set({ licence_issued_on: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-lic-to">
                Expires on
              </label>
              <input
                id="pp-lic-to"
                type="date"
                className={INPUT}
                value={form.licence_expires_on ?? ""}
                onChange={(e) => set({ licence_expires_on: e.target.value })}
              />
            </div>
          </div>

          <div className={SUBHEAD}>If you have them</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="pp-nacada">
                NACADA accreditation number
              </label>
              <input
                id="pp-nacada"
                className={INPUT}
                value={form.nacada_number}
                onChange={(e) => set({ nacada_number: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-nacada-cat">
                NACADA category (as on the certificate)
              </label>
              <input
                id="pp-nacada-cat"
                className={INPUT}
                value={form.nacada_category}
                onChange={(e) => set({ nacada_category: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-nacada-from">
                NACADA issued on
              </label>
              <input
                id="pp-nacada-from"
                type="date"
                className={INPUT}
                value={form.nacada_issued_on ?? ""}
                onChange={(e) => set({ nacada_issued_on: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-nacada-to">
                NACADA expires on
              </label>
              <input
                id="pp-nacada-to"
                type="date"
                className={INPUT}
                value={form.nacada_expires_on ?? ""}
                onChange={(e) => set({ nacada_expires_on: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-ind">
                Professional indemnity policy number
              </label>
              <input
                id="pp-ind"
                className={INPUT}
                value={form.indemnity_number}
                onChange={(e) => set({ indemnity_number: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="pp-ind-to">
                Indemnity cover expires on
              </label>
              <input
                id="pp-ind-to"
                type="date"
                className={INPUT}
                value={form.indemnity_expires_on ?? ""}
                onChange={(e) => set({ indemnity_expires_on: e.target.value })}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <SaveButton onSave={save} variant="ghost">
              Save details
            </SaveButton>
          </div>

          <div className={SUBHEAD}>Documents (PDF, PNG or JPEG, up to 10 MB)</div>
          <ul>
            {REQUIRED_DOCS.map((kind) => docRow(kind, true))}
            {OPTIONAL_DOCS.map((kind) => docRow(kind, false))}
          </ul>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 text-[12.5px] text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-[12.5px] text-brand-green-dark">
          {notice}
        </p>
      )}

      {profile.credentials_required && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {!canSubmit && status !== "SUBMITTED" && status !== "VERIFIED" && (
            <span className="text-[12px] text-ink-500">
              Save your details and upload the documents first.
            </span>
          )}
          {status === "SUBMITTED" && (
            <span className="text-[12px] text-ink-500">
              Submitted {dateText(profile.submitted_at)} — waiting for verification.
            </span>
          )}
          <SaveButton
            onSave={submit}
            disabled={!canSubmit}
            savingLabel="Submitting…"
            savedLabel="Submitted"
          >
            Submit for verification
          </SaveButton>
        </div>
      )}

      {profile.reviews.length > 0 && (
        <>
          <div className={SUBHEAD}>History</div>
          <ul className="text-[12.5px] text-ink-700">
            {profile.reviews.map((r, i) => (
              <li key={`${r.at}-${i}`} className="py-1">
                {dateText(r.at)} ·{" "}
                {r.action === "SUBMITTED"
                  ? "Submitted"
                  : r.action === "VERIFIED"
                    ? "Verified"
                    : "Returned"}{" "}
                by {r.actor}
                {r.reason ? ` — ${r.reason}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
