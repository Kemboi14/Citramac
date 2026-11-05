import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutoResizeTextarea } from "./AutoResizeTextarea";

describe("AutoResizeTextarea", () => {
  it("expands as content grows and preserves textarea props and entered text", () => {
    const onInput = vi.fn();
    let height = 48;
    function ControlledTextarea() {
      const [value, setValue] = useState("First line\nSecond line");
      return (
        <AutoResizeTextarea
          aria-label="Clinical note"
          className="rounded-lg"
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onInput={onInput}
        />
      );
    }

    render(<ControlledTextarea />);

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Clinical note" });
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => height,
    });

    fireEvent.input(textarea, { target: { value: "First line\nSecond line\nThird line" } });

    const firstHeight = Number.parseFloat(textarea.style.height);
    expect(firstHeight).toBeGreaterThan(0);
    expect(textarea).toHaveStyle({ overflowY: "hidden", resize: "none" });
    expect(textarea).toHaveClass("rounded-lg");
    expect(textarea).toHaveValue("First line\nSecond line\nThird line");
    expect(onInput).toHaveBeenCalledOnce();

    height = 96;
    fireEvent.input(textarea);
    expect(Number.parseFloat(textarea.style.height)).toBeGreaterThan(firstHeight);
  });
});
