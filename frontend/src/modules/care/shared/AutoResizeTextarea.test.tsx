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

  function NoteField({ plain = false }: { plain?: boolean }) {
    const [value, setValue] = useState("Poor sleep");
    return (
      <AutoResizeTextarea
        aria-label="Note"
        plain={plain}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }

  it("has the intake's square look and a list toolbar once focused", () => {
    render(<NoteField />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    expect(textarea).toHaveClass("!rounded-none");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    fireEvent.focus(textarea);
    textarea.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Toggle bulleted list" }));
    // The caller's own onChange receives the formatted text.
    expect(textarea).toHaveValue("• Poor sleep");
  });

  it("continues a list on Enter", () => {
    render(<NoteField />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    fireEvent.change(textarea, { target: { value: "1. Poor sleep" } });
    textarea.setSelectionRange(13, 13);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea).toHaveValue("1. Poor sleep\n2. ");
  });

  it("plain fields keep the caller's styling and have no toolbar", () => {
    render(<NoteField plain />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    fireEvent.focus(textarea);
    expect(textarea).not.toHaveClass("!rounded-none");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
