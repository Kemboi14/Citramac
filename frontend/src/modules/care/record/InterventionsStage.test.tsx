import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InterventionsStage } from "./InterventionsStage";

const apiMocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  records: vi.fn(),
}));

vi.mock("../../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../../lib/carePathwayApi", () => ({
  getInterventionWorkspace: apiMocks.workspace,
  listInterventions: apiMocks.records,
  ApiError: class ApiError extends Error {},
}));

const carePlanWorkspace = (
  note: { id: string; text: string; author: string; at: string } | null = null,
) => ({
  has_plan: true,
  plan_signed: false,
  actions: [
    {
      id: "action-1",
      title: "Psychiatric review",
      goal: "Review progress",
      modules: ["PSYCHIATRY"],
      status: "PLANNED",
      status_display: "Planned",
      priority: "",
      instructions: "",
      decision_display: "Accepted",
      why: "",
      due_at: null,
      overdue: false,
      records: 0,
      latest_by: "",
      latest_at: null,
      note,
    },
  ],
  scheduled_sessions: [],
  modules: [],
  context: {
    client: "",
    diagnoses: [],
    allergies: "",
    risk: "",
    risk_change_72h: "",
    alerts: [],
    medicines: [],
    goals: [],
  },
});

describe("InterventionsStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.workspace.mockResolvedValue(carePlanWorkspace());
    apiMocks.records.mockResolvedValue({ results: [] });
  });

  it("lists accepted care-plan actions before the plan is signed", async () => {
    render(
      <MemoryRouter>
        <InterventionsStage
          patientId="patient-77"
          banner={{} as never}
          onRecordChanged={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Psychiatric review")).toBeInTheDocument();
    expect(screen.getByText(/not signed yet/i)).toBeInTheDocument();
  });

  it("shows the note logged when the action was confirmed", async () => {
    apiMocks.workspace.mockResolvedValue(
      carePlanWorkspace({
        id: "note-1",
        text: "Client agrees to weekly review; prefers mornings.",
        author: "Dr A. Banda",
        at: "2026-11-12T08:04:00Z",
      }),
    );
    render(
      <MemoryRouter>
        <InterventionsStage
          patientId="patient-77"
          banner={{} as never}
          onRecordChanged={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Client agrees to weekly review; prefers mornings."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Care-plan note/)).toBeInTheDocument();
  });
});
