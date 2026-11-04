import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientBanner, TriageEncounterDetail } from "../../../lib/carePathwayApi";
import { TriageStage } from "./TriageStage";
import { useRecordData } from "./useRecordData";

vi.mock("./useRecordData", () => ({ useRecordData: vi.fn() }));
vi.mock("../triage/TriageFormV5", () => ({
  TriageFormV5: ({ detail, embedded }: { detail: TriageEncounterDetail; embedded: boolean }) => (
    <div data-testid="embedded-v5-triage">
      {detail.id}:{embedded ? "embedded" : "standalone"}
    </div>
  ),
}));
vi.mock("../triage/TriageFormV4", () => ({
  TriageFormV4: () => <div data-testid="embedded-v4-triage" />,
}));
vi.mock("../triage/TriageForm", () => ({
  TriageForm: () => <div data-testid="embedded-v3-triage" />,
}));
vi.mock("../triage/QuickRecheck", () => ({
  QuickRecheck: () => <div data-testid="embedded-recheck" />,
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
  episode_id: "episode-1",
  latest_triage_encounter_id: "triage-1",
  latest_signed_triage_encounter_id: "triage-1",
  psychiatry_encounter_id: null,
};

const encounter: TriageEncounterDetail = {
  id: "triage-1",
  patient_id: "patient-1",
  episode_id: "episode-1",
  status: "IN_TRIAGE",
  status_label: "In triage",
  visit_number: 1,
  arrival_at: "2026-11-04T08:00:00Z",
  due_at: "2026-11-04T08:10:00Z",
  wait_minutes: 0,
  presenting_concern: "Low mood and poor sleep",
  referral_source: "Walk-in",
  priority: "ORANGE",
  triage_version: 1,
  last_triaged_at: null,
  last_triaged_by: "",
  next_recheck_at: null,
  triage_started_at: "2026-11-04T08:02:00Z",
  clinician: "Nurse Jane",
  tenant_location: "Main clinic",
  defaults: {},
  schema: "v5",
  draft: null,
  signed: null,
  evaluation: {
    rules_version: "2026-10-28.1",
    priority: "ORANGE",
    ready: true,
    recommendation: "",
    summary_priority: "ORANGE",
    reasons: "",
    alerts: [],
    findings: [],
    triggers: [],
    unanswered: [],
    unresolved: [],
  },
  tasks: [],
  recheck_draft: null,
  rechecks: [],
};

const mockedUseRecordData = vi.mocked(useRecordData<TriageEncounterDetail>);

describe("TriageStage", () => {
  beforeEach(() => {
    mockedUseRecordData.mockReturnValue({
      data: encounter,
      error: null,
      loading: false,
    });
  });

  it("renders the existing capture form embedded for the latest encounter", () => {
    render(
      <MemoryRouter>
        <TriageStage patientId="patient-1" banner={banner} onRecordChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("embedded-v5-triage")).toHaveTextContent("triage-1:embedded");
    expect(mockedUseRecordData.mock.calls.at(-1)?.[0]).toBe("triage-1");
  });

  it("does not create an encounter when none exists", () => {
    mockedUseRecordData.mockReturnValue({
      data: null,
      error: null,
      loading: false,
    });
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
    expect(screen.queryByTestId("embedded-v5-triage")).not.toBeInTheDocument();
  });
});
