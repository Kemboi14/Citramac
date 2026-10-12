"""
Intervention modules (mockup v4 stage 5): SBAR handover, observation & safety,
observation sets (EWS), prescribing checks, the MAR and restrictive practice.

What is deliberately *not* here (CLAUDE.md §6): a drug formulary, interaction
rules, maximum-dose ceilings or class duplication — those need a licensed or
national source (VERIFY). The prescribing check says so in every result instead
of implying a clean bill of health. Timed monitoring schedules are
configuration (settings), not clinical advice.
"""

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import ews as ews_module
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
    for allergy in patient.allergy_records.exclude(verification_status="REFUTED"):
        substance = allergy.substance.strip().lower()
        if substance and (substance in name or name in substance):
            tag = "client-reported, unconfirmed" if allergy.verification_status == "UNCONFIRMED" else "confirmed"
            hard.append(f"Recorded allergy to {allergy.substance} ({tag}) matches {drug_name}.")
    if patient.allergy_status == "UNKNOWN":
        warn.append("Allergy status is unknown — assess before prescribing.")
    elif patient.allergy_records.filter(verification_status="UNCONFIRMED").exists():
        warn.append("The allergy record is client-reported and not yet clinically confirmed.")
    for med in MedicationHistoryEntry.objects.filter(
        patient=patient, superseded_at__isnull=True, status="TAKING"
    ):
        if med.name.strip().lower() == name:
            warn.append(f"Duplicate — {med.name} is already on the medication list ({med.dose} {med.frequency}).")
    return {
        "blocking": hard,
        "warnings": warn,
        "not_checked": [
            "Drug interactions, therapeutic-class duplication, maximum daily doses, QTc and "
            "pregnancy rules were NOT checked — no licensed formulary is configured. "
            "Allergy and exact-name duplicate checks only (VERIFY: national drug index / formulary)."
        ],
    }


# ── MAR ──
FREQUENCY_SLOTS = {
    "once daily": ["08:00"], "mane": ["08:00"], "nocte": ["22:00"], "bd": ["08:00", "20:00"],
    "tds": ["08:00", "14:00", "20:00"], "qds": ["06:00", "12:00", "18:00", "22:00"],
}


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
    diff = (now - entry.scheduled_time).total_seconds() / 60
    if diff < -60:
        return "future"
    if diff <= 60:
        return "due"
    if diff <= 180:
        return "late"
    return "missed"


def mar_today(patient):
    from apps.ipd_ward.models import MedicationAdministration

    from . import services

    admission = services.current_admission(patient)
    if admission is None:
        return {"admission": None, "entries": [], "pending_effects": []}
    start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    entries = MedicationAdministration.objects.filter(
        admission=admission, scheduled_time__gte=start - timedelta(days=1)
    ).select_related("prescription_item__drug").order_by("scheduled_time")
    now = timezone.now()
    rows = [_mar_row(e, now) for e in entries]
    return {
        "admission": str(admission.id),
        "entries": rows,
        "pending_effects": [r for r in rows if r["is_prn"] and r["status"] == "ADMINISTERED" and not r["effect"]],
    }


def _mar_row(e, now):
    drug = e.prescription_item.drug.generic_name if e.prescription_item_id else ""
    return {
        "id": str(e.id), "drug": drug, "dose": e.prescription_item.dose if e.prescription_item_id else "",
        "scheduled_time": e.scheduled_time, "status": e.status, "state": slot_state(e, now),
        "is_prn": e.is_prn, "prn_indication": e.prn_indication, "controlled_drug": e.controlled_drug,
        "witness_name": e.witness_name, "own_supply": e.own_supply, "notes": e.notes,
        "effect": e.effect, "administered_at": e.administered_at, "by": _name(e.administered_by),
    }


@transaction.atomic
def record_administration(entry, user, outcome, *, notes="", indication="", witness="", own_supply=False):
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
    from apps.accounts.models import User

    try:
        authoriser_id = uuid.UUID(str(data.get("authorised_by")))
    except ValueError:
        authoriser_id = None
    authoriser = User.objects.filter(pk=authoriser_id, organization_id=patient.organization_id).first()
    if authoriser is None:
        raise ValidationError({"authorised_by": "Name the person who authorised it."})
    start = data.get("start_at")
    if not start:
        raise ValidationError({"start_at": "Record the start time."})
    from django.utils.dateparse import parse_datetime

    start_at = parse_datetime(str(start))
    if start_at is None:
        raise ValidationError({"start_at": "Enter a valid start time."})
    if timezone.is_naive(start_at):
        start_at = timezone.make_aware(start_at)
    episode = RestrictivePracticeEpisode.objects.create(
        organization_id=patient.organization_id, patient=patient, kind=kind, de_escalation=tried,
        authorised_by=authoriser, start_at=start_at, injury_check=data["injury_check"],
        incident_reference=(data.get("incident_reference") or "").strip(),
        staff_debrief_held=bool(data.get("staff_debrief_held")), recorded_by=user,
    )
    for minutes in settings.RESTRICTIVE_CHECK_MINUTES.get(kind, []):
        RestrictiveCheck.objects.create(
            organization_id=patient.organization_id, episode=episode,
            label=_check_label(kind, minutes), due_at=start_at + timedelta(minutes=minutes),
        )
    return episode


def complete_check(check, user):
    if check.done_at:
        raise ValidationError({"detail": "Already recorded."})
    check.done_at, check.done_by = timezone.now(), user
    check.save()
    return check


def end_episode(episode, end_at=None):
    if episode.end_at:
        raise ValidationError({"detail": "This episode has already ended."})
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


def build_sbar(patient, user):
    """Handover text built from the record — nothing is typed twice."""
    from . import intake, services
    from apps.triage.models import VitalSigns

    signed = intake.current_draft(patient) or intake.latest_signed(patient)
    sections = signed.sections if signed else {}
    triage = services.latest_signed_triage(patient)
    allergies = patient.allergy_records.exclude(verification_status="REFUTED")
    if allergies.exists():
        allergy_text = ", ".join(
            f"{a.substance}{' (unconfirmed)' if a.verification_status == 'UNCONFIRMED' else ''}"
            for a in allergies
        )
    else:
        allergy_text = {"NONE": "No known allergies", "UNKNOWN": "Allergy status unknown"}.get(
            patient.allergy_status, "Not recorded"
        )
    meds = MedicationHistoryEntry.objects.filter(patient=patient, superseded_at__isnull=True)
    meds_text = "; ".join(f"{m.name} {m.dose} {m.frequency}".strip() for m in meds) or "none recorded"
    vital = VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at").first()
    vitals_text = "—"
    if vital:
        score = ews_module.from_vital(vital)
        vitals_text = (
            f"{score['label']} · HR {vital.heart_rate or '–'} · BP "
            f"{vital.systolic_bp or '–'}/{vital.diastolic_bp or '–'} · RR {vital.respiratory_rate or '–'} · "
            f"T {vital.temperature_c or '–'} · SpO₂ {vital.spo2 or '–'} ({vital.recorded_at:%Y-%m-%d %H:%M})"
        )
    alerts = [a.label for a in ClinicalAlert.objects.filter(patient=patient, status="ACTIVE")]
    risk = sections.get("risk", {})
    mse = sections.get("mse", {})
    scores = []
    for code in ("PHQ9", "GAD7", "PAWSS", "PCL5", "EPDS"):
        s = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
        if s:
            scores.append(f"{code} {s.score}")
    from apps.clinical_encounter.models import DiagnosisCode

    dx = "; ".join(
        f"{d.icd11_code.code} {d.icd11_code.description}"
        for d in DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE").select_related("icd11_code")
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
        f"ALLERGIES: {allergy_text}\n\n"
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
        f"Request senior review / receiving-unit acceptance. Prepared by {_name(user)} at {timezone.now():%H:%M}."
    )

