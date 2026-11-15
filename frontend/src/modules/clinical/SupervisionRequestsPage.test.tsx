import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PatientContext } from "../../clinical/patientContextObject";
import type { PatientContextValue } from "../../clinical/patientContextObject";
import {
  createSupervisionRequest,
  listSupervisionRequests,
  type SupervisionRequest,
} from "../../lib/mhpExtrasApi";
import { SupervisionRequestsPage } from "./SupervisionRequestsPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/mhpExtrasApi", () => ({
  completeSupervisionRequest: vi.fn(),
  createSupervisionRequest: vi.fn(),
  getSupervisionRequest: vi.fn(),
  listSupervisionRequests: vi.fn(),
  scheduleSupervisionRequest: vi.fn(),
}));

const scheduledRequest: SupervisionRequest = {
  id: "request-1",
  patient: "patient-1",
  patient_name: "Jane Client",
  requested_by: "user-1",
  requested_by_name: "Grace Wanjiru",
  supervisor: "user-2",
  supervisor_name: "Samuel Kiptoo",
  topic: "Working with a disclosure",
  notes: "Reflection recorded with the signed individual note for 12/11/2026.",
  status: "SCHEDULED",
  requested_at: "2026-11-12T09:30:00Z",
  scheduled_for: "2026-12-01T09:00:00Z",
  completed_at: null,
};

const openRequest: SupervisionRequest = {
  ...scheduledRequest,
  id: "request-open",
  supervisor: null,
  supervisor_name: "",
  topic: "Therapist self-assessment — session 12/11/2026",
  notes: "I noticed I moved too quickly past the disclosure.",
  status: "OPEN",
  scheduled_for: null,
};

function TestPatientProvider({
  children,
  withClient = true,
}: {
  children: ReactNode;
  withClient?: boolean;
}) {
  const [selected, setSelected] = useState<PatientContextValue["selected"]>(
    withClient ? { patientId: "patient-1", patientName: "Jane Client", encounterId: null } : null,
  );
  const value: PatientContextValue = {
    selected,
    selectPatient: (patientId, patientName) =>
      setSelected({ patientId, patientName, encounterId: null }),
    setEncounter: (encounterId) =>
      setSelected((current) => (current ? { ...current, encounterId } : null)),
    clear: () => setSelected(null),
  };

  return <PatientContext.Provider value={value}>{children}</PatientContext.Provider>;
}

const renderPage = (withClient = true) =>
  render(
    <MemoryRouter>
      <TestPatientProvider withClient={withClient}>
        <SupervisionRequestsPage />
      </TestPatientProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SupervisionRequestsPage", () => {
  it("lists requests cleanly and shows the scheduled session with the client", async () => {
    vi.mocked(listSupervisionRequests).mockResolvedValue({ count: 1, results: [scheduledRequest] });

    renderPage();

    expect(await screen.findByText(/Jane Client/)).toBeInTheDocument();
    expect(screen.getByText("Scheduled", { selector: "span" })).toBeInTheDocument();
    // The auto-generated psychotherapy topic is not list furniture.
    expect(screen.queryByText("Working with a disclosure")).not.toBeInTheDocument();
    // The row opens the detail page.
    expect(
      screen.getByRole("row", { name: /Open supervision request for Jane Client/ }),
    ).toBeInTheDocument();
  });

  it("shows the supervision queue without asking for a client first", async () => {
    vi.mocked(listSupervisionRequests).mockResolvedValue({ count: 1, results: [scheduledRequest] });

    renderPage(false);

    expect(
      await screen.findByRole("row", { name: /Open supervision request for Jane Client/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose a client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request Supervision" })).not.toBeInTheDocument();
  });

  it("hides the psychotherapy self-assessment record label from the list", async () => {
    vi.mocked(listSupervisionRequests).mockResolvedValue({ count: 1, results: [openRequest] });

    renderPage();

    expect(
      await screen.findByRole("row", { name: /Open supervision request for Jane Client/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Therapist self-assessment/)).not.toBeInTheDocument();
  });

  it("lists the request the clinician raises from this page", async () => {
    vi.mocked(listSupervisionRequests)
      .mockResolvedValueOnce({ count: 0, results: [] })
      .mockResolvedValue({ count: 1, results: [scheduledRequest] });
    vi.mocked(createSupervisionRequest).mockResolvedValue(scheduledRequest);

    renderPage();
    expect(await screen.findByText("No supervision requests yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Topic"), {
      target: { value: "Working with a disclosure" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Supervision" }));

    expect(
      await screen.findByRole("row", { name: /Open supervision request for Jane Client/ }),
    ).toBeInTheDocument();
    expect(createSupervisionRequest).toHaveBeenCalledWith(
      "test-token",
      "patient-1",
      "Working with a disclosure",
    );
  });
});
