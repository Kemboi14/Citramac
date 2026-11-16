import { describe, expect, it } from "vitest";
import { capitalizeName } from "./names";

describe("capitalizeName", () => {
  it.each([
    ["amina", "Amina"],
    ["amina wanjiku", "Amina Wanjiku"],
    ["mary-jane", "Mary-Jane"],
    ["ng'ang'a", "Ng'ang'a"],
    ["McDonald", "McDonald"],
    ["", ""],
    ["amina ", "Amina "],
  ])("%s → %s", (typed, expected) => {
    expect(capitalizeName(typed)).toBe(expected);
  });
});
