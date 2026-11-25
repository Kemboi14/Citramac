import { describe, expect, it } from "vitest";
import { CLINICAL_NAV, navForPermissions } from "./navConfig";

const labels = (held: string[] | undefined) =>
  navForPermissions(CLINICAL_NAV, held).flatMap((group) => group.items.map((item) => item.label));

describe("clinical nav by permission", () => {
  it("shows only Group Psychotherapy to people without the deliver permission", () => {
    for (const held of [["clinical.care.record"], undefined]) {
      const psy = navForPermissions(CLINICAL_NAV, held)
        .flatMap((group) => group.items)
        .find((item) => item.label === "Psychotherapy");
      expect(psy?.children?.map((child) => child.label)).toEqual(["Group Psychotherapy"]);
    }
  });

  it("shows Psychotherapy and its three modules to holders", () => {
    const nav = navForPermissions(CLINICAL_NAV, ["clinical.psychotherapy.deliver"]);
    const psy = nav.flatMap((group) => group.items).find((item) => item.label === "Psychotherapy");
    expect(psy?.children?.map((child) => child.label)).toEqual([
      "Individual Psychotherapy",
      "Family Psychotherapy",
      "Group Psychotherapy",
    ]);
  });

  it("leaves items without a permission alone", () => {
    expect(labels([])).toContain("Psychiatry");
    expect(labels([])).toContain("Laboratory");
  });
});
