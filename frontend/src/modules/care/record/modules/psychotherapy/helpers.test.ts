import { describe, expect, it } from "vitest";
import { exampleAnswers } from "./exampleSession";
import { familyDraftDisplayText, noteSections } from "./helpers";

const config = {
  sections: [
    { key: "session_information", title: "Session Information" },
    { key: "presenting_focus", title: "Presenting Focus / Client Report" },
    { key: "assessment", title: "Clinical Assessment / Observations" },
    { key: "interventions", title: "Therapeutic Focus & Interventions" },
    { key: "response", title: "Client Response & Progress" },
    { key: "risk_safety", title: "Risk & Safety" },
    { key: "plan", title: "Plan" },
  ],
};

describe("family psychotherapy presentation", () => {
  it("uses family section headings and keeps the required safety section", () => {
    expect(noteSections(config, "FAMILY").map((section) => section.title)).toEqual([
      "Key issues discussed",
      "Family dynamics observed",
      "Interventions used",
      "Progress toward goals",
      "Risk & Safety",
      "Areas needing attention & recommendations",
    ]);
  });

  it("keeps individual section headings unchanged", () => {
    expect(noteSections(config, "INDIVIDUAL").map((section) => section.title)).toEqual([
      "Presenting Focus / Client Report",
      "Clinical Assessment / Observations",
      "Therapeutic Focus & Interventions",
      "Client Response & Progress",
      "Risk & Safety",
      "Plan",
    ]);
  });

  it("uses family-only example answers instead of the individual sample", () => {
    const answers = exampleAnswers("FAMILY");
    expect(answers).toHaveProperty("family_issues");
    expect(answers).not.toHaveProperty("q1");
    expect(answers.family_issues).toContain("The family discussed");
  });

  it("removes individual-only subheadings from family drafts without changing signed notes", () => {
    const text =
      "Client report:\n- A family issue.\n\nClinician observation / assessment:\n- A family interaction.";
    const familyDraft = { session: { session_type: "FAMILY" }, status: "DRAFT" } as const;
    const signedFamilyNote = { ...familyDraft, status: "SIGNED" } as const;

    expect(familyDraftDisplayText(familyDraft, text)).toBe(
      "- A family issue.\n\n- A family interaction.",
    );
    expect(familyDraftDisplayText(signedFamilyNote, text)).toBe(text);
  });
});
