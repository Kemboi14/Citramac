from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.tenancy.models import Branch, TenantScopedModel

# Fund attribution — docs/01-OVERVIEW-AND-STANDARDS.md §1.3's SHA benefit funds
# plus the non-SHA payment rails from docs/07-CLINICAL-MODULES-SPEC.md §7.10.
FUND_SOURCE_CHOICES = [
    ("CASH", "Cash"),
    ("MPESA", "M-Pesa"),
    ("CARD", "Card"),
    ("CORPORATE", "Corporate Account"),
    ("PRIVATE_INSURANCE", "Private Insurance"),
    ("SHA_PRIMARY", "SHA Primary Healthcare Fund"),
    ("SHA_SHIF", "SHA Social Health Insurance Fund"),
    ("SHA_ECCIF", "SHA Emergency, Chronic & Critical Illness Fund"),
]


class CostCenter(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.10 — cost-center accounting per department."""

    name = models.CharField(max_length=150)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return self.name


class Invoice(TenantScopedModel):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("PENDING_PAYMENT", "Pending Payment"),
        ("PARTIALLY_PAID", "Partially Paid"),
        ("PAID", "Paid"),
        ("CANCELLED", "Cancelled"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="invoices")
    encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices"
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    currency = models.CharField(max_length=3, default="KES")
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now)

    @property
    def total_amount(self):
        return sum((line.line_total for line in self.lines.all()), start=0)

    @property
    def amount_paid(self):
        return sum((payment.amount for payment in self.payments.all()), start=0)

    def refresh_status(self):
        total, paid = self.total_amount, self.amount_paid
        if total > 0 and paid >= total:
            self.status = "PAID"
        elif paid > 0:
            self.status = "PARTIALLY_PAID"
        elif self.status not in ("DRAFT", "CANCELLED"):
            self.status = "PENDING_PAYMENT"
        self.save(update_fields=["status"])

    def __str__(self):
        return f"Invoice for {self.patient} ({self.status})"


class InvoiceLine(TenantScopedModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    cost_center = models.ForeignKey(CostCenter, on_delete=models.SET_NULL, null=True, blank=True)
    description = models.CharField(max_length=255)
    fund_source = models.CharField(max_length=20, choices=FUND_SOURCE_CHOICES, default="CASH")
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)

    @property
    def line_total(self):
        return self.quantity * self.unit_price

    def __str__(self):
        return f"{self.description} x{self.quantity}"


class Payment(TenantScopedModel):
    METHOD_CHOICES = [
        ("CASH", "Cash"),
        ("MPESA", "M-Pesa"),
        ("CARD", "Card"),
        ("CORPORATE", "Corporate Account"),
        ("INSURANCE", "Insurance"),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    reference = models.CharField(max_length=100, blank=True)
    received_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    paid_at = models.DateTimeField(default=timezone.now)

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.invoice.refresh_status()

    def __str__(self):
        return f"{self.amount} {self.invoice.currency} via {self.get_method_display()}"
