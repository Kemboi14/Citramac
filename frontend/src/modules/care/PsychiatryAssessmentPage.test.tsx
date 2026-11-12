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

vi.mock("./record/intake/MedsSection", () => ({
  MedsSection: ({ source }: { source: string }) => (
    <div data-testid="psychiatry-medication-history">{source} medication history</div>
  ),
}));

vi.mock("./record/modules/PrescribingModule", () => ({
  PrescribingModule: () => <div data-testid="psychiatry-medication-orders">Medication orders</div>,
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
};

describe("PsychiatryAssessmentPage risk assessment", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

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
  }, 10_000);

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
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

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

  it("uses the shared intake medication history in psychiatry", async () => {
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

    fireEvent.click(await screen.findByRole("tab", { name: "Medication" }));

    expect(await screen.findByText("Medication orders & History")).toBeInTheDocument();
    expect(await screen.findByTestId("psychiatry-medication-orders")).toBeInTheDocument();
    expect(await screen.findByTestId("psychiatry-medication-history")).toHaveTextContent(
      "Psychiatry medication history",
    );
    expect(await screen.findByTestId("psychiatry-intake-medication-summary")).toHaveTextContent(
      "Medication reconciliation completed",
    );
    expect(screen.getByText("Stopped due to nausea")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open / update in Intake" })).toHaveAttribute(
      "href",
      "/clinical/clients/patient-77/intake",
    );
  });
});
