import { ApiError } from "./apiClient";

/**
 * Per-field messages from a failed request, keyed by the API's field name
 * (nested names like `medications.0.action` are kept as sent). Empty when the
 * failure is not a field-level validation error, so the caller falls back to
 * showing `err.message` once at the top of the form.
 */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.fields) return {};
  const entries: [string, string][] = [];
  const collect = (field: string, value: unknown) => {
    if (Array.isArray(value)) {
      if (value.every((item) => item === null || typeof item !== "object")) {
        const message = value.map(String).join(" ");
        if (message) entries.push([field, message]);
        return;
      }
      value.forEach((item, index) => collect(`${field}.${index}`, item));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, nested]) =>
        collect(field ? `${field}.${key}` : key, nested),
      );
      return;
    }
    if (value !== undefined && value !== null && String(value)) {
      entries.push([field, String(value)]);
    }
  };

  Object.entries(err.fields).forEach(([field, value]) => collect(field, value));
  return Object.fromEntries(entries);
}

/** The message to show above a form: the whole message unless every part is shown inline. */
export function formErrorSummary(err: unknown, fallback: string, shownInline: string[] = []) {
  if (!(err instanceof ApiError)) return fallback;
  const fields = Object.keys(fieldErrorsFrom(err));
  if (fields.length && fields.every((f) => shownInline.includes(f))) {
    return "Some answers need attention — see the highlighted fields.";
  }
  return err.message;
}
