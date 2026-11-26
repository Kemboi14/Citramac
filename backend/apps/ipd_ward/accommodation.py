"""
Accommodation types, bed stays and nightly bed-day charges (guide.md 2026-11-24).

- An accommodation type (shared bed, shared room, private room, …) is the
  organisation's own; each has its own tariff line "Bed-day — <name>", priced
  on the Service Tariff page. No price is ever invented: an unpriced type
  raises unpriced charges, shown as "No rate configured" like any service.
- A bed takes its type from itself, else from its room.
- A BedStay records which bed an admission was in and when. Admission opens
  one, transfer closes it and opens the next, discharge closes the last.
- `charge_nights` counts every facility midnight an admitted client spent in a
  bed and raises one bed-day charge for it, at the tariff rate at that moment.
  It is idempotent (one BedNight per admission and night) and catches up on any
  night it missed. Nights before a stay existed — before go-live for clients
  already admitted — are never charged.
- A discharge recorded with an earlier time than nights already charged voids
  those nights' charges (not invoiced ones, which are listed for finance).

FHIR R4 (not emitted yet): ward / room / bed → Location physicalType wa / ro /
bd; a stay → Encounter.location (+ period) on the admission Encounter; a
bed-day → ChargeItem. The accommodation type is a local code (VERIFY: no
published code set confirmed). Never sent to the SHR.
"""

from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.care_pathway import facility_time, pricing

from .models import AccommodationType, Bed, BedNight, BedStay

SERVICE_PREFIX = "Bed-day — "
# Starting names only, never prices (guide.md §6). The Org Admin renames,
# retires or adds to them.
DEFAULT_TYPES = ["Shared bed", "Shared room", "Private room"]
CURRENT = ("ADMITTED", "TRANSFERRED")


def service_name(type_name):
    return f"{SERVICE_PREFIX}{type_name}"


def seed_types(organization_id):
    """Give an organisation the starting types (unpriced) when it has none."""
    from apps.care_pathway.models import BillingService

    if AccommodationType.all_objects.filter(organization_id=organization_id).exists():
        return
    for order, name in enumerate(DEFAULT_TYPES):
        service, _ = BillingService.all_objects.get_or_create(
            organization_id=organization_id, name=service_name(name)
        )
        AccommodationType.all_objects.get_or_create(
            organization_id=organization_id,
            name=name,
            defaults={"billing_service": service, "order": order},
        )


def _require_admin(user):
    from apps.accounts.permissions import _has_org_admin_role

    if not _has_org_admin_role(user):
        raise PermissionDenied("Only an Org Admin can change accommodation types.")


def _clean_name(name, exclude=None):
    name = " ".join(str(name or "").split())
    if not name:
        raise ValidationError({"name": "Enter a name."})
    if len(name) > 100:
        raise ValidationError({"name": "Use 100 characters or fewer."})
    clash = AccommodationType.objects.filter(name__iexact=name)
    if exclude is not None:
        clash = clash.exclude(pk=exclude.pk)
    if clash.exists():
        raise ValidationError({"name": f'There is already an accommodation type "{name}".'})
    return name


def type_row(kind):
    service = kind.billing_service
    return {
        "id": str(kind.id),
        "name": kind.name,
        "active": kind.active,
        "service_id": str(service.id),
        "rate": None if service.rate is None else str(service.rate),
        "bed_count": Bed.objects.filter(accommodation_type=kind).count(),
        "room_count": kind.rooms.count(),
    }


def types():
    return AccommodationType.objects.select_related("billing_service")


@transaction.atomic
def add_type(user, name):
    from apps.care_pathway.models import BillingService

    _require_admin(user)
    name = _clean_name(name)
    service, _ = BillingService.objects.get_or_create(
        organization=user.organization, name=service_name(name)
    )
    if AccommodationType.objects.filter(billing_service=service).exists():
        raise ValidationError({"name": f'"{name}" was used before; restore that type instead.'})
    service.active = True
    service.save(update_fields=["active"])
    order = (types().order_by("-order").values_list("order", flat=True).first() or 0) + 1
    return AccommodationType.objects.create(
        organization=user.organization, name=name, billing_service=service, order=order
    )


@transaction.atomic
def change_type(user, kind, data):
    """Rename (the tariff line follows; charges already raised keep their
    service, so past bills show the new name) or retire / restore. A retired
    type can't be given to a bed or room; beds that have it keep charging."""
    _require_admin(user)
    kind = AccommodationType.objects.select_for_update().get(pk=kind.pk)
    service = kind.billing_service
    if "name" in data:
        name = _clean_name(data["name"], exclude=kind)
        from apps.care_pathway.models import BillingService

        if (
            BillingService.objects.filter(name__iexact=service_name(name))
            .exclude(pk=service.pk)
            .exists()
        ):
            raise ValidationError({"name": f'A tariff line "{service_name(name)}" already exists.'})
        kind.name = name
        service.name = service_name(name)
    if "active" in data:
        kind.active = bool(data["active"])
    kind.save()
    service.save(update_fields=["name"])
    return kind


def check_assignable(kind):
    if kind is not None and not kind.active:
        raise ValidationError(
            {"accommodation_type": f'"{kind.name}" is retired. Choose a current type.'}
        )


# ── Stays ──


def open_stay(admission, bed, at):
    """The client is in `bed` from `at`. The database refuses a second open
    stay on the same bed or admission, so two clients can never share it."""
    try:
        with transaction.atomic():
            return BedStay.objects.create(
                organization_id=admission.organization_id,
                admission=admission,
                bed=bed,
                started_at=at,
            )
    except IntegrityError as exc:
        raise ValidationError({"bed": f"Bed {bed.bed_number} is already occupied."}) from exc


def close_stay(admission, at):
    """End the admission's open stay at `at`. Nights counted after `at` are
    taken back: their charges are voided unless already invoiced."""
    stay = BedStay.objects.select_for_update().filter(admission=admission, ended_at__isnull=True)
    stay = stay.first()
    if stay is None:
        return None
    stay.ended_at = max(at, stay.started_at)
    stay.save(update_fields=["ended_at", "updated_at"])
    _void_nights_after(admission, stay.ended_at)
    return stay


def _void_nights_after(admission, ended_at):
    from apps.billing.models import InvoiceLine

    now = timezone.now()
    for night in BedNight.objects.filter(admission=admission).select_related("charge"):
        if census_instant(night.night) <= ended_at:
            continue
        charge = night.charge
        if charge is None or charge.voided_at is not None:
            continue
        if InvoiceLine.objects.filter(charge_item=charge).exists():
            continue  # already billed: finance corrects it on the invoice
        charge.voided_at = now
        charge.save(update_fields=["voided_at", "updated_at"])


def census_instant(night):
    """The facility midnight that ends the night of `night`."""
    return facility_time.combine_local(night + timedelta(days=1))


# ── Nightly charges ──


def _nights(stay, now):
    """The nights this stay was in its bed at the facility's midnight."""
    end = stay.ended_at or now
    # The night of the start date ends at the next midnight, which is always
    # after the start; a stay that ends before it counts no night.
    night = facility_time.local_date(stay.started_at)
    while census_instant(night) <= end:
        yield night
        night += timedelta(days=1)


def charge_nights(now=None):
    """Raise every bed-day charge due up to `now`. Safe to run as often as
    wanted: a night already counted is skipped. Runs cross-tenant (beat)."""
    from apps.care_pathway.models import ChargeItem

    now = now or timezone.now()
    raised = 0
    # Open stays, and stays closed recently enough to still owe a night.
    recent = Q(ended_at__isnull=True) | Q(ended_at__gte=now - timedelta(days=2))
    stays = BedStay.all_objects.select_related(
        "admission",
        "admission__patient",
        "bed__accommodation_type__billing_service",
        "bed__room__accommodation_type__billing_service",
    ).filter(recent)
    for stay in stays:
        done = set(
            BedNight.all_objects.filter(admission=stay.admission).values_list("night", flat=True)
        )
        for night in _nights(stay, now):
            if night in done:
                continue
            try:
                with transaction.atomic():
                    if BedNight.all_objects.filter(admission=stay.admission, night=night).exists():
                        continue
                    # The bed's type when the night is counted. A night missed and
                    # caught up later is priced at the type the bed has then.
                    kind = stay.bed.effective_type
                    charge = None
                    if kind is not None:
                        service = kind.billing_service
                        charge = ChargeItem.all_objects.create(
                            organization_id=stay.organization_id,
                            patient=stay.admission.patient,
                            episode_id=stay.admission.episode_id,
                            quantity=1,
                            **pricing.charge_fields(service, stay.admission.patient),
                            delivered_at=census_instant(night),
                        )
                    BedNight.all_objects.create(
                        organization_id=stay.organization_id,
                        admission=stay.admission,
                        stay=stay,
                        night=night,
                        accommodation_type=kind,
                        charge=charge,
                    )
                    raised += 1
            except IntegrityError:
                # Another run counted this night first; the unique
                # (admission, night) constraint is the source of truth.
                continue
    return raised


def stay_summary(admission):
    """Nights so far by accommodation type, for the admission and the bill."""
    rows = {}
    for night in admission.bed_nights.select_related("accommodation_type", "charge"):
        name = night.accommodation_type.name if night.accommodation_type_id else None
        row = rows.setdefault(
            name, {"accommodation_type": name, "nights": 0, "priced": 0, "amount": Decimal("0")}
        )
        charge = night.charge
        if charge is not None and charge.voided_at is not None:
            continue
        row["nights"] += 1
        if charge is not None and charge.unit_price is not None:
            row["priced"] += 1
            row["amount"] += charge.unit_price * charge.quantity
    return [{**row, "amount": str(row["amount"])} for row in rows.values() if row["nights"]]
