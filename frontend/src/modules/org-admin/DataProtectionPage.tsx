import { AuthenticatedDownloadButton } from "../../components/AuthenticatedDownloadButton";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  acceptComplianceWarranty,
  getComplianceProfile,
  updateComplianceProfile,
  type ComplianceProfile,
} from "../../lib/complianceApi";
import { formatDate, formatDateTime } from "../care/shared/format";
import { BTN, INPUT } from "../care/shared/styles";
import { Callout, Card, ErrorNote, Field, PageHeader, Tag } from "../care/shared/ui";
import { useRecordData } from "../care/record/useRecordData";

// Org Admin — the facility's data-protection compliance profile (legal opinion
// of 2 Oct 2026 §4.3, §5, §6): its Data Protection Officer, ODPC registration
// evidence, the data processing agreement and the compliance warranty. The
// warranty wording is published by the platform and shown verbatim; this
// screen never writes or paraphrases legal text (CLAUDE.md §6).

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

function errorText(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  const fields = err.fields
    ? Object.entries(err.fields)
        .map(([field, msg]) => {
          const text = Array.isArray(msg) ? msg.map(String).join(" ") : String(msg);
          return field === "detail" ? text : `${field.replace(/_/g, " ")}: ${text}`;
        })
        .join("; ")
    : "";
  return fields && fields !== err.message ? `${err.message} — ${fields}` : err.message;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="break-words text-[13px] text-ink-900">{children}</dd>
    </div>
  );
}

const NOT_RECORDED = <span className="text-ink-400">Not recorded</span>;

function StatusCard({ profile }: { profile: ComplianceProfile }) {
  if (profile.gaps.length === 0) {
    return (
      <Callout tone="success" role="status">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Complete — every data-protection item for {profile.organization_name} is in place.
        </div>
      </Callout>
    );
  }
  return (
    <Callout tone="warning" role="status">
      <div className="font-semibold">Still outstanding for {profile.organization_name}:</div>
      <ul className="mt-1 list-disc pl-5">
        {profile.gaps.map((gap) => (
          <li key={gap}>{gap}</li>
        ))}
      </ul>
    </Callout>
  );
}

function DpoCard({
  profile,
  onSaved,
}: {
  profile: ComplianceProfile;
  onSaved: (p: ComplianceProfile) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [form, setForm] = useState({
    dpo_name: profile.dpo_name,
    dpo_email: profile.dpo_email,
    dpo_phone: profile.dpo_phone,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty =
    form.dpo_name !== profile.dpo_name ||
    form.dpo_email !== profile.dpo_email ||
    form.dpo_phone !== profile.dpo_phone;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateComplianceProfile(accessToken, {
        dpo_name: form.dpo_name.trim(),
        dpo_email: form.dpo_email.trim(),
        dpo_phone: form.dpo_phone.trim(),
      });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(errorText(err, "Couldn't save the Data Protection Officer's details."));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = "text") => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <input
        id={`${id}-${key}`}
        type={type}
        className={INPUT}
        // eslint-disable-next-line security/detect-object-injection -- typed key of the DPO form.
        value={form[key]}
        onChange={(e) => {
          const value = e.target.value;
          setForm((f) => ({ ...f, [key]: value }));
          setSaved(false);
        }}
      />
    </Field>
  );

  return (
    <Card title="Data Protection Officer">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-500">
          The person at your facility responsible for data protection, and their contact details.
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
          {field("dpo_name", "Name")}
          {field("dpo_email", "Email", "email")}
          {field("dpo_phone", "Phone", "tel")}
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BTN} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && (
            <span role="status" className="text-xs text-brand-green">
              Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function OdpcCard({
  profile,
  onSaved,
}: {
  profile: ComplianceProfile;
  onSaved: (p: ComplianceProfile) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const verified = Boolean(profile.odpc_verified_at);
  const [number, setNumber] = useState(profile.odpc_registration_number);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const numberChanged = !verified && number.trim() !== profile.odpc_registration_number;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || (!numberChanged && !file)) return;
    if (file && file.size > MAX_EVIDENCE_BYTES) {
      setError("The evidence file is larger than 10 MB.");
      return;
    }
    if (
      file &&
      verified &&
      !window.confirm(
        "Uploading new evidence clears the current verification until platform staff verify it again. Continue?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateComplianceProfile(accessToken, {
        ...(numberChanged ? { odpc_registration_number: number.trim() } : {}),
        ...(file ? { odpc_evidence: file } : {}),
      });
      onSaved(updated);
      setNumber(updated.odpc_registration_number);
      setFile(null);
      setFileKey((k) => k + 1);
      setSaved(true);
    } catch (err) {
      setError(errorText(err, "Couldn't save the ODPC registration."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="ODPC registration"
      aside={
        verified ? <Tag tone="brand">Verified</Tag> : <Tag tone="warn">Awaiting verification</Tag>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-500">
          Your facility&apos;s registration with the Office of the Data Protection Commissioner.
          Upload the registration certificate; platform staff verify it.
        </p>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Registration number" htmlFor={`${id}-number`}>
            <input
              id={`${id}-number`}
              className={INPUT}
              value={number}
              readOnly={verified}
              aria-describedby={verified ? `${id}-locked` : undefined}
              onChange={(e) => {
                setNumber(e.target.value);
                setSaved(false);
              }}
            />
            {verified && (
              <span id={`${id}-locked`} className="text-xs text-ink-500">
                Locked once verified — ask platform staff to correct it.
              </span>
            )}
          </Field>
          <Field label="Registration evidence (PDF or image)" htmlFor={`${id}-evidence`}>
            <input
              key={fileKey}
              id={`${id}-evidence`}
              type="file"
              accept="application/pdf,image/*"
              className="text-[13px] text-ink-900 file:mr-3 file:rounded-md file:border file:border-surface-border file:bg-surface-card file:px-3 file:py-1 file:text-xs file:font-semibold file:text-ink-900"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSaved(false);
              }}
            />
            {profile.odpc_evidence_url ? (
              <AuthenticatedDownloadButton
                path={profile.odpc_evidence_url}
                filename="odpc-evidence"
              >
                Download current evidence
              </AuthenticatedDownloadButton>
            ) : (
              <span className="text-xs text-ink-500">No evidence uploaded yet.</span>
            )}
          </Field>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
          <Item label="Verification">
            {verified ? (
              `Verified by ${profile.odpc_verified_by || "platform staff"} · ${formatDateTime(
                profile.odpc_verified_at,
              )}`
            ) : (
              <span className="text-priority-orange">Awaiting verification by platform staff</span>
            )}
          </Item>
          <Item label="Registration expires">
            {profile.odpc_registration_expires_on
              ? formatDate(profile.odpc_registration_expires_on)
              : NOT_RECORDED}
          </Item>
        </dl>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BTN} disabled={saving || (!numberChanged && !file)}>
            {saving ? "Saving…" : file ? "Upload evidence" : "Save"}
          </button>
          {saved && (
            <span role="status" className="text-xs text-brand-green">
              Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

function DpaCard({ profile }: { profile: ComplianceProfile }) {
  return (
    <Card title="Data processing agreement">
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
          <Item label="Agreement version">{profile.dpa_version || NOT_RECORDED}</Item>
          <Item label="Signed on">
            {profile.dpa_signed_on ? formatDate(profile.dpa_signed_on) : NOT_RECORDED}
          </Item>
        </dl>
        <p className="text-xs text-ink-500">
          Recorded by platform staff once the signed agreement is received — contact platform
          support if these details are wrong.
        </p>
      </div>
    </Card>
  );
}

function WarrantyCard({
  profile,
  onSaved,
}: {
  profile: ComplianceProfile;
  onSaved: (p: ComplianceProfile) => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = Boolean(profile.current_warranty_version);
  const accepted = published && profile.warranty_version === profile.current_warranty_version;

  const accept = async () => {
    if (!accessToken || !checked) return;
    if (
      !window.confirm(
        `Accept version ${profile.current_warranty_version} of the compliance warranty on behalf of ${profile.organization_name}? Your name and the time are recorded.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await acceptComplianceWarranty(accessToken, profile.current_warranty_version));
      setChecked(false);
    } catch (err) {
      setError(errorText(err, "Couldn't record your acceptance."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Compliance warranty"
      aside={
        published ? (
          accepted ? (
            <Tag tone="brand">Accepted</Tag>
          ) : (
            <Tag tone="warn">Not yet accepted</Tag>
          )
        ) : undefined
      }
    >
      {!published ? (
        <p className="text-[13px] text-ink-500">
          The platform has not published a compliance warranty yet. There is nothing to accept until
          it does.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-surface-border bg-surface-bg p-3.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Version {profile.current_warranty_version}
            </div>
            <blockquote className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-900">
              {profile.current_warranty_text}
            </blockquote>
          </div>
          {accepted ? (
            <p className="text-[13px] text-ink-900">
              Accepted by {profile.warranty_accepted_by || "—"} ·{" "}
              {formatDateTime(profile.warranty_accepted_at)}
            </p>
          ) : (
            <>
              {profile.warranty_version && (
                <Callout tone="warning" role="status">
                  Your facility accepted version {profile.warranty_version}
                  {profile.warranty_accepted_at
                    ? ` on ${formatDate(profile.warranty_accepted_at)}`
                    : ""}
                  . The platform has since published version {profile.current_warranty_version},
                  which needs your acceptance.
                </Callout>
              )}
              <label
                htmlFor={`${id}-accept`}
                className="flex cursor-pointer items-start gap-2 text-[13px] text-ink-900"
              >
                <input
                  id={`${id}-accept`}
                  type="checkbox"
                  className="mt-0.5 h-[17px] w-[17px] flex-shrink-0 accent-[var(--green)]"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I accept this warranty on behalf of {profile.organization_name}
              </label>
              <ErrorNote>{error}</ErrorNote>
              <div>
                <button
                  type="button"
                  className={BTN}
                  disabled={!checked || saving}
                  onClick={() => void accept()}
                >
                  {saving ? "Recording…" : "Accept"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function DataProtectionPage() {
  const [saved, setSaved] = useState<ComplianceProfile | null>(null);
  const { data, error } = useRecordData(
    "compliance-profile",
    0,
    (token) => getComplianceProfile(token),
    "Couldn't load your facility's data-protection profile.",
  );
  // Every save returns the full updated profile, which then replaces the loaded copy.
  const profile = saved ?? data;
  const onSaved = setSaved;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <PageHeader
        eyebrow="Organization · Data protection"
        title="Data Protection"
        subtitle="Your facility's Data Protection Officer, ODPC registration, data processing agreement and compliance warranty."
      />
      <ErrorNote>{error}</ErrorNote>
      {!profile ? (
        !error && <p className="text-[13px] text-ink-500">Loading…</p>
      ) : (
        <>
          <StatusCard profile={profile} />
          <DpoCard profile={profile} onSaved={onSaved} />
          <OdpcCard profile={profile} onSaved={onSaved} />
          <DpaCard profile={profile} />
          <WarrantyCard profile={profile} onSaved={onSaved} />
        </>
      )}
    </div>
  );
}
