from rest_framework import serializers

from .models import (
    BillingService,
    CarePlan,
    CarePlanActivity,
    CareTask,
    IntakeAssessment,
    MedicationHistoryEntry,
    InterventionRecord,
    OutcomeScore,
)
from .services import user_display


class CareTaskSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CareTask
        fields = [
            "id",
            "action_code",
            "action_label",
            "owner",
            "status",
            "created_at",
            "created_by_name",
            "focus_type",
            "due_at",
        ]
        read_only_fields = ["action_code", "action_label", "owner", "created_at", "focus_type", "due_at"]

    def get_created_by_name(self, obj):
        return user_display(obj.created_by)


MSE_FIELDS = {
    "mse_appearance": "appearance",
    "mse_behaviour": "behavior",
    "mse_mood": "mood",
    "mse_affect": "affect",
}


class IntakeAssessmentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    mse_appearance = serializers.CharField(required=False, allow_blank=True)
    mse_behaviour = serializers.CharField(required=False, allow_blank=True)
    mse_mood = serializers.CharField(required=False, allow_blank=True)
    mse_affect = serializers.CharField(required=False, allow_blank=True)

    def to_representation(self, instance):
        from . import intake_schema
        from .intake import can_view_restricted

        data = super().to_representation(instance)
        for field, mse_field in MSE_FIELDS.items():
            data[field] = getattr(instance.mse, mse_field) if instance.mse_id else ""
        request = self.context.get("request")
        data["sections"] = intake_schema.strip_restricted(
            instance.sections, can_view_restricted(getattr(request, "user", None))
        )
        return data

    class Meta:
        model = IntakeAssessment
        fields = [
            "id",
            "patient",
            "episode",
            "encounter",
            "presenting_concern",
            "history",
            "symptoms",
            "risk_level",
            "risk_notes",
            "mse_appearance",
            "mse_behaviour",
            "mse_mood",
            "mse_affect",
            "mse",
            "gad7_score",
            "phq9_score",
            "formulation",
            "clinical_decision",
            "care_needs",
            "version",
            "status",
            "completeness",
            "section_state",
            "current_section",
            "signed_at",
            "outstanding",
            "author_name",
            "created_at",
        ]
        read_only_fields = [
            "patient",
            "episode",
            "encounter",
            "mse",
            "created_at",
            "version",
            "status",
            "completeness",
            "section_state",
            "current_section",
            "signed_at",
            "outstanding",
        ]

    def validate_gad7_score(self, value):
        if value is not None and value > 21:
            raise serializers.ValidationError("GAD-7 scores range from 0 to 21.")
        return value

    def validate_phq9_score(self, value):
        if value is not None and value > 27:
            raise serializers.ValidationError("PHQ-9 scores range from 0 to 27.")
        return value

    def get_author_name(self, obj):
        return user_display(obj.author)


class OutcomeScoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = OutcomeScore
        fields = [
            "id",
            "instrument",
            "score",
            "items",
            "flags",
            "positive",
            "detail",
            "context",
            "timepoint",
            "note",
            "recorded_at",
            "source_intake",
        ]


class CarePlanActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CarePlanActivity
        fields = ["id", "title", "goal", "module", "status", "created_at"]
        read_only_fields = ["created_at"]


class CarePlanSerializer(serializers.ModelSerializer):
    activities = serializers.SerializerMethodField()

    def get_activities(self, plan):
        # Declined recommendations stay on record but are not live plan actions.
        return CarePlanActivitySerializer(
            plan.activities.exclude(decision="DECLINED"), many=True
        ).data
    care_coordinator_name = serializers.SerializerMethodField()

    class Meta:
        model = CarePlan
        fields = [
            "id",
            "patient",
            "episode",
            "plan_type",
            "interventions",
            "goals",
            "review_date",
            "care_coordinator",
            "care_coordinator_name",
            "activities",
            "updated_at",
        ]
        read_only_fields = ["patient", "episode", "updated_at"]

    def get_care_coordinator_name(self, obj):
        return user_display(obj.care_coordinator)


class InterventionRecordSerializer(serializers.ModelSerializer):
    """A delivery recorded from an Interventions module. With `module`, billing
    follows the module's tariff line (see intervention_catalogue); without it,
    the caller names the billed service explicitly."""

    provider_name = serializers.SerializerMethodField()
    activity_title = serializers.CharField(source="activity.title", read_only=True, default="")
    activity_goal = serializers.CharField(source="activity.goal", read_only=True, default="")
    billing_service_name = serializers.CharField(
        source="billing_service.name", read_only=True, default=None
    )
    quantity = serializers.IntegerField(min_value=1, max_value=999, required=False, default=1)

    class Meta:
        model = InterventionRecord
        fields = [
            "id",
            "activity",
            "module",
            "activity_title",
            "activity_goal",
            "performed_at",
            "provider",
            "provider_name",
            "intervention",
            "note",
            "response",
            "outcome",
            "next_action",
            "completes_activity",
            "billable",
            "billing_service",
            "billing_service_name",
            "quantity",
            "voided_at",
            "void_reason",
            "corrections",
        ]
        read_only_fields = ["voided_at", "void_reason", "corrections"]

    def validate_module(self, value):
        from . import intervention_catalogue

        if value and not intervention_catalogue.is_served(value):
            raise serializers.ValidationError("Unknown intervention module.")
        return value

    def validate(self, attrs):
        from . import intervention_catalogue

        module = attrs.get("module")
        if module:
            if not (attrs.get("note") or "").strip():
                raise serializers.ValidationError({"note": "Add a brief note of what was done."})
            if attrs.get("intervention") not in intervention_catalogue.BY_CODE[module]["options"]:
                raise serializers.ValidationError(
                    {"intervention": "Choose one of this module's interventions."}
                )
            service = intervention_catalogue.billing_service_for(module)
            attrs["billing_service"] = service
            attrs["billable"] = service is not None
        elif attrs.get("billable") and not attrs.get("billing_service"):
            raise serializers.ValidationError(
                {"billing_service": "Choose the billed service for a billable intervention."}
            )
        if attrs.get("completes_activity") and not attrs.get("activity"):
            raise serializers.ValidationError(
                {"completes_activity": "Link a care-plan action to mark it complete."}
            )
        return attrs

    def get_provider_name(self, obj):
        return user_display(obj.provider)


class BillingServiceSerializer(serializers.ModelSerializer):
    rate = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, allow_null=True, required=False
    )

    class Meta:
        model = BillingService
        fields = ["id", "name", "rate", "active"]
        read_only_fields = ["name"]


class MedicationHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationHistoryEntry
        fields = [
            "id",
            "name",
            "drug_code",
            "dose",
            "frequency",
            "route",
            "status",
            "reason",
            "source",
            "started_on",
            "recorded_at",
        ]
        read_only_fields = ["recorded_at"]
