from django.db import models
from django.utils import timezone

from apps.billing.models import Invoice
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.tenancy.models import TenantScopedModel


class PreAuthorization(TenantScopedModel):
    """
    docs/07-CLINICAL-MODULES-SPEC.md §7.11, docs/08-DHA-SHA-INTEGRATION.md §8.3.2.
    Real SHA submission is a Phase 6 item — see apps.insurance_claims.sha_gateway;
    this model + the DRAFT/SUBMITTED states are real now, the actual API call is stubbed.
    """

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SUBMITTED", "Submitted"),
        ("APPROVED", "Approved"),
        ("PARTIALLY_APPROVED", "Partially Approved"),
        ("REJECTED", "Rejected"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="pre_authorizations"
    )
    encounter = models.ForeignKey(
        Encounter,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pre_authorizations",
    )
    clinical_notes = models.TextField(blank=True)
    diagnostic_evidence = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    sha_reference = models.CharField(max_length=100, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Pre-auth for {self.patient} ({self.status})"


class InsuranceClaim(TenantScopedModel):
    """E-claim — docs/07-CLINICAL-MODULES-SPEC.md §7.11, docs/08-DHA-SHA-INTEGRATION.md §8.3.3."""

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SUBMITTED", "Submitted"),
        ("UNDER_REVIEW", "Under Review"),
        ("APPROVED", "Approved"),
        ("PARTIALLY_APPROVED", "Partially Approved"),
        ("REJECTED", "Rejected"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="insurance_claims")
    encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="insurance_claims"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="insurance_claims"
    )
    diagnoses_snapshot = models.JSONField(default=list, blank=True)
    total_claimed_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    sha_reference = models.CharField(max_length=100, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"E-claim for {self.patient} ({self.status})"


class Remittance(TenantScopedModel):
    claim = models.ForeignKey(InsuranceClaim, on_delete=models.CASCADE, related_name="remittances")
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    remittance_date = models.DateField(default=timezone.now)
    reference = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return f"Remittance {self.amount_paid} for {self.claim}"
