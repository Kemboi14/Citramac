import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { Drawer } from "../../components/Drawer";
import { SaveButton } from "../../components/SaveButton";
import { AutoResizeTextarea } from "../care/shared/AutoResizeTextarea";
import { Callout, StatusPill } from "../care/shared/ui";
import {
  downloadStaffDocument,
  getStaffCredential,
  openBlob,
  returnStaffCredential,
  STATUS_LABEL,
  STATUS_TONE,
  verifyStaffCredential,
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

  const view = async (kind: DocumentKind) => {
    if (!accessToken || !userId) return;
    try {
      openBlob(await downloadStaffDocument(accessToken, userId, kind));
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
                className="w-full rounded-[9px] border border-surface-border bg-surface-bg px-3 py-2.5 text-[13px] text-ink-900 outline-none focus:border-brand-green"
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
              <div className={ROW}>
                <span className={KEY}>Qualifications</span>
                <span className={VAL}>{f.qualifications || "—"}</span>
              </div>

              <div className={SUBHEAD}>Practising licence</div>
              <div className={ROW}>
                <span className={KEY}>Licence number</span>
                <span className={VAL}>{f.licence_number || "—"}</span>
              </div>
              <div className={ROW}>
                <span className={KEY}>Valid</span>
                <span className={VAL}>
                  {day(f.licence_issued_on)} – {day(f.licence_expires_on)}
                </span>
              </div>

              {(f.nacada_number || f.indemnity_number) && <div className={SUBHEAD}>Other</div>}
              {f.nacada_number && (
                <div className={ROW}>
                  <span className={KEY}>NACADA accreditation</span>
                  <span className={VAL}>
                    {f.nacada_number}
                    {f.nacada_category ? ` · ${f.nacada_category}` : ""} · until{" "}
                    {day(f.nacada_expires_on)}
                  </span>
                </div>
              )}
              {f.indemnity_number && (
                <div className={ROW}>
                  <span className={KEY}>Indemnity cover</span>
                  <span className={VAL}>
                    {f.indemnity_number} · until {day(f.indemnity_expires_on)}
                  </span>
                </div>
              )}

              <div className={SUBHEAD}>Documents</div>
              {(Object.keys(profile.documents) as DocumentKind[]).map((kind) => {
                // eslint-disable-next-line security/detect-object-injection -- `kind` comes from the object's own keys.
                const doc = profile.documents[kind];
                return (
                  <div key={kind} className={ROW}>
                    <span className={KEY}>{doc.label}</span>
                    {doc.uploaded ? (
                      <button
                        type="button"
                        className="font-semibold text-brand-green-dark hover:underline"
                        onClick={() => void view(kind)}
                      >
                        View
                      </button>
                    ) : (
                      <span className="text-ink-400">Not uploaded</span>
                    )}
                  </div>
                );
              })}
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
