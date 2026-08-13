from django.db import models
from django.utils import timezone

from apps.clinical_encounter.models import PrescriptionItem
from apps.dha_interop.models import NationalDrugIndex
from apps.tenancy.models import Branch, TenantScopedModel


class Store(TenantScopedModel):
    """Multi-store management — docs/07-CLINICAL-MODULES-SPEC.md §7.6."""

    STORE_TYPE_CHOICES = [
        ("BULK", "Bulk Store"),
        ("SUB_STORE", "Sub-Store"),
        ("WARD", "Ward Pharmacy"),
        ("OUTPATIENT", "Outpatient Dispensing"),
    ]

    name = models.CharField(max_length=150)
    store_type = models.CharField(max_length=20, choices=STORE_TYPE_CHOICES)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.get_store_type_display()})"


class DrugStockItem(TenantScopedModel):
    """A batch of a drug at a store — docs/07-CLINICAL-MODULES-SPEC.md §7.6's FEFO tracking."""

    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name="stock_items")
    drug = models.ForeignKey(NationalDrugIndex, on_delete=models.PROTECT, related_name="+")
    batch_number = models.CharField(max_length=100)
    expiry_date = models.DateField()
    quantity_on_hand = models.PositiveIntegerField(default=0)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["store", "drug", "batch_number"], name="unique_batch_per_store_drug"
            )
        ]
        ordering = ["expiry_date"]  # FEFO — earliest-expiring batch first, by default query order

    def __str__(self):
        return f"{self.drug.generic_name} batch {self.batch_number} (exp {self.expiry_date})"


class StockMovement(TenantScopedModel):
    MOVEMENT_TYPE_CHOICES = [
        ("RECEIPT", "Receipt"),
        ("TRANSFER_OUT", "Transfer Out"),
        ("TRANSFER_IN", "Transfer In"),
        ("DISPENSE", "Dispense"),
        ("ADJUSTMENT", "Adjustment"),
    ]

    stock_item = models.ForeignKey(
        DrugStockItem, on_delete=models.CASCADE, related_name="movements"
    )
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPE_CHOICES)
    quantity = models.IntegerField(help_text="Positive for inbound, negative for outbound.")
    moved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    moved_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.get_movement_type_display()} {self.quantity} — {self.stock_item}"


class DispenseRecord(TenantScopedModel):
    """
    E-prescription fulfillment — docs/07-CLINICAL-MODULES-SPEC.md §7.6.
    Which batch(es) were used is recorded via the linked StockMovement
    records (apps.pharmacy.fefo picks the earliest-expiring batch with
    enough stock); this row is the dispense event itself.
    """

    prescription_item = models.ForeignKey(
        PrescriptionItem, on_delete=models.PROTECT, related_name="dispense_records"
    )
    stock_item = models.ForeignKey(
        DrugStockItem, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    quantity_dispensed = models.PositiveIntegerField()
    dispensed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    dispensed_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"Dispensed {self.quantity_dispensed} of {self.prescription_item}"
