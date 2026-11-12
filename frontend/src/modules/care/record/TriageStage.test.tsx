import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ClientBanner } from "../../../lib/carePathwayApi";
import { TriageStage } from "./TriageStage";

vi.mock("../TriageEncounterPage", () => ({
  TriageEncounterScreen: ({ triageId }: { triageId: string }) => (
    <div data-testid="triage-screen">{triageId}</div>
  ),
}));

const banner: ClientBanner = {
  patient_id: "patient-1",
  name: "Amina Kamau",
  preferred_name: "",
  identity_status: "IDENTIFIED",
  identity_label: "",
  identity_description: "",
  citramac_number: "202610ORG-001",
  mrn: "",
  age: 34,
  sex: "FEMALE",
  date_of_birth: "1992-03-14",
  payer: "",
  phone: "",
  next_of_kin: "",
  referral_source: "",
  allergy: { state: "unknown", items: [] },
  setting: { type: "OUTPATIENT", ward: null, bed: null, status: "" },
  priority: "ORANGE",
  alerts: [],
  clinician: "",
  team: "",
  clinician_role: "",
  care_team: [],
  open_tasks: 0,
  episode_id: "episode-1",
  latest_triage_encounter_id: "triage-1",
  latest_signed_triage_encounter_id: "triage-1",
  psychiatry_encounter_id: null,
};

describe("TriageStage", () => {
  it("shows the dashboard's triage screen for the latest encounter", () => {
    render(
      <MemoryRouter>
        <TriageStage patientId="patient-1" banner={banner} onRecordChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("triage-screen")).toHaveTextContent("triage-1");
  });

  it("does not create an encounter when none exists", () => {
    const noTriageBanner = {
      ...banner,
      latest_triage_encounter_id: null,
      latest_signed_triage_encounter_id: null,
    };

    render(
      <MemoryRouter>
        <TriageStage patientId="patient-1" banner={noTriageBanner} onRecordChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/No triage encounter has been recorded/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to registration" })).toHaveAttribute(
      "href",
      "/clinical/registration",
    );
    expect(screen.queryByTestId("triage-screen")).not.toBeInTheDocument();
  });
});
