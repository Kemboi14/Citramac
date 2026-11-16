import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ClientReport } from "../../lib/carePathwayApi";
import { ClientReportPage } from "./ClientReportPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

const triage = (id: string, on: string, priority: "RED" | "GREEN") => ({
  id,
  assessment_id: `a-${id}`,
  answers: [
    { title: "Safety screen", rows: [{ label: "Thoughts of ending life", value: `Answer ${on}` }] },
  ],
  rules_version: "2026-10-29.1",
  arrival_on: on,
  status: "Triaged",
  presenting_concern: `Concern at ${on}`,
  priority,
  priority_label: priority === "RED" ? "Red" : "Green",
  signed: true,
  signed_on: on,
  signed_by: "Nurse Jane",
  recommendation: "",
  recommendation_reasons: "",
  final_priority: "",
  override_reason: "",
  findings: [],
  alerts: [],
  rechecks: [],
});

const session = (id: string, title: string, note: string, restricted = "") => ({
  id,
  kind: "session" as const,
  on: "02 Nov 2026 10:00",
  provider: "Alice Mwangi",
  title,
  note,
  response: "",
  outcome: "",
  next_action: "",
  details: [],
  restricted,
});

const REPORT: ClientReport = {
  reference: "CLR-ABC123",
  generated_on: "16 Nov 2026 12:00",
  generated_by: "Dr Otieno",
  client: {
    id: "p1",
    name: "Amina Kamau",
    preferred_name: "",
    citramac_number: "202611ORG-001",
    age: 34,
    sex: "Female",
    date_of_birth: "14 Mar 1992",
    identity_label: "Identified",
  },
  registration: {
    registered_on: "01 Nov 2026",
    setting_label: "Outpatient",
    phone: "+254700100200",
  },
  episode: null,
  clinical: {
    priority: "RED",
    priority_label: "Red",
    clinician: "",
    team: "",
    diagnoses: [
      {
        code: "6A70.1",
        label: "Single episode depressive disorder, moderate",
        kind: "Primary",
        status: "Active",
        certainty: "Confirmed",
        noted_on: "03 Nov 2026",
      },
    ],
    allergies: [{ substance: "Penicillin", reaction: "Rash", severity: "", verified: "" }],
    medicines: [],
    alerts: [{ code: "SUICIDE_RISK", label: "Suicide risk", raised_on: "01 Nov 2026" }],
  },
  care_plan: null,
  triages: [triage("t1", "01 Nov 2026", "GREEN"), triage("t2", "10 Nov 2026", "RED")],
  intakes: [],
  mse: null,
  admissions: [],
  interventions: [
    {
      id: "psychotherapy",
      title: "Psychotherapy sessions",
      module: "Psychotherapy",
      status_label: "",
      goal: "",
      instructions: "",
      note: null,
      records: [
        session("s1", "Individual Psychotherapy", "Charted early prodromes."),
        session("s2", "Family Therapy", "", "Withheld — care team only."),
      ],
    },
  ],
  group_sessions: [],
  outcomes: {
    summary: [
      {
        instrument: "PHQ9",
        name: "PHQ-9",
        max: 27,
        series: [
          { score: 12, on: "01 Nov 2026" },
          { score: 18, on: "10 Nov 2026" },
        ],
        baseline: 12,
        baseline_on: "01 Nov 2026",
        latest: 18,
        latest_on: "10 Nov 2026",
        band: "Moderately severe",
        change: "Worse by 6",
        direction: "bad",
      },
    ],
    episode_outcome: null,
  },
  discharges: [],
  follow_ups: [],
  billing: {
    payer: "Cash",
    totals: { services: "KES 3,000.00", paid: "KES 1,000.00", outstanding: "KES 2,000.00" },
    services: [{ on: "01 Nov 2026", service: "Triage", status: "Partial", amount: "KES 3,000.00" }],
    invoice: null,
    payments: [
      {
        on: "02 Nov 2026",
        amount: "KES 1,000.00",
        method: "Cash",
        reference: "R1",
        received_by: "Cashier",
      },
    ],
    claims: [],
  },
  activity: [
    {
      at: "2026-11-10T09:00:00Z",
      on: "10 Nov 2026 12:00",
      kind: "Risk",
      title: "Risk finding accepted",
      detail: "",
    },
  ],
  appointments: [],
  notes: [],
};

vi.mock("../../lib/carePathwayApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/carePathwayApi")>()),
  getClientReport: vi.fn(() => Promise.resolve(REPORT)),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/clients/p1/report"]}>
      <Routes>
        <Route path="/clients/:patientId/report" element={<ClientReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ClientReportPage", () => {
  it("shows the patient card, overview and safety panel", async () => {
    renderPage();
    expect(await screen.findByText("Amina Kamau", { selector: "dd" })).toBeInTheDocument();
    expect(
      screen.getByText("6A70.1 · Single episode depressive disorder, moderate"),
    ).toBeInTheDocument();
    expect(screen.getByText("Suicide risk")).toBeInTheDocument();
    expect(screen.getByText("Penicillin")).toBeInTheDocument();
  });

  it("lists every triage latest first and opens one into its detail", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Triage/ }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("10 Nov 2026");
    expect(rows[1]).toHaveTextContent("01 Nov 2026");
    fireEvent.click(rows[0]);
    expect(screen.getByRole("heading", { name: "Triage 2" })).toBeInTheDocument();
    expect(screen.getByText("Answer 10 Nov 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Preview/ }).length).toBeGreaterThan(1);
  });

  it("filters interventions and marks withheld content", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Interventions/ }));
    fireEvent.click(screen.getByRole("row", { name: /Individual Psychotherapy/ }));
    expect(screen.getByText("Charted early prodromes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Family & couple/ }));
    fireEvent.click(screen.getByRole("row", { name: /Family Therapy/ }));
    expect(screen.getByText("Withheld — care team only.")).toBeInTheDocument();
  });

  it("shows outcome scores with their change", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Outcomes/ }));
    expect(screen.getByText(/18 \/ 27/)).toBeInTheDocument();
    expect(screen.getByText("Worse by 6")).toBeInTheDocument();
  });

  it("shows billing figures and the activity log", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Billing/ }));
    expect(screen.getAllByText("KES 2,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("R1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Activity log/ }));
    expect(screen.getByText("Risk finding accepted")).toBeInTheDocument();
  });
});
