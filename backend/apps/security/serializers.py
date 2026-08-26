from rest_framework import serializers

from .models import SecurityAlert, SecurityPolicy


class SecurityPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = SecurityPolicy
        fields = [
            "minimum_password_length",
            "password_complexity",
            "password_expiry_days",
            "password_history_count",
            "max_failed_login_attempts",
            "lockout_duration_minutes",
            "session_timeout_minutes",
            "max_concurrent_sessions",
            "token_expiry_minutes",
            "rate_limit_per_minute",
            "data_retention_years",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class SecurityAlertSerializer(serializers.ModelSerializer):
    organization_name = serializers.SerializerMethodField()

    class Meta:
        model = SecurityAlert
        fields = [
            "id",
            "organization_id",
            "organization_name",
            "category",
            "severity",
            "description",
            "status",
            "detected_at",
            "updated_at",
            "resolved_at",
        ]
        read_only_fields = [
            "organization_id",
            "category",
            "severity",
            "description",
            "detected_at",
        ]

    def get_organization_name(self, obj):
        return self.context.get("org_names", {}).get(str(obj.organization_id), "All tenants")
