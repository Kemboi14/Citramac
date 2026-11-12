import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionInbox } from "./DecisionInbox";

const api = vi.hoisted(() => ({
  getDecisionInbox: vi.fn(),
  startPsychiatricReviewRequest: vi.fn(),
  completePsychiatricReviewRequest: vi.fn(),
  acknowledgeCosign: vi.fn(),
  decideCosign: vi.fn(),
}));

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/carePathwayApi", () => api);

vi.mock("./shared/useValueSets", () => ({
  useValueSets: () => ({
    ready: true,
    error: null,
    options: (id: string) =>
      id === "psychiatric-review-outcome"
        ? [{ code: "managed_here", display: "Reviewed — managed here" }]
        : [],
  }),
}));

const request = {
  id: "review-task-1",
  patient_id: "patient-1",
  patient_name: "Amina Kamau",
  kind: "PSYCHIATRIC_REVIEW",
  what: "Psychiatric review requested",
  status: "INITIATED",
  requested_by: "Jane Njoroge",
  requested_at: "2026-11-12T09:00:00Z",
  decided_by: "",
  decided_at: null,
  decline_reason: "",
  thread: [],
  inbox_kind: "psychiatric_review",
  sbar: "SITUATION\nUrgent assessment requested.",
  priority: "urgent",
  assignee: null,
  outcome: "",
  outcome_label: "",
  outcome_note: "",
};

describe("DecisionInbox psychiatric reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDecisionInbox.mockResolvedValueOnce({ results: [request] }).mockResolvedValue({
      results: [{ ...request, status: "PENDING", assignee: "psychiatrist-1" }],
    });
    api.startPsychiatricReviewRequest.mockResolvedValue({ ...request, status: "PENDING" });
    api.completePsychiatricReviewRequest.mockResolvedValue({
      ...request,
      status: "COMPLETED",
      outcome: "managed_here",
    });
  });

  it("shows the SBAR and starts, then completes the review with a served outcome", async () => {
    render(
      <MemoryRouter>
        <DecisionInbox />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Psychiatric review requested")).toBeInTheDocument();
    expect(screen.getByText("Psychiatric review")).toBeInTheDocument();
    fireEvent.click(screen.getByText("View SBAR handover"));
    expect(screen.getByText(/SITUATION\s+Urgent assessment requested\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    await waitFor(() =>
      expect(api.startPsychiatricReviewRequest).toHaveBeenCalledWith("test-token", "review-task-1"),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /complete review/i })).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: /complete review/i }));
    fireEvent.change(screen.getByRole("combobox", { name: "Psychiatric review outcome" }), {
      target: { value: "managed_here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete review" }));

    await waitFor(() =>
      expect(api.completePsychiatricReviewRequest).toHaveBeenCalledWith(
        "test-token",
        "review-task-1",
        "managed_here",
        "",
      ),
    );
  });
});
