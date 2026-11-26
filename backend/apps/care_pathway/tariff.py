"""An organisation's own tariff (guide.md 2026-11-26): lines added from the
platform service catalogue or written by the Org Admin, the Org Admin's own
prices, and the rate agreed with each of the organisation's insurers.

Nothing here sets a price on its own: a line added from the catalogue or
created without a price is unpriced ("No rate configured") until the Org
Admin prices it."""

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.exceptions import ValidationError

from .models import BillingService, ServiceCatalogueItem

FIXED_PAYERS = ("SHA", "PRIVATE", "EMPLOYER")


def _rate(value, label):
    if value in ("", None):
        return None
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, ValueError) as err:
        raise ValidationError({"payer_rates": f"Invalid rate for {label}."}) from err
    if rate < 0:
        raise ValidationError({"payer_rates": f"Rate for {label} cannot be negative."})
    if rate != rate.quantize(Decimal("0.01")):
        raise ValidationError({"payer_rates": f"Rate for {label} has more than 2 decimals."})
    return rate


def set_payer_rates(service, rows):
    """Upsert the service's payer rows. A row names either one of the
    organisation's insurers (`insurer`: id) or a fixed payer (`payer`)."""
    from apps.insurance_claims.models import Insurer, ServicePayerCode

    if not isinstance(rows, list):
        raise ValidationError({"payer_rates": "Provide a list of payer rates."})
    for row in rows:
        if not isinstance(row, dict):
            raise ValidationError({"payer_rates": "Each payer rate must be an object."})
        insurer_id = row.get("insurer")
        if insurer_id:
            try:
                insurer = Insurer.objects.filter(
                    pk=insurer_id, organization_id=service.organization_id
                ).first()
            except (ValueError, DjangoValidationError):
                insurer = None
            if insurer is None:
                raise ValidationError({"payer_rates": "Unknown insurer."})
            lookup = {"payer": "INSURER", "insurer": insurer}
            label = insurer.name
        else:
            payer = str(row.get("payer") or "").strip().upper()
            if payer not in FIXED_PAYERS:
                raise ValidationError({"payer_rates": f"Unknown payer '{payer}'."})
            lookup = {"payer": payer, "insurer": None}
            label = payer
        ServicePayerCode.objects.update_or_create(
            organization_id=service.organization_id,
            service=service,
            **lookup,
            defaults={
                "payer_code": str(row.get("payer_code") or "").strip(),
                "rate": _rate(row.get("rate"), label),
                "requires_preauth": bool(row.get("requires_preauth", False)),
                "active": bool(row.get("active", True)),
            },
        )


def catalogue_for(organization_id):
    """Active catalogue entries, each saying whether this organisation already has it."""
    on_tariff = dict(
        BillingService.objects.filter(catalogue_item__isnull=False).values_list(
            "catalogue_item_id", "id"
        )
    )
    names = {n.lower() for n in BillingService.objects.values_list("name", flat=True)}
    out = []
    for item in ServiceCatalogueItem.objects.filter(active=True):
        line = on_tariff.get(item.id)
        out.append(
            {
                "id": str(item.id),
                "category": item.category,
                "name": item.name,
                "description": item.description,
                "medicine_name": item.medicine_name,
                "mass": item.mass,
                "on_tariff": bool(line) or item.name.lower() in names,
            }
        )
    return out


@transaction.atomic
def add_from_catalogue(organization, item_ids):
    """Add catalogue entries to the organisation's tariff, unpriced. An entry
    already on the tariff (linked, or a line of the same name) is linked, not
    duplicated, and keeps its price."""
    if not isinstance(item_ids, list) or not item_ids:
        raise ValidationError({"items": "Choose at least one service."})
    try:
        items = list(ServiceCatalogueItem.objects.filter(pk__in=item_ids, active=True))
    except (ValueError, DjangoValidationError) as err:
        raise ValidationError({"items": "Unknown catalogue entry."}) from err
    if len(items) != len(set(map(str, item_ids))):
        raise ValidationError({"items": "Unknown or retired catalogue entry."})
    added = []
    for item in items:
        existing = BillingService.objects.filter(catalogue_item=item).first() or (
            BillingService.objects.filter(name__iexact=item.name).first()
        )
        if existing is not None:
            if existing.catalogue_item_id is None:
                existing.catalogue_item = item
                existing.save(update_fields=["catalogue_item", "updated_at"])
            continue
        added.append(
            BillingService.objects.create(
                organization=organization,
                catalogue_item=item,
                name=item.name,
                category=item.category,
                description=item.description,
                medicine_name=item.medicine_name,
                mass=item.mass,
                rate=None,
                active=True,
            )
        )
    return added


def create_line(organization, data):
    """A tariff line the Org Admin writes themselves (a service not in the catalogue)."""
    category = str(data.get("category") or "").strip()
    is_med = category.lower() == "medication"
    medicine_name = str(data.get("medicine_name") or "").strip()
    mass = str(data.get("mass") or "").strip()
    if is_med:
        if not medicine_name or not mass:
            raise ValidationError({"medicine_name": "Enter the medicine name and strength."})
        name = f"{medicine_name} {mass}"
    else:
        name = " ".join(str(data.get("name") or "").split())
        if not name:
            raise ValidationError({"name": "Enter the service name."})
    if len(name) > 150:
        raise ValidationError({"name": "Use at most 150 characters."})
    rate = data.get("rate")
    try:
        with transaction.atomic():
            service = BillingService.objects.create(
                organization=organization,
                name=name,
                category=category,
                description=str(data.get("description") or "").strip()[:255],
                medicine_name=medicine_name if is_med else "",
                mass=mass if is_med else "",
                rate=_rate(rate, "the out-of-pocket price"),
                active=True,
            )
    except IntegrityError as err:
        raise ValidationError(
            {"name": "A service with this name is already on the tariff."}
        ) from err
    return service
