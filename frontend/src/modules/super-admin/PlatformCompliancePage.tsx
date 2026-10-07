import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SaveButton } from "../../components/SaveButton";
import {
  getPlatformComplianceSettings,
  updatePlatformComplianceSettings,
  type PlatformComplianceSettings,
} from "../../lib/complianceApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_PRIMARY =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

// Matches PlatformComplianceSettings.warranty_version (max_length=32).
const VERSION_MAX_LENGTH = 32;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function PlatformCompliancePage() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PlatformComplianceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dpoName, setDpoName] = useState("");
  const [dpoEmail, setDpoEmail] = useState("");
  const [dpoPhone, setDpoPhone] = useState("");
  const [dpoError, setDpoError] = useState<string | null>(null);

  const [version, setVersion] = useState("");
  const [wording, setWording] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);

  const apply = (s: PlatformComplianceSettings) => {
    setSettings(s);
    setDpoName(s.dpo_name);
    setDpoEmail(s.dpo_email);
    setDpoPhone(s.dpo_phone);
  };

  useEffect(() => {
    if (!accessToken) return;
    getPlatformComplianceSettings(accessToken)
      .then(apply)
      .catch((err) =>
        setLoadError(errorMessage(err, "Couldn't load platform compliance settings.")),
      );
  }, [accessToken]);

  const saveDpo = async () => {
    if (!accessToken) return;
    setDpoError(null);
    try {
      const updated = await updatePlatformComplianceSettings(accessToken, {
        dpo_name: dpoName.trim(),
        dpo_email: dpoEmail.trim(),
        dpo_phone: dpoPhone.trim(),
      });
      apply(updated);
    } catch (err) {
      setDpoError(errorMessage(err, "Couldn't save the DPO contact."));
      throw err;
    }
  };

  const startPublish = () => {
    setPublishError(null);
    setPublished(null);
    const label = version.trim();
    if (!label || !wording.trim()) {
      setPublishError("Give both a version label and the full wording.");
      return;
    }
    if (settings && label === settings.warranty_version) {
      setPublishError(
        `"${label}" is the version already published. A new or changed wording needs a new version label.`,
      );
      return;
    }
    setConfirming(true);
  };

  const publish = () => {
    if (!accessToken) return;
    setPublishing(true);
    setPublishError(null);
    updatePlatformComplianceSettings(accessToken, {
      warranty_version: version.trim(),
      warranty_text: wording.trim(),
    })
      .then((updated) => {
        apply(updated);
        setPublished(updated.warranty_version);
        setVersion("");
        setWording("");
        setConfirming(false);
      })
      .catch((err) => setPublishError(errorMessage(err, "Couldn't publish the warranty.")))
      .finally(() => setPublishing(false));
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Governance · Data protection
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Platform Compliance</h1>
      </div>

      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}
      {!settings && !loadError && <p className="text-sm text-ink-500">Loading settings…</p>}

      {settings && (
        <>
          <form onSubmit={(e) => e.preventDefault()} className={CARD_CLASS}>
            <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
              Platform Data Protection Officer
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Shown publicly on the login page. Leave a field empty to hide it.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className={LABEL_CLASS}>
                Name
                <input
                  className={FIELD_CLASS}
                  value={dpoName}
                  onChange={(e) => setDpoName(e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Email
                <input
                  type="email"
                  className={FIELD_CLASS}
                  value={dpoEmail}
                  onChange={(e) => setDpoEmail(e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Phone
                <input
                  type="tel"
                  className={FIELD_CLASS}
                  value={dpoPhone}
                  onChange={(e) => setDpoPhone(e.target.value)}
                />
              </label>
            </div>
            {dpoError && (
              <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {dpoError}
              </p>
            )}
            <div className="mt-5">
              <SaveButton onSave={saveDpo}>Save DPO contact</SaveButton>
            </div>
          </form>

          <div className={CARD_CLASS}>
            <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
              Tenant compliance warranty
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Every facility must accept the current version. Publishing a new version means every
              facility has to accept it again before its compliance status is complete.
            </p>
            {settings.warranty_version ? (
              <>
                <div className="mb-2 text-sm text-ink-700">
                  Current version:{" "}
                  <span className="font-mono font-semibold text-ink-900">
                    {settings.warranty_version}
                  </span>
                  {settings.updated_at && (
                    <span className="text-ink-500">
                      {" "}
                      · settings last updated{" "}
                      {new Date(settings.updated_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                </div>
                <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-md border border-surface-border bg-surface-bg px-4 py-3 text-sm text-ink-900">
                  {settings.warranty_text}
                </div>
              </>
            ) : (
              <p className="rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-status-amber">
                No warranty has been published. Every facility shows this as a compliance gap until
                one is.
              </p>
            )}
            {published && (
              <p className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark">
                Version {published} published. Facilities must now accept it.
              </p>
            )}
          </div>

          <form onSubmit={(e) => e.preventDefault()} className={CARD_CLASS}>
            <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
              Publish new version
            </h2>
            <p className="mb-4 text-sm text-ink-500">
              Enter the approved wording exactly as it should be shown to facilities. Changed
              wording always needs a new version label.
            </p>
            <div className="flex flex-col gap-4">
              <label className={`${LABEL_CLASS} max-w-xs`}>
                Version label
                <input
                  className={FIELD_CLASS}
                  value={version}
                  maxLength={VERSION_MAX_LENGTH}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </label>
              <label className={LABEL_CLASS}>
                Wording
                <textarea
                  className={`${FIELD_CLASS} min-h-[220px] font-normal`}
                  value={wording}
                  onChange={(e) => setWording(e.target.value)}
                />
              </label>
            </div>
            {publishError && !confirming && (
              <p className="mt-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {publishError}
              </p>
            )}
            <div className="mt-5">
              <button type="button" className={BUTTON_PRIMARY} onClick={startPublish}>
                Publish new version…
              </button>
            </div>
          </form>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="Publish a new warranty version?"
        confirmLabel={`Publish ${version.trim()}`}
        busyLabel="Publishing…"
        busy={publishing}
        error={confirming ? publishError : null}
        onConfirm={publish}
        onCancel={() => {
          setConfirming(false);
          setPublishError(null);
        }}
      >
        <p>
          Version <span className="font-mono font-semibold">{version.trim()}</span> replaces{" "}
          {settings?.warranty_version ? (
            <span className="font-mono font-semibold">{settings.warranty_version}</span>
          ) : (
            "the unpublished warranty"
          )}
          . Every facility&rsquo;s acceptance of the previous version stops counting: each
          facility&rsquo;s Org Admin must accept the new version, and until they do their compliance
          status shows a gap.
        </p>
      </ConfirmDialog>
    </div>
  );
}
