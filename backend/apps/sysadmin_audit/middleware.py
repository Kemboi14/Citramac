import uuid

from .context import clear_audit_context, set_audit_actor, set_audit_request_meta


class AuditMiddleware:
    """
    Stashes request-scoped metadata (source IP, a per-request correlation
    id, and — for session-authenticated requests like Django Admin — the
    actor) into thread-local context that the audit signal handlers
    (signals.py) read when writing AuditLogEntry rows. For JWT/API requests,
    the actor is set later by
    apps.accounts.authentication.TenantAwareJWTAuthentication, for the same
    reason TenantMiddleware can't see the JWT user itself (see its
    docstring) — but this middleware still owns clearing the context once
    the whole request, including the nested view call, has finished.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = str(uuid.uuid4())
        set_audit_request_meta(source_ip=_client_ip(request), request_id=request_id)

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            set_audit_actor(user)

        try:
            response = self.get_response(request)
        finally:
            clear_audit_context()
        response["X-Request-ID"] = request_id
        return response


def _client_ip(request):
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
