import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeSupervisionRequest,
  getSupervisionRequest,
  scheduleSupervisionRequest,
  type SupervisionRequest,
} from "../../lib/mhpExtrasApi";
import { SupervisionRequestDetailPage } from "./SupervisionRequestDetailPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/mhpExtrasApi", () => ({
  completeSupervisionRequest: vi.fn(),
  getSupervisionRequest: vi.fn(),
  scheduleSupervisionRequest: vi.fn(),
}));

const request: SupervisionRequest = {
  id: "request-1",
  patient: "patient-1",
  patient_name: "Jane Client",
  requested_by: "user-1",
  requested_by_name: "Grace Wanjiru",
  supervisor: "user-2",
  supervisor_name: "Samuel Kiptoo",
  topic: "Working with a disclosure",
  notes: "I noticed I moved too quickly past the disclosure.",
  status: "SCHEDULED",
  requested_at: "2026-11-12T09:30:00Z",
  scheduled_for: "2026-12-01T09:00:00Z",
  completed_at: null,
};

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={["/clinical/mhp/supervision/request-1"]}>
      <Routes>
        <Route path="/clinical/mhp/supervision/:id" element={<SupervisionRequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSupervisionRequest).mockResolvedValue(request);
});

describe("SupervisionRequestDetailPage", () => {
  it("shows all details and the full self-assessment", async () => {
    renderDetail();

    expect(await screen.findByText("Jane Client", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Grace Wanjiru")).toBeInTheDocument();
    expect(screen.getByText("Samuel Kiptoo")).toBeInTheDocument();
    expect(screen.getByText("Self-assessment and reflection")).toBeInTheDocument();
    expect(screen.getByText(/I moved too quickly past the disclosure/)).toBeInTheDocument();
    expect(screen.getByText("Back to queue")).toBeInTheDocument();
  });

  it("schedules an open request", async () => {
    const openReq = {
      ...request,
      status: "OPEN" as const,
      supervisor: null,
      supervisor_name: "",
      scheduled_for: null,
    };
    vi.mocked(getSupervisionRequest).mockResolvedValue(openReq);
    vi.mocked(scheduleSupervisionRequest).mockResolvedValue({ ...openReq, status: "SCHEDULED" });

    renderDetail();

    await screen.findByText("Back to queue");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));

    await waitFor(() =>
      expect(scheduleSupervisionRequest).toHaveBeenCalledWith(
        "test-token",
        "request-1",
        new Date("2026-12-01T09:00").toISOString(),
      ),
    );
  });

  it("completes a scheduled request with notes", async () => {
    vi.mocked(completeSupervisionRequest).mockResolvedValue({ ...request, status: "COMPLETED" });

    renderDetail();

    await screen.findByText("Back to queue");
    fireEvent.change(screen.getByLabelText("Completion notes (optional)"), {
      target: { value: "Agreed fortnightly check-ins." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));

    await waitFor(() =>
      expect(completeSupervisionRequest).toHaveBeenCalledWith(
        "test-token",
        "request-1",
        "Agreed fortnightly check-ins.",
      ),
    );
  });
});
