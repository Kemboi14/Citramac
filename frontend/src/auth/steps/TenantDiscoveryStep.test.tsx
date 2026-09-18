import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TenantDiscoveryStep } from "./TenantDiscoveryStep";

function renderStep() {
  const onSuccess = vi.fn();
  render(
    <MemoryRouter>
      <TenantDiscoveryStep onSuccess={onSuccess} />
    </MemoryRouter>,
  );
  return onSuccess;
}

describe("TenantDiscoveryStep", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the platform-staff sign-in link, with no inline bypass button, before any submission", () => {
    renderStep();
    expect(screen.getByText("Platform staff sign-in")).toBeInTheDocument();
    expect(
      screen.queryByText("I'm platform staff — continue without an organisation"),
    ).not.toBeInTheDocument();
  });

  it("still shows the platform-staff sign-in link, and no inline bypass, after a not-found result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ error: { code: "TENANT_NOT_FOUND", message: "Not found" } }),
      }),
    );
    const onSuccess = renderStep();

    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "someone@unknown-domain.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't continue with the information provided."),
      ).toBeInTheDocument(),
    );

    // The old escape hatch used to call onSuccess(email, null) here — it
    // must not exist at all any more, so onSuccess is never called on a
    // not-found result.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(
      screen.queryByText("I'm platform staff — continue without an organisation"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Platform staff sign-in")).toBeInTheDocument();
  });
});
