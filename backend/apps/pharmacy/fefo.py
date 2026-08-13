from django.db import transaction

from .models import DrugStockItem, StockMovement


class InsufficientStock(Exception):
    pass


@transaction.atomic
def dispense_fefo(store, drug, quantity, user, organization):
    """
    First-Expired, First-Out batch selection — docs/07-CLINICAL-MODULES-SPEC.md §7.6.
    Consumes stock from the earliest-expiring batches with quantity_on_hand > 0
    until `quantity` is satisfied, logging a StockMovement per batch touched.
    Returns the list of (DrugStockItem, quantity_taken) tuples consumed.
    """
    remaining = quantity
    consumed = []
    batches = (
        DrugStockItem.objects.select_for_update()
        .filter(store=store, drug=drug, quantity_on_hand__gt=0)
        .order_by("expiry_date")
    )
    for batch in batches:
        if remaining <= 0:
            break
        take = min(remaining, batch.quantity_on_hand)
        batch.quantity_on_hand -= take
        batch.save(update_fields=["quantity_on_hand"])
        StockMovement.objects.create(
            organization=organization,
            stock_item=batch,
            movement_type="DISPENSE",
            quantity=-take,
            moved_by=user,
        )
        consumed.append((batch, take))
        remaining -= take

    if remaining > 0:
        available = quantity - remaining
        raise InsufficientStock(
            f"Only {available} of {quantity} requested units are available for this drug "
            f"across all batches at {store}."
        )
    return consumed
