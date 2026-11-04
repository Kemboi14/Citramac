import { describe, expect, it } from "vitest";
import { clientRecordPath, JOURNEY_KEYS, JOURNEY_STAGES } from "./recordRoutes";

describe("client care journey stages", () => {
  it("places triage immediately before intake", () => {
    expect(JOURNEY_STAGES.map((stage) => stage.key)).toEqual([
      "snapshot",
      "triage",
      "intake",
      "care-plan",
      "interventions",
      "outcomes",
      "billing",
      "follow-up",
    ]);
    expect(JOURNEY_KEYS.has("triage")).toBe(true);
    expect(clientRecordPath("patient-1")).toBe("/clinical/clients/patient-1/triage");
  });
});
