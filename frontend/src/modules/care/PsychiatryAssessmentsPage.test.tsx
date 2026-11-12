import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PsychiatryCandidate } from "../../lib/carePathwayApi";
import { PsychiatryAssessmentsPage } from "./PsychiatryAssessmentsPage";

const apiMocks = vi.hoisted(() => ({
  candidates: vi.fn(),
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/carePathwayApi", () => ({
  getPsychiatryCandidates: apiMocks.candidates,
  PRIORITY_LABEL: { RED: "Emergency", ORANGE: "Urgent", YELLOW: "Soon", GREEN: "Routine" },
}));

const scheduled: PsychiatryCandidate = {
  patient_id: "patient-1",
  name: "K. Phiri",
  citramac_number: "CIT-0987",
  mrn: "MRN-1",
  age: 27,
  sex: "FEMALE",
  priority: "ORANGE",
  episode_id: "episode-1",
  presenting_concern: "Low mood",
  last_triaged_at: "2026-11-10T08:00:00Z",
  intake_complete: true,
  intake_signed_at: "2026-11-10T09:00:00Z",
  suggested: false,
  suggested_reason: "Psychiatric assessment signed",
  review: null,
  assessment_id: "note-1",
  assessment_status: "SIGNED",
  assessment_format: "STRUCTURED",
  assessment_updated_at: "2026-11-11T09:00:00Z",
  assessment_signed_at: "2026-11-11T09:00:00Z",
  next_scheduled_session: {
    id: "appointment-1",
    scheduled_for: "2026-11-12T14:30:00Z",
    appointment_type: "Psychiatric review",
    status: "SCHEDULED",
    mode: "IN_PERSON",
    duration_minutes: 30,
    provider_name: "Dr A. Banda",
    due_state: "TODAY",
    days_until: 0,
  },
  alerts: [],
};

const notScheduled: PsychiatryCandidate = {
  ...scheduled,
  patient_id: "patient-2",
  name: "T. Banda",
  citramac_number: "CIT-1103",
  mrn: "MRN-2",
  intake_complete: false,
  intake_signed_at: null,
  assessment_id: null,
  assessment_status: "",
  assessment_format: "",
  assessment_updated_at: null,
  assessment_signed_at: null,
  suggested: true,
  suggested_reason: "Intake complete — psychiatric assessment pending",
  next_scheduled_session: null,
};

describe("PsychiatryAssessmentsPage sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.candidates.mockResolvedValue({ results: [scheduled, notScheduled] });
  });

  it("shows the next session and a due banner, and filters to booked sessions", async () => {
    render(
      <MemoryRouter>
        <PsychiatryAssessmentsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/1 due today/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Sessions \(1\)/ }));

    expect(screen.getByText("K. Phiri")).toBeInTheDocument();
    expect(screen.getByText(/Today/)).toBeInTheDocument();
    expect(screen.queryByText("T. Banda")).not.toBeInTheDocument();
  });
});
