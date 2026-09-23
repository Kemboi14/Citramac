"""
Project-wide DRF EXCEPTION_HANDLER (config/settings/base.py REST_FRAMEWORK).

Without this, DRF's stock handler produces `{"detail": "..."}` for anything
raised (AuthenticationFailed, PermissionDenied, a bare
`serializer.is_valid(raise_exception=True)`, Http404, Throttled), a
different shape from the app's own `{"error": {code, message}}` convention
(apps.accounts.auth_views._error / config.errors.error_response). The
frontend's ApiError parser (frontend/src/lib/apiClient.ts) only recognizes
the latter — a `{"detail": ...}` response has its real message silently
discarded and replaced with a generic "Request failed".

This wraps DRF's own handler and reshapes whatever it produces into the one
shape, so every raised exception across every app gets a real, displayable
message — not just the views that happen to call `_error()`/`error_response()`
by hand. A `code` kwarg on the raised exception (e.g.
`AuthenticationFailed("...", code="organization_suspended")`) is honored and
upper-cased; otherwise a generic code is derived from the HTTP status.

Deliberately scoped to exceptions whose `.detail` is a plain string
(AuthenticationFailed, PermissionDenied, NotAuthenticated, Http404,
Throttled, a bare `raise ValidationError("message")`) — DRF wraps those as
`{"detail": "..."}` today, the shape this project never intended to ship.
A `serializer.is_valid(raise_exception=True)` failure is untouched: DRF
represents that as a raw per-field `{"field": ["msg"]}` dict (no "detail"
key at all), which a substantial number of existing tests and, in
principle, frontend forms already assert on directly. Reshaping that too is
a legitimate follow-up but a separate, much larger-blast-radius change
(every `raise_exception=True` call site in every app) than what today's
login/deactivation error-handling work calls for.
"""

from rest_framework.views import exception_handler as drf_exception_handler

_STATUS_FALLBACK_CODES = {
    400: "BAD_REQUEST",
    401: "AUTHENTICATION_FAILED",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    406: "NOT_ACCEPTABLE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    429: "RATE_LIMITED",
    500: "SERVER_ERROR",
}


def custom_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        # Not a DRF-recognized exception (e.g. an unhandled bug) — let
        # Django's own 500 handling deal with it, unchanged.
        return None

    data = response.data
    if not (isinstance(data, dict) and set(data.keys()) == {"detail"}):
        # Either already app-shaped ({"error": ...}, not actually reachable
        # via the handler but defensive) or a per-field validation dict/list
        # — left alone, see module docstring.
        return response

    detail = data["detail"]
    code = getattr(detail, "code", None) or _STATUS_FALLBACK_CODES.get(
        response.status_code, "ERROR"
    )
    response.data = {"error": {"code": str(code).upper(), "message": str(detail)}}
    return response
