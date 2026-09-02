from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter, PrescriptionItem
from apps.tenancy.models import Branch, TenantScopedModel


class Ward(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.7 — ADT ward/bed allocation."""

    name = models.CharField(max_length=150)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True)
    ward_type = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return self.name


class Bed(TenantScopedModel):
    STATUS_CHOICES = [
        ("AVAILABLE", "Available"),
        ("OCCUPIED", "Occupied"),
        ("RESERVED", "Reserved"),
        ("MAINTENANCE", "Maintenance"),
    ]

    ward = models.ForeignKey(Ward, on_delete=models.CASCADE, related_name="beds")
    bed_number = models.CharField(max_length=50)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="AVAILABLE")

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["ward", "bed_number"], name="unique_bed_number_per_ward"
            )
        ]

    def __str__(self):
        return f"{self.ward.name} / Bed {self.bed_number}"


class Admission(TenantScopedModel):
    """
    ADT (Admission, Discharge, Transfer) — docs/07-CLINICAL-MODULES-SPEC.md §7.7.
    Voluntary/involuntary distinction and Mental Health Act (Cap. 248) legal-
    status tracking, admission-time consent/risk capture, and structured
    discharge planning are net-new here — nothing analogous existed before
    (see mockups/citramac_clinical_workspace.html's Admission screen).
    """

    STATUS_CHOICES = [
        ("ADMITTED", "Admitted"),
        ("DISCHARGED", "Discharged"),
        ("TRANSFERRED", "Transferred"),
    ]
    ADMISSION_TYPE_CHOICES = [
        ("VOLUNTARY", "Voluntary Admission"),
        ("INVOLUNTARY", "Involuntary Admission"),
    ]
    PRIORITY_CHOICES = [
        ("ROUTINE", "Routine"),
        ("URGENT", "Urgent"),
        ("EMERGENCY", "Emergency"),
    ]
    OBSERVATION_LEVEL_CHOICES = [
        ("ROUTINE", "Routine Observation"),
        ("ENHANCED", "Enhanced Observation"),
        ("CLOSE", "Close Observation"),
        ("CONTINUOUS", "Continuous Observation"),
    ]
    CONSENT_STATUS_CHOICES = [
        ("PENDING", "Consent Pending"),
        ("OBTAINED", "Consent Obtained"),
        ("DECLINED", "Consent Declined"),
    ]
    NOK_NOTIFICATION_CHOICES = [
        ("NOT_NOTIFIED", "Not Yet Notified"),
        ("NOTIFIED", "Notified"),
        ("NOT_APPLICABLE", "Notification Not Applicable"),
        ("UNABLE_TO_REACH", "Unable to Reach"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="admissions")
    encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="admissions"
    )
    bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="admissions")
    admitted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    admitted_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ADMITTED")
    discharged_at = models.DateTimeField(null=True, blank=True)
    discharge_summary = models.TextField(blank=True)
    follow_up_date = models.DateField(null=True, blank=True)

    # Admission classification
    admission_type = models.CharField(
        max_length=16, choices=ADMISSION_TYPE_CHOICES, default="VOLUNTARY"
    )
    admission_source = models.CharField(max_length=100, blank=True)
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default="ROUTINE")

    # Clinical reason for admission
    reason_for_admission = models.TextField(blank=True)
    clinical_summary = models.TextField(blank=True)
    primary_diagnosis = models.CharField(max_length=255, blank=True)
    associated_conditions = models.TextField(blank=True)

    # Risk and immediate safety
    risk_self_harm = models.BooleanField(default=False)
    risk_to_others = models.BooleanField(default=False)
    risk_absconding = models.BooleanField(default=False)
    risk_medical = models.BooleanField(default=False)
    observation_level = models.CharField(
        max_length=16, choices=OBSERVATION_LEVEL_CHOICES, default="ROUTINE"
    )
    safety_actions = models.TextField(blank=True)
    risk_summary = models.TextField(blank=True)

    # Ward/bed/care team already covered by `bed`; care team is free text —
    # a formal link to apps.ccp_program.CareTeamMembership would couple two
    # otherwise-independent apps for a field that's informational here.
    primary_care_team = models.CharField(max_length=150, blank=True)
    consultant = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    initial_care_priorities = models.TextField(blank=True)

    # Voluntary path — treatment consent (distinct from Patient-level HIE
    # data-sharing consent in apps.client_registry.ConsentRecord).
    consent_status = models.CharField(max_length=16, choices=CONSENT_STATUS_CHOICES, blank=True)
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_obtained_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    capacity_assessed = models.BooleanField(null=True, blank=True)
    consent_notes = models.TextField(blank=True)

    # Involuntary path — Mental Health Act (Cap. 248) legal status.
    legal_status = models.CharField(max_length=150, blank=True)
    legal_order_reference = models.CharField(max_length=100, blank=True)
    legal_order_date = models.DateField(null=True, blank=True)
    legal_review_due_date = models.DateField(null=True, blank=True)
    authorizing_professional = models.CharField(max_length=255, blank=True)
    legal_rationale = models.TextField(blank=True)
    oversight_notes = models.TextField(blank=True)

    # Next of kin notification (distinct from Patient.next_of_kin identity record).
    next_of_kin_notification = models.CharField(
        max_length=20, choices=NOK_NOTIFICATION_CHOICES, default="NOT_NOTIFIED"
    )
    next_of_kin_notes = models.TextField(blank=True)

    handover_note = models.TextField(blank=True)

    def __str__(self):
        return f"Admission of {self.patient} to {self.bed}"


class MedicationAdministration(TenantScopedModel):
    """
    Electronic MAR — docs/07-CLINICAL-MODULES-SPEC.md §7.7: digital checklist
    ensuring correct dose/patient/time.
    """

    STATUS_CHOICES = [
        ("SCHEDULED", "Scheduled"),
        ("ADMINISTERED", "Administered"),
        ("MISSED", "Missed"),
        ("REFUSED", "Refused"),
    ]

    admission = models.ForeignKey(Admission, on_delete=models.CASCADE, related_name="mar_entries")
    prescription_item = models.ForeignKey(
        PrescriptionItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    scheduled_time = models.DateTimeField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="SCHEDULED")
    administered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    administered_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"MAR entry for {self.admission} @ {self.scheduled_time}"


class NursingNote(TenantScopedModel):
    """Nursing notes / shift reports — docs/07-CLINICAL-MODULES-SPEC.md §7.7."""

    SHIFT_CHOICES = [("DAY", "Day"), ("NIGHT", "Night")]

    admission = models.ForeignKey(Admission, on_delete=models.CASCADE, related_name="nursing_notes")
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    shift = models.CharField(max_length=10, choices=SHIFT_CHOICES)
    note = models.TextField()
    recorded_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"Nursing note for {self.admission} ({self.get_shift_display()})"
