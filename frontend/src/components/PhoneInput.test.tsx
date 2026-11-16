import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import PhoneInput, { phoneProblem } from "./PhoneInput";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneInput id="p" value={value} onChange={setValue} />
      <output data-testid="v">{value}</output>
    </>
  );
}

describe("PhoneInput", () => {
  it.each([
    ["0712 345 678", "+254712345678"],
    ["712345678", "+254712345678"],
    ["+254712345678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+256 772 123456", "+256772123456"],
    ["0044 7911 123456", "+447911123456"],
  ])("reads %s as %s", (typed, expected) => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: typed } });
    expect(screen.getByTestId("v").textContent).toBe(expected);
  });

  it("keeps a stored local number and shows the Kenyan code", () => {
    render(<Harness initial="0712345678" />);
    expect(screen.getByRole("textbox")).toHaveValue("712 345 678");
    expect(screen.getByRole("button", { name: /Kenya \+254/ })).toBeInTheDocument();
  });

  it("finds a country by name or code and switches to it", () => {
    render(<Harness initial="+254712345678" />);
    fireEvent.click(screen.getByRole("button", { name: /dialling code/ }));
    const search = screen.getByRole("combobox", { name: "Search country or code" });
    fireEvent.change(search, { target: { value: "ugan" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByTestId("v").textContent).toBe("+256712345678");
    fireEvent.click(screen.getByRole("button", { name: /dialling code/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search country or code" }), {
      target: { value: "+44" },
    });
    fireEvent.click(screen.getByRole("option", { name: /United Kingdom/ }));
    expect(screen.getByTestId("v").textContent).toBe("+44712345678");
  });

  it("flags a Kenyan number of the wrong length", () => {
    expect(phoneProblem("+25471234")).toMatch(/9 digits/);
    expect(phoneProblem("+254712345678")).toBeNull();
    expect(phoneProblem("")).toBeNull();
  });
});
