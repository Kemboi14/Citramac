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
    """ADT (Admission, Discharge, Transfer) — docs/07-CLINICAL-MODULES-SPEC.md §7.7."""

    STATUS_CHOICES = [
        ("ADMITTED", "Admitted"),
        ("DISCHARGED", "Discharged"),
        ("TRANSFERRED", "Transferred"),
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
