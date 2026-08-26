from rest_framework import serializers

from .models import AuditLogEntry


class AuditLogEntrySerializer(serializers.ModelSerializer):
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
            "field_diff",
            "timestamp",
            "source_ip",
            "request_id",
        ]
