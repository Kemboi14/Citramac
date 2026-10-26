"""
Intervention modules (mockup v4 stage 5): SBAR handover, observation & safety,
observation sets (EWS), prescribing checks and structured orders, the MAR and
restrictive practice.

What is deliberately *not* here (CLAUDE.md §6): a drug formulary, interaction
rules, maximum-dose ceilings or class duplication — those need a licensed or
national source (VERIFY). The prescribing check says so in every result instead
of implying a clean bill of health. Timed monitoring schedules are
configuration (settings), not clinical advice.
"""

import uuid
from datetime import time, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.access import active_roles

from . import ews as ews_module
from . import facility_time, mental_state
from .models import (
    ClinicalAlert,
    MedicationHistoryEntry,
    ObservationEntry,
    ObservationLevelChange,
    ObserverHandover,
    OutcomeScore,
    RestrictiveCheck,
    RestrictivePracticeEpisode,
)

# ── observation level ──
# code → (display, minutes between signed entries). VERIFY with the facility policy.
OBS_LEVELS = {
    "GENERAL_HOURLY": ("General (hourly)", 60),
    "INTERMITTENT_15": ("Intermittent (every 15 min)", 15),
    "EYESIGHT": ("Within eyesight (continuous)", 15),
    "ARMS_LENGTH": ("Within arm's length (1:1)", 15),
}
CONTINUOUS = {"EYESIGHT", "ARMS_LENGTH"}
LOCATIONS = [
    "Main waiting area", "Quiet room", "Safe (low-stimulus) room", "Medical bay / resus",
    "Ward bed", "Day room", "Garden / outside area", "Off ward (escorted)",
]
ENGAGEMENT = [
    "Engaged — talked with observer", "Withdrawn", "Agitated",
    "Asleep — breathing observed", "Off ward",
]


def served_observation():
    return {
        "levels": [{"code": c, "display": d, "interval_minutes": m} for c, (d, m) in OBS_LEVELS.items()],
        "locations": LOCATIONS,
        "engagement": ENGAGEMENT,
        "max_continuous_minutes": settings.OBS_MAX_CONTINUOUS_MINUTES,
        "approval": "illustrative",  # VERIFY: facility observation policy
    }


def observation_state(patient):
    now = timezone.now()
    level = ObservationLevelChange.objects.filter(patient=patient).first()
    last_entry = ObservationEntry.objects.filter(patient=patient).first()
    observer = ObserverHandover.objects.filter(patient=patient).first()
    due = None
    if level:
        interval = OBS_LEVELS[level.level][1]
        base = last_entry.observed_at if last_entry and last_entry.observed_at >= level.changed_at else level.changed_at
        due = base + timedelta(minutes=interval)
    rotation_due = None
    if level and level.level in CONTINUOUS and observer:
        rotation_due = observer.since + timedelta(minutes=settings.OBS_MAX_CONTINUOUS_MINUTES)
    return {
        "level": (
            {"code": level.level, "display": OBS_LEVELS[level.level][0], "reason": level.reason,
             "since": level.changed_at, "by": _name(level.changed_by)}
            if level else None
        ),
        "next_entry_due": due,
        "overdue": bool(due and now > due),
        "observer": (
            {"name": observer.observer_name, "gender": observer.observer_gender, "since": observer.since}
            if observer else None
        ),
        "rotation_due": rotation_due,
        "rotation_overdue": bool(rotation_due and now > rotation_due),
        "entries": [
            {"id": str(e.id), "at": e.observed_at, "location": e.location,
             "engagement": e.engagement, "note": e.note, "by": _name(e.observed_by)}
            for e in ObservationEntry.objects.filter(patient=patient)[:20]
        ],
    }


def _name(user):
    return (user.get_full_name() or str(user)) if user else ""


def set_observation_level(patient, user, code, reason):
    if code not in OBS_LEVELS:
        raise ValidationError({"level": "Unknown observation level."})
    current = ObservationLevelChange.objects.filter(patient=patient).first()
    if current and current.level == code:
        raise ValidationError({"level": "Level unchanged."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "A reason is required."})
    return ObservationLevelChange.objects.create(
        organization_id=patient.organization_id, patient=patient, level=code,
        reason=reason.strip(), changed_by=user,
    )


def hand_over_observer(patient, user, name, gender=""):
    if not (name or "").strip():
        raise ValidationError({"observer_name": "Name the incoming observer."})
    return ObserverHandover.objects.create(
        organization_id=patient.organization_id, patient=patient,
        observer_name=name.strip(), observer_gender=gender or "", recorded_by=user,
    )


def add_observation_entry(patient, user, location, engagement, note):
    if location not in LOCATIONS:
        raise ValidationError({"location": "Choose a location."})
    note = (note or "").strip()
    if not note and not (engagement or "").startswith("Asleep"):
        raise ValidationError({"note": "Describe what you observed."})
    return ObservationEntry.objects.create(
        organization_id=patient.organization_id, patient=patient, location=location,
        engagement=engagement or "", note=note or engagement, observed_by=user,
    )


# ── observation sets (vital signs) ──
# (hard min, hard max, soft min, soft max) — values outside "hard" are impossible
# and refused; outside "soft" the entry is accepted with a warning to re-check.
VITAL_RANGES = {
    "heart_rate": ("Heart rate", "bpm", 20, 300, 40, 150),
    "systolic_bp": ("Systolic BP", "mmHg", 40, 300, 80, 200),
    "diastolic_bp": ("Diastolic BP", "mmHg", 20, 200, 40, 120),
    "respiratory_rate": ("Respiratory rate", "/min", 4, 70, 8, 30),
    "temperature_c": ("Temperature", "°C", 30, 44, 35, 39.5),
    "spo2": ("SpO₂", "%", 50, 100, 88, 100),
    "blood_glucose_mmol": ("Glucose", "mmol/L", 0.5, 50, 3, 20),
}
NOT_MEASURED_REASONS = [
    "Declined", "Too agitated / unsafe to measure", "Equipment unavailable",
    "Not clinically indicated now",
]


@transaction.atomic
def record_observation_set(patient, user, data):
    from apps.triage.models import VitalSigns

    from . import services

    values, warnings = {}, []
    skipped = data.get("not_measured") or {}
    for field, (label, unit, hmin, hmax, smin, smax) in VITAL_RANGES.items():
        raw = data.get(field)
        if raw in (None, ""):
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            raise ValidationError({field: f"{label}: enter a number only."}) from None
        if not hmin <= number <= hmax:
            raise ValidationError({field: f"{label}: not a possible value — check ({hmin}–{hmax} {unit})."})
        if not smin <= number <= smax:
            warnings.append(f"{label} {number:g} {unit} is unusual — confirm it was measured correctly.")
        values[field] = number
    for field, reason in skipped.items():
        if field in VITAL_RANGES and reason not in NOT_MEASURED_REASONS:
            raise ValidationError({"not_measured": f"Unknown reason for {field}."})
    consciousness = data.get("consciousness") or ""
    if consciousness not in ("", "A", "C", "V", "P", "U"):
        raise ValidationError({"consciousness": "Use A, C, V, P or U."})
    if not values and not consciousness:
        raise ValidationError({"detail": "Record at least one measurement."})
    for field in ("heart_rate", "systolic_bp", "diastolic_bp", "respiratory_rate", "spo2"):
        if field in values:
            values[field] = int(values[field])
    episode = services.get_or_open_episode(patient, user)
    encounter = services.clinical_encounter_for(patient, episode, user)
    vital = VitalSigns.objects.create(
        organization_id=patient.organization_id, encounter=encounter, recorded_by=user,
        consciousness=consciousness, supplemental_o2=data.get("supplemental_o2"), **values,
    )
    return vital, warnings, {k: v for k, v in skipped.items() if k in VITAL_RANGES}


# ── prescribing checks ──


def prescribing_checks(patient, drug_name):
    """Name-based checks only, and honest about what was not checked."""
    name = (drug_name or "").strip().lower()
    if not name:
        raise ValidationError({"drug": "Name the medicine."})
    hard, warn = [], []
    # INT-06: a true allergy hard-stops; an intolerance or ADR warns but does not block.
    for allergy in patient.allergy_records.exclude(verification_status="REFUTED").exclude(clinical_status="RESOLVED"):
        substance = allergy.substance.strip().lower()
        if substance and (substance in name or name in substance):
            tag = "client-reported, unconfirmed" if allergy.verification_status == "UNCONFIRMED" else "confirmed"
            if allergy.allergy_type == "ALLERGY":
                hard.append(f"Recorded allergy to {allergy.substance} ({tag}) matches {drug_name}.")
            else:
                warn.append(f"Recorded {allergy.get_allergy_type_display().lower()} to {allergy.substance} ({tag}) matches {drug_name}.")
    if patient.allergy_status == "UNKNOWN":
        warn.append("Allergy status is unknown — assess before prescribing.")
    elif patient.allergy_records.filter(verification_status="UNCONFIRMED").exists():
        warn.append("The allergy record is client-reported and not yet clinically confirmed.")
    for med in MedicationHistoryEntry.objects.filter(
        patient=patient, superseded_at__isnull=True, status="TAKING"
    ):
        if med.name.strip().lower() == name:
            warn.append(f"Duplicate — {med.name} is already on the medication list ({med.dose} {med.frequency}).")
    admission = _current_admission(patient)
    if admission:
        for item in admission_orders(admission):
            if item.drug.generic_name.strip().lower() == name:
                warn.append(f"Duplicate — {item.drug.generic_name} is already ordered during this admission ({_order_text(item)}).")
    return {
        "blocking": hard,
        "warnings": warn,
        "not_checked": [
            "Drug interactions, therapeutic-class duplication, maximum daily doses, QTc and "
            "pregnancy rules were NOT checked — no licensed formulary is configured. "
            "Allergy and exact-name duplicate checks only (VERIFY: national drug index / formulary)."
        ],
    }


# ── structured medication orders (R4 MedicationRequest) ──
ROUTE_VALUESET_ID = "medication-route"
ROUTE_VALUESET_TITLE = "Medication route"
# Local codes, seeded by migration 0037 and served from then on. VERIFY: mapping
# to the SNOMED CT route codes the R4 Dosage.route binding expects.
ROUTES = [
    ("ORAL", "Oral"), ("IM", "Intramuscular (IM)"), ("IV", "Intravenous (IV)"),
    ("SC", "Subcutaneous (SC)"), ("SL", "Sublingual"),
]
# Frequencies the MAR can turn into dose times (FREQUENCY_SLOTS below), plus a
# single stat dose, which has no scheduled time and is recorded as unscheduled.
FREQUENCIES = ["Once daily", "Mane", "Nocte", "BD", "TDS", "QDS", "Stat (once)"]
# Allergy status that locks prescribing until it is assessed.
PRESCRIBING_LOCKED = ("UNKNOWN", "")


def _has_role(user, names):
    from django.db.models import Q

    if not (user and user.is_authenticated) or user.is_superuser:
        return False
    query = Q()
    for name in names:
        query |= Q(name__iexact=name)
    return active_roles(user).filter(query).exists()


def can_prescribe(user):
    return _has_role(user, settings.PRESCRIBER_ROLES)


def is_clinical_staff(user):
    return _has_role(user, settings.DOC_ROLE_GROUPS["CLINICAL_STAFF"])


def _current_admission(patient):
    from . import services

    return services.current_admission(patient)


def _order_text(item):
    if item.is_prn:
        return f"{item.dose} {item.route} PRN, max {item.prn_max_per_24h}/24 h"
    return f"{item.dose} {item.route} {item.frequency}".strip()


def _order_row(item):
    rx = item.prescription
    return {
        "id": str(item.pk), "drug_code": item.drug_id, "drug": item.drug.generic_name, "dose": item.dose,
        "route": item.route, "frequency": item.frequency, "is_prn": item.is_prn,
        "prn_max_per_24h": item.prn_max_per_24h, "indication": item.indication,
        "controlled_drug": item.controlled_drug, "findings": item.check_findings,
        "allergy_override_reason": item.allergy_override_reason,
        "prescribed_by": _name(rx.prescribed_by), "prescribed_at": rx.prescribed_at,
    }


def prescribing_state(patient, user):
    from apps.clinical_encounter.models import PrescriptionItem

    from . import plan_extras

    orders = PrescriptionItem.objects.filter(prescription__encounter__patient=patient).select_related(
        "drug", "prescription__prescribed_by"
    ).order_by("-prescription__prescribed_at")[:20]
    return {
        "allergy_status": patient.allergy_status,
        "allergy_text": allergy_text(patient),
        "locked": patient.allergy_status in PRESCRIBING_LOCKED,
        "can_prescribe": can_prescribe(user),
        "is_senior": plan_extras.can_cosign(user),
        "frequencies": FREQUENCIES,
        "orders": [_order_row(i) for i in orders],
    }


@transaction.atomic
def place_order(patient, user, data):
    """Every check runs before the order exists: a true allergy is a hard stop
    that needs a written override reason (and a senior co-signature when the
    prescriber is not one); warnings must be acknowledged. Raises
    apps.billing.gate.BillingNotCleared when the encounter has no cleared payment."""
    from rest_framework.exceptions import PermissionDenied

    from apps.billing.gate import check_billing_clearance
    from apps.clinical_encounter.models import Prescription, PrescriptionItem
    from apps.dha_interop.models import NationalDrugIndex

    from . import plan_extras, services
    from .models import LocalConcept

    if not can_prescribe(user):
        raise PermissionDenied("Only a prescriber can place a medication order — request a psychiatrist review instead.")
    if patient.allergy_status in PRESCRIBING_LOCKED:
        raise ValidationError({"detail": "Prescribing locked — allergy status unknown. Record it in Intake first."})
    drug = NationalDrugIndex.objects.filter(pk=data.get("drug") or "").first()
    if drug is None:
        raise ValidationError({"drug": "Choose the medicine from the national drug index."})
    dose = str(data.get("dose") or "").strip()
    if not dose:
        raise ValidationError({"dose": "Enter the dose."})
    route = LocalConcept.objects.filter(valueset_id=ROUTE_VALUESET_ID, code=data.get("route"), active=True).first()
    if route is None:
        raise ValidationError({"route": "Choose the route."})
    is_prn = bool(data.get("is_prn"))
    indication = str(data.get("indication") or "").strip()
    frequency, maximum = "", None
    if is_prn:
        try:
            maximum = int(data.get("prn_max_per_24h"))
        except (TypeError, ValueError):
            maximum = 0
        if maximum < 1:
            raise ValidationError({"prn_max_per_24h": "A PRN order needs the maximum number of doses in 24 hours."})
        if not indication:
            raise ValidationError({"indication": "A PRN order needs its indication."})
    else:
        frequency = str(data.get("frequency") or "")
        if frequency not in FREQUENCIES:
            raise ValidationError({"frequency": "Choose the frequency, or mark the order PRN."})
    checks = prescribing_checks(patient, drug.generic_name)
    if checks["warnings"] and not data.get("acknowledged_warnings"):
        raise ValidationError({"acknowledged_warnings": "Review the warnings and confirm the order is clinically appropriate."})
    override = str(data.get("override_reason") or "").strip()
    if checks["blocking"] and len(override) < 5:
        raise ValidationError({"override_reason": "A recorded allergy is a hard stop. Cancel the order, or give the clinical reason for overriding it."})
    admission = services.current_admission(patient)
    if admission and admission.encounter_id:
        encounter = admission.encounter
    else:
        encounter = services.clinical_encounter_for(patient, services.get_or_open_episode(patient, user), user)
    check_billing_clearance(encounter)
    rx = Prescription.objects.create(organization_id=patient.organization_id, encounter=encounter, prescribed_by=user)
    item = PrescriptionItem.objects.create(
        organization_id=patient.organization_id, prescription=rx, drug=drug, dose=dose,
        route=route.display, frequency=frequency, is_prn=is_prn, prn_max_per_24h=maximum,
        indication=indication, controlled_drug=bool(data.get("controlled_drug")),
        allergy_check_passed=not checks["blocking"],
        check_findings=[{"level": "HARD", "text": t} for t in checks["blocking"]]
        + [{"level": "WARN", "text": t} for t in checks["warnings"]],
        allergy_override_reason=override if checks["blocking"] else "",
    )
    if checks["blocking"] and not plan_extras.can_cosign(user):
        plan_extras.request_cosign(
            patient, user, "PRESCRIBING_OVERRIDE",
            f"Allergy hard-stop override: {drug.generic_name} — {override}"[:300],
            subject_type="PrescriptionItem", subject_id=item.pk,
        )
    return item


# ── MAR ──
# VERIFY: the facility's drug-round times. Times are facility wall-clock times
# (settings.FACILITY_TIME_ZONE, via facility_time), not UTC.
FREQUENCY_SLOTS = {
    "once daily": ["08:00"], "mane": ["08:00"], "nocte": ["22:00"], "bd": ["08:00", "20:00"],
    "tds": ["08:00", "14:00", "20:00"], "qds": ["06:00", "12:00", "18:00", "22:00"],
}


def _local(value, fmt="%Y-%m-%d %H:%M"):
    return facility_time.local_format(value, fmt)


def slot_state(entry, now=None):
    """given / declined / withheld / future / due / late / missed (mockup marSlotsToday)."""
    now = now or timezone.now()
    if entry.status == "ADMINISTERED":
        return "given"
    if entry.status == "REFUSED":
        return "declined"
    if entry.status == "WITHHELD":
        return "withheld"
    if entry.status == "MISSED":
        return "missed"
    return _time_state(entry.scheduled_time, now)


def _time_state(scheduled, now):
    diff = (now - scheduled).total_seconds() / 60
    if diff < -60:
        return "future"
    if diff <= 60:
        return "due"
    if diff <= 180:
        return "late"
    return "missed"


def admission_orders(admission):
    """Orders the MAR works from: everything prescribed for the client since
    admission, plus any order already charted on this admission's MAR."""
    from django.db.models import Q

    from apps.clinical_encounter.models import PrescriptionItem
    from apps.ipd_ward.models import MedicationAdministration

    charted = MedicationAdministration.objects.filter(
        admission=admission, prescription_item__isnull=False
    ).values("prescription_item")
    return PrescriptionItem.objects.filter(
        Q(prescription__encounter__patient_id=admission.patient_id, prescription__prescribed_at__gte=admission.admitted_at)
        | Q(pk__in=charted)
    ).select_related("drug", "prescription").distinct().order_by("prescription__prescribed_at")


def prn_given_24h(item, now=None):
    from apps.ipd_ward.models import MedicationAdministration

    since = (now or timezone.now()) - timedelta(hours=24)
    return MedicationAdministration.objects.filter(
        prescription_item=item, status="ADMINISTERED", administered_at__gte=since
    ).count()


def slot_times(item, now=None):
    """Today's scheduled dose times for a regular order (none for PRN or stat)."""
    if item.is_prn:
        return []
    day = facility_time.local_date(now)
    times = []
    for hhmm in FREQUENCY_SLOTS.get((item.frequency or "").strip().lower(), []):
        hour, minute = (int(x) for x in hhmm.split(":"))
        times.append(facility_time.combine_local(day, time(hour, minute)))
    return times


def _order_mar(item, entries, now):
    """One order on today's MAR: its dose times (charted or not yet) and, for a
    PRN, how many doses were given in the last 24 h against the written maximum."""
    by_time = {e.scheduled_time: e for e in entries if e.prescription_item_id == item.pk}
    slots = []
    for at in sorted(set(slot_times(item, now)) | {t for t, e in by_time.items() if e.status == "SCHEDULED"}):
        entry = by_time.get(at)
        slots.append({
            "time": at, "entry": str(entry.pk) if entry else None,
            "state": slot_state(entry, now) if entry else _time_state(at, now),
        })
    given = prn_given_24h(item, now) if item.is_prn else None
    return {
        **_order_row(item), "slots": slots, "given_24h": given,
        "at_max": bool(item.is_prn and item.prn_max_per_24h and given >= item.prn_max_per_24h),
    }


def mar_today(patient):
    from apps.ipd_ward.models import MedicationAdministration

    from . import services

    admission = services.current_admission(patient)
    if admission is None:
        return {"admission": None, "orders": [], "entries": [], "pending_effects": []}
    now = timezone.now()
    start = facility_time.combine_local(facility_time.local_date(now))
    entries = list(MedicationAdministration.objects.filter(
        admission=admission, scheduled_time__gte=start - timedelta(days=1)
    ).select_related("prescription_item__drug", "administered_by").order_by("scheduled_time"))
    rows = [_mar_row(e, now) for e in entries]
    return {
        "admission": str(admission.id),
        "orders": [_order_mar(item, entries, now) for item in admission_orders(admission).select_related("prescription__prescribed_by")],
        "entries": rows,
        "pending_effects": [r for r in rows if r["is_prn"] and r["status"] == "ADMINISTERED" and not r["effect"]],
    }


def _mar_row(e, now):
    drug = e.prescription_item.drug.generic_name if e.prescription_item_id else ""
    return {
        "id": str(e.id), "order": str(e.prescription_item_id or ""), "drug": drug,
        "dose": e.prescription_item.dose if e.prescription_item_id else "",
        "scheduled_time": e.scheduled_time, "status": e.status, "state": slot_state(e, now),
        "is_prn": e.is_prn, "prn_indication": e.prn_indication, "controlled_drug": e.controlled_drug,
        "witness_name": e.witness_name, "own_supply": e.own_supply, "notes": e.notes,
        "effect": e.effect, "administered_at": e.administered_at, "by": _name(e.administered_by),
        "prn_max_override_reason": e.prn_max_override_reason,
    }


@transaction.atomic
def administer_order(admission, item, user, outcome, *, slot="", **documentation):
    """Record a dose against an order: at one of today's dose times, or — with
    no slot — as an unscheduled dose (every PRN dose, a stat dose, or a regular
    medicine given outside its round). The MAR row is created on recording."""
    from django.utils.dateparse import parse_datetime

    from apps.ipd_ward.models import MedicationAdministration

    now = timezone.now()
    if slot:
        when = parse_datetime(str(slot))
        if when is None:
            raise ValidationError({"slot": "Choose the dose time."})
        when = facility_time.make_local_aware(when)
        entry = MedicationAdministration.objects.filter(
            admission=admission, prescription_item=item, scheduled_time=when
        ).first()
        if entry is None and when not in slot_times(item, now):
            raise ValidationError({"slot": "That is not one of today's dose times for this order."})
    else:
        entry = None
        when = now
    if entry is None:
        entry = MedicationAdministration.objects.create(
            organization_id=admission.organization_id, admission=admission, prescription_item=item,
            scheduled_time=when, is_prn=item.is_prn, controlled_drug=item.controlled_drug,
        )
    return record_administration(entry, user, outcome, **documentation)


@transaction.atomic
def record_administration(entry, user, outcome, *, notes="", indication="", witness="", own_supply=False,
                          override_reason=""):
    """Given / Declined / Withheld — each with the documentation it needs."""
    if entry.status not in ("SCHEDULED", "MISSED"):
        raise ValidationError({"detail": "This dose has already been recorded."})
    notes = (notes or "").strip()
    if outcome not in ("ADMINISTERED", "REFUSED", "WITHHELD"):
        raise ValidationError({"outcome": "Use ADMINISTERED, REFUSED or WITHHELD."})
    if outcome != "ADMINISTERED" and not notes:
        raise ValidationError({"notes": "A reason is required when a dose is declined or withheld."})
    if outcome == "ADMINISTERED":
        if entry.controlled_drug and not (witness or "").strip():
            raise ValidationError({"witness_name": "A second signature (witness) is required for a controlled drug."})
        if entry.is_prn and not (indication or "").strip():
            raise ValidationError({"prn_indication": "Say why the PRN dose is being given now."})
        order = entry.prescription_item
        if entry.is_prn and order and order.prn_max_per_24h and prn_given_24h(order) >= order.prn_max_per_24h:
            if not (override_reason or "").strip():
                raise ValidationError({"override_reason": (
                    f"The maximum of {order.prn_max_per_24h} doses in 24 h has already been given — review "
                    "with the prescriber, and record the reason if the dose is still given."
                )})
            entry.prn_max_override_reason = override_reason.strip()[:400]
    entry.status = outcome
    entry.administered_by = user
    entry.administered_at = timezone.now()
    entry.notes = notes
    entry.prn_indication = (indication or entry.prn_indication).strip()
    entry.witness_name = (witness or "").strip()
    entry.own_supply = bool(own_supply)
    entry.save()
    return entry


def record_effect(entry, user, effect):
    effect = (effect or "").strip()
    if not entry.is_prn or entry.status != "ADMINISTERED":
        raise ValidationError({"detail": "Only a given PRN dose has an effect to record."})
    if not effect:
        raise ValidationError({"effect": "Record the effect."})
    entry.effect = effect
    entry.effect_recorded_at = timezone.now()
    entry.save(update_fields=["effect", "effect_recorded_at", "updated_at"])
    return entry


# ── restrictive practice ──
DE_ESCALATION = ["Verbal de-escalation", "Reduced stimulation / space offered", "Oral PRN offered first", "Support person involved"]


def _check_label(kind, minutes):
    if kind == "RAPID_TRANQUILLISATION":
        return f"{minutes} min — pulse, BP, RR, SpO₂, temp, consciousness, hydration"
    if kind == "RESTRAINT":
        return f"{minutes} min — airway, breathing, circulation, position"
    return f"Seclusion review at {minutes // 60} h (nurse + doctor)"


@transaction.atomic
def record_restrictive_episode(patient, user, data):
    kind = data.get("kind")
    if kind not in dict(RestrictivePracticeEpisode.KIND_CHOICES):
        raise ValidationError({"kind": "Choose the intervention."})
    tried = [d for d in (data.get("de_escalation") or []) if d in DE_ESCALATION]
    if not tried:
        raise ValidationError({"de_escalation": "Document the de-escalation attempted first."})
    if data.get("injury_check") not in dict(RestrictivePracticeEpisode.INJURY_CHOICES):
        raise ValidationError({"injury_check": "Record the injury check."})
    try:
        authoriser_id = uuid.UUID(str(data.get("authorised_by")))
    except ValueError:
        authoriser_id = None
    authoriser = restrictive_authorisers(patient.organization_id).filter(pk=authoriser_id).first()
    if authoriser is None:
        raise ValidationError({"authorised_by": "Name the person who authorised it."})
    debrief = data.get("client_debrief") or "PENDING"
    if debrief not in ("PENDING", "DONE"):
        raise ValidationError({"client_debrief": "Client debrief is Pending or Done."})
    start = data.get("start_at")
    if not start:
        raise ValidationError({"start_at": "Record the start time."})
    from django.utils.dateparse import parse_datetime

    start_at = parse_datetime(str(start))
    if start_at is None:
        raise ValidationError({"start_at": "Enter a valid start time."})
    if timezone.is_naive(start_at):
        start_at = facility_time.make_local_aware(start_at)
    episode = RestrictivePracticeEpisode.objects.create(
        organization_id=patient.organization_id, patient=patient, kind=kind, de_escalation=tried,
        authorised_by=authoriser, start_at=start_at, injury_check=data["injury_check"],
        incident_reference=(data.get("incident_reference") or "").strip(),
        staff_debrief_held=bool(data.get("staff_debrief_held")), recorded_by=user,
        client_debrief_at=timezone.now() if debrief == "DONE" else None,
    )
    for minutes in settings.RESTRICTIVE_CHECK_MINUTES.get(kind, []):
        RestrictiveCheck.objects.create(
            organization_id=patient.organization_id, episode=episode,
            label=_check_label(kind, minutes), due_at=start_at + timedelta(minutes=minutes),
        )
    from . import plan_extras

    if not plan_extras.can_cosign(authoriser):
        plan_extras.request_cosign(
            patient, user, "RESTRICTIVE_PRACTICE",
            f"{episode.get_kind_display()} authorised by {_name(authoriser)} from "
            f"{_local(start_at)}",
            subject_type="RestrictivePracticeEpisode", subject_id=episode.pk,
        )
    return episode


def restrictive_authorisers(organization_id):
    """Who may be named as authoriser: prescribers and senior (co-signing)
    clinicians. One who is not senior triggers a co-signature request."""
    from django.db.models import Q

    from apps.accounts.models import User

    query = Q()
    for name in [*settings.PRESCRIBER_ROLES, *settings.COSIGN_ROLES]:
        query |= Q(roles__name__iexact=name)
    return User.objects.filter(query, organization_id=organization_id, is_active=True).distinct()


def complete_check(check, user):
    if check.done_at:
        raise ValidationError({"detail": "Already recorded."})
    check.done_at, check.done_by = timezone.now(), user
    check.save()
    return check


def end_episode(episode, end_at=None):
    if episode.end_at:
        raise ValidationError({"detail": "This episode has already ended."})
    if end_at:
        from django.utils.dateparse import parse_datetime

        parsed = parse_datetime(str(end_at))
        if parsed is None:
            raise ValidationError({"end_at": "Enter a valid end time."})
        end_at = facility_time.make_local_aware(parsed)
        if end_at > timezone.now() + timedelta(minutes=1):
            raise ValidationError({"end_at": "The end cannot be in the future."})
    episode.end_at = end_at or timezone.now()
    if episode.end_at < episode.start_at:
        raise ValidationError({"end_at": "The end cannot be before the start."})
    episode.save(update_fields=["end_at", "updated_at"])
    return episode


def client_debrief(episode):
    episode.client_debrief_at = timezone.now()
    episode.save(update_fields=["client_debrief_at", "updated_at"])
    return episode


def seclusion_review_due(episode):
    """An ongoing seclusion past the configured maximum needs independent senior review."""
    return bool(
        episode.kind == "SECLUSION" and not episode.end_at
        and timezone.now() - episode.start_at >= timedelta(minutes=settings.SECLUSION_MAX_MINUTES)
    )


# ── SBAR ──


def allergy_text(patient):
    """The allergy line carried into handovers and module context."""
    allergies = patient.allergy_records.exclude(verification_status="REFUTED").exclude(
        clinical_status="RESOLVED"
    )
    if allergies.exists():
        return ", ".join(
            f"{a.substance}{' (unconfirmed)' if a.verification_status == 'UNCONFIRMED' else ''}"
            for a in allergies
        )
    return {"NONE": "No known allergies", "UNKNOWN": "Allergy status unknown"}.get(
        patient.allergy_status, "Not recorded"
    )


def build_sbar(patient, user):
    """Handover text built from the record — nothing is typed twice."""
    from apps.triage.models import VitalSigns

    from . import intake, services

    signed = intake.current_draft(patient) or intake.latest_signed(patient)
    sections = signed.sections if signed else {}
    triage = services.latest_signed_triage(patient)
    allergies = allergy_text(patient)
    meds =MedicationHistoryEntry.objects.filter(patient=patient, superseded_at__isnull=True)
    meds_text = "; ".join(f"{m.name} {m.dose} {m.frequency}".strip() for m in meds) or "none recorded"
    vital = VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at").first()
    vitals_text = "—"
    if vital:
        score = ews_module.from_vital(vital)
        vitals_text = (
            f"{score['label']} · HR {vital.heart_rate or '–'} · BP "
            f"{vital.systolic_bp or '–'}/{vital.diastolic_bp or '–'} · RR {vital.respiratory_rate or '–'} · "
            f"T {vital.temperature_c or '–'} · SpO₂ {vital.spo2 or '–'} ({_local(vital.recorded_at)})"
        )
    alerts = [a.label for a in ClinicalAlert.objects.filter(patient=patient, status="ACTIVE")]
    risk = sections.get("risk", {})
    mse = mental_state.exam_text(sections.get("mse", {}))
    scores = []
    for code in ("PHQ9", "GAD7", "PAWSS", "PCL5", "EPDS"):
        s = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
        if s:
            scores.append(f"{code} {s.score}")
    from apps.clinical_encounter.models import DiagnosisCode

    dx = "; ".join(
        f"{d.icd11_code.code} {d.icd11_code.description}"
        for d in DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE")
        .exclude(verification_status="RULED_OUT").select_related("icd11_code")
    ) or "none recorded"
    plan = services.current_or_latest_episode(patient)
    plan_text = ""
    if plan and hasattr(plan, "care_plan"):
        actions = plan.care_plan.activities.exclude(decision="DECLINED").exclude(action_key="")
        if actions.exists():
            plan_text = "Plan: " + "; ".join(f"{a.title} ({a.get_priority_display() or '—'})" for a in actions) + ". "
    priority = triage.get_priority_display() if triage and triage.priority else "not triaged"
    handover = sections.get("close", {}).get("message", "")
    age = patient.age_years
    return (
        f"SITUATION\n{patient.get_full_name()} ({patient.citramac_number}), "
        f"{age if age is not None else 'age unknown'} {patient.get_gender_display() if patient.gender else ''}. "
        f"Priority {priority}. {sections.get('pres', {}).get('own') or (triage.presenting_concern if triage else '') or ''}\n"
        f"ALLERGIES: {allergies}\n\n"
        f"BACKGROUND\n{sections.get('sx', {}).get('hpi') or sections.get('pres', {}).get('own') or '—'}\n"
        f"Past psychiatric: {sections.get('mh', {}).get('past_psych') or '—'}\n"
        f"Medicines: {meds_text}\n\n"
        f"ASSESSMENT\nVitals: {vitals_text}\n"
        f"Active alerts: {'; '.join(alerts) or 'none'}\n"
        f"Risk formulation: {risk.get('summary') if risk.get('formulation_signed_at') else 'not yet signed'}"
        f"{' · next 24–72 h: ' + risk['change_72h'] if risk.get('change_72h') else ''}\n"
        f"MSE: mood {mse.get('mood') or '—'}; thought {mse.get('thought_content') or '—'}; "
        f"perception {mse.get('perception') or '—'}; insight {mse.get('insight') or '—'}\n"
        f"Scores: {' · '.join(scores) or 'none'}\n"
        f"Diagnosis: {dx}\n\n"
        f"RECOMMENDATION\n{plan_text}{('Handover: ' + handover + '. ') if handover else ''}"
        f"Request senior review / receiving-unit acceptance. Prepared by {_name(user)} at {_local(timezone.now(), '%H:%M')}."
    )

