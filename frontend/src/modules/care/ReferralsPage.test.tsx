import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ReferralsPage } from "./ReferralsPage";

describe("ReferralsPage", () => {
  it("offers buttons for the worklist and referral documents", () => {
    render(
      <MemoryRouter>
        <ReferralsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Open worklist/ })).toHaveAttribute(
      "href",
      "/clinical/referrals/worklist",
    );
    expect(screen.getByRole("link", { name: /Open documents/ })).toHaveAttribute(
      "href",
      "/clinical/referrals/documents",
    );
  });
});
