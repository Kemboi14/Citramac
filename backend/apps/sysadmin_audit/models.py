import uuid

from django.db import models


class AppendOnlyQuerySet(models.QuerySet):
    """Blocks bulk update()/delete() at the ORM layer — see AuditLogEntry docstring."""

    def update(self, **kwargs):
        raise PermissionError("AuditLogEntry rows are append-only and cannot be updated.")

    def delete(self):
        raise PermissionError("AuditLogEntry rows are append-only and cannot be deleted.")


class AuditLogEntry(models.Model):
    """
    Immutable audit trail entry — docs/09-SECURITY-COMPLIANCE.md §9.4. Every
    create/update/delete on any model in LOCAL_APPS is logged automatically
    (see apps/sysadmin_audit/signals.py), plus explicit entries for
    security-sensitive events that aren't a model write (login, login
    failure, logout — see apps/accounts/auth_views.py).

    Deliberately not a ForeignKey to Organization/Branch/User: an audit
    entry must survive the deletion of the thing it describes (and Super
    Admin actions may have no organization at all), so these are plain
    UUID/string fields, not relations.

    App-layer immutability only (AppendOnlyQuerySet blocks .update()/.delete()
    via the ORM) — true tamper-evidence would need the DB connection to use a
    role without UPDATE/DELETE grants (or hash-chained entries), which is a
    documented Phase 7 hardening item (docs/09-SECURITY-COMPLIANCE.md §9.4),
    not a Phase 1 blocker.
    """

    ACTION_CREATE = "CREATE"
    ACTION_UPDATE = "UPDATE"
    ACTION_DELETE = "DELETE"
    ACTION_LOGIN = "LOGIN"
    ACTION_LOGIN_FAILED = "LOGIN_FAILED"
    ACTION_LOGOUT = "LOGOUT"
    ACTION_CHOICES = [
        (ACTION_CREATE, "Create"),
        (ACTION_UPDATE, "Update"),
        (ACTION_DELETE, "Delete"),
        (ACTION_LOGIN, "Login"),
        (ACTION_LOGIN_FAILED, "Login Failed"),
        (ACTION_LOGOUT, "Logout"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(null=True, blank=True, db_index=True)
    branch_id = models.UUIDField(null=True, blank=True)
    actor_user_id = models.UUIDField(null=True, blank=True, db_index=True)
    actor_role = models.CharField(max_length=100, blank=True)
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    model = models.CharField(max_length=150, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    field_diff = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    source_ip = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=64, blank=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["-timestamp"]
        verbose_name_plural = "audit log entries"

    def __str__(self):
        return f"{self.timestamp:%Y-%m-%d %H:%M:%S} {self.action} {self.model}:{self.object_id}"

    def save(self, *args, **kwargs):
        if self.pk and AuditLogEntry.objects.filter(pk=self.pk).exists():
            raise PermissionError("AuditLogEntry rows are append-only and cannot be modified.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("AuditLogEntry rows are append-only and cannot be deleted.")
