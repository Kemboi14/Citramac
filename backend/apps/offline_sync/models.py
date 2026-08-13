from django.db import models

from apps.tenancy.models import TenantScopedModel


class SyncableRecord(TenantScopedModel):
    """
    Maps a client-generated idempotency key (assigned while offline) to the
    server-side record it created — docs/08-DHA-SHA-INTEGRATION.md §8.5's
    "idempotent, timestamp/version-aware sync endpoints." `version` is the
    server's authoritative version counter for last-write-wins comparison;
    a push whose `base_version` is behind this is a conflict, logged to
    SyncConflictLog rather than silently overwritten.
    """

    ENTITY_TYPE_CHOICES = [("VITALS", "Vital Signs"), ("SOAP_NOTE", "SOAP Note")]

    client_id = models.CharField(max_length=64, db_index=True)
    entity_type = models.CharField(max_length=32, choices=ENTITY_TYPE_CHOICES)
    # Null + version=0 briefly while a request "reserves" a client_id before
    # doing the actual domain-model write — see sync_service.push_entry's
    # race-handling comment for why this two-step reserve-then-fill exists.
    server_entity_id = models.UUIDField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "client_id"], name="unique_client_id_per_org"
            )
        ]

    def __str__(self):
        return (
            f"{self.entity_type} client:{self.client_id} "
            f"-> {self.server_entity_id} (v{self.version})"
        )


class SyncConflictLog(TenantScopedModel):
    """
    Surfaced to an Org Admin/records officer for manual resolution rather
    than silently overwritten — docs/08-DHA-SHA-INTEGRATION.md §8.5.
    """

    client_id = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=32, choices=SyncableRecord.ENTITY_TYPE_CHOICES)
    server_entity_id = models.UUIDField(null=True, blank=True)
    incoming_payload = models.JSONField()
    client_base_version = models.PositiveIntegerField()
    server_version = models.PositiveIntegerField()
    detail = models.TextField(blank=True)
    resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    def __str__(self):
        status = "resolved" if self.resolved else "open"
        return f"Conflict on {self.entity_type} client:{self.client_id} ({status})"
