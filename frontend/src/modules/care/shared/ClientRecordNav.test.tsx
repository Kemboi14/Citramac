import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ClientRecordNav } from "./ClientRecordNav";

describe("ClientRecordNav", () => {
  it("shows persisted journey status with the active stage clearly identified", () => {
    render(
      <MemoryRouter initialEntries={["/clinical/clients/patient-1/care-plan"]}>
        <ClientRecordNav
          patientId="patient-1"
          view="care-plan"
          banner={{
            latest_signed_triage_encounter_id: "triage-1",
            journey_status: {
              triage: "complete",
              intake: "complete",
              "care-plan": "in_progress",
              interventions: "incomplete",
              outcomes: "incomplete",
              billing: "incomplete",
              "follow-up": "incomplete",
            },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Triage — Complete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Intake — Complete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Care Plan — In progress" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("link", { name: "Interventions — Incomplete" })).toBeInTheDocument();
    // The status key is hidden until asked for.
    expect(screen.queryByLabelText("Journey stage status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Status key" }));
    expect(screen.getByLabelText("Journey stage status")).toBeInTheDocument();
  });
});
