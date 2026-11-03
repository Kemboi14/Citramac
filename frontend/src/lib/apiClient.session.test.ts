import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  apiRequest,
  setTokenRefresher,
} from "./apiClient";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
const tokenExpired = () =>
  json(401, {
    error: { code: "TOKEN_NOT_VALID", message: "Given token not valid for any token type" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenRefresher(null, null);
});

describe("expired access token", () => {
  it("gets a fresh token and re-sends the request once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenExpired())
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setTokenRefresher(async () => ({ access: "fresh" }), vi.fn());

    await expect(apiRequest("/x/", { accessToken: "old" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("ends the session in plain words when it can't be renewed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenExpired()));
    const onExpired = vi.fn();
    setTokenRefresher(async () => "expired", onExpired);

    const error = await apiRequest<never>("/x/", { accessToken: "old" }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("SESSION_EXPIRED");
    expect(error.message).toBe(SESSION_EXPIRED_MESSAGE);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("never signs out when the refresh couldn't reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenExpired()));
    const onExpired = vi.fn();
    setTokenRefresher(async () => "unavailable", onExpired);

    const error = await apiRequest<never>("/x/", { accessToken: "old" }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error.code).toBe("NETWORK_ERROR");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("does not loop when the fresh token is refused too", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => tokenExpired());
    vi.stubGlobal("fetch", fetchMock);
    const onExpired = vi.fn();
    setTokenRefresher(async () => ({ access: "fresh" }), onExpired);

    const error = await apiRequest<never>("/x/", { accessToken: "old" }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error.code).toBe("SESSION_EXPIRED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("leaves a 401 on an unauthenticated call (e.g. a wrong password) alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(json(401, { error: { code: "INVALID_CREDENTIALS", message: "Wrong" } })),
    );
    const refresher = vi.fn();
    setTokenRefresher(refresher, vi.fn());
    const error = await apiRequest<never>("/auth/login/", { method: "POST", body: {} }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(refresher).not.toHaveBeenCalled();
  });
});

describe("no connection", () => {
  it("says so instead of 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await apiRequest<never>("/x/", { accessToken: "t" }).catch(
      (e: unknown) => e as ApiError,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});
