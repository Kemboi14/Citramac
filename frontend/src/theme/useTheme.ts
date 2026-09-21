import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createElement } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "citramac.theme";

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

const ThemeContext = createContext<{
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
} | null>(null);

/**
 * "system" (the default) leaves `data-theme` unset so tokens.css's
 * `@media (prefers-color-scheme: dark)` block drives the palette; "light"/
 * "dark" set `data-theme` explicitly, which tokens.css gives priority over
 * the OS preference. Persisted per-browser, not per-account — a shared
 * clinic workstation and someone's own laptop can reasonably want
 * different modes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    try {
      if (p === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // Best-effort only — a private window or blocked storage just means
      // the preference won't persist across reloads.
    }
  };

  return createElement(ThemeContext.Provider, { value: { preference, setPreference } }, children);
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
