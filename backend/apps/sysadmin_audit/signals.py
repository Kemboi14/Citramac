"""
Generic "every write gets audited" wiring — docs/09-SECURITY-COMPLIANCE.md §9.4,
docs/11-ROADMAP-AND-PHASES.md Phase 1 ("Immutable AuditLogEntry model +
middleware wired to every write"). Connected in apps.sysadmin_audit.apps.ready()
to every concrete model in our own LOCAL_APPS (not Django's built-ins, and not
AuditLogEntry itself). Signals — not a request middleware alone — are what
actually give "every write" coverage: they fire for saves from management
commands, Celery tasks, and data migrations too, not just HTTP views.
"""

from django.conf import settings
from django.db.models.signals import post_delete, post_save, pre_save

from .audit import write_entry
from .models import AuditLogEntry

SENSITIVE_FIELDS = {"password", "code_hash"}
_PRE_SAVE_SNAPSHOTS = {}


def _local_app_labels():
    # Resolved via the app registry, not by splitting the module path: an
    # app may override its label (apps.security's is "platform_security"),
    # and a path-derived "security" would silently leave that app's models
    # — SecurityPolicy included — out of the audit trail entirely.
    from django.apps import apps as django_apps

    return {
        config.label
        for config in django_apps.get_app_configs()
        if config.name in settings.LOCAL_APPS
    } - {"sysadmin_audit"}


def _serialize(instance, field_names=None):
    field_names = field_names or [f.name for f in instance._meta.concrete_fields]
    data = {}
    for name in field_names:
        if name in SENSITIVE_FIELDS:
            continue
        value = getattr(instance, name, None)
        data[name] = str(value) if value is not None else None
    return data


def _capture_pre_save_snapshot(sender, instance, **kwargs):
    if not instance.pk:
        return
    try:
        old = sender._base_manager.get(pk=instance.pk)
    except sender.DoesNotExist:
        return
    _PRE_SAVE_SNAPSHOTS[(sender, instance.pk)] = _serialize(old)


def _log_save(sender, instance, created, **kwargs):
    field_names = [f.name for f in instance._meta.concrete_fields]
    new_values = _serialize(instance, field_names)

    if created:
        diff = {name: {"old": None, "new": value} for name, value in new_values.items()}
        action = AuditLogEntry.ACTION_CREATE
    else:
        old_values = _PRE_SAVE_SNAPSHOTS.pop((sender, instance.pk), {})
        diff = {
            name: {"old": old_values.get(name), "new": value}
            for name, value in new_values.items()
            if old_values.get(name) != value
        }
        action = AuditLogEntry.ACTION_UPDATE
        if not diff:
            return  # save() with no actual field changes — nothing to log

    write_entry(instance, action, diff)


def _log_delete(sender, instance, **kwargs):
    # The row itself is gone after this, so the entry carries its final
    # field values — otherwise the audit trail records *that* something was
    # deleted but not *what*, and the content survives only in backups.
    # Raw column values (attname, i.e. `organization_id` not `organization`):
    # a related row may already be gone mid-cascade, and resolving it here
    # would query — or fail on — something that no longer exists.
    diff = {}
    for field in instance._meta.concrete_fields:
        if field.name in SENSITIVE_FIELDS:
            continue
        value = getattr(instance, field.attname, None)
        diff[field.name] = {"old": str(value) if value is not None else None, "new": None}
    write_entry(instance, AuditLogEntry.ACTION_DELETE, diff)


def connect_audit_signals():
    from django.apps import apps as django_apps

    labels = _local_app_labels()
    for model in django_apps.get_models():
        if model._meta.app_label not in labels:
            continue
        if model is AuditLogEntry:
            continue
        pre_save.connect(_capture_pre_save_snapshot, sender=model, weak=False)
        post_save.connect(_log_save, sender=model, weak=False)
        post_delete.connect(_log_delete, sender=model, weak=False)
