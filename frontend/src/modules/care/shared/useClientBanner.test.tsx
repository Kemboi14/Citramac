import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientBanner } from "../../../lib/carePathwayApi";
import { BANNER_POLL_MS, notifyClientChanged, useClientBanner } from "./useClientBanner";

vi.mock("../../../auth/useAuth", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

const getClientBanner = vi.fn();
const getClientBannerVersion = vi.fn();
vi.mock("../../../lib/carePathwayApi", () => ({
  getClientBanner: (...args: unknown[]) => getClientBanner(...args),
  getClientBannerVersion: (...args: unknown[]) => getClientBannerVersion(...args),
}));

const banner = (clinician: string) => ({ patient_id: "p1", clinician }) as unknown as ClientBanner;

describe("useClientBanner", () => {
  beforeEach(() => {
    getClientBanner.mockReset();
    getClientBannerVersion.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reloads when the server's banner version changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getClientBanner.mockResolvedValueOnce(banner("Unassigned"));
    getClientBanner.mockResolvedValueOnce(banner("Peter Kiprono"));
    getClientBannerVersion.mockResolvedValueOnce({ version: "a" });
    getClientBannerVersion.mockResolvedValue({ version: "b" });

    const { result } = renderHook(() => useClientBanner("p1"));
    await waitFor(() => expect(result.current.banner?.clinician).toBe("Unassigned"));
    await waitFor(() => expect(getClientBannerVersion).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(BANNER_POLL_MS);
    });
    await waitFor(() => expect(result.current.banner?.clinician).toBe("Peter Kiprono"));
    expect(getClientBanner).toHaveBeenCalledTimes(2);
  });

  it("reloads when a save elsewhere on the page announces the client changed", async () => {
    getClientBanner.mockResolvedValue(banner("Unassigned"));
    getClientBannerVersion.mockResolvedValue({ version: "a" });
    const { result } = renderHook(() => useClientBanner("p1"));
    await waitFor(() => expect(result.current.banner).not.toBeNull());

    act(() => notifyClientChanged("someone-else"));
    act(() => notifyClientChanged("p1"));
    await waitFor(() => expect(getClientBanner).toHaveBeenCalledTimes(2));
    // Once, not again from this tab's own BroadcastChannel echo.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getClientBanner).toHaveBeenCalledTimes(2);
  });

  it("reloads when another tab announces the client changed", async () => {
    getClientBanner.mockResolvedValue(banner("Unassigned"));
    getClientBannerVersion.mockResolvedValue({ version: "a" });
    const { result } = renderHook(() => useClientBanner("p1"));
    await waitFor(() => expect(result.current.banner).not.toBeNull());

    const otherTab = new BroadcastChannel("citramac-client-banner");
    otherTab.postMessage({ patientId: "p1", tab: "another-tab" });
    otherTab.close();
    await waitFor(() => expect(getClientBanner).toHaveBeenCalledTimes(2));
  });

  it("keeps the banner shown when a background refresh fails", async () => {
    getClientBanner.mockResolvedValueOnce(banner("Unassigned"));
    getClientBanner.mockRejectedValueOnce(new Error("offline"));
    getClientBannerVersion.mockResolvedValue({ version: "a" });
    const { result } = renderHook(() => useClientBanner("p1"));
    await waitFor(() => expect(result.current.banner).not.toBeNull());

    act(() => notifyClientChanged("p1"));
    await waitFor(() => expect(getClientBanner).toHaveBeenCalledTimes(2));
    expect(result.current.banner?.clinician).toBe("Unassigned");
    expect(result.current.error).toBeNull();
  });
});
