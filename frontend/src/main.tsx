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
