import secrets

from django.db import models
from django.utils import timezone

from apps.clinical_encounter.models import Encounter
from apps.dha_interop.models import LoincCodeIndex
from apps.tenancy.models import TenantScopedModel


def _generate_barcode():
    return f"SPEC-{timezone.now():%Y%m%d}-{secrets.token_hex(4).upper()}"


class LabOrder(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.4, docs/10-API-SPECIFICATION.md §10.6 — Module 4."""

    STATUS_CHOICES = [
        ("ORDERED", "Ordered"),
        ("SPECIMEN_COLLECTED", "Specimen Collected"),
        ("RESULT_PENDING", "Result Pending"),
        ("RESULT_VALIDATED", "Result Validated"),
        ("CANCELLED", "Cancelled"),
    ]

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="lab_orders")
    loinc_code = models.ForeignKey(LoincCodeIndex, on_delete=models.PROTECT, related_name="+")
    ordered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    ordered_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ORDERED")

    def __str__(self):
        return f"{self.loinc_code.code} for {self.encounter}"


class LabSpecimen(TenantScopedModel):
    """Auto-generated barcode at accessioning — docs/07-CLINICAL-MODULES-SPEC.md §7.4."""

    lab_order = models.ForeignKey(LabOrder, on_delete=models.CASCADE, related_name="specimens")
    barcode = models.CharField(max_length=32, unique=True, default=_generate_barcode)
    specimen_type = models.CharField(max_length=100, blank=True)
    collected_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    collected_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.barcode


class LabResult(TenantScopedModel):
    """
    Quality control/validation gate — docs/07-CLINICAL-MODULES-SPEC.md §7.4:
    "senior lab scientist review & approval gate before results publish to
    clinicians." Enforced in apps.lims.views (a plain clinician sees nothing
    for an unvalidated result; Lab Technician/Auditor/Super Admin do).
    """

    lab_order = models.ForeignKey(LabOrder, on_delete=models.CASCADE, related_name="results")
    specimen = models.ForeignKey(
        LabSpecimen, on_delete=models.SET_NULL, null=True, blank=True, related_name="results"
    )
    result_value = models.CharField(max_length=255)
    unit = models.CharField(max_length=50, blank=True)
    reference_range = models.CharField(max_length=100, blank=True)
    is_abnormal = models.BooleanField(default=False)

    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    is_validated = models.BooleanField(default=False)
    validated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    validated_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.result_value} {self.unit} for {self.lab_order}"
