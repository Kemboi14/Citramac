import { describe, expect, it } from "vitest";
import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import { sectionNActionOptions } from "./TriageFormV5";

const options: ValueSetConcept[] = [
  { code: "other", display: "Other" },
  { code: "routine_psychiatric_review", display: "Routine psychiatric review" },
  { code: "urgent_medical_review", display: "Urgent medical review" },
  { code: "priority_psychiatric_review", display: "Priority psychiatric review" },
  { code: "urgent_psychiatric_review", display: "Urgent psychiatric review" },
  { code: "psychiatric_review_withdrawal", display: "Psychiatric review — withdrawal" },
  { code: "psychiatric_review", display: "Psychiatric review" },
  { code: "safety_plan", display: "Safety plan" },
];

describe("Section N actions", () => {
  it("uses one psychiatric review action and leaves Other last for an editable triage", () => {
    const codes = sectionNActionOptions(options, false).map((option) => option.code);

    expect(codes).toEqual(["urgent_medical_review", "psychiatric_review", "safety_plan", "other"]);
  });

  it("preserves historical action choices in a read-only triage", () => {
    expect(sectionNActionOptions(options, true).map((option) => option.code)).toEqual([
      "other",
      "routine_psychiatric_review",
      "urgent_medical_review",
      "priority_psychiatric_review",
      "urgent_psychiatric_review",
      "psychiatric_review_withdrawal",
      "safety_plan",
    ]);
  });
});
