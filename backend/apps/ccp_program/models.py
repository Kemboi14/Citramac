from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.tenancy.models import TenantScopedModel


class CareTeamMembership(TenantScopedModel):
    """
    Elevated privacy tier for psychiatric/SUD records — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.7: only the assigned care team, their supervisor chain, and the
    patient's Org Admin can see full session content; everyone else in the
    org sees only that an active care episode exists. Enforced in
    PsychotherapySessionViewSet/BiopsychosocialAssessmentViewSet via
    apps.ccp_program.permissions.has_full_ccp_access(), not just here.
    """

    ROLE_CHOICES = [("THERAPIST", "Therapist"), ("SUPERVISOR", "Supervisor")]

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="care_team_memberships"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="care_team_memberships"
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    assigned_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["patient", "user", "role"], name="unique_care_team_membership"
            )
        ]

    def __str__(self):
        return f"{self.user} — {self.get_role_display()} for {self.patient}"


class BiopsychosocialAssessment(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.1."""

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="biopsychosocial_assessments"
    )
    developmental_history = models.TextField(blank=True)
    social_history = models.TextField(blank=True)
    psychological_history = models.TextField(blank=True)
    family_history = models.TextField(blank=True)
    presenting_problem = models.TextField(blank=True)
    risk_factors = models.TextField(blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    def __str__(self):
        return f"Biopsychosocial assessment for {self.patient}"


class PsychotherapySession(TenantScopedModel):
    """
    Individual/Family/Group — discriminated by session_type, per
    docs/06-DATA-MODEL.md §6.4 and docs/07-CLINICAL-MODULES-SPEC.md §7.14.3.
    Field set covers what's common across mockups/citramac_clinical_workspace.html's
    three session forms; session_type-specific extras (e.g. family members
    present, group topic) live in `extra` since they don't overlap.
    """

    SESSION_TYPE_CHOICES = [
        ("INDIVIDUAL", "Individual Psychotherapy"),
        ("FAMILY", "Family Therapy"),
        ("GROUP", "Group Psychotherapy"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="psychotherapy_sessions"
    )
    session_type = models.CharField(max_length=16, choices=SESSION_TYPE_CHOICES)
    therapist = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    session_date = models.DateTimeField(default=timezone.now)
    duration_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    modality = models.CharField(max_length=255, blank=True)

    goals = models.TextField(blank=True)
    session_notes = models.TextField(blank=True)
    trauma_processing_stage = models.CharField(max_length=100, blank=True)
    progress_rating = models.PositiveSmallIntegerField(null=True, blank=True)

    # Session-type-specific fields that don't cleanly generalize (family
    # members present, group topic/facilitator notes, self-assessment, etc.)
    extra = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"{self.get_session_type_display()} — {self.patient} @ {self.session_date:%Y-%m-%d}"
