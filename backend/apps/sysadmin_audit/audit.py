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


def write_entry(instance, action, field_diff=None):
    context = get_audit_context()
    return AuditLogEntry.objects.create(
        organization_id=getattr(instance, "organization_id", None),
        branch_id=context["actor_branch_id"],
        actor_user_id=context["actor_user_id"],
        actor_role=context["actor_role"],
        action=action,
        model=f"{instance._meta.app_label}.{instance._meta.model_name}",
        object_id=str(instance.pk),
        field_diff=field_diff or {},
        source_ip=context["source_ip"],
        request_id=context["request_id"],
    )


def log_view(instance):
    """Call from a view/serializer path whenever full sensitive content is returned to a user."""
    return write_entry(instance, AuditLogEntry.ACTION_VIEW)
