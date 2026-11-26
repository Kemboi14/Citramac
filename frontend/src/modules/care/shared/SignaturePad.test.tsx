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

  it("offers refused to sign only where allowed, and records what was said", () => {
    const { unmount } = render(
      <SignaturePad label="Client's signature" allowUnable onChange={() => undefined} />,
    );
    expect(screen.queryByLabelText(/refused to sign/i)).toBeNull();
    unmount();
    const onChange = vi.fn();
    render(
      <SignaturePad label="Client's signature" allowUnable allowRefused onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText(/refused to sign/i));
    expect(screen.queryByRole("img")).toBeNull();
    const reason = screen.getByPlaceholderText(/what they said or did in refusing/i);
    fireEvent.change(reason, { target: { value: "Said they will not sign" } });
    expect(onChange).toHaveBeenLastCalledWith({ refused_reason: "Said they will not sign" });
  });
});
