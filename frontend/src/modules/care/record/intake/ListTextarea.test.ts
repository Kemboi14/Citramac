import { describe, expect, it } from "vitest";
import { continueListOnEnter, formatSelectedLines } from "./ListTextarea";

describe("formatSelectedLines", () => {
  it("numbers selected lines", () => {
    const result = formatSelectedLines("first\nsecond", 0, 12, "numbered");
    expect(result.value).toBe("1. first\n2. second");
  });

  it("toggles an existing bullet list off", () => {
    const result = formatSelectedLines("• first\n• second", 0, 17, "bullet");
    expect(result.value).toBe("first\nsecond");
  });

  it("replaces existing list markers when changing list style", () => {
    const result = formatSelectedLines("1. first\n2. second", 0, 18, "bullet");
    expect(result.value).toBe("• first\n• second");
  });

  it("inserts a bullet at the caret on the current line", () => {
    const result = formatSelectedLines("a note", 0, 0, "bullet");
    expect(result.value).toBe("• a note");
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(2);
  });

  it("continues a bullet list when Enter is pressed", () => {
    const result = continueListOnEnter("• first item", 12, 12);
    expect(result?.value).toBe("• first item\n• ");
    expect(result?.selectionStart).toBe(15);
  });

  it("increments numbered list items on Enter", () => {
    const result = continueListOnEnter("1. first item", 13, 13);
    expect(result?.value).toBe("1. first item\n2. ");
  });

  it("ends a list when Enter is pressed on an empty item", () => {
    const result = continueListOnEnter("• first\n• ", 10, 10);
    expect(result?.value).toBe("• first\n");
  });

  it("does not intercept Enter for plain text", () => {
    expect(continueListOnEnter("plain text", 10, 10)).toBeNull();
  });
});
