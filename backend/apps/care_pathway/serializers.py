from rest_framework import serializers

from .models import (
    BillingService,
    CarePlan,
    CarePlanActivity,
    CareTask,
    IntakeAssessment,
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
        ]
        read_only_fields = ["action_code", "action_label", "owner", "created_at"]

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
        data = super().to_representation(instance)
        for field, mse_field in MSE_FIELDS.items():
            data[field] = getattr(instance.mse, mse_field) if instance.mse_id else ""
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
            "author_name",
            "created_at",
        ]
        read_only_fields = ["patient", "episode", "encounter", "mse", "created_at"]

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
        fields = ["id", "instrument", "score", "recorded_at", "source_intake"]


class CarePlanActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CarePlanActivity
        fields = ["id", "title", "goal", "module", "status", "created_at"]
        read_only_fields = ["created_at"]


class CarePlanSerializer(serializers.ModelSerializer):
    activities = CarePlanActivitySerializer(many=True, read_only=True)
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
    provider_name = serializers.SerializerMethodField()
    activity_title = serializers.CharField(source="activity.title", read_only=True)
    activity_goal = serializers.CharField(source="activity.goal", read_only=True)
    billing_service_name = serializers.CharField(source="billing_service.name", read_only=True)

    class Meta:
        model = InterventionRecord
        fields = [
            "id",
            "activity",
            "activity_title",
            "activity_goal",
            "performed_at",
            "provider",
            "provider_name",
            "intervention",
            "response",
            "next_action",
            "billable",
            "billing_service",
            "billing_service_name",
            "quantity",
        ]

    def validate(self, attrs):
        if attrs.get("billable") and not attrs.get("billing_service"):
            raise serializers.ValidationError(
                {"billing_service": "Choose the billed service for a billable intervention."}
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
