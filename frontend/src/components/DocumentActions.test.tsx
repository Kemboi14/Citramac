import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiDownload } from "../lib/apiClient";
import { DocumentActions } from "./DocumentActions";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

vi.mock("../lib/apiClient", () => ({
  ApiError: class ApiError extends Error {},
  apiDownload: vi.fn(() => Promise.resolve(new Blob(["<html></html>"]))),
}));

describe("DocumentActions", () => {
  beforeEach(() => {
    vi.mocked(apiDownload).mockClear();
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
  });

  it("downloads the server PDF with the document's file name", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <DocumentActions
        path="/documents/generated/abc/print/"
        filename="DOC-1-v1"
        label="Sick note"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download Sick note as PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(apiDownload).toHaveBeenCalledWith(
      "/documents/generated/abc/print/?output=pdf",
      "test-token",
    );
    click.mockRestore();
  });

  it("opens the preview in a dialog with print and download", async () => {
    render(
      <DocumentActions
        path="/documents/generated/abc/print/"
        filename="DOC-1-v1"
        label="Sick note"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview Sick note" }));
    const dialog = await screen.findByRole("dialog", { name: "Preview: Sick note" });
    expect(apiDownload).toHaveBeenCalledWith("/documents/generated/abc/print/", "test-token");
    expect(dialog.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-modals",
    );
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
