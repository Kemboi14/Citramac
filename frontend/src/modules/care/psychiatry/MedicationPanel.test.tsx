import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrescribingState } from "../../../lib/carePathwayApi";
import { PsychiatryMedicationPanel } from "./MedicationPanel";

const api = vi.hoisted(() => ({
  getPrescribing: vi.fn(),
  cosignPrescription: vi.fn(),
  decideCosign: vi.fn(),
}));

vi.mock("../../../auth/useAuth", () => ({ useAuth: () => ({ accessToken: "t" }) }));
vi.mock("../../../lib/carePathwayApi", () => api);
vi.mock("../record/modules/PrescribingModule", () => ({
  PrescribingModule: () => <div>Order form</div>,
}));
vi.mock("../record/intake/MedsSection", () => ({ MedsSection: () => <div>History</div> }));

const base = {
  drug_code: "D",
  route: "Oral",
  frequency: "",
  controlled_drug: false,
  findings: [],
  allergy_override_reason: "",
  cosigned_by: "",
  cosigned_at: null,
  authorised_by: "",
};

const state: PrescribingState = {
  allergy_status: "NKDA",
  allergy_text: "",
  locked: false,
  can_prescribe: true,
  is_senior: true,
  frequencies: [],
  prescribers: [],
  orders: [
    {
      ...base,
      id: "prn-1",
      drug: "Lorazepam",
      dose: "1 mg",
      is_prn: true,
      prn_max_per_24h: 2,
      indication: "Acute agitation",
      prescribed_by: "Nurse Wanjiru",
      prescribed_at: "2026-11-16T08:00:00Z",
      order_type: "PRN",
      confirmation: { state: "AWAITING", request_id: "req-1" },
      can_confirm: true,
    },
    {
      ...base,
      id: "rx-1",
      drug: "Olanzapine",
      dose: "10 mg",
      frequency: "Nocte",
      is_prn: false,
      prn_max_per_24h: null,
      indication: "",
      prescribed_by: "Dr Otieno",
      prescribed_at: "2026-11-15T08:00:00Z",
      order_type: "PRESCRIPTION",
      confirmation: { state: "" },
      can_confirm: false,
    },
  ],
  prn_given: [
    {
      id: "dose-1",
      order: "prn-0",
      drug: "Haloperidol",
      dose: "5 mg",
      route: "IM",
      given_at: "2026-11-15T22:10:00Z",
      given_by: "Nurse Achieng",
      reason: "Aggressive, not responding to de-escalation",
      effect: "",
      effect_recorded_at: null,
      over_max_reason: "",
    },
  ],
};

describe("PsychiatryMedicationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPrescribing.mockResolvedValue(state);
  });

  it("lists orders awaiting approval apart from the client's orders and PRN doses given", async () => {
    render(<PsychiatryMedicationPanel patientId="p1" />);
    const awaiting = (await screen.findByText("Awaiting approval")).closest("section")!;
    expect(within(awaiting).getByText("Lorazepam")).toBeInTheDocument();
    expect(within(awaiting).getByText(/placed by Nurse Wanjiru/)).toBeInTheDocument();
    const orders = screen.getByText("Medication orders").closest("section")!;
    expect(within(orders).getByText("Olanzapine")).toBeInTheDocument();
    expect(within(orders).queryByText("Lorazepam")).not.toBeInTheDocument();
    const prn = screen.getByText("PRN given — last 14 days").closest("section")!;
    expect(within(prn).getByText("Haloperidol")).toBeInTheDocument();
    expect(within(prn).getByText(/not responding to de-escalation/)).toBeInTheDocument();
    expect(within(prn).getByText("Not yet recorded")).toBeInTheDocument();
  });

  it("approves an order", async () => {
    api.cosignPrescription.mockResolvedValue({ ...state, orders: [state.orders[1]] });
    render(<PsychiatryMedicationPanel patientId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.cosignPrescription).toHaveBeenCalledWith("t", "prn-1"));
    expect(await screen.findByText("No orders are waiting for approval.")).toBeInTheDocument();
  });

  it("declines an order only with a reason", async () => {
    api.decideCosign.mockResolvedValue({});
    render(<PsychiatryMedicationPanel patientId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const confirm = screen.getByRole("button", { name: "Decline order" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for declining/), {
      target: { value: "Use the regular dose" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.decideCosign).toHaveBeenCalledWith(
        "t",
        "req-1",
        "DECLINE",
        "Use the regular dose",
      ),
    );
    expect(api.getPrescribing).toHaveBeenCalledTimes(2);
  });
});
