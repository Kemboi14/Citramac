import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  beforeEach(() => {
    // AuthProvider always tries a silent refresh on mount — no cookie in
    // tests, so it always fails, which is exactly the "logged out" case.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { code: "MISSING_REFRESH_TOKEN", message: "" } }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects an unauthenticated visitor at / to the login page", async () => {
    renderAt("/");
    await waitFor(() => expect(screen.getByText("Sign in to CITRAMAC")).toBeInTheDocument());
  });

  it("redirects an unauthenticated visitor hitting a protected shell to login", async () => {
    renderAt("/super-admin/organizations");
    await waitFor(() => expect(screen.getByText("Sign in to CITRAMAC")).toBeInTheDocument());
  });

  it("renders the activation flow's first step given an activation token", async () => {
    renderAt("/activate?token=abc123");
    await waitFor(() => expect(screen.getByText("Welcome to CITRAMAC")).toBeInTheDocument());
  });
});
