import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignaturePad } from "./SignaturePad";

describe("SignaturePad", () => {
  it("offers a drawing box, and no unable-to-sign option for the witness", () => {
    render(<SignaturePad label="Your signature as witness" onChange={() => undefined} />);
    expect(
      screen.getByRole("img", { name: /your signature as witness — draw the signature/i }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/unable to sign/i)).toBeNull();
  });

  it("records why a party cannot sign instead of a drawing", () => {
    const onChange = vi.fn();
    render(<SignaturePad label="Client's signature" allowUnable onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/unable to sign/i));
    expect(screen.queryByRole("img")).toBeNull();
    const reason = screen.getByPlaceholderText(/why they cannot sign/i);
    fireEvent.change(reason, { target: { value: "no" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(reason, { target: { value: "Hand in a cast" } });
    expect(onChange).toHaveBeenLastCalledWith({ unable_reason: "Hand in a cast" });
  });
});
