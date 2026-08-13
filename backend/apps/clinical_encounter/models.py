from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.dha_interop.models import IcdCodeIndex, NationalDrugIndex
from apps.tenancy.models import Branch, TenantScopedModel


class Encounter(TenantScopedModel):
    """
    Umbrella object every clinical touchpoint attaches to — docs/06-DATA-MODEL.md
    §6.3. VitalSigns/MentalStatusExam (apps.triage) and SoapNote/DiagnosisCode/
    ClinicalOrder/Prescription/ReferralPacket (below) all hang off this.
    """

    STATUS_CHOICES = [("OPEN", "Open"), ("IN_PROGRESS", "In Progress"), ("CLOSED", "Closed")]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="encounters")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True)
    opened_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    encounter_type = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="OPEN")
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Encounter {self.id} — {self.patient}"


class SoapNote(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.3 — S.O.A.P. structured documentation."""

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="soap_notes")
    subjective = models.TextField(blank=True)
    objective = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    is_locked = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SoapNote.all_objects.filter(pk=self.pk, is_locked=True).exists()
            if previous:
                raise PermissionError("This SOAP note is signed and locked; it cannot be edited.")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"SOAP note for {self.encounter}"


class DiagnosisCode(TenantScopedModel):
    """
    Mandatory ICD-11 mapping — docs/08-DHA-SHA-INTEGRATION.md §8.2: "diagnosis
    field is a required, validated FK — no free-text diagnosis without a code."
    """

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="diagnoses")
    icd11_code = models.ForeignKey(IcdCodeIndex, on_delete=models.PROTECT, related_name="+")
    is_primary = models.BooleanField(default=False)
    noted_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.icd11_code.code} ({'primary' if self.is_primary else 'secondary'})"


class ClinicalOrder(TenantScopedModel):
    """CPOE — docs/07-CLINICAL-MODULES-SPEC.md §7.3. RADIOLOGY intentionally
    omitted: this deployment has no Theatre/RIS-PACS modules (mental-health-only
    facility, not a general hospital)."""

    ORDER_TYPE_CHOICES = [
        ("LAB", "Laboratory"),
        ("PROCEDURE", "Procedure"),
        ("REFERRAL", "Referral"),
    ]
    STATUS_CHOICES = [
        ("ORDERED", "Ordered"),
        ("IN_PROGRESS", "In Progress"),
        ("COMPLETED", "Completed"),
        ("CANCELLED", "Cancelled"),
    ]

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="orders")
    order_type = models.CharField(max_length=16, choices=ORDER_TYPE_CHOICES)
    details = models.TextField(blank=True)
    ordered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    ordered_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ORDERED")

    def __str__(self):
        return f"{self.get_order_type_display()} order for {self.encounter}"


class Prescription(TenantScopedModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="prescriptions")
    prescribed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    prescribed_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"Prescription for {self.encounter}"


class PrescriptionItem(TenantScopedModel):
    """
    E-prescribing with allergy/interaction checks — docs/07-CLINICAL-MODULES-SPEC.md
    §7.3. The checks themselves are simple heuristics for now (real drug-interaction
    data isn't mirrored yet — see apps.dha_interop.models module docstring);
    they're stored so the workflow/UI is real even while the underlying data is thin.
    """

    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name="items")
    drug = models.ForeignKey(NationalDrugIndex, on_delete=models.PROTECT, related_name="+")
    dose = models.CharField(max_length=100)
    route = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration = models.CharField(max_length=100, blank=True)

    allergy_check_passed = models.BooleanField(default=True)
    interaction_check_passed = models.BooleanField(default=True)
    pediatric_dose_flag = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.drug.generic_name} {self.dose}"


class ReferralPacket(TenantScopedModel):
    """
    E-Referral — docs/07-CLINICAL-MODULES-SPEC.md §7.3. Real FHIR Bundle
    construction + HIE transmission is Phase 6 (docs/08-DHA-SHA-INTEGRATION.md
    §8.1); fhir_bundle_json is a placeholder structure until then.
    """

    STATUS_CHOICES = [("DRAFT", "Draft"), ("SENT", "Sent"), ("ACKNOWLEDGED", "Acknowledged")]

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="referrals")
    destination_facility = models.CharField(max_length=255)
    fhir_bundle_json = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="DRAFT")
    sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Referral to {self.destination_facility} for {self.encounter}"
