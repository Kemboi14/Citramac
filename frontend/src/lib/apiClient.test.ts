import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  SESSION_EXPIRED_MESSAGE,
  apiRequest,
  setSessionInvalidatedHandler,
  setTokenRefresher,
} from "./apiClient";

afterEach(() => {
  setSessionInvalidatedHandler(null);
  setTokenRefresher(null, null);
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
      // Written for staff; the status stays in the text for support.
      message: expect.stringContaining("(error 404)"),
    });
  });

  it("reports a server error in plain words without blaming the connection", async () => {
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
      message: expect.stringContaining("server is having a problem right now (error 500)"),
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
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid name",
                fields: { name: ["Invalid"] },
              },
            },
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

  it("signs out with a clear message when an expired session can't be renewed", async () => {
    // An expired access token is first renewed (apiClient.session.test.ts);
    // only when the session itself has ended is the user signed out, and
    // never with the token library's own wording.
    const onExpired = vi.fn();
    setTokenRefresher(async () => "expired", onExpired);
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
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED", message: SESSION_EXPIRED_MESSAGE });
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("fails with a clear timeout error when a timed request never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );

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
