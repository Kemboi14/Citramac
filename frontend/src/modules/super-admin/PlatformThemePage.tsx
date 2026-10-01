import { useEffect, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { getPlatformBranding, updatePlatformTheme } from "../../lib/brandingApi";
import { SaveButton } from "../../components/SaveButton";
import { ThemeEditor } from "../../theme/ThemeEditor";
import { setPlatformTheme } from "../../theme/runtimeTheme";
import { sanitizeOverrides, type ThemeOverrides } from "../../theme/themeTokens";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";

/**
 * Super Admin's platform-wide palette — every color token in both light
 * and dark mode, including the status colors (danger/warning), which only
 * this screen can change (organizations theme everything else on top).
 */
export function PlatformThemePage() {
  const { accessToken } = useAuth();
  const [saved, setSaved] = useState<ThemeOverrides | null>(null);
  const [draft, setDraft] = useState<ThemeOverrides>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getPlatformBranding()
      .then((b) => {
        const overrides = sanitizeOverrides(b.theme_overrides, true);
        setSaved(overrides);
        setDraft(overrides);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the platform theme."),
      );
  }, []);

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  const save = async () => {
    if (!accessToken) return;
    setSaveError(null);
    try {
      const result = await updatePlatformTheme(accessToken, sanitizeOverrides(draft, true));
      const overrides = sanitizeOverrides(result.theme_overrides, true);
      setSaved(overrides);
      setDraft(overrides);
      setPlatformTheme(overrides);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save the platform theme.");
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          Platform Administration
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Theme &amp; Colors</h1>
        <p className="mt-1 text-sm text-ink-500">
          The default palette every user sees, in light and dark mode. Each organization can
          re-theme everything except status colors on top of this from its Branch Settings.
        </p>
      </div>

      {loadError && (
        <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">{loadError}</p>
      )}
      {!saved && !loadError && <p className="text-sm text-ink-500">Loading…</p>}

      {saved && (
        <div className={CARD_CLASS}>
          <ThemeEditor value={draft} onChange={setDraft} allowStatus />
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
            {saveError && <p className="mr-auto text-sm text-status-red">{saveError}</p>}
            {dirty && <span className="text-xs text-ink-500">Unsaved changes</span>}
            <button
              type="button"
              disabled={!dirty}
              onClick={() => setDraft(saved)}
              className="rounded-md border border-surface-border bg-surface-card px-4 py-2.5 text-[13px] font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-50"
            >
              Discard changes
            </button>
            <SaveButton onSave={save} disabled={!dirty}>
              Save Platform Theme
            </SaveButton>
          </div>
        </div>
      )}
    </div>
  );
}
