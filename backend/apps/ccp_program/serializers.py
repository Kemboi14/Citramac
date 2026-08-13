from rest_framework import serializers

from .models import BiopsychosocialAssessment, CareTeamMembership, PsychotherapySession


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
