from rest_framework import serializers

from .models import AuditLogEntry


class AuditLogEntrySerializer(serializers.ModelSerializer):
    """
    `field_diff` holds the old/new values of every changed field — including
    psychiatric free text and patient identifiers — so it is never returned.
    The audit screens only need to know *which* fields changed.
    """

    changed_fields = serializers.SerializerMethodField()

    class Meta:
        model = AuditLogEntry
        fields = [
            "id",
            "organization_id",
            "branch_id",
            "actor_user_id",
            "actor_role",
            "action",
            "model",
            "object_id",
            "changed_fields",
            "timestamp",
            "source_ip",
            "request_id",
        ]

    def get_changed_fields(self, obj) -> list[str]:
        return sorted((obj.field_diff or {}).keys())
