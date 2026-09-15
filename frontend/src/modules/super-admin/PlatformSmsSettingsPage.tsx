import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  getPlatformSmsSettings,
  testPlatformSmsSettings,
  updatePlatformSmsSettings,
  type PlatformSmsSettings,
} from "../../lib/organizationsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
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
  sender_id: string;
  client_id: string;
  access_key: string;
  api_key: string;
}

function formFromSettings(settings: PlatformSmsSettings): FormState {
  return {
    sender_id: settings.sender_id,
    client_id: settings.client_id,
    access_key: "",
    api_key: "",
  };
}

/**
 * Platform-wide Onfon Media SMS gateway fallback (Super Admin Settings
 * screen) — used as the default for any tenant that hasn't configured its
 * own gateway (Org Admin's own Branch Settings > SMS Configuration card).
 * Same encrypted-at-rest write-only-credential pattern as
 * PlatformEmailSettingsPage.
 */
export function PlatformSmsSettingsPage() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PlatformSmsSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    getPlatformSmsSettings(accessToken)
      .then((s) => {
        setSettings(s);
        setForm(formFromSettings(s));
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load SMS settings."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const save = async () => {
    if (!accessToken || !form) return;
    setSaveError(null);
    try {
      const updated = await updatePlatformSmsSettings(accessToken, {
        sender_id: form.sender_id,
        client_id: form.client_id,
        ...(form.access_key ? { access_key: form.access_key } : {}),
        ...(form.api_key ? { api_key: form.api_key } : {}),
      });
      setSettings(updated);
      setForm(formFromSettings(updated));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save SMS settings.");
      throw err;
    }
  };

  const runTest = async () => {
    if (!accessToken || !form) return;
    setTestResult(null);
    try {
      const result = await testPlatformSmsSettings(accessToken, {
        phone: testPhone,
        sender_id: form.sender_id,
        client_id: form.client_id,
        ...(form.access_key ? { access_key: form.access_key } : {}),
        ...(form.api_key ? { api_key: form.api_key } : {}),
      });
      setTestResult(result);
      if (!result.success) throw new Error(result.message);
    } catch (err) {
      if (err instanceof ApiError) {
        setTestResult({ success: false, message: err.message });
      }
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">SMS Settings</h1>
        <p className="mt-1 text-sm text-ink-500">
          The platform-wide Onfon Media gateway fallback used for any tenant that hasn&rsquo;t
          configured its own under its Branch Settings.
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
                <MessageSquare size={16} className="text-brand-green" />
                Onfon Media Configuration
              </span>
            </h2>
            <div className="mb-3">
              <StatusPill
                ok={settings.has_credentials}
                okLabel="SMS gateway configured"
                pendingLabel="Not configured — OTP/reminders fall back to a log-only stub"
              />
            </div>
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
              <label className={LABEL_CLASS}>
                Sender ID
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={form.sender_id}
                  onChange={(e) => {
                    setForm({ ...form, sender_id: e.target.value });
                  }}
                  placeholder="CITRAMAC"
                />
              </label>
              <label className={LABEL_CLASS}>
                Client ID
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={form.client_id}
                  onChange={(e) => {
                    setForm({ ...form, client_id: e.target.value });
                  }}
                  placeholder="Onfon Client ID"
                />
              </label>
              <label className={LABEL_CLASS}>
                Access Key
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={form.access_key}
                  onChange={(e) => {
                    setForm({ ...form, access_key: e.target.value });
                  }}
                  placeholder={
                    settings.has_credentials
                      ? "Leave blank to keep the current Access Key"
                      : "Onfon Access Key"
                  }
                  autoComplete="new-password"
                />
              </label>
              <label className={LABEL_CLASS}>
                API Key
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={form.api_key}
                  onChange={(e) => {
                    setForm({ ...form, api_key: e.target.value });
                  }}
                  placeholder={
                    settings.has_credentials
                      ? "Leave blank to keep the current API Key"
                      : "Onfon API Key"
                  }
                  autoComplete="new-password"
                />
              </label>
              <div>
                <SaveButton onSave={save}>Save SMS Settings</SaveButton>
              </div>
              {saveError && (
                <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                  {saveError}
                </p>
              )}

              <div className="mt-2 border-t border-surface-border pt-4">
                <p className="mb-2 text-xs text-ink-500">
                  Send a real test SMS to confirm Onfon is reachable with the values above — the
                  number registered with Onfon works well for this.
                </p>
                <label className={LABEL_CLASS}>
                  Test Phone Number
                  <input
                    type="text"
                    className={FIELD_CLASS}
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="07XXXXXXXX"
                  />
                </label>
                <div className="mt-3">
                  <SaveButton
                    onSave={runTest}
                    variant="ghost"
                    disabled={!testPhone.trim()}
                    savingLabel="Sending…"
                    savedLabel="Sent"
                  >
                    Send Test SMS
                  </SaveButton>
                </div>
                {testResult && (
                  <p
                    className={`mt-2 rounded-sm px-3 py-2 text-sm ${
                      testResult.success
                        ? "bg-brand-green-tint text-brand-green-dark"
                        : "bg-status-red-tint text-status-red"
                    }`}
                  >
                    {testResult.message}
                  </p>
                )}
              </div>
            </form>
          </div>

          <div className="flex flex-col gap-6 lg:w-1/3">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>How This Is Used</h2>
              <div className="flex flex-col gap-3 text-sm text-ink-700">
                <p>
                  This is the platform-wide fallback SMS gateway — used for any tenant that
                  hasn&rsquo;t set up its own.
                </p>
                <p>
                  Each organization can override this with its own Onfon Media credentials under its
                  own{" "}
                  <span className="font-medium text-ink-900">
                    Branch Settings &rarr; SMS Configuration
                  </span>{" "}
                  screen.
                </p>
                <p>
                  Used for login OTP codes (when a staff member&rsquo;s preferred channel is SMS)
                  and appointment reminders (when a patient has a phone number on file).
                </p>
                <p className="text-ink-500">
                  Leaving this unconfigured is safe — SMS sends simply log a stub event instead of
                  being delivered, and OTP/reminders still work via email.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
