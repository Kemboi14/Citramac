import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createElement } from "react";

export type ThemePreference = "light" | "dark" | "system";

/** Each person's choice is kept under their own key, so one account switching
 * to dark (say Super Admin) never changes another's on the same browser. */
const KEY_PREFIX = "citramac.theme.user.";
/** The old per-browser key — removed, never carried over to anyone. */
const LEGACY_KEY = "citramac.theme";

function readPreference(userId: string | null): ThemePreference {
  if (!userId) return "light"; // signed out (sign-in screens): always light
  try {
    const stored = localStorage.getItem(KEY_PREFIX + userId);
    return stored === "dark" || stored === "system" ? stored : "light";
  } catch {
    return "light";
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") {
    // Only when the person chose "Match device": tokens.css's
    // `@media (prefers-color-scheme: dark)` block drives the palette.
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
}

const ThemeContext = createContext<{
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Whose preference applies — set from the signed-in user (ThemeUserSync). */
  setUser: (userId: string | null) => void;
} | null>(null);

/**
 * Light by default: a new person, and every sign-in screen, sees light mode
 * whatever the device is set to. Dark (or "Match device") applies only after
 * the person chooses it, and only for them — the choice is stored per user on
 * this browser.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [preference, setPreferenceState] = useState<ThemePreference>("light");

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage unavailable: nothing to clean up.
    }
  }, []);

  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  const setUser = useCallback((id: string | null) => {
    setUserId(id);
    setPreferenceState(readPreference(id));
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    if (!userId) return;
    try {
      if (p === "light") localStorage.removeItem(KEY_PREFIX + userId);
      else localStorage.setItem(KEY_PREFIX + userId, p);
    } catch {
      // Best-effort only — a private window or blocked storage just means
      // the preference won't persist across reloads.
    }
  };

  return createElement(
    ThemeContext.Provider,
    { value: { preference, setPreference, setUser } },
    children,
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
