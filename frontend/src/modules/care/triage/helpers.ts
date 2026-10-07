import { ApiError } from "../../../lib/apiClient";

// Shared by the registration and triage screens (docs/15-CLINICAL-WORKSPACE-V3.md §1.4–§1.7).

/** Mockup `.fieldgrid` — 2 columns, 1 under 560px. */
export const FIELDGRID = "grid grid-cols-1 gap-x-4 gap-y-3 min-[561px]:grid-cols-2";

/** Mockup `.required-mark`. */
export const REQUIRED_MARK = "text-priority-red";

/**
 * Readable text for a failed call. A hand-raised DRF ValidationError arrives as
 * per-field messages (`{"detail": …}`, `{"full_name": …}`); show the server's own
 * words rather than "detail: …". Anything that is not an ApiError never reached
 * the server's validation — report it as a connection problem, never silently.
 */
export function errorText(
  err: unknown,
  offline: string,
  fieldLabels: Record<string, string> = {},
): string {
  if (!(err instanceof ApiError)) return offline;
  const fields = err.fields;
  if (!fields) return err.message;
  const labels = new Map(Object.entries(fieldLabels));
  const parts: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (field === "missing") continue;
    const messages = Array.isArray(value) ? value.map(String) : [String(value)];
    const label = labels.get(field);
    for (const message of messages) parts.push(label ? `${label}: ${message}` : message);
  }
  return parts.join(" ") || err.message;
}

/** True when the request never got an HTTP answer (offline, DNS, CORS…). */
export function isNetworkFailure(err: unknown) {
  return !(err instanceof ApiError);
}
