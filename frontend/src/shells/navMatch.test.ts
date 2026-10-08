import { describe, expect, it } from "vitest";
import { CLINICAL_NAV } from "./navConfig";
import { groupContainsActive, itemMatches } from "./navMatch";

const groups = CLINICAL_NAV.flatMap((group) => group.items).filter((item) => item.children);
const leaves = groups.flatMap((group) => group.children ?? []);
const topLevel = CLINICAL_NAV.flatMap((group) => group.items).filter((item) => item.to);
const everyLeaf = [...leaves, ...topLevel];
const find = (label: string) => everyLeaf.find((item) => item.label === label)!;
const group = (label: string) => groups.find((item) => item.label === label)!;

describe("clinical nav matching", () => {
  it("matches a leaf exactly, not its sub-routes", () => {
    expect(itemMatches(find("Admissions"), "/clinical/inpatient")).toBe(true);
    // Ward board has its own entry; Admissions must not light up with it.
    expect(itemMatches(find("Admissions"), "/clinical/inpatient/ward")).toBe(false);
    expect(itemMatches(find("Ward board"), "/clinical/inpatient/ward")).toBe(true);
  });

  it("honours matchPrefix and alsoActiveFor", () => {
    expect(itemMatches(find("Triage"), "/clinical/triage/abc")).toBe(true);
    expect(itemMatches(find("Psychiatric"), "/clinical/clients/abc/intake")).toBe(true);
    expect(itemMatches(find("Psychiatric"), "/clinical/clientsmith")).toBe(false);
  });

  it("opens the group that holds the current route", () => {
    expect(groupContainsActive(group("Inpatient & residential"), "/clinical/discharge")).toBe(true);
    expect(groupContainsActive(group("Reports & analytics"), "/clinical/mhp/nacada")).toBe(true);
    expect(groupContainsActive(group("Clinical"), "/clinical/mhp/supervision")).toBe(true);
    expect(groupContainsActive(group("Laboratory"), "/clinical/discharge")).toBe(false);
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
