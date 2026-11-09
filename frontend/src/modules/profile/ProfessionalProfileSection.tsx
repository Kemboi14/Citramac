import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import { Callout, StatusPill } from "../care/shared/ui";
import {
  addMyCredentialItem,
  downloadMyCredentialItemDocument,
  downloadMyProfessionalDocument,
  getMyProfessionalProfile,
  openBlob,
  removeMyCredentialItem,
  STATUS_LABEL,
  STATUS_TONE,
  submitMyProfessionalProfile,
  updateMyCredentialItem,
  updateMyProfessionalProfile,
  uploadMyCredentialItemDocument,
  uploadMyProfessionalDocument,
  type CredentialItem,
  type CredentialItemFields,
  type DocumentKind,
  type ItemKind,
  type ProfessionalProfile,
  type ProfessionalProfileFields,
} from "../../lib/professionalProfileApi";

const INPUT =
  "w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none transition-colors focus:border-brand-green focus:bg-surface-card";
const LABEL = "mb-1.5 block text-[11.5px] font-semibold text-ink-700";
const SUBHEAD = "mt-7 mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-500";
const HELP = "mb-3 text-[12px] text-ink-500";
const GHOST =
  "rounded-md border border-surface-border px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60";
const CARD = "mb-3 rounded-lg border border-surface-border p-4";
const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

const QUALIFICATION_KINDS: ItemKind[] = ["DEGREE", "DIPLOMA", "CERTIFICATE", "OTHER"];

type Form = ProfessionalProfileFields;

function formFrom(profile: ProfessionalProfile): Form {
  const f = profile.fields;
  return {
    ...f,
    regulator: f.regulator || profile.suggested_regulators[0] || "",
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
 * The upload placeholder that sits next to every document the profile asks
 * for: whether it is uploaded, View, and Upload / Replace. Before an entry is
 * saved, the chosen file is held here and sent with the entry.
 */
function DocumentSlot({
  label,
  uploaded,
  required,
  busy,
  pendingName,
  onPick,
  onView,
}: {
  label: string;
  uploaded: boolean;
  required: boolean;
  busy: boolean;
  pendingName?: string;
  onPick: (file: File) => void;
  onView?: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-surface-border bg-surface-bg px-3 py-2.5">
      <div className="min-w-0 flex-1 text-[12.5px] text-ink-900">
        <span className="font-semibold">{label}</span>
        <span className="ml-1.5 text-[11.5px] text-ink-500">PDF, PNG or JPEG, up to 10 MB</span>
        {pendingName && (
          <span className="block text-[11.5px] text-ink-500">
            Selected: {pendingName} — uploaded when you save
          </span>
        )}
      </div>
      <StatusPill
        tone={uploaded ? "success" : pendingName ? "info" : required ? "warning" : "neutral"}
      >
        {uploaded ? "Uploaded" : pendingName ? "Ready to upload" : "Not uploaded"}
      </StatusPill>
      {uploaded && onView && (
        <button type="button" className={GHOST} onClick={onView}>
          View
        </button>
      )}
      <label className={`${GHOST} cursor-pointer`}>
        {busy ? "Uploading…" : uploaded || pendingName ? "Replace" : "Upload"}
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          aria-label={`Upload ${label}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

type ItemDraft = {
  title: string;
  issuer: string;
  number: string;
  issued_on: string;
  expires_on: string;
};

function draftFrom(item: CredentialItem | null, issuer = ""): ItemDraft {
  return {
    title: item?.title ?? "",
    issuer: item?.issuer ?? issuer,
    number: item?.number ?? "",
    issued_on: item?.issued_on ?? "",
    expires_on: item?.expires_on ?? "",
  };
}

function itemPill(item: CredentialItem) {
  if (item.kind === "LICENCE") {
    if (item.in_force === false) return <StatusPill>Superseded</StatusPill>;
    if (item.licence_status === "EXPIRED") return <StatusPill tone="danger">Expired</StatusPill>;
    if (item.licence_status === "EXPIRING") return <StatusPill tone="warning">Expiring</StatusPill>;
  }
  return item.verified_at ? (
    <StatusPill tone="success">Verified</StatusPill>
  ) : (
    <StatusPill>Not verified yet</StatusPill>
  );
}

/**
 * One licence, degree, diploma or certificate, with its own document slot.
 * `item` is null for a new entry that hasn't been saved yet.
 */
function CredentialItemCard({
  kind,
  kindLabel,
  item,
  defaultIssuer,
  issuerSuggestions,
  onCreate,
  onUpdate,
  onRemove,
  onUpload,
  onView,
  onCancel,
}: {
  kind: ItemKind;
  kindLabel: string;
  item: CredentialItem | null;
  defaultIssuer: string;
  issuerSuggestions: string[];
  onCreate: (fields: CredentialItemFields, file: File | null) => Promise<void>;
  onUpdate: (id: string, fields: CredentialItemFields) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onUpload: (id: string, file: File) => Promise<void>;
  onView: (id: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFrom(item, defaultIssuer));
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const licence = kind === "LICENCE";
  const id = item?.id ?? `new-${kind}`;
  const saved = item ? draftFrom(item) : null;
  const dirty =
    !saved ||
    (Object.keys(draft) as (keyof ItemDraft)[]).some(
      // eslint-disable-next-line security/detect-object-injection -- keys of a fixed local type.
      (key) => draft[key] !== saved[key],
    );
  const set = (patch: Partial<ItemDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const fields = (): CredentialItemFields => ({
    title: draft.title,
    issuer: draft.issuer,
    number: draft.number,
    issued_on: draft.issued_on || null,
    expires_on: licence ? draft.expires_on || null : null,
  });

  const save = async () => {
    if (item) await onUpdate(item.id, fields());
    else await onCreate(fields(), pending);
  };

  const pick = async (file: File) => {
    if (!item) {
      setPending(file);
      return;
    }
    setBusy(true);
    try {
      await onUpload(item.id, file);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!window.confirm(`Remove ${item.label} from your profile?`)) return;
    await onRemove(item.id);
  };

  return (
    <div className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink-900">
          {item ? item.label : `New ${kindLabel.toLowerCase()}`}
        </div>
        {item && itemPill(item)}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {licence ? (
          <>
            <div>
              <label className={LABEL} htmlFor={`${id}-issuer`}>
                Issued by (regulator)
              </label>
              <input
                id={`${id}-issuer`}
                className={INPUT}
                list="pp-regulator-names"
                value={draft.issuer}
                onChange={(e) => set({ issuer: e.target.value })}
              />
              <datalist id="pp-regulator-names">
                {issuerSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-number`}>
                Licence number
              </label>
              <input
                id={`${id}-number`}
                className={INPUT}
                value={draft.number}
                onChange={(e) => set({ number: e.target.value })}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={LABEL} htmlFor={`${id}-title`}>
                {kindLabel} (as on the certificate)
              </label>
              <input
                id={`${id}-title`}
                className={INPUT}
                value={draft.title}
                placeholder={kind === "DEGREE" ? "e.g. MBChB" : undefined}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-issuer`}>
                Awarded by
              </label>
              <input
                id={`${id}-issuer`}
                className={INPUT}
                value={draft.issuer}
                placeholder="University, college or body"
                onChange={(e) => set({ issuer: e.target.value })}
              />
            </div>
          </>
        )}
        <div>
          <label className={LABEL} htmlFor={`${id}-from`}>
            {licence ? "Issued on" : "Awarded on"}
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className={INPUT}
            value={draft.issued_on}
            onChange={(e) => set({ issued_on: e.target.value })}
          />
        </div>
        {licence ? (
          <div>
            <label className={LABEL} htmlFor={`${id}-to`}>
              Expires on
            </label>
            <input
              id={`${id}-to`}
              type="date"
              className={INPUT}
              value={draft.expires_on}
              onChange={(e) => set({ expires_on: e.target.value })}
            />
          </div>
        ) : (
          <div>
            <label className={LABEL} htmlFor={`${id}-number`}>
              Certificate number (if it has one)
            </label>
            <input
              id={`${id}-number`}
              className={INPUT}
              value={draft.number}
              onChange={(e) => set({ number: e.target.value })}
            />
          </div>
        )}
      </div>

      <DocumentSlot
        label={licence ? "Practising licence" : `${kindLabel} certificate`}
        uploaded={Boolean(item?.document_uploaded)}
        required
        busy={busy}
        pendingName={pending?.name}
        onPick={(file) => void pick(file)}
        onView={item ? () => onView(item.id) : undefined}
      />

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {item ? (
          <button type="button" className={GHOST} onClick={() => void remove()}>
            Remove
          </button>
        ) : (
          <button type="button" className={GHOST} onClick={onCancel}>
            Cancel
          </button>
        )}
        <SaveButton onSave={save} variant="ghost" disabled={!dirty}>
          {item ? "Save changes" : `Save ${kindLabel.toLowerCase()}`}
        </SaveButton>
      </div>
    </div>
  );
}

/**
 * "Professional profile" on My Profile: what this person's roles require —
 * registration, practising licences (as many as they hold) and degrees,
 * diplomas and certificates — each with its document uploaded right beside
 * it, saved as they go and then submitted for an Org Admin or a credentials
 * verifier to check. Nothing here can mark itself verified.
 */
export function ProfessionalProfileSection() {
  const { accessToken, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  // New entries being filled in, not saved yet (in page memory only).
  const [drafts, setDrafts] = useState<{ key: number; kind: ItemKind }[]>([]);
  const nextDraft = useRef(0);
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

  // An upload or an entry's save must not wipe details typed but not yet
  // saved, so only "Save details" and submit reload the form from the server.
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

  const upload = async (kind: DocumentKind, file: File) => {
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

  // Every entry action reports its own failure and rethrows, so the
  // SaveButton shows it.
  const itemAction = async (run: () => Promise<ProfessionalProfile>, fallback: string) => {
    setError(null);
    setNotice(null);
    try {
      await applied(await run(), false);
    } catch (err) {
      setError(message(err, fallback));
      throw err;
    }
  };

  const viewItem = async (itemId: string) => {
    try {
      openBlob(await downloadMyCredentialItemDocument(accessToken, itemId));
    } catch (err) {
      setError(message(err, "Couldn't open the document."));
    }
  };

  const addDraft = (kind: ItemKind) => {
    nextDraft.current += 1;
    setDrafts((prev) => [...prev, { key: nextDraft.current, kind }]);
  };
  const dropDraft = (key: number) => setDrafts((prev) => prev.filter((d) => d.key !== key));

  const kindLabel = (kind: ItemKind) =>
    profile.item_kinds.find((k) => k.value === kind)?.label ?? kind;
  const regulatorNames = profile.regulator_choices
    .filter((c) => c.value !== "OTHER")
    .map((c) => c.label);
  const registrationBody =
    form.regulator === "OTHER"
      ? form.registration_body
      : (profile.regulator_choices.find((c) => c.value === form.regulator)?.label ?? "");

  const card = (kind: ItemKind, item: CredentialItem | null, draftKey?: number) => (
    <CredentialItemCard
      key={item ? item.id : `draft-${draftKey}`}
      kind={kind}
      kindLabel={kindLabel(kind)}
      item={item}
      defaultIssuer={kind === "LICENCE" ? registrationBody : ""}
      issuerSuggestions={regulatorNames}
      onCreate={(fields, file) =>
        itemAction(
          () => addMyCredentialItem(accessToken, kind, fields, file),
          "Couldn't add the entry.",
        ).then(() => {
          if (draftKey !== undefined) dropDraft(draftKey);
        })
      }
      onUpdate={(itemId, fields) =>
        itemAction(
          () => updateMyCredentialItem(accessToken, itemId, fields),
          "Couldn't save the entry.",
        )
      }
      onRemove={(itemId) =>
        itemAction(
          () => removeMyCredentialItem(accessToken, itemId),
          "Couldn't remove the entry.",
        ).catch(() => undefined)
      }
      onUpload={(itemId, file) =>
        itemAction(
          () => uploadMyCredentialItemDocument(accessToken, itemId, file),
          "Couldn't upload the document.",
        ).catch(() => undefined)
      }
      onView={(itemId) => void viewItem(itemId)}
      onCancel={() => draftKey !== undefined && dropDraft(draftKey)}
    />
  );

  const licences = profile.items.filter((i) => i.kind === "LICENCE");
  const qualifications = profile.items.filter((i) => i.kind !== "LICENCE");

  const status = profile.status;
  const canSubmit =
    profile.credentials_required &&
    profile.missing_items.length === 0 &&
    drafts.length === 0 &&
    (status === "DRAFT" || status === "RETURNED");

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
              ? "Your registration, practising licences and qualifications, each with its document beside it. Save as you go, then submit it to be verified."
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
            Verified by {profile.verified.registration_by} on{" "}
            {dateText(profile.verified.registration_at)}. Changing a number, date or document sends
            it back for verification.
          </Callout>
        )}
        {profile.licence_status === "EXPIRING" && (
          <Callout tone="warning" label="Expiring">
            A practising licence expires on {dateText(profile.licence_expires_on)}. Add the renewed
            licence here once you have it.
          </Callout>
        )}
      </div>

      {profile.credentials_required && (
        <form onSubmit={(e) => e.preventDefault()}>
          <div className={SUBHEAD}>Registration</div>
          <p className={HELP}>Who you are registered with, and the certificate that shows it.</p>
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
          </div>
          <DocumentSlot
            label={profile.documents.registration.label}
            uploaded={profile.documents.registration.uploaded}
            required
            busy={uploading === "registration"}
            onPick={(file) => void upload("registration", file)}
            onView={() => void view("registration")}
          />
          <div className="mt-3 flex justify-end">
            <SaveButton onSave={save} variant="ghost">
              Save registration
            </SaveButton>
          </div>

          <div className={SUBHEAD}>Practising licences</div>
          <p className={HELP}>
            Every practising licence you hold, each with its document. When you renew, add the new
            licence — the latest one from each regulator is the one in force.
          </p>
          {licences.map((item) => card("LICENCE", item))}
          {drafts.filter((d) => d.kind === "LICENCE").map((d) => card("LICENCE", null, d.key))}
          <button type="button" className={GHOST} onClick={() => addDraft("LICENCE")}>
            + Add a practising licence
          </button>

          <div className={SUBHEAD}>Degrees, diplomas and certificates</div>
          <p className={HELP}>
            Add each qualification you hold. Each one asks for its certificate.
          </p>
          {qualifications.map((item) => card(item.kind, item))}
          {drafts.filter((d) => d.kind !== "LICENCE").map((d) => card(d.kind, null, d.key))}
          <div className="flex flex-wrap gap-2">
            {QUALIFICATION_KINDS.map((kind) => (
              <button key={kind} type="button" className={GHOST} onClick={() => addDraft(kind)}>
                + {kindLabel(kind)}
              </button>
            ))}
          </div>

          <div className={SUBHEAD}>If you have them</div>
          <p className={HELP}>NACADA accreditation and professional indemnity cover.</p>
          <div className={CARD}>
            <div className="mb-3 text-[13px] font-semibold text-ink-900">NACADA accreditation</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="pp-nacada">
                  Accreditation number
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
                  Category (as on the certificate)
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
                  Issued on
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
                  Expires on
                </label>
                <input
                  id="pp-nacada-to"
                  type="date"
                  className={INPUT}
                  value={form.nacada_expires_on ?? ""}
                  onChange={(e) => set({ nacada_expires_on: e.target.value })}
                />
              </div>
            </div>
            <DocumentSlot
              label={profile.documents.nacada.label}
              uploaded={profile.documents.nacada.uploaded}
              required={Boolean(form.nacada_number.trim())}
              busy={uploading === "nacada"}
              onPick={(file) => void upload("nacada", file)}
              onView={() => void view("nacada")}
            />
          </div>
          <div className={CARD}>
            <div className="mb-3 text-[13px] font-semibold text-ink-900">
              Professional indemnity cover
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="pp-ind">
                  Policy number
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
                  Cover expires on
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
            <DocumentSlot
              label={profile.documents.indemnity.label}
              uploaded={profile.documents.indemnity.uploaded}
              required={Boolean(form.indemnity_number.trim())}
              busy={uploading === "indemnity"}
              onPick={(file) => void upload("indemnity", file)}
              onView={() => void view("indemnity")}
            />
          </div>
          <div className="flex justify-end">
            <SaveButton onSave={save} variant="ghost">
              Save NACADA and indemnity
            </SaveButton>
          </div>
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
              {drafts.length > 0
                ? "Save or cancel the new entries first."
                : "Save your details and upload the documents first."}
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
