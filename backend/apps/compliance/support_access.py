"""
Enforcement of tenant-authorised platform support access (see models.py).

A platform superuser's API request to a route that carries tenant patient
data is refused unless it names an active SupportAccessGrant (header
`X-Support-Grant`) approved by that tenant for that user. With a grant, the
request runs in the tenant's own context (row-level security narrowed to that
organization, not platform-wide) and is written to the audit log.
"""

import re

from rest_framework.exceptions import PermissionDenied

# Routes under /api/v1/ that carry tenant patient data.
CLINICAL_ROUTE = re.compile(
    r"^/api/v1/("
    r"patients|appointments|attachments|encounters|diagnoses|mhp|lab|pharmacy|ipd|clinical|"
    r"sync|billing|invoices|payments|claims|pre-authorizations|erasure-requests|compliance/subject-requests|"
    r"retention/(patients|archived|batches)|"
    r"care/(?!valuesets/|triage/thresholds/|consent-templates/|billing-services/)"
    r")(/|$)"
)

HEADER = "HTTP_X_SUPPORT_GRANT"


def is_clinical_route(path):
    return bool(CLINICAL_ROUTE.match(path))


def enforce_for_platform_staff(request, user):
    """Called once the JWT user is known. Returns the organization id the
    request must be narrowed to, or None when no narrowing applies."""
    if not user.is_superuser or not is_clinical_route(request.path):
        return None
    from apps.tenancy.context import platform_admin_context

    from .models import SupportAccessGrant

    grant_id = request.META.get(HEADER, "").strip()
    grant = None
    if grant_id:
        with platform_admin_context():
            grant = (
                SupportAccessGrant.all_objects.filter(pk=grant_id, requested_by=user)
                .only("id", "organization_id", "status", "expires_at")
                .first()
                if _is_uuid(grant_id)
                else None
            )
    if grant is None or not grant.is_active:
        raise PermissionDenied(
            "Platform staff can only reach a facility's clinical records with an active "
            "support access grant approved by that facility."
        )
    request.support_grant_id = str(grant.id)
    return grant.organization_id


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def record_support_request(request, user, organization_id):
    """Every request made under a support grant lands in the audit log."""
    from apps.sysadmin_audit.context import get_audit_context
    from apps.sysadmin_audit.models import AuditLogEntry

    context = get_audit_context()
    AuditLogEntry.objects.create(
        organization_id=organization_id,
        actor_user_id=user.id,
        actor_role="Platform support",
        action=AuditLogEntry.ACTION_SUPPORT_ACCESS,
        model="compliance.supportaccessgrant",
        object_id=getattr(request, "support_grant_id", ""),
        field_diff={"method": request.method, "path": request.path},
        source_ip=context["source_ip"],
        request_id=context["request_id"],
    )
