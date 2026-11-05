import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MyTasks } from "./MyTasks";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

const TASKS = Array.from({ length: 23 }, (_, i) => ({
  key: `task-${i}`,
  category: "Care plan",
  text: `Task number ${i + 1}`,
  overdue: i < 3,
  due_at: null,
  patient_id: `patient-${i}`,
  patient: `Client ${i + 1}`,
}));

vi.mock("../../lib/carePathwayApi", () => ({
  getMyTasks: vi.fn(() => Promise.resolve({ results: TASKS })),
}));

function renderTasks() {
  return render(
    <MemoryRouter>
      <MyTasks />
    </MemoryRouter>,
  );
}

describe("MyTasks", () => {
  it("starts hidden with a count, and the button shows the tasks", async () => {
    renderTasks();
    expect(await screen.findByText(/23 tasks outstanding, 3 overdue/)).toBeInTheDocument();
    expect(screen.queryByText("Task number 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show my tasks/i }));
    expect(screen.getByText("Task number 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByText("Task number 1")).not.toBeInTheDocument();
  });

  it("shows ten tasks a page with previous and next", async () => {
    renderTasks();
    fireEvent.click(await screen.findByRole("button", { name: /show my tasks/i }));

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Task number 10")).toBeInTheDocument();
    expect(screen.queryByText("Task number 11")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Task number 11")).toBeInTheDocument();
    expect(screen.queryByText("Task number 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("21–23 of 23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
