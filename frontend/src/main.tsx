import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { AuthProvider } from "./auth/AuthContext.tsx";
import { PatientProvider } from "./clinical/PatientContext.tsx";
import { ThemeProvider } from "./theme/useTheme.ts";
import { applyCachedPlatformTheme, setPlatformTheme } from "./theme/runtimeTheme.ts";
import { getPlatformBranding } from "./lib/brandingApi.ts";

// Paint the last-known platform theme before the first render, then refresh
// it — the branding endpoint is public, so this also themes the login screens.
applyCachedPlatformTheme();
getPlatformBranding()
  .then((b) => setPlatformTheme(b.theme_overrides))
  .catch(() => {
    // Best-effort — the cached (or stock) palette stays in place.
  });

// A tab opened before a deploy still references the previous build's chunk
// names, which no longer exist. Reload once to pick up the new build instead
// of leaving that screen blank. The offline queue's beforeunload warning still
// applies, so pending clinical work is never discarded silently.
window.addEventListener("vite:preloadError", (event) => {
  const KEY = "citramac.chunk-reload-at";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still reload, the 30 s guard just can't apply.
  }
  if (Date.now() - last < 30_000) return; // already reloaded once — let the error surface
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <PatientProvider>
              <App />
            </PatientProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
