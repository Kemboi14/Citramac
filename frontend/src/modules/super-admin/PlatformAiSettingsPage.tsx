import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  getPlatformAiSettings,
  testPlatformAiSettings,
  updatePlatformAiSettings,
  type PlatformAiSettings,
} from "../../lib/organizationsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";

const SOURCE_LABEL: Record<PlatformAiSettings["key_source"], string> = {
  saved: "API key saved here",
  environment: "Using the server's environment key",
  "": "No API key — AI note assistance is unavailable",
};

/**
 * Super Admin's Anthropic API key for psychotherapy note assistance — the
 * same encrypted-at-rest, write-only pattern as PlatformSmsSettingsPage. The
 * key alone turns nothing on: each organisation still needs Super Admin to
 * allow it, its Org Admin to turn it on, and each client's consent.
 */
export function PlatformAiSettingsPage() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PlatformAiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const apply = (s: PlatformAiSettings) => {
    setSettings(s);
    setModel(s.model);
    setApiKey("");
  };

  useEffect(() => {
    if (!accessToken) return;
    getPlatformAiSettings(accessToken)
      .then(apply)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load AI settings."),
      )
      .finally(() => setLoading(false));
  }, [accessToken]);

  const save = async () => {
    if (!accessToken) return;
    setSaveError(null);
    try {
      apply(
        await updatePlatformAiSettings(accessToken, {
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      );
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save AI settings.");
      throw err;
    }
  };

  const removeKey = async () => {
    if (!accessToken) return;
    if (
      !window.confirm(
        "Remove the saved API key? AI note assistance stops unless the server has its own key.",
      )
    )
      throw new Error("cancelled");
    setSaveError(null);
    try {
      apply(await updatePlatformAiSettings(accessToken, { remove_api_key: true }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't remove the key.");
      throw err;
    }
  };

  const runTest = async () => {
    if (!accessToken) return;
    setTestResult(null);
    try {
      const result = await testPlatformAiSettings(accessToken, {
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setTestResult(result);
      if (!result.success) throw new Error(result.message);
    } catch (err) {
      if (err instanceof ApiError) setTestResult({ success: false, message: err.message });
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">AI Settings</h1>
        <p className="mt-1 text-sm text-ink-500">
          The Anthropic API key used for psychotherapy note assistance (translation and
          trauma-informed rewording).
        </p>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {loadError}
        </p>
      )}

      {settings && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className={`${CARD_CLASS} lg:w-2/3`}>
            <h2 className={SECTION_TITLE_CLASS}>
              <span className="inline-flex items-center gap-2">
                <Sparkles size={16} className="text-brand-green" />
                Anthropic Configuration
              </span>
            </h2>
            <div className="mb-3 flex flex-wrap gap-2">
              <span
                className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                  settings.key_source
                    ? "bg-brand-green-tint text-brand-green-dark"
                    : "bg-status-amber-tint text-status-amber"
                }`}
              >
                {SOURCE_LABEL[settings.key_source]}
              </span>
              {!settings.server_switch_on && (
                <span className="rounded-sm bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
                  Turned off on the server (PSYCHOTHERAPY_AI_ENABLED)
                </span>
              )}
            </div>
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
              <label className={LABEL_CLASS}>
                API Key
                <input
                  type="password"
                  className={FIELD_CLASS}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    settings.has_credentials
                      ? "Leave blank to keep the current API key"
                      : "Anthropic API key"
                  }
                  autoComplete="new-password"
                />
              </label>
              <label className={LABEL_CLASS}>
                Model
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={`Leave blank for the default (${settings.default_model})`}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <SaveButton onSave={save}>Save AI Settings</SaveButton>
                {settings.has_credentials && (
                  <SaveButton
                    onSave={removeKey}
                    variant="ghost"
                    savingLabel="Removing…"
                    savedLabel="Removed"
                  >
                    Remove saved key
                  </SaveButton>
                )}
              </div>
              {saveError && (
                <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                  {saveError}
                </p>
              )}
              {settings.updated_by_name && (
                <p className="text-xs text-ink-500">
                  Last changed by {settings.updated_by_name} ·{" "}
                  {new Date(settings.updated_at).toLocaleString()}
                </p>
              )}

              <div className="mt-2 border-t border-surface-border pt-4">
                <p className="mb-2 text-xs text-ink-500">
                  Sends one short test message — no client information — to confirm the key and
                  model above work. Uses the key typed above, or the saved one if blank.
                </p>
                <SaveButton
                  onSave={runTest}
                  variant="ghost"
                  disabled={!apiKey.trim() && !settings.key_source}
                  savingLabel="Testing…"
                  savedLabel="Connected"
                >
                  Test Connection
                </SaveButton>
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
                  The key is stored encrypted and is never shown again. A key saved here takes
                  precedence over one set in the server environment.
                </p>
                <p>
                  The key alone turns nothing on. For each organisation, you allow AI on the{" "}
                  <span className="font-medium text-ink-900">Organizations</span> page, its Org
                  Admin turns it on under{" "}
                  <span className="font-medium text-ink-900">Data Protection</span>, and AI is used
                  only for clients who agreed to it.
                </p>
                <p className="text-ink-500">
                  Allow AI for an organisation only once the data-processing agreement with
                  Anthropic covers this use.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
