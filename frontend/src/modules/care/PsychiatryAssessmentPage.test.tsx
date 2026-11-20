import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PsychiatryWorkspace } from "../../lib/carePathwayApi";
import { PsychiatryAssessmentPage } from "./PsychiatryAssessmentPage";

const apiMocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  sign: vi.fn(),
  getSchema: vi.fn(),
  listIntakes: vi.fn(),
  getSchedule: vi.fn(),
  schedule: vi.fn(),
  getCatalogue: vi.fn(),
  getPlanWorkspace: vi.fn(),
  decidePlan: vi.fn(),
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/carePathwayApi", () => ({
  ApiError: class ApiError extends Error {},
  openPsychiatryAssessment: apiMocks.open,
  savePsychiatryAssessment: apiMocks.save,
  signPsychiatryAssessment: apiMocks.sign,
  getIntakeSchema: apiMocks.getSchema,
  listIntakeAssessments: apiMocks.listIntakes,
  getPsychiatryPlanSchedule: apiMocks.getSchedule,
  schedulePsychiatrySession: apiMocks.schedule,
  getCarePlanCatalogue: apiMocks.getCatalogue,
  getPlanWorkspace: apiMocks.getPlanWorkspace,
  decidePlanAction: apiMocks.decidePlan,
}));

vi.mock("./shared/useClientBanner", () => ({
  useClientBanner: () => ({ banner: null, error: null }),
}));

vi.mock("./shared/useValueSets", () => ({
  useValueSets: () => ({
    ready: true,
    error: null,
    options: (id: string) =>
      id === "intake-risk-actions"
        ? [{ code: "SAFETY_PLAN_TRIGGERED", display: "Safety plan triggered" }]
        : [],
    label: (_id: string, code: string) => code,
  }),
}));

vi.mock("./record/IntakeDiagnosisTab", () => ({
  IntakeDiagnosisTab: () => null,
}));

vi.mock("./record/intake/MseSection", () => ({
  MseSection: () => null,
}));

vi.mock("./psychiatry/MedicationPanel", () => ({
  PsychiatryMedicationPanel: () => <div data-testid="psychiatry-medication">Medication</div>,
}));

const workspace: PsychiatryWorkspace = {
  patient_id: "patient-77",
  encounter_id: "encounter-77",
  episode_id: "episode-77",
  assessment: null,
  carried_forward_presenting_concern: null,
  mse: {},
  history: [],
  review: null,
  completed: null,
  withdrawal_review: null,
  review_outcomes: [],
};

// Each test drives the full page through several tabs; under the parallel suite run that
// outlasts vitest's 5 s default, so the file gets a CI-safe limit.
describe("PsychiatryAssessmentPage risk assessment", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.open.mockResolvedValue(workspace);
    apiMocks.save.mockResolvedValue(workspace);
    apiMocks.listIntakes.mockResolvedValue({
      results: [
        {
          id: "intake-1",
          status: "SIGNED",
          version: 3,
          sections: {
            meds: {
              none: false,
              reconciled: true,
              unavailable: false,
              non_adherence: "Stopped due to nausea",
            },
          },
        },
      ],
    });
    apiMocks.getSchedule.mockResolvedValue({
      plan: {
        id: "plan-1",
        goals: "Continue psychiatric review.",
        confirmed: false,
        activities: [
          {
            id: "activity-1",
            action_key: "psych_review",
            title: "Psychiatric review",
            goal: "Review progress",
            module: "PSYCHIATRY",
            status: "PLANNED",
            status_display: "Planned",
            available_to_psychiatry: true,
          },
          {
            id: "activity-2",
            action_key: "therapy",
            title: "Therapy",
            goal: "",
            module: "THERAPY",
            status: "PLANNED",
            status_display: "Planned",
            available_to_psychiatry: false,
          },
          {
            id: "activity-3",
            action_key: "outpatient",
            title: "Existing review",
            goal: "",
            module: "PSYCHIATRY",
            status: "ACTIVE",
            status_display: "Active",
            available_to_psychiatry: true,
          },
        ],
      },
      scheduled_sessions: [],
    });
    apiMocks.getCatalogue.mockResolvedValue({
      results: [
        {
          key: "psych_review",
          name: "Psychiatric review",
          low: false,
          roles: ["psychiatrist"],
          tasks: ["Refer to on-call psychiatry or book a slot"],
        },
        {
          key: "therapy",
          name: "Psychological therapy",
          low: true,
          roles: ["therapist"],
          tasks: ["Refer to therapy service"],
        },
      ],
    });
    apiMocks.getPlanWorkspace.mockResolvedValue({ actions: [], recommendations: [] });
    apiMocks.getSchema.mockResolvedValue({
      sections: [
        {
          key: "risk",
          n: "3",
          title: "Immediate & clinical risk",
          core: true,
          required: true,
          kind: "risk",
          fields: [
            { key: "other", label: "Other acute risk", type: "text", full: true },
            {
              key: "details",
              label: "Immediate actions already taken",
              type: "textarea",
              rows: 2,
              full: true,
            },
            {
              key: "actions",
              label: "Actions",
              type: "multi",
              valueset: "intake-risk-actions",
            },
            { key: "static", label: "Static factors", type: "textarea" },
            { key: "dynamic", label: "Dynamic factors", type: "textarea" },
            { key: "protective", label: "Protective factors", type: "textarea" },
            {
              key: "change_72h",
              label: "What could change in the next 24–72 hours?",
              type: "textarea",
            },
            { key: "summary", label: "Formulation", type: "textarea", full: true },
            { key: "plan", label: "Risk management plan", type: "textarea", full: true },
            { key: "review_by", label: "Review by", type: "date" },
            {
              key: "concern_level",
              label: "Level of concern (optional — does not set priority)",
              type: "select",
              valueset: "intake-concern-level",
            },
          ],
        },
      ],
      riskRows: [
        {
          key: "suicide",
          label: "Suicide / self-harm",
          options: [
            "None identified",
            "Thoughts",
            "Intent",
            "Plan",
            "Access to means",
            "Recent attempt/self-harm",
            "Past history",
          ],
          none: ["None identified"],
          active: ["Thoughts", "Intent"],
        },
        {
          key: "violence",
          label: "Harm to others / violence",
          options: ["None identified", "Thoughts", "Threats"],
          none: ["None identified"],
          active: ["Thoughts", "Threats"],
        },
        {
          key: "safeguarding",
          label: "Safeguarding",
          options: ["None identified", "Abuse", "Neglect"],
          none: ["None identified"],
          active: ["Abuse", "Neglect"],
        },
        {
          key: "neglect",
          label: "Self-neglect/vulnerability",
          options: ["None", "Difficulty with self-care"],
          none: ["None"],
          active: ["Difficulty with self-care"],
        },
        {
          key: "absconding",
          label: "Absconding/Leave care risk",
          options: ["None", "Possible", "Significant"],
          none: ["None"],
          active: ["Possible", "Significant"],
        },
        {
          key: "medical",
          label: "Falls / medical safety",
          options: ["None", "Concern identified"],
          none: ["None"],
          active: ["Concern identified"],
          single: true,
        },
      ],
    });
  });

  it("keeps risk checkboxes clickable and saves the selections for this client", async () => {
    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Clinical Risk Assessment")).toBeInTheDocument();
    expect(screen.getByText("Self-neglect/vulnerability")).toBeInTheDocument();
    expect(screen.getByText("Absconding/Leave care risk")).toBeInTheDocument();
    expect(screen.getByText("Other acute risk")).toBeInTheDocument();
    expect(screen.getByText("Immediate actions already taken")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Tools" })).not.toBeInTheDocument();
    expect(screen.queryByText("Structured risk formulation")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft — unsigned")).not.toBeInTheDocument();
    expect(screen.queryByText("Static factors")).not.toBeInTheDocument();
    expect(screen.queryByText("Dynamic factors")).not.toBeInTheDocument();
    expect(screen.queryByText("Protective factors")).not.toBeInTheDocument();
    expect(screen.queryByText("Risk management plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Review by")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Level of concern (optional — does not set priority)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Sign risk formulation")).not.toBeInTheDocument();
    expect(screen.queryByText("Formulation")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan (needed to sign)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Safety plan triggered" }));
    const thoughts = (await screen.findAllByRole("checkbox", { name: "Thoughts" }))[0];
    fireEvent.click(thoughts);
    expect(thoughts).toBeChecked();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "None identified" })[0]);
    expect(thoughts).not.toBeChecked();
    fireEvent.click(thoughts);
    expect(thoughts).toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: "Medication" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMocks.save).toHaveBeenCalledOnce());
    expect(apiMocks.save).toHaveBeenCalledWith(
      "test-token",
      "patient-77",
      expect.objectContaining({
        structured: expect.objectContaining({
          risk: expect.objectContaining({
            rows: expect.objectContaining({ suicide: ["Thoughts"] }),
            actions: ["SAFETY_PLAN_TRIGGERED"],
          }),
        }),
      }),
    );
  });

  it("prefills a new assessment with the signed triage presenting concern", async () => {
    apiMocks.open.mockResolvedValue({
      ...workspace,
      carried_forward_presenting_concern: {
        text: "Low mood and poor sleep reported at triage.",
        source: "triage",
      },
    });

    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByDisplayValue("Low mood and poor sleep reported at triage."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Carried forward from signed triage. Review or update as needed."),
    ).toBeInTheDocument();
  });

  it("preserves an existing draft presenting concern instead of replacing it", async () => {
    apiMocks.open.mockResolvedValue({
      ...workspace,
      assessment: {
        id: "assessment-1",
        status: "DRAFT",
        format: "STRUCTURED",
        free_text: "",
        structured: { presenting_concern: "Existing psychiatry draft concern." },
        text: "Existing psychiatry draft concern.",
        author: "Clinician",
        created_at: "2026-11-12T00:00:00Z",
        updated_at: "2026-11-12T00:00:00Z",
        signed_at: null,
        can_edit: true,
      },
      carried_forward_presenting_concern: {
        text: "Newer concern from triage.",
        source: "triage",
      },
    });

    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByDisplayValue("Existing psychiatry draft concern."),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Newer concern from triage.")).not.toBeInTheDocument();
  });

  it("saves formulation and differential alongside coded diagnoses", async () => {
    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Formulation & diagnosis" }));
    fireEvent.change(screen.getByLabelText("Integrated clinical summary / formulation"), {
      target: { value: "Integrated clinical summary." },
    });
    fireEvent.change(screen.getByLabelText("Differential diagnoses / conditions to rule out"), {
      target: { value: "Consider a substance-related condition." },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Medication" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMocks.save).toHaveBeenCalledOnce());
    expect(apiMocks.save).toHaveBeenCalledWith(
      "test-token",
      "patient-77",
      expect.objectContaining({
        structured: expect.objectContaining({
          form: {
            summary: "Integrated clinical summary.",
            differential: "Consider a substance-related condition.",
          },
        }),
      }),
    );
  });

  it("ends every draft tab in one save bar with Save; Sign only on Plan & Schedule", async () => {
    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole("tab", { name: "Assessment" });
    for (const tab of ["Assessment", "MSE", "Formulation & diagnosis", "Medication"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Sign assessment" })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "MSE" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiMocks.save).toHaveBeenCalledOnce());
    expect(screen.getByRole("tab", { name: "MSE" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Plan & Schedule" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign assessment" })).toBeInTheDocument();
  });

  it("confirms a care plan with a note and schedules the next psychiatric review session", async () => {
    apiMocks.decidePlan.mockResolvedValue({
      actions: [
        {
          key: "psych_review",
          decision: "ACCEPTED",
          note: {
            id: "note-1",
            text: "Client agrees to weekly review; prefers mornings.",
            author: "Dr A. Banda",
            at: "2026-11-12T08:04:00Z",
          },
        },
      ],
      recommendations: [],
    });
    apiMocks.schedule.mockResolvedValue({
      plan: {
        id: "plan-1",
        goals: "Continue psychiatric review.",
        confirmed: true,
        activities: [
          {
            id: "activity-1",
            action_key: "psych_review",
            title: "Psychiatric review",
            goal: "Review progress",
            module: "PSYCHIATRY",
            status: "PLANNED",
            status_display: "Planned",
            available_to_psychiatry: true,
          },
        ],
      },
      scheduled_sessions: [
        {
          id: "appointment-1",
          care_plan_activity_id: "activity-1",
          activity_title: "Psychiatric review",
          scheduled_for: "2030-02-03T10:00:00Z",
          duration_minutes: 45,
          mode: "VIDEO",
          status: "SCHEDULED",
          notes: "Call first",
          provider_name: "Clinician",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Plan & Schedule" }));
    const planSelect = await screen.findByLabelText("Care plan");
    expect(planSelect).toHaveTextContent("Psychiatric review — Not selected");
    expect(planSelect).toHaveTextContent("Psychological therapy — Not selected");
    fireEvent.change(planSelect, { target: { value: "psych_review" } });
    fireEvent.change(await screen.findByLabelText(/Note for the record/), {
      target: { value: "Client agrees to weekly review; prefers mornings." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm for this client" }));

    await waitFor(() =>
      expect(apiMocks.decidePlan).toHaveBeenCalledWith("test-token", "patient-77", "psych_review", {
        decision: "ACCEPTED",
        note: "Client agrees to weekly review; prefers mornings.",
      }),
    );
    expect(
      await screen.findByText("Client agrees to weekly review; prefers mornings."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Schedule next session" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date and time"), {
      target: { value: "2030-02-03T13:00" },
    });
    fireEvent.change(screen.getByLabelText("Brief scheduling note (optional)"), {
      target: { value: "Call first" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule next session" }));

    await waitFor(() => expect(apiMocks.schedule).toHaveBeenCalledOnce());
    expect(apiMocks.schedule).toHaveBeenCalledWith(
      "test-token",
      "patient-77",
      expect.objectContaining({
        care_plan_activity: "activity-1",
        duration_minutes: 30,
        mode: "IN_PERSON",
        notes: "Call first",
      }),
    );
    expect(await screen.findByText("Next psychiatry session scheduled.")).toBeInTheDocument();
    expect(screen.getByText("Call first", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule next session" })).not.toBeInTheDocument();
  });

  it("confirms a non-psychiatric care plan without offering scheduling", async () => {
    apiMocks.decidePlan.mockResolvedValue({
      actions: [{ key: "therapy", decision: "ACCEPTED" }],
      recommendations: [],
    });

    render(
      <MemoryRouter initialEntries={["/care/clients/patient-77/psychiatry"]}>
        <Routes>
          <Route
            path="/care/clients/:patientId/psychiatry"
            element={<PsychiatryAssessmentPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Plan & Schedule" }));
    const planSelect = await screen.findByLabelText("Care plan");
    fireEvent.change(planSelect, { target: { value: "therapy" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm for this client" }));

    await waitFor(() =>
      expect(apiMocks.decidePlan).toHaveBeenCalledWith("test-token", "patient-77", "therapy", {
        decision: "ACCEPTED",
      }),
    );
    expect(
      await screen.findByText(/Psychological therapy.*now appears in Interventions/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule next session" })).not.toBeInTheDocument();
  });
});
