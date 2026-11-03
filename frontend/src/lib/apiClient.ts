/**
 * Thin fetch wrapper for the API contract in docs/10-API-SPECIFICATION.md.
 * `credentials: "include"` on every call so the httpOnly refresh_token
 * cookie (docs/05-AUTHENTICATION-FLOW.md §5.3) round-trips in dev, where the
 * frontend (5173) and backend (8000) are different origins.
 */

import { workingBranchHeader } from "./workingBranch";

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://localhost:8000/api/v1" : "/api/v1");

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.code = body.error.code;
    this.status = status;
    this.fields = body.error.fields;
  }
}

// Error codes that mean "this session is no longer valid, not just this one
// request" — backend/apps/accounts/authentication.py raises these on every
// authenticated call once the token holder's account/org/branch/department
// is deactivated, closing the gap between that happening and the access
// token's own ~15-minute expiry. Only meaningful on an authenticated call
// (a bare login attempt failing with one of these is handled inline by the
// login form itself, not by force-logging-out a session that never existed).
const SESSION_INVALIDATING_CODES = new Set([
  "ORGANIZATION_SUSPENDED",
  "BRANCH_INACTIVE",
  "DEPARTMENT_INACTIVE",
  "USER_INACTIVE",
  "ACCESS_WINDOW_CLOSED",
]);

type SessionInvalidatedHandler = (message: string) => void;
let sessionInvalidatedHandler: SessionInvalidatedHandler | null = null;

/** Registered once by AuthContext so a mid-session deactivation can force a
 * logout + explain why, however deep in the app the request happened. */
export function setSessionInvalidatedHandler(handler: SessionInvalidatedHandler | null) {
  sessionInvalidatedHandler = handler;
}

/**
 * What AuthContext's refresher reports back: a fresh access token, "expired"
 * (the session itself has ended — the refresh cookie is gone, expired, or the
 * user has been inactive past the organisation's session timeout), or
 * "unavailable" (the network or server couldn't be reached, which must never
 * sign a clinician out — they may be working offline).
 */
export type TokenRefreshResult = { access: string } | "expired" | "unavailable";
type TokenRefresher = () => Promise<TokenRefreshResult>;
let tokenRefresher: TokenRefresher | null = null;
type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

/**
 * Registered once by AuthContext. An authenticated call that comes back 401
 * (the short-lived access token ran out) asks for one fresh token and is
 * re-sent once with it; a 401 means the server rejected the request before
 * acting on it, so re-sending is safe even for a POST. When the session
 * itself has ended, `onExpired` sends the user to sign in again with a plain
 * explanation instead of the token library's own wording ("Given token not
 * valid for any token type").
 */
export function setTokenRefresher(
  refresher: TokenRefresher | null,
  onExpired: SessionExpiredHandler | null,
) {
  tokenRefresher = refresher;
  sessionExpiredHandler = onExpired;
}

export const SESSION_EXPIRED_MESSAGE = "Your session has ended. Please sign in again to carry on.";
export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Check your internet connection and try again.";

function networkError(): ApiError {
  return new ApiError(0, { error: { code: "NETWORK_ERROR", message: NETWORK_ERROR_MESSAGE } });
}

function sessionExpiredError(): ApiError {
  return new ApiError(401, {
    error: { code: "SESSION_EXPIRED", message: SESSION_EXPIRED_MESSAGE },
  });
}

/** fetch() rejects with a bare TypeError ("Failed to fetch") when the
 * request never reached the server — reworded so no screen shows that. An
 * abort (our own timeout) is left alone; the timeout race reports it. */
async function fetchOrNetworkError(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw networkError();
  }
}

/**
 * A 401 on a call that carried a token: get a fresh one and hand it back for
 * a single retry, or end the session. Deactivation codes are not a timeout
 * and keep their own handling (SESSION_INVALIDATING_CODES).
 */
async function recoverFromUnauthorized(): Promise<string> {
  if (!tokenRefresher) throw sessionExpiredError();
  const result = await tokenRefresher();
  if (result === "unavailable") throw networkError();
  if (result === "expired") {
    sessionExpiredHandler?.();
    throw sessionExpiredError();
  }
  return result.access;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
  timeoutMs?: number;
}

/**
 * A `serializer.is_valid(raise_exception=True)` failure (missing/invalid
 * required field on create/update — org, branch, department, staff, ...)
 * isn't reshaped by the backend's exception handler (config/exceptions.py
 * deliberately leaves it as DRF's raw per-field shape, e.g.
 * `{"name": ["This field is required."]}` or a bare
 * `{"organization": "..."}` from a hand-raised ValidationError — see that
 * file's docstring for why). Without this, such a response has no `.error`
 * key, so it fell through to a content-free "Request failed"/statusText
 * message — the user had no way to tell *which* field was the problem, even
 * though the backend already knew and said so. This turns that raw shape
 * into a readable message (and keeps the original per-field detail in
 * `.fields` for a form that wants to highlight the specific input).
 */
function parseValidationErrorBody(data: unknown): ApiErrorBody | null {
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    return { error: { code: "VALIDATION_ERROR", message: data.map(String).join(" ") } };
  }
  if (!data || typeof data !== "object") return null;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return null;

  const fields: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const [field, value] of entries) {
    const messages = Array.isArray(value) ? value.map(String) : [String(value)];
    fields[field] = messages;
    const label = field === "non_field_errors" ? null : field.replace(/_/g, " ");
    for (const message of messages) {
      parts.push(label ? `${label}: ${message}` : message);
    }
  }
  if (parts.length === 0) return null;
  return { error: { code: "VALIDATION_ERROR", message: parts.join(" "), fields } };
}

async function performApiRequest<T>(
  path: string,
  options: RequestOptions,
  signal?: AbortSignal,
  isRetry = false,
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const response = await fetchOrNetworkError(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      // FormData sets its own multipart Content-Type (with boundary) —
      // forcing application/json here would corrupt the upload.
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.accessToken ? workingBranchHeader() : {}),
    },
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    signal,
  });

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A proxy or gateway page instead of the API's JSON (a 502 while the
      // server restarts, a captive portal, ...). The status stays in the
      // message so support can tell these apart; the wording is for staff.
      const message =
        response.status >= 500
          ? `The server is having a problem right now (error ${response.status}). ` +
            "Wait a moment and try again; if it keeps happening, contact your system administrator."
          : `The server sent back something we didn't expect (error ${response.status}). ` +
            "Try again; if it keeps happening, contact your system administrator.";
      throw new ApiError(response.status, {
        error: {
          code: "INVALID_API_RESPONSE",
          message,
        },
      });
    }
  }

  if (!response.ok) {
    const body: ApiErrorBody =
      data && typeof data === "object" && "error" in data
        ? (data as ApiErrorBody)
        : (parseValidationErrorBody(data) ?? {
            error: { code: "UNKNOWN_ERROR", message: response.statusText || "Request failed" },
          });
    const error = new ApiError(response.status, body);

    if (options.accessToken && SESSION_INVALIDATING_CODES.has(error.code)) {
      sessionInvalidatedHandler?.(error.message);
    } else if (options.accessToken && response.status === 401) {
      if (isRetry) {
        // A brand-new token was rejected too — the session can't continue.
        sessionExpiredHandler?.();
        throw sessionExpiredError();
      }
      const fresh = await recoverFromUnauthorized();
      return performApiRequest<T>(path, { ...options, accessToken: fresh }, signal, true);
    }
    throw error;
  }

  return data as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!options.timeoutMs) return performApiRequest<T>(path, options);

  const controller = new AbortController();
  let timeoutId = 0;
  const timeoutError = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(
        new ApiError(0, {
          error: {
            code: "REQUEST_TIMEOUT",
            message: "The server did not respond in time. Check your connection and try again.",
          },
        }),
      );
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([
      performApiRequest<T>(path, options, controller.signal),
      timeoutError,
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/** Authenticated file download (e.g. compliance evidence) — never a public
 * media URL. Returns the file as a Blob held in memory only. */
export async function apiDownload(
  path: string,
  accessToken: string,
  isRetry = false,
): Promise<Blob> {
  const response = await fetchOrNetworkError(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}`, ...workingBranchHeader() },
  });
  if (response.status === 401) {
    if (isRetry) {
      sessionExpiredHandler?.();
      throw sessionExpiredError();
    }
    return apiDownload(path, await recoverFromUnauthorized(), true);
  }
  if (!response.ok) {
    let body: ApiErrorBody = {
      error: { code: "DOWNLOAD_FAILED", message: "The file could not be downloaded." },
    };
    try {
      const data = await response.json();
      if (data?.error) body = data as ApiErrorBody;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiError(response.status, body);
  }
  return response.blob();
}
