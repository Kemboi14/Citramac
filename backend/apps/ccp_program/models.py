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


class SudRehabPlan(TenantScopedModel):
    """
    Multi-phase SUD rehab plan — docs/07-CLINICAL-MODULES-SPEC.md §7.14.4:
    Intake -> Stabilization -> Active Treatment -> Aftercare, with milestone
    tracking (see RehabMilestone below).
    """

    PHASE_CHOICES = [
        ("INTAKE", "Intake"),
        ("STABILIZATION", "Stabilization"),
        ("ACTIVE_TREATMENT", "Active Treatment"),
        ("AFTERCARE", "Aftercare"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="sud_rehab_plans")
    current_phase = models.CharField(max_length=20, choices=PHASE_CHOICES, default="INTAKE")
    substances_of_concern = models.TextField(blank=True)
    treatment_goals = models.TextField(blank=True)
    case_manager = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    started_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"SUD rehab plan for {self.patient} ({self.get_current_phase_display()})"


class RehabMilestone(TenantScopedModel):
    plan = models.ForeignKey(SudRehabPlan, on_delete=models.CASCADE, related_name="milestones")
    phase = models.CharField(max_length=20, choices=SudRehabPlan.PHASE_CHOICES)
    description = models.CharField(max_length=255)
    achieved = models.BooleanField(default=False)
    achieved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.description} ({'achieved' if self.achieved else 'pending'})"


class UrineDrugScreen(TenantScopedModel):
    """
    Periodic UDS results logged against a rehab plan — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.4: panel results stored as structured JSONB for trend charts.
    """

    plan = models.ForeignKey(
        SudRehabPlan, on_delete=models.CASCADE, related_name="urine_drug_screens"
    )
    collected_at = models.DateTimeField(default=timezone.now)
    panel_results = models.JSONField(
        default=dict,
        blank=True,
        help_text="e.g. {'amphetamine': 'negative', 'cannabinoids': 'positive'}",
    )
    collected_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    def __str__(self):
        return f"UDS for {self.plan.patient} @ {self.collected_at:%Y-%m-%d}"


class ClinicalReview(TenantScopedModel):
    """Peer/senior review before finalizing a treatment plan — §7.14.5."""

    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("APPROVED", "Approved"),
        ("CHANGES_REQUESTED", "Changes Requested"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="clinical_reviews")
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewer = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    case_summary = models.TextField(blank=True)
    review_notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    requested_at = models.DateTimeField(default=timezone.now)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Clinical review for {self.patient} ({self.get_status_display()})"


class SupervisionRequest(TenantScopedModel):
    """Junior clinician requests supervisor time on a case — §7.14.5."""

    STATUS_CHOICES = [("OPEN", "Open"), ("SCHEDULED", "Scheduled"), ("COMPLETED", "Completed")]

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="supervision_requests"
    )
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    supervisor = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    topic = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="OPEN")
    requested_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Supervision request re: {self.patient} ({self.get_status_display()})"


class NacadaNdoReport(TenantScopedModel):
    """
    Periodic aggregated NACADA National Drug Observatory report — §7.14.6.
    Auto-compiled from SudRehabPlan/UrineDrugScreen data at generation time;
    submission to NACADA's own systems is a Phase 6+ integration item — this
    stores the compiled snapshot and export status honestly as SHA-style
    stub, not a fake "submitted" success.
    """

    STATUS_CHOICES = [("DRAFT", "Draft"), ("EXPORTED", "Exported")]

    period_start = models.DateField()
    period_end = models.DateField()
    generated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    generated_at = models.DateTimeField(default=timezone.now)
    summary_data = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="DRAFT")

    def __str__(self):
        return f"NACADA NDO report {self.period_start} to {self.period_end}"
