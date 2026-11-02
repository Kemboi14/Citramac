import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, setSessionInvalidatedHandler } from "./apiClient";

afterEach(() => {
  setSessionInvalidatedHandler(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apiRequest", () => {
  it("reports an actionable error when the API returns HTML instead of JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!DOCTYPE html><html></html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(apiRequest("/platform/organizations/")).rejects.toMatchObject({
      name: "Error",
      code: "INVALID_API_RESPONSE",
      status: 404,
      message: expect.stringContaining("reverse proxy"),
    });
  });

  it("directs server errors to backend logs instead of blaming the proxy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!DOCTYPE html><html></html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(apiRequest("/platform/email-settings/")).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      status: 500,
      message: expect.stringContaining("backend logs"),
    });
  });

  it("returns successful JSON responses", async () => {
    const body = { id: "org-1", name: "Example" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));

    await expect(apiRequest("/platform/organizations/")).resolves.toEqual(body);
  });

  it("keeps structured API errors as ApiError instances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: { code: "VALIDATION_ERROR", message: "Invalid name", fields: { name: ["Invalid"] } } },
          { status: 400 },
        ),
      ),
    );

    const request = apiRequest("/platform/organizations/", { method: "POST", body: {} });
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      fields: { name: ["Invalid"] },
    });
  });

  it("signs out with a clear message when an access token is no longer valid", async () => {
    const onSessionInvalidated = vi.fn();
    setSessionInvalidatedHandler(onSessionInvalidated);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "TOKEN_NOT_VALID",
              message: "Given token not valid for any token type",
            },
          },
          { status: 401 },
        ),
      ),
    );

    await expect(
      apiRequest("/care/dashboard/", { accessToken: "expired-access-token" }),
    ).rejects.toMatchObject({
      code: "TOKEN_NOT_VALID",
      message: "Given token not valid for any token type",
    });

    expect(onSessionInvalidated).toHaveBeenCalledWith(
      "Your session has expired! Please sign in again",
    );
  });

  it("fails with a clear timeout error when a timed request never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));

    const request = apiRequest("/platform/email-settings/", { timeoutMs: 30_000 });
    const assertion = expect(request).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 0,
      message: expect.stringContaining("did not respond in time"),
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
