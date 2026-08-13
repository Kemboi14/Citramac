from rest_framework import serializers

from .models import (
    BiopsychosocialAssessment,
    CareTeamMembership,
    ClinicalReview,
    NacadaNdoReport,
    PsychotherapySession,
    RehabMilestone,
    SudRehabPlan,
    SupervisionRequest,
    UrineDrugScreen,
)


class CareTeamMembershipSerializer(serializers.ModelSerializer):
    class Meta:
        model = CareTeamMembership
        fields = ["id", "patient", "user", "role", "assigned_at"]


class BiopsychosocialAssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BiopsychosocialAssessment
        fields = [
            "id",
            "patient",
            "developmental_history",
            "social_history",
            "psychological_history",
            "family_history",
            "presenting_problem",
            "risk_factors",
            "author",
            "created_at",
        ]
        read_only_fields = ["author", "created_at"]


class BiopsychosocialAssessmentRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = BiopsychosocialAssessment
        fields = ["id", "patient", "created_at"]


class PsychotherapySessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PsychotherapySession
        fields = [
            "id",
            "patient",
            "session_type",
            "therapist",
            "session_date",
            "duration_minutes",
            "modality",
            "goals",
            "session_notes",
            "trauma_processing_stage",
            "progress_rating",
            "extra",
        ]
        read_only_fields = ["therapist"]


class PsychotherapySessionRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = PsychotherapySession
        fields = ["id", "patient", "session_type", "session_date"]


class RehabMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = RehabMilestone
        fields = ["id", "plan", "phase", "description", "achieved", "achieved_at"]


class SudRehabPlanSerializer(serializers.ModelSerializer):
    milestones = RehabMilestoneSerializer(many=True, read_only=True)

    class Meta:
        model = SudRehabPlan
        fields = [
            "id",
            "patient",
            "current_phase",
            "substances_of_concern",
            "treatment_goals",
            "case_manager",
            "started_at",
            "completed_at",
            "milestones",
        ]
        read_only_fields = ["case_manager", "started_at"]


class SudRehabPlanRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = SudRehabPlan
        fields = ["id", "patient", "current_phase", "started_at"]


class UrineDrugScreenSerializer(serializers.ModelSerializer):
    class Meta:
        model = UrineDrugScreen
        fields = ["id", "plan", "collected_at", "panel_results", "collected_by"]
        read_only_fields = ["collected_by"]


class UrineDrugScreenRestrictedSerializer(serializers.ModelSerializer):
    """docs/09-SECURITY-COMPLIANCE.md §9.3 — existence only, no panel results."""

    class Meta:
        model = UrineDrugScreen
        fields = ["id", "plan", "collected_at"]


class ClinicalReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClinicalReview
        fields = [
            "id",
            "patient",
            "requested_by",
            "reviewer",
            "case_summary",
            "review_notes",
            "status",
            "requested_at",
            "reviewed_at",
        ]
        read_only_fields = ["requested_by", "status", "requested_at", "reviewed_at"]


class SupervisionRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupervisionRequest
        fields = [
            "id",
            "patient",
            "requested_by",
            "supervisor",
            "topic",
            "notes",
            "status",
            "requested_at",
            "completed_at",
        ]
        read_only_fields = ["requested_by", "status", "requested_at", "completed_at"]


class NacadaNdoReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = NacadaNdoReport
        fields = [
            "id",
            "period_start",
            "period_end",
            "generated_by",
            "generated_at",
            "summary_data",
            "status",
        ]
        read_only_fields = ["generated_by", "generated_at", "summary_data", "status"]


class CcpTeamRosterSerializer(serializers.Serializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.6 — roster/caseload view, not a stored model."""

    user_id = serializers.UUIDField()
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    caseload_count = serializers.IntegerField()
    specialties = serializers.ListField(child=serializers.CharField())
