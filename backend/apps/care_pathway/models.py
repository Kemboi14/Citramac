"""
Care pathway — docs/15-CLINICAL-WORKSPACE-V3.md. The approved 2026-10-07
clinical workspace: Registration → Triage → Psychiatry → Intake → Care Plan →
Interventions → Outcomes → Billing → Follow-up, all hanging off one
EpisodeOfCare per period of care (CLAUDE.md §4, "the clinical spine").

FHIR R4 mapping (doc 15 §3, confirmed by the project owner 2026-10-07):

| Model | FHIR R4 resource |
|---|---|
| EpisodeOfCare (+ EpisodeStatusHistory) | EpisodeOfCare (+ statusHistory) |
| TriageEncounter | Encounter (triage), priority bound to the triage-priority ValueSet |
| TriageAssessment | QuestionnaireResponse (+ RiskAssessment for the outcome) |
| TriageRecheck | QuestionnaireResponse (re-check) + vital-sign Observations |
| ClinicalAlert | Flag |
| CareTask | Task |
| IntakeAssessment | QuestionnaireResponse (intake) |
| OutcomeScore | Observation (instrument score) — VERIFY: LOINC codes before export |
| CarePlan / CarePlanActivity | CarePlan / CarePlan.activity + Goal |
| InterventionRecord | Procedure (performed intervention) |
| BillingService / ChargeItem | ChargeItemDefinition / ChargeItem |
| DischargeSummary (+ lines) | Composition (discharge summary) in a document Bundle — docs/17 |
| LocalValueSet / LocalConcept | ValueSet / CodeSystem (served, CLAUDE.md §4) |
"""

from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.tenancy.models import Branch, TenantScopedModel, TimestampedModel

PRIORITY_CHOICES = [
    ("RED", "Emergency"),
    ("ORANGE", "Urgent"),
    ("YELLOW", "Priority"),
    ("GREEN", "Routine"),
]
PRIORITY_ORDER = {"RED": 0, "ORANGE": 1, "YELLOW": 2, "GREEN": 3}


# ── Served terminology (CLAUDE.md §4 "Terminology is served, not compiled") ──


class LocalValueSet(TimestampedModel):
    """A locally defined value set, served to every clinical drop-down.

    Platform-wide, not tenant-scoped (like IcdCodeIndex). Seeded by migration
    from the approved mockup's option lists; editing a concept's display or
    retiring it is a database change, not a release.
    """

    id = models.SlugField(primary_key=True, max_length=64)
    title = models.CharField(max_length=255)
    version = models.CharField(max_length=32, default="1")

    def __str__(self):
        return self.title


class LocalConcept(TimestampedModel):
    valueset = models.ForeignKey(LocalValueSet, on_delete=models.CASCADE, related_name="concepts")
    # Codes are stable: triage rules and stored answers reference them.
    code = models.CharField(max_length=64)
    display = models.CharField(max_length=255)
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["valueset", "order"]
        constraints = [
            models.UniqueConstraint(fields=["valueset", "code"], name="unique_concept_per_valueset")
        ]

    def __str__(self):
        return f"{self.valueset_id}:{self.code}"


# ── EpisodeOfCare — the clinical spine ──


class EpisodeOfCare(TenantScopedModel):
    """Organisational container only (CLAUDE.md §4): client, service, start,
    coordinator, presenting problems, state. Never clinical content."""

    STATUS_CHOICES = [
        ("planned", "Planned"),
        ("waitlist", "Waitlist"),
        ("active", "Active"),
        ("onhold", "On hold"),
        ("finished", "Finished"),
        ("cancelled", "Cancelled"),
    ]
    OPEN_STATUSES = ("planned", "waitlist", "active", "onhold")

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="episodes")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="waitlist")
    period_start = models.DateTimeField(default=timezone.now)
    period_end = models.DateTimeField(null=True, blank=True)
    care_manager = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    presenting_problems = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-period_start"]

    def transition(self, new_status, user=None, at=None):
        """Change state and record it in the status history — the waitlist →
        active timestamp is the only record of waiting time (CLAUDE.md §4)."""
        if new_status == self.status:
            return
        at = at or timezone.now()
        EpisodeStatusHistory.objects.filter(episode=self, period_end__isnull=True).update(
            period_end=at
        )
        EpisodeStatusHistory.objects.create(
            organization_id=self.organization_id,
            episode=self,
            status=new_status,
            period_start=at,
            changed_by=user,
        )
        self.status = new_status
        if new_status in ("finished", "cancelled"):
            self.period_end = at
        self.save(update_fields=["status", "period_end", "updated_at"])

    def __str__(self):
        return f"Episode {self.status} — {self.patient}"


class EpisodeStatusHistory(TenantScopedModel):
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, related_name="status_history"
    )
    status = models.CharField(max_length=12, choices=EpisodeOfCare.STATUS_CHOICES)
    period_start = models.DateTimeField(default=timezone.now)
    period_end = models.DateTimeField(null=True, blank=True)
    changed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["period_start"]


# ── Triage ──


class TriageEncounter(TenantScopedModel):
    """One arrival sent to triage (doc 15 §1.4–§1.7). FHIR Encounter (triage)."""

    STATUS_AWAITING = "AWAITING"
    STATUS_IN_TRIAGE = "IN_TRIAGE"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_RECHECK_COMPLETED = "RECHECK_COMPLETED"
    STATUS_CHOICES = [
        (STATUS_AWAITING, "Awaiting triage"),
        (STATUS_IN_TRIAGE, "In triage"),
        (STATUS_COMPLETED, "Triage completed"),
        (STATUS_RECHECK_COMPLETED, "Re-check completed"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="triage_encounters")
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, related_name="triage_encounters"
    )
    encounter = models.OneToOneField(
        Encounter, on_delete=models.PROTECT, related_name="triage_encounter"
    )
    # Idempotency key from the registration form (CLAUDE.md §4 "Fail safely").
    client_request_id = models.CharField(max_length=64)
    visit_number = models.PositiveIntegerField(default=1)
    arrival_at = models.DateTimeField(default=timezone.now)
    due_at = models.DateTimeField()
    presenting_concern = models.TextField(blank=True)
    referral_source = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_AWAITING)
    priority = models.CharField(max_length=8, choices=PRIORITY_CHOICES, blank=True)
    triage_started_at = models.DateTimeField(null=True, blank=True)
    triage_started_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    full_retriage_requested_at = models.DateTimeField(null=True, blank=True)
    triage_version = models.PositiveIntegerField(default=0)
    last_triaged_at = models.DateTimeField(null=True, blank=True)
    last_triaged_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    next_recheck_at = models.DateTimeField(null=True, blank=True)
    psychiatry_review_started_at = models.DateTimeField(null=True, blank=True)
    psychiatry_encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    registered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-arrival_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "client_request_id"],
                name="unique_triage_request_per_org",
            )
        ]

    @property
    def effective_status(self):
        """Status as the worklist shows it — a completed triage becomes
        "Re-check due" once its re-check time arrives, until psychiatry opens
        the review."""
        if (
            self.status in (self.STATUS_COMPLETED, self.STATUS_RECHECK_COMPLETED)
            and self.next_recheck_at
            and self.psychiatry_review_started_at is None
            and self.next_recheck_at <= timezone.now()
        ):
            return "RECHECK_DUE"
        return self.status

    def __str__(self):
        return f"Triage {self.get_status_display()} — {self.patient}"


class SignedRecordMixin(models.Model):
    """A signed (completed) record is immutable; corrections are a new version."""

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk:
            stored = type(self).all_objects.filter(pk=self.pk).values_list("status", flat=True)
            if stored and stored[0] == "COMPLETED":
                raise PermissionError("This record is signed and cannot be changed.")
        super().save(*args, **kwargs)


class TriageAssessment(SignedRecordMixin, TenantScopedModel):
    """Sections A–N of initial triage. FHIR QuestionnaireResponse; draft =
    in-progress (server-side, never browser storage — doc 15 C1)."""

    STATUS_CHOICES = [("IN_PROGRESS", "In progress"), ("COMPLETED", "Signed")]
    DECISION_CHOICES = [("CONFIRM", "Confirm recommendation"), ("OVERRIDE", "Override")]

    triage_encounter = models.ForeignKey(
        TriageEncounter, on_delete=models.PROTECT, related_name="assessments"
    )
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="IN_PROGRESS")
    answers = models.JSONField(default=dict, blank=True)
    tasks_snapshot = models.JSONField(default=list, blank=True)
    findings = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)
    recommendation = models.CharField(max_length=64, blank=True)
    recommendation_reasons = models.TextField(blank=True)
    final_priority = models.CharField(max_length=8, choices=PRIORITY_CHOICES, blank=True)
    decision = models.CharField(max_length=10, choices=DECISION_CHOICES, blank=True)
    override_reason = models.TextField(blank=True)
    rules_version = models.CharField(max_length=32, blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    draft_saved_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-version"]


class TriageRecheck(SignedRecordMixin, TenantScopedModel):
    """Quick re-check (doc 15 §1.7). FHIR QuestionnaireResponse + Observations."""

    STATUS_CHOICES = [("IN_PROGRESS", "In progress"), ("COMPLETED", "Signed")]

    triage_encounter = models.ForeignKey(
        TriageEncounter, on_delete=models.PROTECT, related_name="rechecks"
    )
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="IN_PROGRESS")
    change_since_last_check = models.CharField(max_length=32, blank=True)
    distress_behaviour = models.CharField(max_length=32, blank=True)
    # {"heartRate": {"value": "88", "status": "MEASURED"}, ...}
    observations = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    draft_saved_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-version"]


class ClinicalAlert(TenantScopedModel):
    """Critical clinical alert shown on the safety banner. FHIR Flag."""

    STATUS_CHOICES = [("ACTIVE", "Active"), ("RESOLVED", "Resolved")]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="clinical_alerts")
    # Code from the `clinical-alert` LocalValueSet.
    alert_code = models.CharField(max_length=40)
    label = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ACTIVE")
    source_assessment = models.ForeignKey(
        TriageAssessment, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    raised_at = models.DateTimeField(default=timezone.now)
    raised_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["raised_at"]


class CareTask(TenantScopedModel):
    """Trackable immediate action from triage section N. FHIR Task."""

    STATUS_CHOICES = [
        ("INITIATED", "Initiated"),
        ("PENDING", "Pending"),
        ("COMPLETED", "Completed"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="care_tasks")
    triage_encounter = models.ForeignKey(
        TriageEncounter, on_delete=models.PROTECT, null=True, blank=True, related_name="tasks"
    )
    # Code from the `triage-action` LocalValueSet; label kept as shown at the time.
    action_code = models.CharField(max_length=40)
    action_label = models.CharField(max_length=255)
    owner = models.CharField(max_length=150)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="INITIATED")
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]


# ── Client journey ──


class IntakeAssessment(TenantScopedModel):
    """Intake & Clinical Assessment (doc 15 §1.17, Journey → Intake). Each save
    is a new version; earlier ones are kept as "Previous Assessments"."""

    RISK_CHOICES = [("LOW", "Low Risk"), ("MODERATE", "Moderate Risk"), ("HIGH", "High Risk")]

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="intake_assessments"
    )
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    encounter = models.ForeignKey(
        Encounter, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    presenting_concern = models.TextField(blank=True)
    history = models.TextField(blank=True)
    symptoms = models.JSONField(default=list, blank=True)
    risk_level = models.CharField(max_length=10, choices=RISK_CHOICES, blank=True)
    risk_notes = models.TextField(blank=True)
    # The MSE lives in one store only — triage.MentalStatusExam (CLAUDE.md §4/§5,
    # "if a clinical concept appears in two places in the UI it is one profile and
    # one store"). The intake's four MSE fields are saved there and linked here.
    mse = models.ForeignKey(
        "triage.MentalStatusExam",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    gad7_score = models.PositiveSmallIntegerField(null=True, blank=True)
    phq9_score = models.PositiveSmallIntegerField(null=True, blank=True)
    formulation = models.TextField(blank=True)
    clinical_decision = models.CharField(max_length=32, blank=True)
    care_needs = models.JSONField(default=list, blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class OutcomeScore(TenantScopedModel):
    INSTRUMENT_CHOICES = [("PHQ9", "PHQ-9"), ("GAD7", "GAD-7")]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="outcome_scores")
    instrument = models.CharField(max_length=8, choices=INSTRUMENT_CHOICES)
    score = models.PositiveSmallIntegerField()
    recorded_at = models.DateTimeField(default=timezone.now)
    source_intake = models.ForeignKey(
        IntakeAssessment, on_delete=models.SET_NULL, null=True, blank=True, related_name="scores"
    )
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["recorded_at"]


class CarePlan(TenantScopedModel):
    """One plan per episode: the outpatient treatment plan fields (doc 15
    §1.11) plus the Journey care-plan actions (CarePlanActivity)."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="care_plans")
    episode = models.OneToOneField(
        EpisodeOfCare, on_delete=models.PROTECT, related_name="care_plan"
    )
    plan_type = models.CharField(max_length=40, blank=True)
    interventions = models.JSONField(default=list, blank=True)
    goals = models.TextField(blank=True)
    review_date = models.DateField(null=True, blank=True)
    care_coordinator = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )


class CarePlanActivity(TenantScopedModel):
    STATUS_CHOICES = [
        ("PLANNED", "Planned"),
        ("SCHEDULED", "Scheduled"),
        ("ACTIVE", "Active"),
        ("COMPLETED", "Completed"),
    ]

    care_plan = models.ForeignKey(CarePlan, on_delete=models.PROTECT, related_name="activities")
    title = models.CharField(max_length=255)
    goal = models.TextField(blank=True)
    # Code from the `care-module` LocalValueSet (Psychiatry Module, Nursing Module, …).
    module = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="PLANNED")
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]


class BillingService(TenantScopedModel):
    """Facility tariff line. Rates are never invented (doc 15 C3): a service
    with no rate is excluded from billing with a visible notice."""

    name = models.CharField(max_length=150)
    rate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="unique_billing_service_per_org"
            )
        ]

    def __str__(self):
        return self.name


class InterventionRecord(TenantScopedModel):
    """Intervention Engine record (doc 15 §1.17). A billable one creates a ChargeItem."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="interventions")
    activity = models.ForeignKey(
        CarePlanActivity, on_delete=models.PROTECT, related_name="interventions"
    )
    performed_at = models.DateTimeField(default=timezone.now)
    provider = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    intervention = models.CharField(max_length=255)
    response = models.TextField(blank=True)
    next_action = models.CharField(max_length=255, blank=True)
    billable = models.BooleanField(default=False)
    billing_service = models.ForeignKey(
        BillingService, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    quantity = models.PositiveSmallIntegerField(default=1)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-performed_at"]


class ChargeItem(TenantScopedModel):
    """A documented delivered service. FHIR ChargeItem. `unit_price` is the
    tariff rate at the time of delivery; null when no rate was configured."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="charge_items")
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    service = models.ForeignKey(BillingService, on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveSmallIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    delivered_at = models.DateTimeField(default=timezone.now)
    intervention = models.OneToOneField(
        InterventionRecord,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="charge_item",
    )
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-delivered_at"]


class ConsentTemplate(TenantScopedModel):
    """Facility-approved consent wording (docs/15 §1.9 Legal & consent). Legal
    text is set by the facility, never written by the system; each change is a
    new version, and every ConsentRecord snapshots the exact wording shown."""

    CONSENT_TYPE_CHOICES = [("DATA_SHARING_HIE", "Data sharing (health information exchange)")]

    consent_type = models.CharField(max_length=32, choices=CONSENT_TYPE_CHOICES)
    version = models.CharField(max_length=32)
    text = models.TextField()
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "consent_type", "version"],
                name="unique_consent_template_version",
            )
        ]


class DischargeSummary(SignedRecordMixin, TenantScopedModel):
    """Signed discharge record for one inpatient admission (docs/17).

    FHIR: Composition (discharge summary) in a document Bundle with the IMP
    Encounter (`hospitalization.dischargeDisposition`, `period.end`), coded
    Conditions, MedicationRequests and a Provenance. It hangs off the
    admission's Encounter inside the client's EpisodeOfCare and puts no
    clinical content on the episode (CLAUDE.md §4).

    A signed row is immutable (SignedRecordMixin). A correction is a new
    version whose `supersedes` points at the row it replaces; the original is
    never edited, so the record that was relied on stays recoverable.
    """

    STATUS_CHOICES = [("IN_PROGRESS", "In progress"), ("COMPLETED", "Signed")]

    admission = models.ForeignKey(
        "ipd_ward.Admission", on_delete=models.PROTECT, related_name="discharge_summaries"
    )
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="discharge_summaries"
    )
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    encounter = models.ForeignKey(
        Encounter, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    version = models.PositiveIntegerField(default=1)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="amended_by"
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="IN_PROGRESS")

    # Value-set code from `discharge-disposition`.
    disposition = models.CharField(max_length=32, blank=True)
    destination = models.CharField(max_length=255, blank=True)
    discharged_at = models.DateTimeField(null=True, blank=True)
    clinical_status = models.TextField(blank=True)
    treatment_summary = models.TextField(blank=True)
    # Required when the admission was involuntary: what became of the legal order.
    legal_status_at_discharge = models.TextField(blank=True)
    # Coded: ICD-11 diagnoses already recorded on the admission's Encounter.
    diagnoses = models.ManyToManyField(
        "clinical_encounter.DiagnosisCode", blank=True, related_name="+"
    )
    # Codes from `discharge-education`.
    education = models.JSONField(default=list, blank=True)
    follow_up_appointment = models.ForeignKey(
        "client_registry.Appointment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    draft_saved_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Authority (CLAUDE.md §3.4: "on whose authority"): the signer's role at the
    # moment of signing, kept because roles can change later.
    signed_role = models.CharField(max_length=100, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["admission", "version"], name="unique_discharge_version_per_admission"
            )
        ]

    def __str__(self):
        return f"Discharge v{self.version} ({self.get_status_display()}) — {self.patient}"


class DischargeMedicationLine(TenantScopedModel):
    """One line of the discharge medication reconciliation. FHIR MedicationRequest.

    `PrescriptionItem` has no status, so what continues, stops, changes or is
    new at discharge is recorded here. Lines of a signed summary are frozen.
    """

    summary = models.ForeignKey(
        DischargeSummary, on_delete=models.PROTECT, related_name="medications"
    )
    prescription_item = models.ForeignKey(
        "clinical_encounter.PrescriptionItem",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    drug = models.ForeignKey(
        "dha_interop.NationalDrugIndex", on_delete=models.PROTECT, related_name="+"
    )
    dose = models.CharField(max_length=100, blank=True)
    route = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration = models.CharField(max_length=100, blank=True)
    # Code from `discharge-medication-action`.
    action = models.CharField(max_length=16)
    note = models.CharField(max_length=255, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]

    def _summary_is_signed(self):
        return DischargeSummary.all_objects.filter(pk=self.summary_id, status="COMPLETED").exists()

    def save(self, *args, **kwargs):
        if self._summary_is_signed():
            raise PermissionError(
                "This discharge summary is signed; its medication lines are frozen."
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self._summary_is_signed():
            raise PermissionError(
                "This discharge summary is signed; its medication lines are frozen."
            )
        return super().delete(*args, **kwargs)
