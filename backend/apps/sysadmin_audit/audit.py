"""
Explicit audit-entry writer shared by the generic write-signal hooks
(signals.py) and by app code that needs to log something a signal can't
see — most importantly sensitive record **views** (not just edits), per
docs/09-SECURITY-COMPLIANCE.md §9.4: "Sensitive record views (not just
edits) must also be logged for psychiatric/SUD records specifically, per
Data Protection Act 'who accessed my file' accountability."
"""

from .context import get_audit_context
from .models import AuditLogEntry


def write_event(organization_id, action, model, object_id, field_diff=None):
    """Write an audit row for something that is not a single model instance."""
    context = get_audit_context()
    return AuditLogEntry.objects.create(
        organization_id=organization_id,
        branch_id=context["actor_branch_id"],
        actor_user_id=context["actor_user_id"],
        actor_role=context["actor_role"],
        action=action,
        model=model,
        object_id=str(object_id),
        field_diff=field_diff or {},
        source_ip=context["source_ip"],
        request_id=context["request_id"],
    )


def write_entry(instance, action, field_diff=None):
    return write_event(
        getattr(instance, "organization_id", None),
        action,
        f"{instance._meta.app_label}.{instance._meta.model_name}",
        instance.pk,
        field_diff,
    )


def log_view(instance):
    """Call from a view/serializer path whenever full sensitive content is returned to a user."""
    return write_entry(instance, AuditLogEntry.ACTION_VIEW)


def log_audit_log_view(organization_id, filters, page):
    """Record who opened the audit trail and with which filters — never any row content."""
    return write_event(
        organization_id,
        AuditLogEntry.ACTION_VIEW,
        "sysadmin_audit.auditlogentry",
        "list",
        {"filters": filters, "page": page},
    )
