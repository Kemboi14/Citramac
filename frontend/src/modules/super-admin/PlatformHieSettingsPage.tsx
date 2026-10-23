import { useEffect, useState } from "react";
import { Copy, History, Link2, PlugZap } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { SaveButton } from "../../components/SaveButton";
import {
  getHieTransactionLog,
  getPlatformHieSettings,
  registerHieCallbacks,
  testPlatformHieSettings,
  updatePlatformHieSettings,
  type HieCallbackBranchResult,
  type HieEnvironment,
  type HieTestResult,
  type HieTransaction,
  type PlatformHieSettings,
} from "../../lib/hieSettingsApi";

const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const HELP_CLASS = "text-xs font-normal text-ink-500";
const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const SECTION_TITLE_CLASS = "mb-4 font-display text-base font-semibold text-ink-900";
const ERROR_CLASS = "rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red";
const TH_CLASS = "px-3 py-2";
const TD_CLASS = "px-3 py-2 align-top";

// The UAT base URL DHA prints in every published HIE spec; production's is
// issued by DHA at onboarding, so it is never pre-filled.
const UAT_BASE_URL = "https://ilm-dev.dha.go.ke/uat-middleware/api/v1";

const SOURCE_LABEL: Record<PlatformHieSettings["source"], string> = {
  saved: "Service account saved here",
  environment: "Using the server's environment service account",
  none: "No service account — DHA HIE calls are unavailable",
};

const ENVIRONMENT_OPTIONS: { value: HieEnvironment; label: string }[] = [
  { value: "sandbox", label: "UAT / sandbox" },
  { value: "production", label: "Production" },
];

const TRANSACTION_TINT: Record<HieTransaction["status"], string> = {
  SUCCESS: "bg-brand-green-tint text-brand-green-dark",
  FAILED: "bg-status-red-tint text-status-red",
  PENDING: "bg-status-amber-tint text-status-amber",
};

const FACILITY_TINT: Record<string, string> = {
  VERIFIED: "bg-brand-green-tint text-brand-green-dark",
  NOT_FOUND: "bg-status-amber-tint text-status-amber",
  ERROR: "bg-status-red-tint text-status-red",
};

interface FormState {
  environment: HieEnvironment;
  base_url: string;
  client_id: string;
  client_secret: string;
  tenant_id: string;
  tenant_code: string;
  public_api_base_url: string;
  remittance_path: string;
  remittance_claims_path: string;
}

function formFromSettings(s: PlatformHieSettings): FormState {
  return {
    environment: s.environment,
    base_url: s.base_url,
    client_id: s.client_id,
    client_secret: "",
    tenant_id: s.tenant_id,
    tenant_code: s.tenant_code,
    public_api_base_url: s.public_api_base_url,
    remittance_path: s.remittance_path,
    remittance_claims_path: s.remittance_claims_path,
  };
}

/** A registry value shown exactly as received; a dash only when absent. */
function verbatim(value: string | undefined | null) {
  return value ? value : "—";
}

/**
 * Super Admin's DHA Health Information Exchange service account — the one
 * multitenant account every branch calls through (each call names the
 * branch's facility by its SHA FR code). Same encrypted-at-rest, write-only
 * secret pattern as PlatformAiSettingsPage. Also: the status-callback URL to
 * give DHA, callback registration per branch, and the recent HIE transaction
 * log for troubleshooting.
 */
export function PlatformHieSettingsPage() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PlatformHieSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<HieTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<HieCallbackBranchResult[] | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<HieTransaction[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const apply = (s: PlatformHieSettings) => {
    setSettings(s);
    setForm(formFromSettings(s));
  };

  const loadLog = async () => {
    if (!accessToken) return;
    setLogError(null);
    try {
      const result = await getHieTransactionLog(accessToken);
      setTransactions(result.transactions);
    } catch (err) {
      setLogError(err instanceof ApiError ? err.message : "Couldn't load the HIE transaction log.");
      throw err;
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    getPlatformHieSettings(accessToken)
      .then(apply)
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Couldn't load DHA / SHA integration settings.",
        ),
      )
      .finally(() => setLoading(false));
    getHieTransactionLog(accessToken)
      .then((result) => setTransactions(result.transactions))
      .catch((err) =>
        setLogError(
          err instanceof ApiError ? err.message : "Couldn't load the HIE transaction log.",
        ),
      );
  }, [accessToken]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const save = async () => {
    if (!accessToken || !form) return;
    setSaveError(null);
    try {
      apply(
        await updatePlatformHieSettings(accessToken, {
          environment: form.environment,
          base_url: form.base_url.trim(),
          client_id: form.client_id.trim(),
          tenant_id: form.tenant_id.trim(),
          tenant_code: form.tenant_code.trim(),
          public_api_base_url: form.public_api_base_url.trim(),
          remittance_path: form.remittance_path.trim(),
          remittance_claims_path: form.remittance_claims_path.trim(),
          ...(form.client_secret.trim() ? { client_secret: form.client_secret.trim() } : {}),
        }),
      );
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save DHA / SHA integration settings.",
      );
      throw err;
    }
  };

  const removeSecret = async () => {
    if (!accessToken) return;
    if (
      !window.confirm(
        "Remove the saved client secret? DHA HIE calls stop unless the server has its own service account.",
      )
    )
      throw new Error("cancelled");
    setSaveError(null);
    try {
      apply(await updatePlatformHieSettings(accessToken, { remove_client_secret: true }));
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't remove the client secret.");
      throw err;
    }
  };

  const rotateToken = async () => {
    if (!accessToken) return;
    if (
      !window.confirm(
        "Rotate the callback token? The current callback URL stops working at once — register the status callbacks again so DHA uses the new one.",
      )
    )
      throw new Error("cancelled");
    setCallbackError(null);
    setCopied(false);
    try {
      apply(await updatePlatformHieSettings(accessToken, { rotate_callback_token: true }));
    } catch (err) {
      setCallbackError(err instanceof ApiError ? err.message : "Couldn't rotate the callback token.");
      throw err;
    }
  };

  const copyCallbackUrl = async () => {
    if (!settings?.callback_url) return;
    setCallbackError(null);
    try {
      await navigator.clipboard.writeText(settings.callback_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCallbackError("Couldn't copy to the clipboard — select the callback URL and copy it manually.");
    }
  };

  const runTest = async () => {
    if (!accessToken) return;
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testPlatformHieSettings(accessToken);
      setTestResult(result);
      if (!result.success) throw new Error(result.message);
    } catch (err) {
      if (err instanceof ApiError) setTestError(err.message);
      throw err;
    } finally {
      void loadLog().catch(() => undefined);
    }
  };

  const runRegistration = async () => {
    if (!accessToken) return;
    setRegistration(null);
    setRegistrationError(null);
    try {
      const result = await registerHieCallbacks(accessToken);
      setRegistration(result.branches);
      if (result.branches.some((b) => "error" in b)) {
        throw new Error("Some branches were not registered.");
      }
    } catch (err) {
      if (err instanceof ApiError) setRegistrationError(err.message);
      throw err;
    } finally {
      void loadLog().catch(() => undefined);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">DHA / SHA Integration</h1>
        <p className="mt-1 text-sm text-ink-500">
          The service account for DHA’s Health Information Exchange — Facility, Health Worker and
          Client Registries, SHA eligibility and claims, and the Shared Health Record.
        </p>
      </div>

      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {loadError && <p className={ERROR_CLASS}>{loadError}</p>}

      {settings && form && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex flex-col gap-6 lg:w-2/3">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <PlugZap size={16} className="text-brand-green" />
                  HIE Service Account
                </span>
              </h2>
              <div className="mb-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                    settings.source !== "none"
                      ? "bg-brand-green-tint text-brand-green-dark"
                      : "bg-status-amber-tint text-status-amber"
                  }`}
                >
                  {SOURCE_LABEL[settings.source]}
                </span>
                {settings.environment === "production" && (
                  <span className="rounded-sm bg-status-red-tint px-2 py-0.5 text-xs font-semibold text-status-red">
                    Production — calls reach the live national systems
                  </span>
                )}
              </div>
              <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className={LABEL_CLASS}>
                    Environment
                    <select
                      className={FIELD_CLASS}
                      value={form.environment}
                      onChange={(e) => updateForm({ environment: e.target.value as HieEnvironment })}
                    >
                      {ENVIRONMENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={LABEL_CLASS}>
                    Base URL
                    <input
                      type="url"
                      className={FIELD_CLASS}
                      value={form.base_url}
                      onChange={(e) => updateForm({ base_url: e.target.value })}
                      placeholder={UAT_BASE_URL}
                    />
                    <span className={HELP_CLASS}>
                      The UAT base URL printed in DHA’s spec is {UAT_BASE_URL}. The production URL
                      is issued by DHA at onboarding.
                    </span>
                  </label>
                  <label className={LABEL_CLASS}>
                    Client ID
                    <input
                      type="text"
                      className={FIELD_CLASS}
                      value={form.client_id}
                      onChange={(e) => updateForm({ client_id: e.target.value })}
                      autoComplete="off"
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Client Secret
                    <input
                      type="password"
                      className={FIELD_CLASS}
                      value={form.client_secret}
                      onChange={(e) => updateForm({ client_secret: e.target.value })}
                      placeholder={
                        settings.has_credentials
                          ? "Leave blank to keep the current secret"
                          : "Client secret issued by DHA"
                      }
                      autoComplete="new-password"
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Tenant ID
                    <input
                      type="text"
                      className={FIELD_CLASS}
                      value={form.tenant_id}
                      onChange={(e) => updateForm({ tenant_id: e.target.value })}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Tenant Code
                    <input
                      type="text"
                      className={FIELD_CLASS}
                      value={form.tenant_code}
                      onChange={(e) => updateForm({ tenant_code: e.target.value })}
                    />
                    <span className={HELP_CLASS}>
                      Issued by DHA; used to register status callbacks. Enter the tenant ID, the
                      tenant code, or both.
                    </span>
                  </label>
                </div>

                <label className={LABEL_CLASS}>
                  Public API Base URL of this Deployment
                  <input
                    type="url"
                    className={FIELD_CLASS}
                    value={form.public_api_base_url}
                    onChange={(e) => updateForm({ public_api_base_url: e.target.value })}
                  />
                  <span className={HELP_CLASS}>
                    This deployment’s API as reachable from the internet, ending in /api/v1. The
                    HIE posts claim, pre-authorisation and authorisation status changes under it.
                  </span>
                </label>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className={LABEL_CLASS}>
                    Remittance Path
                    <input
                      type="text"
                      className={FIELD_CLASS}
                      value={form.remittance_path}
                      onChange={(e) => updateForm({ remittance_path: e.target.value })}
                    />
                  </label>
                  <label className={LABEL_CLASS}>
                    Remittance Claims Path
                    <input
                      type="text"
                      className={FIELD_CLASS}
                      value={form.remittance_claims_path}
                      onChange={(e) => updateForm({ remittance_claims_path: e.target.value })}
                    />
                  </label>
                </div>
                <p className={HELP_CLASS}>
                  DHA publishes the remittance workflows but has not published their paths. Leave
                  both blank until DHA supplies them; remittances can’t be fetched until then.
                  Paths are relative to the base URL.
                </p>

                <div className="flex flex-wrap gap-2">
                  <SaveButton onSave={save}>Save Integration Settings</SaveButton>
                  {settings.has_credentials && (
                    <SaveButton
                      onSave={removeSecret}
                      variant="ghost"
                      savingLabel="Removing…"
                      savedLabel="Removed"
                    >
                      Remove saved secret
                    </SaveButton>
                  )}
                </div>
                {saveError && <p className={ERROR_CLASS}>{saveError}</p>}
                {settings.updated_by_name && (
                  <p className="text-xs text-ink-500">
                    Last changed by {settings.updated_by_name} ·{" "}
                    {new Date(settings.updated_at).toLocaleString()}
                  </p>
                )}

                <div className="mt-2 border-t border-surface-border pt-4">
                  <p className="mb-2 text-xs text-ink-500">
                    Signs in with the saved service account, then looks every active branch’s SHA
                    FR code up in the DHA Facility Registry and records the answer on the branch.
                    No client information is sent. Save any changes above first.
                  </p>
                  <SaveButton
                    onSave={runTest}
                    variant="ghost"
                    disabled={settings.source === "none"}
                    savingLabel="Testing…"
                    savedLabel="Connected"
                  >
                    Test Connection
                  </SaveButton>
                  {testError && <p className={`mt-2 ${ERROR_CLASS}`}>{testError}</p>}
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
                  {testResult?.success && testResult.facilities.length === 0 && (
                    <p className="mt-2 text-xs text-ink-500">
                      No active branch has an SHA FR code yet, so no facility was looked up.
                    </p>
                  )}
                  {testResult && testResult.facilities.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-md border border-surface-border">
                      <p className="border-b border-surface-border bg-surface-bg px-3 py-2 text-xs text-ink-500">
                        Facility Registry results — shown exactly as the registry returned them.
                      </p>
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                          <tr>
                            <th className={TH_CLASS}>Branch</th>
                            <th className={TH_CLASS}>Result</th>
                            <th className={TH_CLASS}>Official Name</th>
                            <th className={TH_CLASS}>FR Code</th>
                            <th className={TH_CLASS}>KEPH Level</th>
                            <th className={TH_CLASS}>Licence Status</th>
                            <th className={TH_CLASS}>SHA Contract</th>
                            <th className={TH_CLASS}>SHA Operational Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testResult.facilities.map((f, index) => (
                            <tr
                              key={`${f.organization}-${f.branch}-${index}`}
                              className="border-b border-surface-border last:border-0"
                            >
                              <td className={TD_CLASS}>
                                <div className="font-medium text-ink-900">{f.branch}</div>
                                <div className="text-xs text-ink-500">{f.organization}</div>
                              </td>
                              <td className={TD_CLASS}>
                                <span
                                  className={`whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${
                                    FACILITY_TINT[f.status] ?? "bg-surface-bg text-ink-500"
                                  }`}
                                >
                                  {f.status_label || f.status || "—"}
                                </span>
                                {f.problem && (
                                  <div className="mt-1 text-xs text-status-red">{f.problem}</div>
                                )}
                              </td>
                              <td className={TD_CLASS}>{verbatim(f.official_name)}</td>
                              <td className={`${TD_CLASS} font-mono`}>{verbatim(f.fr_code)}</td>
                              <td className={TD_CLASS}>{verbatim(f.keph_level)}</td>
                              <td className={TD_CLASS}>{verbatim(f.license_status)}</td>
                              <td className={TD_CLASS}>{verbatim(f.sha_contract_status)}</td>
                              <td className={TD_CLASS}>{verbatim(f.sha_operational_status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </form>
            </div>

            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>
                <span className="inline-flex items-center gap-2">
                  <Link2 size={16} className="text-brand-green" />
                  Status Callbacks
                </span>
              </h2>
              <div className="flex flex-col gap-3">
                <div className={LABEL_CLASS}>
                  Callback URL
                  {settings.callback_url ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <code
                        className={`${FIELD_CLASS} min-w-0 flex-1 break-all bg-surface-bg font-mono text-xs`}
                      >
                        {settings.callback_url}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyCallbackUrl()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg"
                      >
                        <Copy size={14} />
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <div className={`${FIELD_CLASS} bg-surface-bg text-ink-500`}>
                      Save the public API base URL above to generate the callback URL.
                    </div>
                  )}
                  <span className={HELP_CLASS}>
                    &lt;entity&gt; is filled in per callback type (claim, preauth,
                    authorization) when the callbacks are registered.
                  </span>
                </div>
                <p className="rounded-sm bg-status-amber-tint px-3 py-2 text-sm text-ink-900">
                  Keep this URL private. The token in it is what authenticates DHA’s status
                  callbacks — give it to DHA only, and rotate it if it may have been seen by anyone
                  else.
                </p>
                <div className="flex flex-wrap gap-2">
                  <SaveButton
                    onSave={runRegistration}
                    variant="ghost"
                    disabled={!settings.callback_url || settings.source === "none"}
                    savingLabel="Registering…"
                    savedLabel="Registered"
                  >
                    Register Status Callbacks
                  </SaveButton>
                  <SaveButton
                    onSave={rotateToken}
                    variant="ghost"
                    savingLabel="Rotating…"
                    savedLabel="Rotated"
                  >
                    Rotate callback token
                  </SaveButton>
                </div>
                <p className={HELP_CLASS}>
                  Registers the claim, pre-authorisation and authorisation status callbacks with
                  the HIE for every active branch with SHA claims turned on and an SHA FR code.
                  Safe to repeat — callbacks already registered at this URL are left as they are.
                </p>
                {callbackError && <p className={ERROR_CLASS}>{callbackError}</p>}
                {registrationError && <p className={ERROR_CLASS}>{registrationError}</p>}
                {registration && registration.length === 0 && (
                  <p className="text-xs text-ink-500">
                    No active branch has SHA claims turned on with an SHA FR code, so nothing was
                    registered.
                  </p>
                )}
                {registration && registration.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {registration.map((b, index) => (
                      <li
                        key={`${b.branch}-${index}`}
                        className="rounded-md border border-surface-border px-3 py-2 text-sm"
                      >
                        <div className="font-medium text-ink-900">{b.branch}</div>
                        {"error" in b ? (
                          <p className="mt-1 text-status-red">{b.error}</p>
                        ) : (
                          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-700">
                            {b.results.map((r) => (
                              <li key={r.entity_type}>
                                <span className="font-mono">{r.entity_type}</span>: {r.status}
                                {r.endpoint_id && (
                                  <span className="text-ink-500"> · endpoint {r.endpoint_id}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 lg:w-1/3">
            <div className={CARD_CLASS}>
              <h2 className={SECTION_TITLE_CLASS}>How This Is Used</h2>
              <div className="flex flex-col gap-3 text-sm text-ink-700">
                <p>
                  The client secret is stored encrypted and is never shown again. Settings saved
                  here take precedence over a service account set in the server environment.
                </p>
                <p>
                  One service account serves every branch: each call names the branch’s facility
                  by its <span className="font-medium text-ink-900">SHA FR code</span>, set under
                  Branch Settings. A branch that holds its own facility-scoped DHA credentials can
                  enter them there instead.
                </p>
                <p className="text-ink-500">
                  Use the UAT / sandbox environment until DHA has signed off your integration and
                  issued production credentials.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={CARD_CLASS}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink-900">
            <span className="inline-flex items-center gap-2">
              <History size={16} className="text-brand-green" />
              Recent HIE Transactions
            </span>
          </h2>
          <SaveButton
            onSave={loadLog}
            variant="ghost"
            savingLabel="Refreshing…"
            savedLabel="Refreshed"
          >
            Refresh
          </SaveButton>
        </div>
        <p className="mb-3 text-xs text-ink-500">
          The latest 100 calls to the HIE, newest first. Request and response bodies are kept
          redacted on the server and are not shown here.
        </p>
        {logError && <p className={ERROR_CLASS}>{logError}</p>}
        {transactions && transactions.length === 0 && (
          <p className="text-sm text-ink-500">No HIE transactions yet.</p>
        )}
        {transactions && transactions.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-surface-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-border bg-surface-bg text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className={TH_CLASS}>Time</th>
                  <th className={TH_CLASS}>Type</th>
                  <th className={TH_CLASS}>Method</th>
                  <th className={TH_CLASS}>Endpoint</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>HTTP</th>
                  <th className={TH_CLASS}>Trace ID</th>
                  <th className={TH_CLASS}>Error</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-surface-border last:border-0">
                    <td className={`${TD_CLASS} whitespace-nowrap`}>
                      {new Date(t.at).toLocaleString()}
                      {t.duration_ms !== null && (
                        <div className="text-xs text-ink-500">{t.duration_ms} ms</div>
                      )}
                    </td>
                    <td className={TD_CLASS}>{t.type}</td>
                    <td className={`${TD_CLASS} font-mono text-xs`}>{t.method}</td>
                    <td className={`${TD_CLASS} break-all font-mono text-xs`}>{t.endpoint}</td>
                    <td className={TD_CLASS}>
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                          TRANSACTION_TINT[t.status] ?? "bg-surface-bg text-ink-500"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className={`${TD_CLASS} font-mono text-xs`}>{t.http_status ?? "—"}</td>
                    <td className={`${TD_CLASS} break-all font-mono text-xs`}>
                      {t.trace_id || "—"}
                    </td>
                    <td className={`${TD_CLASS} text-xs text-status-red`}>{t.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
