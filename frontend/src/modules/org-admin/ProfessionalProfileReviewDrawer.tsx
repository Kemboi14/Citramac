import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";
import { AutoResizeTextarea } from "../care/shared/AutoResizeTextarea";
import { Callout, StatusPill } from "../care/shared/ui";
import {
  downloadStaffFile,
  getStaffCredential,
  openBlob,
  returnStaffCredential,
  STATUS_LABEL,
  STATUS_TONE,
  verifyStaffCredential,
  type CredentialFile,
  type CredentialItem,
  type DocumentKind,
  type ProfessionalProfile,
} from "../../lib/professionalProfileApi";

const ROW = "flex justify-between gap-3 border-b border-surface-border py-2 text-[13px]";
const KEY = "text-ink-500";
const VAL = "text-right font-medium text-ink-900";
const SUBHEAD = "mt-5 mb-2 text-[11.5px] font-bold uppercase tracking-wide text-ink-500";

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

/**
 * The reviewer's view of a staff member's professional profile: what they
 * entered, their documents, the history, and Verify / Return for a submitted
 * profile. Org Admins and holders of staff.credentials.verify; nobody
 * reviews their own. Mental Health Act approval and the national registry
 * check stay in the separate Credential drawer.
 */
export function ProfessionalProfileReviewDrawer({
  userId,
  staffName,
  onClose,
  onChanged,
}: {
  userId: string | null;
  staffName?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!accessToken || !userId) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      setProfile(null);
      setError(null);
      setReturning(false);
      setReason("");
      return getStaffCredential(accessToken, userId)
        .then((data) => !cancelled && setProfile(data))
        .catch((err) => !cancelled && setError(message(err, "Couldn't load the profile.")));
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, userId]);

  const view = async (fileId: string) => {
    if (!accessToken || !userId) return;
    try {
      openBlob(await downloadStaffFile(accessToken, userId, fileId));
    } catch (err) {
      setError(message(err, "Couldn't open the document."));
    }
  };

  const verify = async () => {
    if (!accessToken || !userId) return;
    setError(null);
    try {
      setProfile(await verifyStaffCredential(accessToken, userId));
      onChanged();
    } catch (err) {
      setError(message(err, "Couldn't verify the profile."));
      throw err;
    }
  };

  const sendBack = async () => {
    if (!accessToken || !userId) return;
    setError(null);
    try {
      setProfile(await returnStaffCredential(accessToken, userId, reason.trim()));
      setReturning(false);
      setReason("");
      onChanged();
    } catch (err) {
      setError(message(err, "Couldn't return the profile."));
      throw err;
    }
  };

  // Every file in a slot (there may be many), each opened on its own.
  const docLinks = (files: CredentialFile[]) =>
    files.length ? (
      <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            className="max-w-[16rem] truncate font-semibold text-brand-green-dark hover:underline"
            title={file.name}
            onClick={() => void view(file.id)}
          >
            {file.name}
          </button>
        ))}
      </span>
    ) : (
      <span className="font-semibold text-status-red">Not uploaded</span>
    );

  const docRow = (kind: DocumentKind) => {
    // eslint-disable-next-line security/detect-object-injection -- `kind` is a fixed union.
    const doc = profile?.documents[kind];
    if (!doc) return null;
    return (
      <div className={ROW}>
        <span className={KEY}>{doc.label}</span>
        {docLinks(doc.files)}
      </div>
    );
  };

  const itemRow = (item: CredentialItem) => {
    const licence = item.kind === "LICENCE" || item.kind === "REGISTRATION";
    const kindName = profile?.item_kinds.find((k) => k.value === item.kind)?.label ?? item.kind;
    return (
      <div key={item.id} className="border-b border-surface-border py-2 text-[13px]">
        <div className="flex justify-between gap-3">
          <span className="font-medium text-ink-900">
            {licence ? item.issuer || kindName : item.title || kindName}
          </span>
          {docLinks(item.files)}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-500">
          <span>{kindName}</span>
          {licence ? (
            <span>
              · {item.number || "no number"} · {day(item.issued_on)} – {day(item.expires_on)}
            </span>
          ) : (
            <span>
              {item.issuer ? `· ${item.issuer}` : ""}
              {item.issued_on ? ` · ${day(item.issued_on)}` : ""}
              {item.number ? ` · No. ${item.number}` : ""}
            </span>
          )}
          {item.kind === "LICENCE" && item.in_force === false && (
            <StatusPill>Superseded</StatusPill>
          )}
          {item.kind === "LICENCE" && item.in_force && item.licence_status === "EXPIRED" && (
            <StatusPill tone="danger">Expired</StatusPill>
          )}
          {item.verified_at && (
            <StatusPill tone="success">Verified {day(item.verified_at)}</StatusPill>
          )}
        </div>
      </div>
    );
  };

  const registrations = profile?.items.filter((i) => i.kind === "REGISTRATION") ?? [];
  const licences = profile?.items.filter((i) => i.kind === "LICENCE") ?? [];
  const qualifications =
    profile?.items.filter((i) => i.kind !== "LICENCE" && i.kind !== "REGISTRATION") ?? [];

  const reviewable = Boolean(profile?.can_review && profile.status === "SUBMITTED");
  const f = profile?.fields;
  const regulator =
    profile && f
      ? f.regulator === "OTHER"
        ? f.registration_body
        : (profile.regulator_choices.find((c) => c.value === f.regulator)?.label ?? "—")
      : "—";

  return (
    <Drawer
      open={userId !== null}
      title="Professional profile"
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
          {reviewable && !returning && (
            <>
              <button
                type="button"
                className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-status-red hover:bg-surface-bg"
                onClick={() => setReturning(true)}
              >
                Return…
              </button>
              <SaveButton
                onSave={verify}
                className="flex-1"
                savingLabel="Verifying…"
                savedLabel="Verified"
              >
                Verify
              </SaveButton>
            </>
          )}
          {reviewable && returning && (
            <SaveButton
              onSave={sendBack}
              className="flex-1"
              disabled={reason.trim().length < 5}
              savingLabel="Returning…"
              savedLabel="Returned"
            >
              Return for changes
            </SaveButton>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-3 text-[12.5px] text-status-red">
          {error}
        </p>
      )}
      {!profile && !error && <p className="text-sm text-ink-500">Loading…</p>}
      {profile && f && (
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            {profile.status ? (
              <StatusPill tone={STATUS_TONE[profile.status]}>
                {STATUS_LABEL[profile.status]}
              </StatusPill>
            ) : (
              <StatusPill>No registration needed</StatusPill>
            )}
            {profile.licence_status === "EXPIRED" && (
              <StatusPill tone="danger">Licence expired</StatusPill>
            )}
            {profile.licence_status === "EXPIRING" && (
              <StatusPill tone="warning">Licence expiring</StatusPill>
            )}
          </div>

          {profile.can_review === false && (
            <Callout tone="info" className="mt-3" label={null}>
              This is your own profile. Another Org Admin or verifier must verify it.
            </Callout>
          )}
          {profile.missing_items.length > 0 && (
            <Callout tone="warning" className="mt-3" label="Incomplete">
              Still missing: {profile.missing_items.map((i) => i.label).join("; ")}.
            </Callout>
          )}
          {profile.status === "RETURNED" && profile.returned_reason && (
            <Callout tone="warning" className="mt-3" label="Returned">
              {profile.returned_reason}
            </Callout>
          )}

          {returning && (
            <div className="mt-4">
              <label
                className="mb-1.5 block text-[11.5px] font-semibold text-ink-700"
                htmlFor="return-reason"
              >
                What needs changing? (sent to {profile.name})
              </label>
              <AutoResizeTextarea
                id="return-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className="mt-2 text-[12.5px] font-semibold text-ink-700 hover:underline"
                onClick={() => setReturning(false)}
              >
                Cancel
              </button>
            </div>
          )}

          {profile.credentials_required && (
            <>
              <div className={SUBHEAD}>Registration</div>
              <div className={ROW}>
                <span className={KEY}>Regulatory body</span>
                <span className={VAL}>{regulator}</span>
              </div>
              <div className={ROW}>
                <span className={KEY}>Registration number</span>
                <span className={VAL}>{f.registration_number || "—"}</span>
              </div>
              {docRow("registration")}
              {registrations.length > 0 && (
                <>
                  <div className={SUBHEAD}>Registrations with other regulators</div>
                  {registrations.map(itemRow)}
                </>
              )}

              <div className={SUBHEAD}>Practising licences</div>
              {licences.length === 0 && <p className="text-[13px] text-ink-400">None recorded.</p>}
              {licences.map(itemRow)}

              <div className={SUBHEAD}>Degrees, diplomas and certificates</div>
              {qualifications.length === 0 && (
                <p className="text-[13px] text-ink-400">None recorded.</p>
              )}
              {qualifications.map(itemRow)}

              {(f.nacada_number || f.indemnity_number) && <div className={SUBHEAD}>Other</div>}
              {f.nacada_number && (
                <>
                  <div className={ROW}>
                    <span className={KEY}>NACADA accreditation</span>
                    <span className={VAL}>
                      {f.nacada_number}
                      {f.nacada_category ? ` · ${f.nacada_category}` : ""} · until{" "}
                      {day(f.nacada_expires_on)}
                    </span>
                  </div>
                  {docRow("nacada")}
                </>
              )}
              {f.indemnity_number && (
                <>
                  <div className={ROW}>
                    <span className={KEY}>Indemnity cover</span>
                    <span className={VAL}>
                      {f.indemnity_number} · until {day(f.indemnity_expires_on)}
                    </span>
                  </div>
                  {docRow("indemnity")}
                </>
              )}
              <p className="mt-2 text-[11.5px] text-ink-500">
                Opening a document is recorded in the audit log.
              </p>
            </>
          )}

          {profile.reviews.length > 0 && (
            <>
              <div className={SUBHEAD}>History</div>
              <ul className="text-[12.5px] text-ink-700">
                {profile.reviews.map((r, i) => (
                  <li key={`${r.at}-${i}`} className="py-1">
                    {day(r.at)} ·{" "}
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
      )}
    </Drawer>
  );
}
