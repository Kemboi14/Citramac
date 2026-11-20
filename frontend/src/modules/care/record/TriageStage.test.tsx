import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ClientBanner } from "../../../lib/carePathwayApi";
import { TriageStage } from "./TriageStage";

const listClientTriages = vi.fn();
const startNewTriage = vi.fn();

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: "token" }) }));
vi.mock("../../../lib/carePathwayApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/carePathwayApi")>()),
  listClientTriages: (...args: unknown[]) => listClientTriages(...args),
  startNewTriage: (...args: unknown[]) => startNewTriage(...args),
}));

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
  it("starts a new triage straight away, without registration", async () => {
    listClientTriages.mockResolvedValue({ results: [] });
    render(
      <MemoryRouter>
        <TriageStage patientId="patient-1" banner={banner} onRecordChanged={vi.fn()} />
      </MemoryRouter>,
    );

    startNewTriage.mockResolvedValue({ id: "triage-9" });
    fireEvent.click(await screen.findByRole("button", { name: "New triage" }));
    expect(await screen.findByTestId("triage-screen")).toHaveTextContent("triage-9");
    expect(startNewTriage.mock.calls[0][1]).toBe("patient-1");
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

  it("lists several triages newest first and opens the one chosen", async () => {
    const row = {
      status: "COMPLETED",
      status_label: "Completed",
      presenting_concern: "Low mood",
      priority: "ORANGE",
      signed_at: "2026-11-19T10:00:00Z",
      signed_by: "Dr A",
      rechecks: 0,
      in_progress: false,
    };
    listClientTriages.mockResolvedValue({
      results: [
        { ...row, id: "triage-2", arrival_at: "2026-11-19T09:00:00Z", versions: 2 },
        { ...row, id: "triage-1", arrival_at: "2026-11-01T09:00:00Z", versions: 1 },
      ],
    });
    render(
      <MemoryRouter>
        <TriageStage patientId="patient-1" banner={banner} onRecordChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/version 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]);
    expect(screen.getByTestId("triage-screen")).toHaveTextContent("triage-1");
    fireEvent.click(screen.getByRole("button", { name: "← All triages" }));
    expect(screen.getByText(/version 2 of 2/)).toBeInTheDocument();
  });
});
