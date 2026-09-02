from rest_framework import serializers

from .models import (
    BiopsychosocialAssessment,
    CareTeamMembership,
    ClinicalReview,
    NacadaNdoReport,
    PsychotherapySession,
    RehabMilestone,
    ReviewOfSystemEntry,
    SubstanceUseEntry,
    SudRehabPlan,
    SupervisionRequest,
    UrineDrugScreen,
)


class CareTeamMembershipSerializer(serializers.ModelSerializer):
    class Meta:
        model = CareTeamMembership
        fields = ["id", "patient", "user", "role", "assigned_at"]


class SubstanceUseEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubstanceUseEntry
        fields = ["id", "assessment", "substance", "first_use", "last_use", "frequency", "route"]


class SubstanceUseEntryRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = SubstanceUseEntry
        fields = ["id", "assessment"]


class ReviewOfSystemEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewOfSystemEntry
        fields = ["id", "assessment", "category", "notes", "review_date", "clinician"]
        read_only_fields = ["clinician"]


class ReviewOfSystemEntryRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = ReviewOfSystemEntry
        fields = ["id", "assessment", "category"]


class BiopsychosocialAssessmentSerializer(serializers.ModelSerializer):
    """
    Also serves as the "Client History" intake form from
    mockups/citramac_clinical_workspace.html — the CIF-style fields below
    (hpi_*, substance use, clinical-history breakdown, structured risk,
    plan) are additive to the original six free-text fields.
    """

    substance_use_entries = SubstanceUseEntrySerializer(many=True, read_only=True)
    review_of_systems = ReviewOfSystemEntrySerializer(many=True, read_only=True)
    patient_name = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = BiopsychosocialAssessment
        fields = [
            "id",
            "patient",
            "patient_name",
            "developmental_history",
            "social_history",
            "psychological_history",
            "family_history",
            "presenting_problem",
            "risk_factors",
            "author",
            "author_name",
            "created_at",
            "status",
            "date_of_intake",
            "hpi_onset_date",
            "hpi_duration",
            "hpi_severity",
            "main_drug_problem",
            "other_main_drug_problem",
            "injecting_drug_use",
            "treatment_before",
            "substance_use_details",
            "substance_use_entries",
            "past_medical_surgical_history",
            "current_medications",
            "family_psychiatric_history",
            "forensic_history",
            "premorbid_history",
            "collateral_history",
            "vegetative_history",
            "withdrawal_risk",
            "suicide_risk_level",
            "self_harm_risk_level",
            "violence_risk_level",
            "plan_details",
            "admission_type_at_intake",
            "level_of_care",
            "next_steps",
            "review_of_systems",
        ]
        read_only_fields = ["author", "created_at"]

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() if obj.patient_id else ""

    def get_author_name(self, obj):
        return obj.author.get_full_name() if obj.author_id else ""


class BiopsychosocialAssessmentRestrictedSerializer(serializers.ModelSerializer):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — existence only, no content."""

    class Meta:
        model = BiopsychosocialAssessment
        fields = ["id", "patient", "status", "created_at"]


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
