import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  getPlatformEmailSettings,
  updatePlatformEmailSettings,
  type PlatformEmailSettings,
} from "../../lib/organizationsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-green-dark active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 transition-all duration-150";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";

function StatusPill({
  ok,
  okLabel,
  pendingLabel,
}: {
  ok: boolean;
  okLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
        ok ? "bg-brand-green-tint text-brand-green-dark" : "bg-status-amber-tint text-status-amber"
      }`}
    >
      {ok ? okLabel : pendingLabel}
    </span>
  );
}

interface FormState {
  host: string;
  port: string;
  host_user: string;
  host_password: string;
  use_tls: boolean;
  use_ssl: boolean;
  default_from_email: string;
}

function formFromSettings(settings: PlatformEmailSettings): FormState {
  return {
    host: settings.host,
    port: settings.port === null ? "" : String(settings.port),
    host_user: settings.host_user,
    host_password: "",
    use_tls: settings.use_tls,
    use_ssl: settings.use_ssl,
    default_from_email: settings.default_from_email,
  };
}

/**
 * Platform-wide SMTP fallback (Super Admin Settings screen) — used for
 * platform staff email and as the default for any tenant that hasn't
 * configured its own SMTP (Org Admin's own Branch Settings > Email
 * Configuration card). Same encrypted-at-rest write-only-password pattern
 * as Branch's SHA credentials.
 */
export function PlatformEmailSettingsPage() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PlatformEmailSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    getPlatformEmailSettings(accessToken)
      .then((s) => {
        setSettings(s);
        setForm(formFromSettings(s));
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load email settings."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !form) return;
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updatePlatformEmailSettings(accessToken, {
        host: form.host,
        port: form.port === "" ? null : Number(form.port),
        host_user: form.host_user,
        ...(form.host_password ? { host_password: form.host_password } : {}),
        use_tls: form.use_tls,
        use_ssl: form.use_ssl,
        default_from_email: form.default_from_email,
      });
      setSettings(updated);
      setForm(formFromSettings(updated));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save email settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Email Settings</h1>
        <p className="mt-1 text-sm text-ink-500">
          The platform-wide SMTP fallback used for CITRAMAC staff email, and for any tenant that
          hasn&rsquo;t configured its own SMTP under its Branch Settings.
        </p>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}

      {settings && form && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className={`${CARD_CLASS} lg:w-2/3`}>
            <h2 className={SECTION_TITLE_CLASS}>
              <span className="inline-flex items-center gap-2">
                <Mail size={16} className="text-brand-green" />
                SMTP Configuration
              </span>
            </h2>
            <div className="mb-3">
              <StatusPill
                ok={settings.has_credentials}
                okLabel="SMTP configured"
                pendingLabel="Not configured — emails fall back to the console/dev backend"
              />
            </div>
            <form onSubmit={save} className="flex flex-col gap-3">
              <label className={LABEL_CLASS}>
                SMTP Host
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={form.host}
                  onChange={(e) => {
                    setForm({ ...form, host: e.target.value });
                    setSaved(false);
                  }}
                  placeholder="mail.softlinkoptions.co.ke"
                />
              </label>
              <div className="flex gap-3">
                <label className={`${LABEL_CLASS} flex-1`}>
                  Port
                  <input
                    type="number"
                    className={FIELD_CLASS}
                    value={form.port}
                    onChange={(e) => {
                      setForm({ ...form, port: e.target.value });
                      setSaved(false);
                    }}
                    placeholder="587"
                  />
                </label>
                <label className={`${LABEL_CLASS} flex-[2]`}>
                  SMTP Username
                  <input
                    type="text"
                    className={FIELD_CLASS}
                    value={form.host_user}
                    onChange={(e) => {
                      setForm({ ...form, host_user: e.target.value });
                      setSaved(false);
                    }}
                    placeholder="notifications@softlinkoptions.co.ke"
                  />
                </label>
              </div>
              <label className={LABEL_CLASS}>
                SMTP Password
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={form.host_password}
                  onChange={(e) => {
                    setForm({ ...form, host_password: e.target.value });
                    setSaved(false);
                  }}
                  placeholder={
                    settings.has_credentials
                      ? "Leave blank to keep the current password"
                      : "SMTP account password"
                  }
                  autoComplete="new-password"
                />
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-green"
                    checked={form.use_tls}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        use_tls: e.target.checked,
                        use_ssl: e.target.checked ? false : form.use_ssl,
                      });
                      setSaved(false);
                    }}
                  />
                  Use TLS (port 587)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-green"
                    checked={form.use_ssl}
                    onChange={(e) => {
                      setForm({
                        ...form,
                        use_ssl: e.target.checked,
                        use_tls: e.target.checked ? false : form.use_tls,
                      });
                      setSaved(false);
                    }}
                  />
                  Use SSL (port 465)
                </label>
              </div>
              <label className={LABEL_CLASS}>
                Default From Address
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={form.default_from_email}
                  onChange={(e) => {
                    setForm({ ...form, default_from_email: e.target.value });
                    setSaved(false);
                  }}
                  placeholder="CITRAMAC <notifications@softlinkoptions.co.ke>"
                />
              </label>
              <button type="submit" disabled={saving} className={BUTTON_CLASS}>
                {saving ? "Saving…" : "Save Email Settings"}
              </button>
              {saved && (
                <span className="text-sm font-medium text-brand-green">Settings saved</span>
              )}
              {saveError && (
                <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                  {saveError}
                </p>
              )}
            </form>
          </div>

          <div className="flex flex-col gap-6 lg:w-1/3">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>How This Is Used</h2>
              <div className="flex flex-col gap-3 text-sm text-ink-700">
                <p>
                  This is the platform-wide fallback SMTP — used for CITRAMAC staff email, and for
                  any tenant that hasn&rsquo;t set up its own.
                </p>
                <p>
                  Each organization can override this with its own SMTP under its own{" "}
                  <span className="font-medium text-ink-900">
                    Branch Settings &rarr; Email Configuration
                  </span>{" "}
                  screen.
                </p>
                <p className="text-ink-500">
                  Leaving this unconfigured is safe — emails simply fall back to the console/dev
                  backend (visible in the celery-worker logs) instead of being delivered.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
