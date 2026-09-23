/**
 * Thin fetch wrapper for the API contract in docs/10-API-SPECIFICATION.md.
 * `credentials: "include"` on every call so the httpOnly refresh_token
 * cookie (docs/05-AUTHENTICATION-FLOW.md §5.3) round-trips in dev, where the
 * frontend (5173) and backend (8000) are different origins.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

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

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      // FormData sets its own multipart Content-Type (with boundary) —
      // forcing application/json here would corrupt the upload.
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const body: ApiErrorBody = data?.error
      ? (data as ApiErrorBody)
      : (parseValidationErrorBody(data) ?? {
          error: { code: "UNKNOWN_ERROR", message: response.statusText || "Request failed" },
        });
    const error = new ApiError(response.status, body);

    if (options.accessToken && SESSION_INVALIDATING_CODES.has(error.code)) {
      sessionInvalidatedHandler?.(error.message);
    }
    throw error;
  }

  return data as T;
}
