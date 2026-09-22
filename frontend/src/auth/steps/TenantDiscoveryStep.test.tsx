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

  it("shows the not-found state and never calls onSuccess for a genuinely unknown email", async () => {
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
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onSuccess with a null tenant for a platform-staff email, not the not-found state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ tenant: null }),
      }),
    );
    const onSuccess = renderStep();

    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "root@platform.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("root@platform.test", null));
    expect(
      screen.queryByText("We couldn't continue with the information provided."),
    ).not.toBeInTheDocument();
  });
});
