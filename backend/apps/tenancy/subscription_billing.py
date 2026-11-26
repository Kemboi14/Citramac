"""
CITRAMAC's own subscription billing by branches, private rooms and shared
rooms (owner decisions 2026-11-26). SaaS billing of an organisation by the
platform — not patient billing, not clinical data, no FHIR resource.

Price: the plan's monthly base fee (`price_monthly`) plus a monthly rate per
active branch, per private room and per shared room. A blank rate means that
unit is not charged on the plan; the statement still shows the count, with
"No rate set". Nothing is ever priced by this module that Super Admin did not
set. An annual cycle is 12 × the monthly amounts (the codebase has no other
annual convention: the plan only ever had a monthly price).

What is counted (`count_usage`):
- Branches: the organisation's branches with `is_active`.
- Rooms: every `ipd_ward.Room` whose ward is in an active branch, or in no
  branch (a ward not tied to a branch still belongs to the organisation, and
  wards and rooms have no active flag of their own — a closed branch's rooms
  stop counting). Each room is counted by **its own** accommodation type's
  class, whatever its beds carry:
    PRIVATE_ROOM → private rooms (charged), SHARED_ROOM → shared rooms
    (charged), WARD_BAY → a bay of shared beds, not a room (counted, never
    charged), no type or an Unclassified type → Unclassified (listed by name
    so the Org Admin can fix it, never charged).
  A room whose beds carry their own type of a different class is listed as a
  note; it is still counted by the room's type.
- Beds not in any room are counted for information only; the plan prices
  rooms, not beds.

Statements (`SubscriptionStatement`, append-only): one per organisation and
billing period, frozen when the period starts — by the daily lifecycle job, or
by Super Admin's "Issue statement now" when none exists for the current
period. A correction is a new statement that supersedes the latest one, with
a reason. Every issue and correction is in the audit trail (the generic
write-audit signals record the new row with its lines, total and reason), as
is every change to a plan's rates.

The billing period is the cycle that ends on the subscription's
`current_period_end`: one month (or twelve) back, plus a day — never before
the subscription's `started_on`. A period that starts later than a full cycle
(a first, shorter period) is still charged as a full cycle: nothing is
prorated.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Branch, Subscription, SubscriptionStatement

CURRENCY = "KES"  # the platform's currency everywhere (plans, tariffs, invoices)
NO_RATE = "No rate set"

CLASS_PRIVATE = "PRIVATE_ROOM"
CLASS_SHARED = "SHARED_ROOM"
CLASS_WARD_BAY = "WARD_BAY"

UNITS = [
    # key, label, usage count key, plan rate field
    ("branches", "Active branches", "branches", "rate_per_branch"),
    ("private_rooms", "Private rooms", "private_rooms", "rate_per_private_room"),
    ("shared_rooms", "Shared rooms", "shared_rooms", "rate_per_shared_room"),
]


def cycle_months(billing_cycle):
    return 12 if billing_cycle == "ANNUAL" else 1


def _months_back(day, months):
    """The same day `months` earlier, clamped to the end of a shorter month."""
    year, month = divmod(day.month - 1 - months, 12)
    year, month = day.year + year, month + 1
    for candidate in (day.day, 30, 29, 28):
        try:
            return date(year, month, min(day.day, candidate))
        except ValueError:
            continue
    raise ValueError(day)  # pragma: no cover — 28 always exists


def current_period(subscription):
    """(start, end) of the billing period ending on `current_period_end`."""
    end = subscription.current_period_end
    start = _months_back(end, cycle_months(subscription.billing_cycle)) + timedelta(days=1)
    if subscription.started_on and subscription.started_on > start:
        start = min(subscription.started_on, end)
    return start, end


# ── usage ──────────────────────────────────────────────────────────────────


def count_usage(organization_id):
    """What the organisation has right now, by billing unit (see module docstring)."""
    from apps.ipd_ward.models import Bed, Room

    branches = list(
        Branch.all_objects.filter(organization_id=organization_id, is_active=True)
        .order_by("name")
        .values_list("name", flat=True)
    )
    in_use = Q(ward__branch__isnull=True) | Q(ward__branch__is_active=True)
    rooms = (
        Room.all_objects.filter(organization_id=organization_id)
        .filter(in_use)
        .select_related("ward", "accommodation_type")
        .order_by("ward__name", "name")
    )
    counts = {CLASS_PRIVATE: 0, CLASS_SHARED: 0, CLASS_WARD_BAY: 0}
    unclassified, notes = [], []
    bed_classes = {}
    for room_id, class_ in Bed.all_objects.filter(
        organization_id=organization_id, room__isnull=False, accommodation_type__isnull=False
    ).values_list("room_id", "accommodation_type__room_class"):
        bed_classes.setdefault(room_id, set()).add(class_)
    for room in rooms:
        kind = room.accommodation_type
        label = f"{room.ward.name} / {room.name}"
        class_ = kind.room_class if kind else ""
        if class_ in counts:
            counts[class_] += 1
        else:
            unclassified.append(
                {
                    "id": str(room.id),
                    "room": label,
                    "reason": (
                        f'Its accommodation type "{kind.name}" has no class'
                        if kind
                        else "It has no accommodation type"
                    ),
                }
            )
        others = bed_classes.get(room.id, set()) - {class_}
        if others:
            notes.append(
                {
                    "room": label,
                    "note": "Some of its beds have their own type of another class; "
                    "the room is counted by its own type.",
                }
            )
    beds_outside_rooms = (
        Bed.all_objects.filter(organization_id=organization_id, room__isnull=True)
        .filter(in_use)
        .count()
    )
    return {
        "branches": len(branches),
        "branch_names": branches,
        "private_rooms": counts[CLASS_PRIVATE],
        "shared_rooms": counts[CLASS_SHARED],
        "ward_bays": counts[CLASS_WARD_BAY],
        "unclassified_rooms": len(unclassified),
        "unclassified": unclassified,
        "beds_outside_rooms": beds_outside_rooms,
        "notes": notes,
    }


# ── pricing ────────────────────────────────────────────────────────────────


def _money(value):
    return f"{Decimal(value):.2f}"


def price_lines(plan, usage, months):
    """The statement lines and total for `usage` on `plan` over `months`."""
    base = Decimal(plan.price_monthly) * months
    lines = [
        {
            "key": "base",
            "label": f"{plan.name} — base fee",
            "count": None,
            "rate": _money(plan.price_monthly),
            "months": months,
            "amount": _money(base),
            "charged": True,
            "note": "",
        }
    ]
    total = base
    for key, label, usage_key, rate_field in UNITS:
        count = usage[usage_key]
        rate = getattr(plan, rate_field)
        if rate is None:
            lines.append(
                {
                    "key": key,
                    "label": label,
                    "count": count,
                    "rate": None,
                    "months": months,
                    "amount": None,
                    "charged": False,
                    "note": NO_RATE,
                }
            )
            continue
        amount = Decimal(rate) * count * months
        total += amount
        lines.append(
            {
                "key": key,
                "label": label,
                "count": count,
                "rate": _money(rate),
                "months": months,
                "amount": _money(amount),
                "charged": True,
                "note": "",
            }
        )
    return lines, total


def plan_rates(plan):
    return {
        "plan_name": plan.name,
        "price_monthly": _money(plan.price_monthly),
        "rate_per_branch": None if plan.rate_per_branch is None else _money(plan.rate_per_branch),
        "rate_per_private_room": (
            None if plan.rate_per_private_room is None else _money(plan.rate_per_private_room)
        ),
        "rate_per_shared_room": (
            None if plan.rate_per_shared_room is None else _money(plan.rate_per_shared_room)
        ),
        "currency": CURRENCY,
    }


# ── statements ─────────────────────────────────────────────────────────────


def _reference(subscription, period_start, version):
    slug = (subscription.organization.slug or str(subscription.organization_id))[:32].upper()
    return f"SUB-{slug}-{period_start:%Y%m%d}" + (f"-C{version}" if version else "")


def _create(subscription, period, *, method, user=None, supersedes=None, reason=""):
    plan = subscription.plan
    months = cycle_months(subscription.billing_cycle)
    usage = count_usage(subscription.organization_id)
    lines, total = price_lines(plan, usage, months)
    version = 0
    if supersedes is not None:
        version = 1
        cursor = supersedes
        while cursor.supersedes_id:
            version += 1
            cursor = cursor.supersedes
    return SubscriptionStatement.all_objects.create(
        organization_id=subscription.organization_id,
        reference=_reference(subscription, period[0], version),
        subscription=subscription,
        plan=plan,
        plan_name=plan.name,
        billing_cycle=subscription.billing_cycle,
        months=months,
        period_start=period[0],
        period_end=period[1],
        currency=CURRENCY,
        lines=lines,
        usage=usage,
        total=total,
        counted_at=timezone.now(),
        method=method,
        issued_by=user,
        supersedes=supersedes,
        reason=reason,
    )


def _blocking(subscription, period, today):
    """Statements that already bill this period: one for the same period start,
    or one whose period is still running today (so a period end moved by
    Super Admin, or a change of cycle, never bills the same days twice while
    the earlier statement is current)."""
    return SubscriptionStatement.all_objects.filter(
        Q(period_start=period[0]) | Q(period_start__lte=today, period_end__gte=today),
        organization_id=subscription.organization_id,
    ).order_by("-created_at")


def issue_for_period(subscription, *, method, user=None, today=None):
    """
    The statement for the subscription's current period, if nothing bills it
    yet (`_blocking`). Returns (statement, created). Idempotent: a correction
    is `supersede`, never a second statement; the unique constraint on
    (organisation, period start) holds under a race.
    """
    today = today or timezone.localdate()
    period = current_period(subscription)
    existing = _blocking(subscription, period, today).first()
    if existing is not None:
        return existing, False
    try:
        with transaction.atomic():
            return _create(subscription, period, method=method, user=user), True
    except IntegrityError:
        return _blocking(subscription, period, today).first(), False


def issue_now(subscription, user):
    """Super Admin: issue the current period's statement now (none may exist yet)."""
    if subscription.status == Subscription.STATUS_CANCELED:
        raise ValidationError("This subscription is cancelled; no statement is issued for it.")
    statement, created = issue_for_period(
        subscription, method=SubscriptionStatement.METHOD_MANUAL, user=user
    )
    if not created:
        raise ValidationError(
            f"{statement.reference} already bills this period, or is still running today. "
            "To change it, issue a correction with a reason."
        )
    return statement


@transaction.atomic
def supersede(statement, user, reason):
    """Super Admin: a correction — a new statement for the same period,
    counted now on the plan's current rates, replacing the latest one."""
    reason = " ".join(str(reason or "").split())
    if not reason:
        raise ValidationError({"reason": "Say why this statement is being corrected."})
    statement = SubscriptionStatement.all_objects.select_for_update().get(pk=statement.pk)
    if SubscriptionStatement.all_objects.filter(supersedes=statement).exists():
        raise ValidationError("This statement has already been corrected; correct the latest one.")
    subscription = Subscription.all_objects.select_related("plan", "organization").get(
        pk=statement.subscription_id
    )
    return _create(
        subscription,
        (statement.period_start, statement.period_end),
        method=SubscriptionStatement.METHOD_CORRECTION,
        user=user,
        supersedes=statement,
        reason=reason,
    )


def issue_due_statements(today=None):
    """
    Daily (from apps.tenancy.subscription_lifecycle): every ACTIVE
    subscription whose current period has started and has no statement gets
    one. Each organisation in isolation; returns {subscription id: reference}.
    """
    import structlog

    logger = structlog.get_logger(__name__)
    today = today or timezone.localdate()
    issued = {}
    subscriptions = Subscription.all_objects.select_related("organization", "plan").filter(
        status=Subscription.STATUS_ACTIVE
    )
    for subscription in subscriptions:
        start, end = current_period(subscription)
        if not (start <= today <= end):
            continue
        try:
            statement, created = issue_for_period(
                subscription, method=SubscriptionStatement.METHOD_SCHEDULED, today=today
            )
        except Exception:  # noqa: BLE001 — isolate, log, carry on with the rest
            logger.exception("subscription_statement_failed", subscription_id=str(subscription.id))
            issued[str(subscription.id)] = "FAILED"
            continue
        if created:
            issued[str(subscription.id)] = statement.reference
    return issued


# ── presentation ───────────────────────────────────────────────────────────


def platform_letterhead():
    """CITRAMAC's own letterhead for its statements — never the organisation's:
    the platform logo (embedded, never fetched), the platform theme colour and
    the renewal contact Super Admin set."""
    from apps.documents import printing

    from .models import PlatformBranding, SubscriptionPolicy

    branding = PlatformBranding.get_solo()
    contact = SubscriptionPolicy.get_solo().renewal_contact
    return {
        "name": "CITRAMAC",
        "branch": "Subscription billing",
        "address": "",
        "contacts": [contact] if contact else [],
        "identifiers": [],
        "logo": printing.logo_data_uri(branding.logo.url if branding.logo else ""),
        "brand": printing.brand_colours(None),
    }


def _display_date(value):
    return f"{value:%d %b %Y}"


def statement_print_context(statement, user):
    from apps.care_pathway import facility_time

    replaced_by = SubscriptionStatement.all_objects.filter(supersedes=statement).first()
    rows = []
    for line in statement.lines:
        rows.append(
            {
                "label": line["label"],
                "count": "" if line["count"] is None else line["count"],
                "rate": NO_RATE if line["rate"] is None else f"{statement.currency} {line['rate']}",
                "months": line["months"],
                "amount": (
                    "Not charged"
                    if line["amount"] is None
                    else f"{statement.currency} {Decimal(line['amount']):,.2f}"
                ),
            }
        )
    meta = [
        ("Statement", statement.reference),
        (
            "Period",
            f"{_display_date(statement.period_start)} – {_display_date(statement.period_end)}",
        ),
        ("Counted", facility_time.local_format(statement.counted_at, "%d %b %Y %H:%M")),
    ]
    return {
        "title": "Subscription statement",
        "letterhead": platform_letterhead(),
        "meta": meta,
        "organization_name": statement.organization.name,
        "plan_name": statement.plan_name,
        "cycle": "Annual (12 months)" if statement.months == 12 else "Monthly",
        "method": statement.get_method_display(),
        "issued_by": _user_name(statement.issued_by),
        "rows": rows,
        "total": f"{statement.currency} {statement.total:,.2f}",
        "usage": statement.usage,
        "supersedes": statement.supersedes.reference if statement.supersedes_id else "",
        "reason": statement.reason,
        "replaced_by": replaced_by.reference if replaced_by else "",
        "watermark": "Replaced by a correction" if replaced_by else "",
        "watermark_short": "REPLACED",
        "currency": statement.currency,
        "printed_by": _user_name(user),
    }


def _user_name(user):
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def statement_row(statement, latest_ids=None):
    superseded = (
        statement.pk not in latest_ids
        if latest_ids is not None
        else SubscriptionStatement.all_objects.filter(supersedes=statement).exists()
    )
    return {
        "id": str(statement.id),
        "reference": statement.reference,
        "period_start": statement.period_start.isoformat(),
        "period_end": statement.period_end.isoformat(),
        "billing_cycle": statement.billing_cycle,
        "months": statement.months,
        "plan_name": statement.plan_name,
        "currency": statement.currency,
        "lines": statement.lines,
        "usage": statement.usage,
        "total": _money(statement.total),
        "counted_at": statement.counted_at.isoformat(),
        "method": statement.method,
        "method_label": statement.get_method_display(),
        "issued_by": _user_name(statement.issued_by),
        "supersedes": str(statement.supersedes_id) if statement.supersedes_id else None,
        "supersedes_reference": statement.supersedes.reference if statement.supersedes_id else "",
        "reason": statement.reason,
        "superseded": superseded,
    }


def billing_overview(subscription):
    """Live usage, the plan's rates, what a statement would be today, and the
    organisation's statements (newest first) — for Super Admin and the Org Admin."""
    usage = count_usage(subscription.organization_id)
    months = cycle_months(subscription.billing_cycle)
    lines, total = price_lines(subscription.plan, usage, months)
    period = current_period(subscription)
    statements = list(
        SubscriptionStatement.all_objects.filter(organization_id=subscription.organization_id)
        .select_related("issued_by", "supersedes")
        .order_by("-period_start", "-created_at")
    )
    replaced = {s.supersedes_id for s in statements if s.supersedes_id}
    latest = {s.pk for s in statements if s.pk not in replaced}
    has_current = _blocking(subscription, period, timezone.localdate()).exists()
    return {
        "organization": str(subscription.organization_id),
        "organization_name": subscription.organization.name,
        "billing_cycle": subscription.billing_cycle,
        "months": months,
        "current_period": {"start": period[0].isoformat(), "end": period[1].isoformat()},
        "current_period_has_statement": has_current,
        "rates": plan_rates(subscription.plan),
        "usage": usage,
        "estimate": {"lines": lines, "total": _money(total), "currency": CURRENCY},
        "statements": [statement_row(s, latest) for s in statements],
    }
