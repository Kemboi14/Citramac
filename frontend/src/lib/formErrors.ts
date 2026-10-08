import { ApiError } from "./apiClient";

/**
 * Per-field messages from a failed request, keyed by the API's field name
 * (nested names like `medications.0.action` are kept as sent). Empty when the
 * failure is not a field-level validation error, so the caller falls back to
 * showing `err.message` once at the top of the form.
 */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.fields) return {};
  return Object.fromEntries(
    Object.entries(err.fields)
      .map(([field, value]) => [
        field,
        Array.isArray(value) ? value.map(String).join(" ") : String(value),
      ])
      .filter(([, message]) => message),
  );
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
