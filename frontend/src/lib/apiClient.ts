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

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
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
          ? options.body
          : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    if (data?.error) {
      throw new ApiError(response.status, data as ApiErrorBody);
    }
    throw new ApiError(response.status, {
      error: { code: "UNKNOWN_ERROR", message: response.statusText || "Request failed" },
    });
  }

  return data as T;
}
