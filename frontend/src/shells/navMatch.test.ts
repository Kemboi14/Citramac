import { describe, expect, it } from "vitest";
import { CLINICAL_NAV } from "./navConfig";
import { groupContainsActive } from "./navMatch";

const groups = CLINICAL_NAV.flatMap((group) => group.items).filter((item) => item.children);
const leaves = groups.flatMap((group) => group.children ?? []);
const topLevel = CLINICAL_NAV.flatMap((group) => group.items).filter((item) => item.to);
const everyLeaf = [...leaves, ...topLevel];
const group = (label: string) => groups.find((item) => item.label === label)!;

describe("clinical nav matching", () => {
  it("keeps removed modules and individual routes out of the left menu", () => {
    expect(everyLeaf.some((item) => item.label === "Registration")).toBe(false);
    expect(everyLeaf.some((item) => item.label === "Psychiatric")).toBe(false);
    expect(everyLeaf.some((item) => item.label === "Triage")).toBe(false);
    expect(groups.some((item) => item.label === "Inpatient & residential")).toBe(false);
    expect(groups.some((item) => item.label === "Clinical")).toBe(false);
    expect(groups.some((item) => item.label === "Appointments & follow-up")).toBe(false);
    expect(everyLeaf.some((item) => item.label === "Appointments")).toBe(false);
    expect(everyLeaf.some((item) => item.label === "Follow-up")).toBe(false);
    expect(topLevel.find((item) => item.label === "Individual Psychotherapy")?.to).toBe(
      "/clinical/psychotherapy/individual",
    );
    expect(groups.some((item) => item.label === "Psychotherapy")).toBe(false);
    expect(topLevel.find((item) => item.label === "Family Psychotherapy")?.to).toBe(
      "/clinical/psychotherapy/family",
    );
    expect(topLevel.find((item) => item.label === "Group Psychotherapy")?.to).toBe(
      "/clinical/psychotherapy/group",
    );
    expect(topLevel.find((item) => item.label === "Supervision requests")?.to).toBe(
      "/clinical/mhp/supervision",
    );
    expect(topLevel.find((item) => item.label === "Referrals")?.to).toBe("/clinical/referrals");
    expect(topLevel.find((item) => item.label === "Laboratory")?.to).toBe("/clinical/lims");
    expect(group("Pharmacy & medication").children?.map((item) => item.label)).toEqual([
      "Medication orders & review",
      "Medication administration",
    ]);
  });

  it("shows the client registry as a standalone menu item", () => {
    expect(topLevel.find((item) => item.label === "Client Registry")?.to).toBe(
      "/clinical/registry",
    );
  });

  it("opens the group that holds the current route", () => {
    expect(groupContainsActive(group("Reports & analytics"), "/clinical/mhp/nacada")).toBe(true);
    expect(everyLeaf.some((item) => item.label === "Laboratory records")).toBe(false);
  });

  it("keeps all clinical menu groups collapsed by default", () => {
    expect(groups.every((item) => !item.defaultOpen)).toBe(true);
  });

  it("gives every nav destination a single owner", () => {
    const paths = everyLeaf.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps the kept modules and drops the legacy group", () => {
    const labels = everyLeaf.map((item) => item.label);
    expect(labels).toContain("NACADA report");
    expect(labels).toContain("Supervision requests");
    expect(labels).not.toContain("Other clinical modules");
    expect(groups.map((g) => g.label)).not.toContain("Other clinical modules");
  });
});
