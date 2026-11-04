import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PatientContext } from "../../clinical/patientContextObject";
import type { PatientContextValue } from "../../clinical/patientContextObject";
import { LimsPage } from "./LimsPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../../lib/limsApi", () => ({
  collectSpecimen: vi.fn(),
  createLabOrder: vi.fn(),
  listLabResults: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  recordLabResult: vi.fn(),
  searchLoinc: vi.fn(),
  validateLabResult: vi.fn(),
}));

function TestPatientProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<PatientContextValue["selected"]>({
    patientId: "patient-1",
    patientName: "Jane Client",
    encounterId: "encounter-1",
  });
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

describe("LimsPage", () => {
  it("opens as a standalone workbench without the client safety banner", async () => {
    render(
      <TestPatientProvider>
        <LimsPage />
      </TestPatientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Laboratory workbench" })).toBeInTheDocument();
    expect(screen.getByText("Jane Client")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "QC validation queue" })).toBeInTheDocument();
    expect(screen.queryByText(/allergies and alerts will stay on screen/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change client" }));
    expect(await screen.findByRole("heading", { name: "Choose a client" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Search for the client whose encounter should be linked to the new laboratory order.",
      ),
    ).toBeInTheDocument();
  });
});
