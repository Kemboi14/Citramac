import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalTooltips, Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderTip = () =>
    render(
      <Tooltip label="Kanban">
        <button type="button">View</button>
      </Tooltip>,
    );

  it("shows on hover and hides when the pointer leaves", () => {
    renderTip();
    const button = screen.getByRole("button", { name: "View" });
    fireEvent.mouseEnter(button);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Kanban");
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows on keyboard focus, describes the trigger and closes on Escape", () => {
    renderTip();
    const button = screen.getByRole("button", { name: "View" });
    fireEvent.focus(button);
    act(() => vi.advanceTimersByTime(200));
    const tip = screen.getByRole("tooltip");
    expect(button).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("turns a plain title into the same tooltip, app-wide", () => {
    render(
      <>
        <button type="button" title="Expand">
          <svg aria-hidden />
        </button>
        <GlobalTooltips />
      </>,
    );
    const button = screen.getByRole("button");
    fireEvent.mouseOver(button);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Expand");
    // The browser's own box is suppressed; the icon button keeps its name.
    expect(button).not.toHaveAttribute("title");
    expect(button).toHaveAccessibleName("Expand");
    expect(button).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    fireEvent.mouseOut(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("leaves a disabled control with the browser's tooltip", () => {
    render(
      <>
        <button type="button" disabled title="Add a branch first">
          Add
        </button>
        <GlobalTooltips />
      </>,
    );
    const button = screen.getByRole("button", { name: "Add" });
    fireEvent.mouseOver(button);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Add a branch first");
  });
});
