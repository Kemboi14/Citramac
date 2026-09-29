from rest_framework import serializers

from apps.client_registry.models import Patient

from .models import (
    ArchiveBatch,
    ArchiveBatchItem,
    OrganizationRetentionPolicy,
    RetentionPlatformSettings,
    RetentionScanRun,
)


def _user_name(user):
    if user is None:
        return None
    return f"{user.first_name} {user.last_name}".strip() or user.email


class RetentionPlatformSettingsSerializer(serializers.ModelSerializer):
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RetentionPlatformSettings
        fields = [
            "clinical_floor_years",
            "mental_health_floor_years",
            "financial_floor_years",
            "minor_clock_start_age",
            "floor_verified",
            "floor_source",
            "verified_by_name",
            "verified_at",
            "forecast_windows_days",
            "updated_at",
        ]
        read_only_fields = ["verified_by_name", "verified_at", "updated_at"]

    def get_verified_by_name(self, obj):
        return _user_name(obj.verified_by)

    def validate_forecast_windows_days(self, value):
        if not isinstance(value, list) or not all(
            isinstance(v, int) and 0 < v <= 3650 for v in value
        ):
            raise serializers.ValidationError("A list of whole days between 1 and 3650.")
        return sorted(set(value), reverse=True)

    def validate(self, attrs):
        verified = attrs.get("floor_verified", self.instance.floor_verified)
        source = attrs.get("floor_source", self.instance.floor_source)
        if verified and not (source or "").strip():
            raise serializers.ValidationError(
                {
                    "floor_source": (
                        "Record the legal instrument or DHA guidance the retention periods "
                        "were confirmed against before marking them verified."
                    )
                }
            )
        for name in ("clinical_floor_years", "mental_health_floor_years", "financial_floor_years"):
            if name in attrs and attrs[name] < 1:
                raise serializers.ValidationError({name: "At least 1 year."})
        # Changing a floor (or the recorded source) after verification means
        # what was signed off is not what's stored any more — it must be
        # confirmed again.
        floors_changed = any(
            name in attrs and attrs[name] != getattr(self.instance, name)
            for name in (
                "clinical_floor_years",
                "mental_health_floor_years",
                "financial_floor_years",
                "minor_clock_start_age",
                "floor_source",
            )
        )
        if floors_changed and "floor_verified" not in attrs:
            attrs["floor_verified"] = False
        return attrs


class OrganizationRetentionPolicySerializer(serializers.ModelSerializer):
    effective = serializers.SerializerMethodField()
    floor = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationRetentionPolicy
        fields = [
            "clinical_years",
            "mental_health_years",
            "financial_years",
            "scan_enabled",
            "effective",
            "floor",
            "updated_at",
        ]
        read_only_fields = ["effective", "floor", "updated_at"]

    def _platform(self):
        return self.context["platform"]

    def get_effective(self, obj):
        from .services import effective_years

        return effective_years(obj.organization_id, self._platform())

    def get_floor(self, obj):
        platform = self._platform()
        return {
            "clinical": platform.clinical_floor_years,
            "mental_health": platform.mental_health_floor_years,
            "financial": platform.financial_floor_years,
            "minor_clock_start_age": platform.minor_clock_start_age,
            "verified": platform.floor_verified,
            "source": platform.floor_source,
        }

    def validate(self, attrs):
        platform = self._platform()
        floors = {
            "clinical_years": platform.clinical_floor_years,
            "mental_health_years": platform.mental_health_floor_years,
            "financial_years": platform.financial_floor_years,
        }
        errors = {}
        for name, floor in floors.items():
            value = attrs.get(name)
            if value is not None and value < floor:
                errors[name] = f"Can't be shorter than the platform minimum of {floor} years."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class RetentionScanRunSerializer(serializers.ModelSerializer):
    batch_reference = serializers.CharField(source="batch.reference", read_only=True, default=None)

    class Meta:
        model = RetentionScanRun
        fields = [
            "id",
            "created_at",
            "outcome",
            "due_count",
            "forecast",
            "batch",
            "batch_reference",
            "floor_verified",
            "error",
        ]
        read_only_fields = fields


class ArchiveBatchItemSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.get_full_name", read_only=True)
    uhid_number = serializers.CharField(source="patient.uhid_number", read_only=True)
    citramac_number = serializers.CharField(source="patient.citramac_number", read_only=True)

    class Meta:
        model = ArchiveBatchItem
        fields = [
            "id",
            "patient",
            "patient_name",
            "uhid_number",
            "citramac_number",
            "last_activity_at",
            "retention_years",
            "retention_ends_on",
            "outcome",
            "skip_reason",
        ]
        read_only_fields = fields


class ArchiveBatchSerializer(serializers.ModelSerializer):
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ArchiveBatch
        fields = [
            "id",
            "reference",
            "reason",
            "status",
            "item_count",
            "archived_count",
            "skipped_count",
            "created_at",
            "decided_by_name",
            "decided_at",
            "decision_note",
        ]
        read_only_fields = fields

    def get_decided_by_name(self, obj):
        return _user_name(obj.decided_by)


class ArchivedPatientSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    archived_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = [
            "id",
            "full_name",
            "uhid_number",
            "citramac_number",
            "archived_at",
            "archived_by_name",
            "archive_reason",
            "legal_hold",
        ]
        read_only_fields = fields

    def get_archived_by_name(self, obj):
        return _user_name(obj.archived_by)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class LegalHoldSerializer(serializers.Serializer):
    on = serializers.BooleanField()
    reason = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class DecisionSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")
