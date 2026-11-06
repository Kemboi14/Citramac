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
        set_audit_request_meta(source_ip=get_client_ip(request), request_id=request_id)

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            set_audit_actor(user)

        try:
            response = self.get_response(request)
            log_client_record_read(request, response)
        finally:
            clear_audit_context()
        response["X-Request-ID"] = request_id
        return response


def log_client_record_read(request, response):
    """CLAUDE.md §4: an AuditEvent on every access to a psychiatric record. Every
    successful read of a URL that names a client (`<patient_id>` — the whole
    client record, care/clients/<id>/…) writes one VIEW entry on that client,
    naming the route. Runs while the request's tenant context is still bound
    (TenantMiddleware wraps this one), so the entry lands in the client's own
    organisation. Never the response content."""
    if request.method != "GET" or not 200 <= response.status_code < 300:
        return
    match = getattr(request, "resolver_match", None)
    patient_id = (match.kwargs or {}).get("patient_id") if match else None
    user = getattr(request, "user", None)
    if not patient_id or user is None or not user.is_authenticated:
        return
    from apps.tenancy.context import get_current_organization_id

    from .audit import write_event
    from .models import AuditLogEntry

    # The organisation the request is working in (a support session's client
    # organisation), not necessarily the user's own.
    organization_id = get_current_organization_id() or user.organization_id
    if not organization_id:
        return
    write_event(
        organization_id,
        AuditLogEntry.ACTION_VIEW,
        "client_registry.patient",
        patient_id,
        {"route": match.view_name or match.route},
    )


def get_client_ip(request):
    """
    The real client IP behind the k8s ingress/reverse proxy — plain
    `REMOTE_ADDR` is the ingress's own address for every request once
    deployed, which makes any per-IP rate limit keyed on it a single
    shared (and trivially exhausted) global budget instead of a per-client
    one. Used by this middleware's own audit `source_ip`, and imported
    directly by apps.accounts.auth_views/throttling for the same reason.
    """
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
