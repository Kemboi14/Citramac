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
    # "Emergency — identity unknown" arrival details, as recorded at the desk.
    # Text only, kept with this arrival; not emitted in FHIR. `apparent_sex` is a
    # code of the served `apparent-sex` value set — an observation, never
    # written to Patient.gender.
    apparent_sex = models.CharField(max_length=20, blank=True)
    found_location = models.CharField(
        "Where the person was found or brought from", max_length=255, blank=True
    )
    arrival_referral_info = models.TextField(
        "Police / ambulance / referral information", blank=True
    )
    identification_notes = models.TextField(
        "How the person can currently be identified", blank=True
    )
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


class ClinicalFinding(TenantScopedModel):
    """One version of a clinical finding (triage spec §17): e.g. the client's
    suicide / self-harm finding, read and extended by Triage, Intake, Risk, Care
    Plan and Follow-up instead of each stage keeping its own copy.

    Append-only: confirming or updating a finding writes a new version that
    supersedes the previous one, so the earlier value, who recorded it and when
    stay in the history (spec §18 "update, do not re-enter"). The current finding
    for a `key` is its highest version. FHIR Observation (+ Provenance)."""

    STATUS_CHOICES = [
        ("PRESENT", "Present"),
        ("ABSENT", "Not present"),
        ("UNKNOWN", "Unable to determine"),
    ]
    ACTION_CHOICES = [
        ("RECORDED", "Recorded"),
        ("CONFIRMED", "Confirmed unchanged"),
        ("UPDATED", "Updated"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="clinical_findings")
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    encounter = models.ForeignKey(
        Encounter, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # e.g. "SUICIDE_SELF_HARM", "SUBSTANCE:alcohol" — one current finding per key.
    key = models.CharField(max_length=60)
    # Code from the `clinical-finding-domain` LocalValueSet.
    domain = models.CharField(max_length=30)
    title = models.CharField(max_length=120)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    summary = models.TextField(blank=True)
    # The coded answers this version rests on (answer key → code(s)).
    values = models.JSONField(default=dict, blank=True)
    note = models.TextField(blank=True)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, default="RECORDED")
    # Workflow stage that wrote this version: TRIAGE, INTAKE, …
    stage = models.CharField(max_length=20)
    # Source (spec §18 SHOW SOURCE): CLIENT_REPORT, THIRD_PARTY_REPORT,
    # CLINICIAN_OBSERVATION, MEASUREMENT, PREVIOUS_RECORD, ASSESSMENT.
    source_code = models.CharField(max_length=30)
    source_label = models.CharField(max_length=120)
    source_detail = models.CharField(max_length=200, blank=True)
    # The signed record this version came from, e.g. ("TriageAssessment", id).
    source_type = models.CharField(max_length=40, blank=True)
    source_id = models.UUIDField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    supersedes = models.OneToOneField(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="superseded_by"
    )
    recorded_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["key", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["patient", "key", "version"], name="uniq_clinical_finding_version"
            )
        ]


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
    # FHIR Task.priority / executionPeriod.end / focus / owner — optional; set by
    # workflows that schedule a task (e.g. legal status reviews, LGL-WF-03).
    priority = models.CharField(
        max_length=8, blank=True, choices=[("routine", "Routine"), ("urgent", "Urgent"), ("asap", "ASAP")]
    )
    due_at = models.DateTimeField(null=True, blank=True)
    assignee = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    focus_type = models.CharField(max_length=40, blank=True)
    focus_id = models.CharField(max_length=64, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
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

    # ── Sectioned intake (mockup v4 stage 3). A DRAFT is edited in place and
    # autosaved; signing locks it (never edited again — a correction is a new
    # version cloned from it, CLAUDE.md §3 item 7). `sections` is keyed by the
    # served schema's section keys (care_pathway.intake_schema); `section_state`
    # holds Not started / In progress / Complete / Not applicable per section.
    STATUS_DRAFT = "DRAFT"
    STATUS_SIGNED = "SIGNED"
    STATUS_CHOICES = [(STATUS_DRAFT, "Draft"), (STATUS_SIGNED, "Signed")]
    COMPLETENESS_CHOICES = [
        ("COMPLETE", "Complete"),
        ("PARTIAL", "Partially complete — clinically safe to continue later"),
        ("UNABLE", "Unable to complete"),
    ]
    version = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    completeness = models.CharField(max_length=8, choices=COMPLETENESS_CHOICES, blank=True)
    sections = models.JSONField(default=dict, blank=True)
    section_state = models.JSONField(default=dict, blank=True)
    current_section = models.CharField(max_length=16, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Outstanding items at signing time, kept so a partial intake's handover
    # says exactly what was left.
    outstanding = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class MedicationHistoryEntry(TenantScopedModel):
    """One line of the client's current / past medication list taken at intake
    (FHIR MedicationStatement — what the client reports taking, not an order).
    One shared list for intake, the MAR and discharge reconciliation
    (CLAUDE.md §4 one store). VERIFY: bind `name` to the national drug index via
    the terminology server; until then `drug_code` stays blank rather than guessed."""

    STATUS_CHOICES = [
        ("TAKING", "Taking"),
        ("STOPPED", "Stopped"),
        ("INTERMITTENT", "Intermittent"),
        ("UNKNOWN", "Unknown"),
    ]
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="medication_history"
    )
    episode = models.ForeignKey(
        EpisodeOfCare, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    name = models.CharField(max_length=255)
    drug_code = models.CharField(max_length=32, blank=True)
    dose = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    route = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=14, choices=STATUS_CHOICES, default="TAKING")
    reason = models.CharField(max_length=255, blank=True)
    source = models.CharField(max_length=100, blank=True)
    started_on = models.DateField(null=True, blank=True)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)
    # Retired entries stay (never deleted): a correction supersedes.
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["recorded_at"]

    def __str__(self):
        return f"{self.name} {self.dose}".strip()


class OutcomeScore(TenantScopedModel):
    # Instrument definitions live in care_pathway.instruments (one registry).
    INSTRUMENT_CHOICES = [
        ("PHQ9", "PHQ-9"),
        ("GAD7", "GAD-7"),
        ("PHQA", "PHQ-A"),
        ("EPDS", "EPDS"),
        ("MDQ", "MDQ"),
        ("PAWSS", "PAWSS"),
        ("CIWA", "CIWA-Ar"),
        ("COWS", "COWS"),
        ("AUDITC", "AUDIT-C"),
        ("PCL5", "PCL-5"),
        ("COG", "Cognitive screen"),
        ("CRI", "CRI (experimental)"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="outcome_scores")
    instrument = models.CharField(max_length=8, choices=INSTRUMENT_CHOICES)
    score = models.PositiveSmallIntegerField()
    # Item-level answers (option points, in item order) when the instrument is
    # scored from items — kept so a total can always be re-derived (CLAUDE.md §3
    # item 7: never store only a total when the items exist).
    items = models.JSONField(default=list, blank=True)
    # Findings the clinician had to see at recording (e.g. PHQ-9 item 9 positive).
    flags = models.JSONField(default=list, blank=True)
    positive = models.BooleanField(null=True, blank=True)
    # Answers that are not summed items: EPDS item 10, MDQ co-occurrence and
    # impairment, the PAWSS threshold question (instruments.SUPPLEMENTARY).
    detail = models.JSONField(default=dict, blank=True)
    context = models.CharField(max_length=24, blank=True)
    # Baseline / repeat / … — a code of the served `assessment-timepoint` value set.
    timepoint = models.CharField(max_length=16, blank=True)
    note = models.CharField(max_length=400, blank=True)
    recorded_at = models.DateTimeField(default=timezone.now)
    source_intake = models.ForeignKey(
        IntakeAssessment, on_delete=models.SET_NULL, null=True, blank=True, related_name="scores"
    )
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["recorded_at"]


class AssessmentAttempt(TenantScopedModel):
    """An assessment that could not be scored (too drowsy, declined, …). Kept
    so a missed withdrawal chart is visible rather than silently absent."""

    REASON_CHOICES = [
        ("SEDATED", "Too drowsy / sedated"),
        ("AGITATED", "Too agitated"),
        ("DECLINED", "Declined"),
        ("COMMUNICATION", "Language / communication barrier"),
        ("CONFUSED", "Confused — possible delirium"),
    ]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="assessment_attempts")
    instrument = models.CharField(max_length=8)
    reason = models.CharField(max_length=14, choices=REASON_CHOICES)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-recorded_at"]


class AssessmentToolDecision(TenantScopedModel):
    """A clinician's decision on a recommended assessment tool — append-only;
    the latest row per (patient, tool) is current. Recommendations themselves
    are computed from the record (care_pathway.tools), never stored."""

    STATUS_CHOICES = [("ACCEPTED", "Accepted"), ("DECLINED", "Declined"), ("RECONSIDERED", "Reconsidered")]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="tool_decisions")
    tool = models.CharField(max_length=24)
    status = models.CharField(max_length=14, choices=STATUS_CHOICES)
    reason = models.CharField(max_length=400, blank=True)
    why = models.JSONField(default=list, blank=True)
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-decided_at"]


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

    # ── Confirmation (mockup v4 stage 4). A plan is confirmed by signing; each
    # signing is a new immutable CarePlanVersion, so history is never rewritten.
    version = models.PositiveSmallIntegerField(default=0)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # A code of the served `care-plan-agreement` value set.
    client_agreement = models.CharField(max_length=10, blank=True)
    # [{"part": <care-plan-disagreement-part code>, "words": the client's own words}]
    disagreements = models.JSONField(default=list, blank=True)
    what_matters = models.TextField(blank=True)
    rationale = models.TextField(blank=True)
    senior_reviewer = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    contact_72h_at = models.DateTimeField(null=True, blank=True)
    follow_up_clinician = models.CharField(max_length=150, blank=True)
    means_counselling_done = models.BooleanField(default=False)

    # ── With the client (mockup v4). Goals are the client's own words, each
    # optionally linked to a plan action and a 5P formulation heading:
    # [{"goal", "action_key", "formulation" (<formulation-5p code>), "owner",
    #   "review_date" (YYYY-MM-DD), "source"}]. FHIR: Goal, referenced from CarePlan.goal.
    goal_items = models.JSONField(default=list, blank=True)
    crisis_plan = models.TextField(blank=True)
    family_involvement = models.TextField(blank=True)
    advance_statement = models.TextField(blank=True)
    # Opioid safety: naloxone and overdose-risk teaching planned for discharge, and
    # whether opioid agonist therapy was offered (served `oat-offer` code).
    naloxone_teaching = models.BooleanField(default=False)
    oat_offer = models.CharField(max_length=24, blank=True)
    # The client read the plan on this device and acknowledged it (co-production view).
    client_ack_at = models.DateTimeField(null=True, blank=True)
    client_ack_language = models.CharField(max_length=2, blank=True)
    client_ack_recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Planned-discharge checklist answers for an episode that ends without an
    # inpatient discharge summary (same keys as DischargeSummary.readiness).
    discharge_readiness = models.JSONField(default=dict, blank=True)


class CarePlanVersion(TenantScopedModel):
    """The signed, immutable snapshot of a plan (what was decided, by whom)."""

    care_plan = models.ForeignKey(CarePlan, on_delete=models.PROTECT, related_name="versions")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    version = models.PositiveSmallIntegerField()
    snapshot = models.JSONField(default=dict)
    conflicts = models.JSONField(default=list, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    signed_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["care_plan", "version"], name="unique_care_plan_version")
        ]


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
    # ── From the recommendation engine (care_pathway.care_plan). `action_key` ties
    # the row to the catalogue; `recommended_priority` is what the system
    # suggested and `priority` what the clinician set — lowering it needs a reason.
    DECISION_CHOICES = [
        ("ACCEPTED", "Accepted"),
        ("MODIFIED", "Modified"),
        ("ADDED", "Added by clinician"),
        ("DECLINED", "Declined"),
    ]
    action_key = models.CharField(max_length=24, blank=True)
    decision = models.CharField(max_length=9, choices=DECISION_CHOICES, blank=True)
    priority = models.CharField(max_length=8, choices=PRIORITY_CHOICES, blank=True)
    recommended_priority = models.CharField(max_length=8, choices=PRIORITY_CHOICES, blank=True)
    instructions = models.TextField(blank=True)
    reason = models.TextField(blank=True)  # lowering the priority, or declining
    why = models.JSONField(default=list, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    # Accepted with "Accept the N remaining" — the signer must confirm they
    # reviewed each one before the plan can be signed (RULE-05).
    bulk_accepted = models.BooleanField(default=False)

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]


class CarePlanTask(TenantScopedModel):
    """One checklist item under a plan action, with an owner role and due time."""

    activity = models.ForeignKey(CarePlanActivity, on_delete=models.PROTECT, related_name="tasks")
    label = models.CharField(max_length=300)
    owner_role = models.CharField(max_length=40, blank=True)
    assignee = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    due_at = models.DateTimeField(null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)
    done_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]


class SafetyPlan(TenantScopedModel):
    """The written, client-held safety plan (Stanley–Brown style sections as in
    the mockup). Versioned: a signed plan is never edited — a revision is a new
    row. Content is the client's own words."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="safety_plans")
    version = models.PositiveSmallIntegerField(default=1)
    warning_signs = models.TextField(blank=True)
    coping = models.TextField(blank=True)
    self_talk = models.TextField(blank=True)
    places_people_distract = models.TextField(blank=True)
    people_to_ask = models.TextField(blank=True)
    professionals = models.TextField(blank=True)
    safer_surroundings = models.TextField(blank=True)
    reasons_for_living = models.TextField(blank=True)
    keepsake = models.TextField(blank=True)
    language = models.CharField(max_length=2, default="en")
    copy_given_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["patient", "version"], name="unique_safety_plan_version")
        ]


class MdtReview(TenantScopedModel):
    """A multidisciplinary review of the plan — scheduled, then held and minuted."""

    care_plan = models.ForeignKey(CarePlan, on_delete=models.PROTECT, related_name="mdt_reviews")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    scheduled_for = models.DateField()
    held_at = models.DateTimeField(null=True, blank=True)
    attendees = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    outcome = models.TextField(blank=True)
    # Differing views recorded as they were voiced — a decision is not unanimous
    # just because only the decision was written down.
    dissent = models.TextField(blank=True)
    next_review = models.DateField(null=True, blank=True)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["scheduled_for"]


class NursingCarePlanEntry(TenantScopedModel):
    """One nursing problem: problem → goal → interventions → evaluation, linked to
    the MDT plan action it serves. Written once; each evaluation is appended with
    who wrote it and when, and the problem and goal are never rewritten.
    FHIR: CarePlan (category nursing) with a Goal and activity, part of the
    episode's CarePlan."""

    care_plan = models.ForeignKey(CarePlan, on_delete=models.PROTECT, related_name="nursing_entries")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    activity = models.ForeignKey(
        CarePlanActivity, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    problem = models.CharField(max_length=300)
    goal = models.CharField(max_length=300)
    interventions = models.TextField(blank=True)
    # [{"text", "by" (user display), "by_id", "at" (ISO time)}], oldest first.
    evaluations = models.JSONField(default=list, blank=True)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["recorded_at"]


class CosignRequest(TenantScopedModel):
    """A request for a senior clinician's signature on something a junior
    clinician decided (a plan that conflicts with the client's priority, a
    priority downgrade …). The decider is never the requester."""

    STATUS_CHOICES = [
        ("REQUESTED", "Requested"),
        ("SIGNED", "Signed"),
        ("DECLINED", "Declined"),
        ("ACKNOWLEDGED", "Decline acknowledged"),
    ]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="cosign_requests")
    kind = models.CharField(max_length=32)
    what = models.CharField(max_length=300)
    subject_type = models.CharField(max_length=40, blank=True)
    subject_id = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="REQUESTED")
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    requested_at = models.DateTimeField(default=timezone.now)
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decline_reason = models.TextField(blank=True)
    # [{by, at, note}] — discussion between requester and senior.
    thread = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-requested_at"]


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
    """Care delivered, recorded from an Interventions module (v4 mockup drawer).
    FHIR Procedure (`activity` → basedOn the CarePlan activity, when linked).
    A billable record creates a ChargeItem. Records are never deleted: a
    correction voids the record and keeps the before/after in `corrections`."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="interventions")
    # Optional: the v4 drawer allows "Not linked to a care-plan action".
    activity = models.ForeignKey(
        CarePlanActivity,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="interventions",
    )
    # Code from the `intervention-module` LocalValueSet (e.g. "group_psychotherapy").
    module = models.CharField(max_length=40, blank=True)
    performed_at = models.DateTimeField(default=timezone.now)
    provider = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    intervention = models.CharField(max_length=255)
    note = models.TextField(blank=True)  # "What was done"
    response = models.TextField(blank=True)
    outcome = models.TextField(blank=True)
    next_action = models.CharField(max_length=255, blank=True)
    completes_activity = models.BooleanField(default=False)
    billable = models.BooleanField(default=False)
    billing_service = models.ForeignKey(
        BillingService, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    quantity = models.PositiveSmallIntegerField(default=1)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.TextField(blank=True)
    # [{at, by, reason, before, after}] — append-only correction trail.
    corrections = models.JSONField(default=list, blank=True)

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
    # Set when the source intervention is voided; voided charges are not billed.
    voided_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-delivered_at"]


class ConsentTemplate(TenantScopedModel):
    """Facility-approved consent wording (docs/15 §1.9 Legal & consent). Legal
    text is set by the facility, never written by the system; each change is a
    new version, and every ConsentRecord snapshots the exact wording shown."""

    CONSENT_TYPE_CHOICES = [
        ("DATA_SHARING_HIE", "Data sharing (health information exchange)"),
        # Release authorizations the documents module checks (DOC-CI-06). With
        # an active template the authorization snapshots the facility's own
        # wording; without one it stays a structured-scope record.
        ("EMPLOYER_COMMUNICATION", "Communicating with the client's employer"),
        ("SCHOOL_COMMUNICATION", "Communicating with the client's school / university"),
        ("RELEASE_OF_INFORMATION", "Releasing health information to a named third party"),
        ("AI_NOTE_PROCESSING", "AI-assisted processing of psychotherapy notes"),
    ]

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
    readiness = models.JSONField(default=dict, blank=True)  # discharge readiness checklist answers
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


# ── Interventions: observation & safety, restrictive practice ──


class ObservationLevelChange(TenantScopedModel):
    """Append-only history of the client's observation level; the latest row is
    current. A change always carries a reason."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="observation_levels")
    level = models.CharField(max_length=24)
    reason = models.CharField(max_length=400)
    changed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    changed_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-changed_at"]


class ObserverHandover(TenantScopedModel):
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="observer_handovers")
    observer_name = models.CharField(max_length=150)
    observer_gender = models.CharField(max_length=10, blank=True)
    since = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-since"]


class ObservationEntry(TenantScopedModel):
    """A signed observation: where the client was, how they were engaging, and
    what the observer saw."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="observation_entries")
    location = models.CharField(max_length=100)
    engagement = models.CharField(max_length=100, blank=True)
    note = models.TextField()
    observed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    observed_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-observed_at"]


class RestrictivePracticeEpisode(TenantScopedModel):
    """Seclusion, physical restraint or rapid tranquillisation — a legally and
    clinically sensitive record. De-escalation must be documented first; the
    timed monitoring checks are scheduled from configuration (VERIFY: the
    facility's restrictive-practice policy), never assumed."""

    KIND_CHOICES = [
        ("SECLUSION", "Seclusion"),
        ("RESTRAINT", "Physical restraint"),
        ("RAPID_TRANQUILLISATION", "Rapid tranquillisation (IM)"),
    ]
    INJURY_CHOICES = [
        ("NONE", "No injury"),
        ("MINOR", "Minor injury — treated"),
        ("REVIEW", "Injury — medical review requested"),
    ]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="restrictive_episodes")
    kind = models.CharField(max_length=24, choices=KIND_CHOICES)
    de_escalation = models.JSONField(default=list)  # which approaches were tried first
    authorised_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="+"
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    injury_check = models.CharField(max_length=8, choices=INJURY_CHOICES)
    incident_reference = models.CharField(max_length=100, blank=True)
    client_debrief_at = models.DateTimeField(null=True, blank=True)
    staff_debrief_held = models.BooleanField(default=False)
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-start_at"]


class RestrictiveCheck(TenantScopedModel):
    episode = models.ForeignKey(RestrictivePracticeEpisode, on_delete=models.PROTECT, related_name="checks")
    label = models.CharField(max_length=200)
    due_at = models.DateTimeField()
    done_at = models.DateTimeField(null=True, blank=True)
    done_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["due_at"]


# ── Risk proposals, capacity, visit consent, progress notes, episode outcome ──


class RiskProposal(TenantScopedModel):
    """A finding the system noticed (e.g. a positive self-harm item) queued for a
    clinician. It never changes the risk record itself: the clinician adds it,
    defers it or dismisses it with a reason, and each decision is kept."""

    STATUS_CHOICES = [
        ("PROPOSED", "Proposed"),
        ("ADDED", "Added to risk record"),
        ("DEFERRED", "Not now"),
        ("DISMISSED", "Dismissed"),
    ]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="risk_proposals")
    source = models.CharField(max_length=80)
    source_key = models.CharField(max_length=80)  # idempotency: one proposal per source finding
    row = models.CharField(max_length=24)
    option = models.CharField(max_length=60)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="PROPOSED")
    decided_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["patient", "source_key"], name="uniq_risk_proposal_source")
        ]


class CapacityAssessment(TenantScopedModel):
    """Decision-specific capacity. Signed on creation and never edited; a later
    assessment supersedes it, so capacity history is preserved."""

    ANSWER_CHOICES = [("Yes", "Yes"), ("No", "No"), ("Unsure", "Unsure")]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="capacity_assessments")
    decision = models.CharField(max_length=60)
    other_decision = models.CharField(max_length=200, blank=True)
    understand = models.CharField(max_length=6, choices=ANSWER_CHOICES)
    retain = models.CharField(max_length=6, choices=ANSWER_CHOICES)
    weigh = models.CharField(max_length=6, choices=ANSWER_CHOICES)
    communicate = models.CharField(max_length=6, choices=ANSWER_CHOICES)
    outcome = models.CharField(max_length=24)
    reassess_by = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)
    assessed_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    assessed_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-assessed_at"]


class VisitConsent(TenantScopedModel):
    """Consent for a specific decision, who gave it and how. A deferred
    (emergency) consent stays open as a task until completed."""

    PARTY_CHOICES = [
        ("PATIENT", "Patient"),
        ("GUARDIAN", "Parent / guardian (minor)"),
        ("SUBSTITUTE", "Substitute decision-maker"),
        ("DEFERRED", "Deferred — emergency"),
    ]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="visit_consents")
    scope = models.CharField(max_length=120)
    party = models.CharField(max_length=12, choices=PARTY_CHOICES)
    method = models.CharField(max_length=20, blank=True)
    given_by_name = models.CharField(max_length=150, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    recorded_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    recorded_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)  # deferred consent obtained later
    completed_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta(TenantScopedModel.Meta):
        ordering = ["-recorded_at"]


class ProgressNote(TenantScopedModel):
    """A clinical note by any discipline: draft, then signed. A signed note is
    never edited — a correction is an addendum that points at it."""

    STATUS_CHOICES = [("DRAFT", "Draft"), ("SIGNED", "Signed")]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="progress_notes")
    episode = models.ForeignKey("EpisodeOfCare", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    encounter = models.ForeignKey("clinical_encounter.Encounter", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    note_type = models.CharField(max_length=24)
    text = models.TextField(blank=True)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default="DRAFT")
    amends = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="addenda")
    author = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    signed_at = models.DateTimeField(null=True, blank=True)
    # The follow-up appointment this note records the contact for, if any.
    appointment = models.ForeignKey(
        "client_registry.Appointment", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class EpisodeOutcome(TenantScopedModel):
    """How an episode ended. Organisational only — no clinical content lives on
    the episode (CLAUDE.md §4). Closing also writes the episode status history."""

    OUTCOME_CHOICES = [
        ("PLANNED", "Discharged — planned"),
        ("LEFT_EARLY", "Left before planned discharge"),
        ("TRANSFERRED", "Transferred"),
        ("LOST", "Lost to follow-up"),
        ("DECEASED", "Deceased"),
    ]
    episode = models.OneToOneField("EpisodeOfCare", on_delete=models.PROTECT, related_name="outcome")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    outcome = models.CharField(max_length=12, choices=OUTCOME_CHOICES)
    destination = models.CharField(max_length=200, blank=True)
    reason = models.TextField(blank=True)
    recorded_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    recorded_at = models.DateTimeField(default=timezone.now)


class TherapyEpisode(TenantScopedModel):
    """The therapy contract for one client: what, how often and under what
    confidentiality terms. Session notes cannot be written until the limits of
    confidentiality are recorded as agreed. Sessions are stored in the existing
    PsychotherapySession table — one store, one row per client per session."""

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="therapy_episodes")
    modality = models.CharField(max_length=60)  # served value set "therapy-modality"
    planned_sessions = models.PositiveSmallIntegerField(null=True, blank=True)
    frequency = models.CharField(max_length=60, blank=True)
    trauma_phase = models.PositiveSmallIntegerField(null=True, blank=True)
    confidentiality_agreed_at = models.DateTimeField(null=True, blank=True)
    consent_to_record = models.BooleanField(default=False)
    under_supervision = models.BooleanField(default=False)
    activity = models.ForeignKey(
        "CarePlanActivity", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    started_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class OatEnrolment(TenantScopedModel):
    """Opioid agonist therapy: the referral and what the OAT prescriber set. This
    records the decision; it never suggests a medicine or dose (no formulary source).
    FHIR: MedicationRequest (category outpatient) with the OAT clinic as performer."""

    STATUS_CHOICES = [("REFERRED", "Referred"), ("ENROLLED", "Enrolled"), ("STOPPED", "Stopped")]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="oat_enrolments")
    medicine = models.CharField(max_length=20)  # served value set "oat-medicine"
    clinic = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="REFERRED")
    prescribed_dose = models.CharField(max_length=100, blank=True)  # as written by the OAT prescriber
    supervised_dispensing = models.BooleanField(default=True)
    status_reason = models.TextField(blank=True)
    recorded_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class NaloxoneSupply(TenantScopedModel):
    """Naloxone offered or supplied. FHIR: MedicationDispense when supplied."""

    OUTCOME_CHOICES = [("SUPPLIED", "Supplied"), ("DECLINED", "Offered and declined")]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="naloxone_supplies")
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES)
    quantity = models.PositiveSmallIntegerField(null=True, blank=True)
    training_given = models.BooleanField(default=False)
    given_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    given_at = models.DateTimeField(default=timezone.now)


class LabResultAcknowledgement(TenantScopedModel):
    """A prescriber's acknowledgement of a validated lab result. Results stay in the
    lims store; this only records who saw them and when (no second store of results)."""

    result = models.OneToOneField("lims.LabResult", on_delete=models.PROTECT, related_name="acknowledgement")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    acknowledged_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    acknowledged_at = models.DateTimeField(default=timezone.now)
    note = models.TextField(blank=True)


class LegalForm(TenantScopedModel):
    """A statutory form completed for a client. The catalogue of forms (numbers,
    titles, who may sign) is configuration — settings.LEGAL_FORM_CATALOGUE — because
    form numbers and statutory references must come from the regulator, not from us
    (CLAUDE.md §6). FHIR: Consent (policy) or DocumentReference, to be confirmed."""

    STATUS_CHOICES = [("DRAFT", "Draft"), ("COSIGN_REQUESTED", "Awaiting co-signature"), ("SIGNED", "Signed")]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="legal_forms")
    admission = models.ForeignKey("ipd_ward.Admission", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    form_key = models.CharField(max_length=60)
    content = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    prepared_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    signed_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    signed_at = models.DateTimeField(null=True, blank=True)
    cosign_request = models.ForeignKey("CosignRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")


# ── Group programme (v4 mockup "Group Psychotherapy" workspace) ──


class GroupProgrammeCategory(TenantScopedModel):
    """A session category the organisation runs (mockup "Category configuration").
    `code` is stable once created: modifying a category changes its display only,
    so sessions already recorded keep pointing at the same category."""

    code = models.SlugField(max_length=64)
    display = models.CharField(max_length=100)
    active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta(TenantScopedModel.Meta):
        ordering = ["order", "display"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="unique_group_category_code_per_org"
            )
        ]

    def __str__(self):
        return self.display


class GroupSession(TenantScopedModel):
    """One confirmed group session: the shared facts only. FHIR Appointment (the
    session) with the cohort as a FHIR Group. Each attendee's record is a separate
    GroupSessionEntry — nothing client-specific is ever stored here (CLAUDE.md §4,
    per-subject separation of multi-party sessions)."""

    category = models.ForeignKey(
        GroupProgrammeCategory, on_delete=models.PROTECT, related_name="sessions"
    )
    # The approved name typed when the "Other approved programme" category is chosen.
    category_other = models.CharField(max_length=100, blank=True)
    topic = models.CharField(max_length=160)
    session_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    facilitator = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Only for a facilitator who has no user account in the staff directory.
    facilitator_name = models.CharField(max_length=120, blank=True)
    documented_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    location = models.CharField(max_length=120)
    # The shared intervention only — never client-specific observations.
    description = models.TextField()
    appointment = models.ForeignKey(
        "client_registry.Appointment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # Idempotent confirm: a retried request returns the session already saved.
    client_request_id = models.UUIDField(null=True, blank=True)
    confirmed_at = models.DateTimeField(default=timezone.now)
    # [{at, by, reason, before, after}] — append-only correction trail.
    audit = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-session_date", "-start_time"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="group_session_ends_after_start",
            ),
            models.UniqueConstraint(
                fields=["organization", "client_request_id"],
                name="unique_group_session_request_per_org",
            ),
        ]


class GroupSessionEntry(TenantScopedModel):
    """One client's own record of a group session. FHIR Encounter: subject is this
    client, `appointment` → the shared session, `episodeOfCare` → the client's
    open episode. The observation is visible only on this client's record.

    `attendance` is a code from the served `group-attendance` value set (local
    code system). VERIFY: its mapping to the R4 participation-status binding
    (Appointment.participant.status) once the national IG names one.
    A risk disclosure always carries an observation and a follow-up task (FHIR Task)."""

    session = models.ForeignKey(GroupSession, on_delete=models.PROTECT, related_name="entries")
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="group_session_entries"
    )
    episode = models.ForeignKey(EpisodeOfCare, on_delete=models.PROTECT, related_name="+")
    attendance = models.CharField(max_length=16)
    observation = models.TextField(blank=True)
    risk_disclosure = models.BooleanField(default=False)
    # Served-lexicon matches found in the observation ([{matched, category,
    # passage}]) and, when the clinician did not mark them a risk disclosure,
    # why not. The alert a disclosure raised on this client's record.
    risk_detected = models.JSONField(default=list, blank=True)
    risk_override_reason = models.TextField(blank=True)
    risk_alert = models.ForeignKey(
        "ClinicalAlert", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    follow_up_task = models.ForeignKey(
        CareTask, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    intervention_record = models.OneToOneField(
        InterventionRecord,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="group_session_entry",
    )
    version = models.PositiveIntegerField(default=1)
    # [{at, by, reason, before, after}] — append-only correction trail.
    audit = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "patient"], name="unique_group_entry_per_client"
            )
        ]


# ── Psychotherapy Session note (master prompt §7) — defined in its own module ──
from .psychotherapy_models import (  # noqa: E402,F401
    ClinicalLexiconTerm,
    PsychotherapyNote,
    PsychotherapyNoteAmendment,
    TherapyModel,
)

# ── Legal admission status (master prompt §7A, LGL-*) — defined in its own module ──
from .legal_models import (  # noqa: E402,F401
    DischargeNotice,
    LegalDocument,
    LegalStatus,
    LegalStatusEvent,
)
