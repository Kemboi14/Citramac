"""
Live queue (v4 mockup renderQueue / queueRow / patientPending / attentionChips).

Four lanes over the one shared store — nothing here is stored:
  Awaiting triage · Triaged — waiting to be seen (clinical priority, then time)
  · In care today · Discharged — in follow-up.
Columns: priority, client (privacy name), wait vs target, next action,
observation level / location, owner, attention chips.

"Seen" is the moment the psychiatric review opened (TriageEncounter.
psychiatry_review_started_at). Targets: triage — triage_rules.TRIAGE_TARGET_MINUTES;
seen — settings.SEEN_BY_CLINICIAN_TARGET_MINUTES, else the mockup's illustrative
values (triage_v4.SEEN_TARGET_MINUTES — illustrative, from client mockup, VERIFY).
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.client_registry.models import Appointment, Patient
from apps.triage.models import VitalSigns

from . import ews, triage_rules
from . import triage_v4 as v4
from .models import (
    PRIORITY_ORDER,
    CareTask,
    ClinicalAlert,
    EpisodeOfCare,
    RiskProposal,
    TriageEncounter,
)

TIMED_TASKS = ("TRIAGE_CALLBACK", "PEP_EC_DECISION", "DUTY_TO_PROTECT")


def _initials(name):
    return "".join(w[0] for w in str(name).split() if w)[:2].upper()


def privacy_name(patient):
    """Queue privacy (mockup qName): initials + the last 3 digits of the record
    number, so a screen visible at reception does not show names."""
    number = patient.citramac_number or ""
    if (
        patient.identity_status != Patient.IDENTITY_IDENTIFIED
        and not patient.get_full_name().strip()
    ):
        return "Unidentified · " + (number.replace("CIT-", "") or "no number yet")
    initials = _initials(patient.preferred_name or patient.get_full_name()) or "?"
    return f"{initials} · …{number[-3:]}" if number else initials


def _signed(te):
    return te.assessments.filter(status="COMPLETED").order_by("-version").first()


def _minutes(delta):
    return max(0, int(delta.total_seconds() // 60))


def wait_info(te, now, lane):
    waited = _minutes(now - te.arrival_at)
    if lane == "awaiting":
        target = triage_rules.TRIAGE_TARGET_MINUTES
        return {"minutes": waited, "target": target, "over": waited > target, "kind": "triage"}
    if lane == "waiting":
        target = v4.seen_targets().get(te.priority)
        return {
            "minutes": waited,
            "target": target,
            "over": target is not None and waited > target,
            "kind": "seen",
        }
    return {
        "minutes": waited,
        "target": None,
        "over": False,
        "kind": "seen" if lane == "in_care" else "none",
    }


def vitals_state(te, answers):
    """Triage vitals on the triage encounter (and any later set): EWS completeness."""
    latest = VitalSigns.objects.filter(encounter=te.encounter).order_by("-recorded_at").first()
    score = ews.from_vital(latest) if latest else ews.score({})
    missing = [v4.EWS_LABELS[k] for k in ews.PARAMS if score["parts"].get(k) is None]
    not_measured = [
        key[3:] for key, reason in (answers or {}).items() if key.startswith("nm_") and reason
    ]
    return score, missing, not_measured


def te_items(te, now, signed=None, include_queue=True):
    """What is outstanding for one triage encounter: [{key, text, due_at, overdue, kind}]."""
    items = []

    def add(key, text, due_at=None, kind=""):
        items.append(
            {
                "key": key,
                "text": text,
                "due_at": due_at,
                "overdue": bool(due_at and due_at <= now),
                "kind": kind,
            }
        )

    if te.triage_version == 0:
        if include_queue:
            add(
                "triage",
                f"Triage (target within {triage_rules.TRIAGE_TARGET_MINUTES} min of arrival)",
                te.due_at,
            )
        return items
    signed = signed if signed is not None else _signed(te)
    answers = signed.answers if signed else {}
    is_v4 = v4.is_v4(answers)
    present = (answers.get("b_present") != "no") if is_v4 else True
    seen = te.psychiatry_review_started_at is not None
    colour, name = te.priority, v4.PRIORITY_NAME.get(te.priority, "")
    if not seen and present and is_v4:
        score, _missing, not_measured = vitals_state(te, answers)
        if not score["complete"]:
            text = f"Complete vital signs — {score['label']}"
            if not_measured:
                text += " · not measured: " + ", ".join(not_measured)
            add(
                "vitals", text, te.last_triaged_at + timedelta(minutes=v4.VITALS_COMPLETION_MINUTES)
            )
    if not seen and include_queue:
        target = v4.seen_targets().get(te.priority)
        add(
            "seen",
            f"To be seen — {colour} {name} ({f'target {target} min' if target else 'see now'})",
            te.arrival_at + timedelta(minutes=target) if target is not None else None,
        )
    if not seen and present and te.next_recheck_at:
        urgent = te.priority in ("RED", "ORANGE")
        overdue = urgent and te.next_recheck_at <= now
        add(
            "recheck",
            f"{'Re-triage OVERDUE' if overdue else 'Quick re-check while waiting'} ({colour})",
            te.next_recheck_at,
            "escalate" if urgent else "",
        )
    for task in CareTask.objects.filter(
        triage_encounter=te, focus_type__in=TIMED_TASKS, status__in=("INITIATED", "PENDING")
    ):
        add(f"task:{task.id}", task.action_label, task.due_at, "escalate")
    if is_v4 and not seen and "minor" in (answers.get("flags") or []):
        add("minor", "Minor — record the guardian and offer time alone with the young person")
    items.sort(
        key=lambda i: (
            not i["overdue"],
            i["kind"] != "escalate",
            i["due_at"] or now + timedelta(days=3650),
        )
    )
    return items


def attention_chips(te, now, lane, wait, signed, alerts, proposals):
    chips = []
    answers = signed.answers if signed else {}
    if lane in ("awaiting", "waiting") and wait["over"]:
        chips.append(
            {
                "key": "over",
                "label": "Triage breach" if lane == "awaiting" else "Over target",
                "tone": "risk",
                "sev": 0,
            }
        )
    present = answers.get("b_present") != "no"
    if lane == "waiting" and present and te.next_recheck_at and te.next_recheck_at <= now:
        urgent = te.priority in ("RED", "ORANGE")
        chips.append(
            {
                "key": "recheck",
                "label": f"Re-triage {'overdue' if urgent else 'due'}",
                "tone": "risk" if urgent else "warn",
                "sev": 0 if urgent else 2,
            }
        )
    if alerts:
        chips.append(
            {
                "key": "alerts",
                "label": alerts[0],
                "count": len(alerts),
                "labels": alerts,
                "tone": "warn",
                "sev": 1,
            }
        )
    if v4.is_v4(answers) and answers.get("b_present") == "no":
        chips.append({"key": "telephone", "label": "Telephone triage", "tone": "info", "sev": 4})
    if proposals:
        chips.append({"key": "proposal", "label": "Risk proposal", "tone": "warn", "sev": 2})
    chips.sort(key=lambda c: c["sev"])
    return chips


def _obs(signed, labels, lane):
    if not signed or lane in ("awaiting", "discharged"):
        return None
    a = signed.answers
    if not v4.is_v4(a):
        return None
    if a.get("b_present") == "no":
        return {"off_site": True, "level": "", "location": "", "observer": ""}
    level, where = a.get("safety_obs") or "", a.get("safety_location") or ""
    return {
        "off_site": False,
        "level": labels.get(("triage-v4-observation-level", level), level),
        "location": labels.get(("triage-v4-location", where), where),
        "observer": a.get("safety_observer") or "",
    }


def _row(te, lane, now, labels):
    from .services import current_admission, user_display

    patient = te.patient
    signed = _signed(te) if te.triage_version else None
    wait = wait_info(te, now, lane)
    alerts = list(
        ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").values_list(
            "label", flat=True
        )
    )
    proposals = RiskProposal.objects.filter(
        patient=patient, status__in=("PROPOSED", "DEFERRED")
    ).exists()
    owner = te.episode.care_manager if te.episode_id else None
    if owner is None and te.psychiatry_encounter_id:
        owner = te.psychiatry_encounter.opened_by
    admission = current_admission(patient) if lane == "in_care" else None
    items = te_items(te, now, signed) if lane != "discharged" else []
    next_follow_up = None
    if lane == "discharged":
        appt = (
            Appointment.objects.filter(patient=patient, status="SCHEDULED", scheduled_for__gte=now)
            .order_by("scheduled_for")
            .first()
        )
        next_follow_up = appt.scheduled_for.isoformat() if appt else None
    return {
        "id": str(te.id),
        "patient_id": str(patient.id),
        "lane": lane,
        "name": patient.get_full_name(),
        "privacy_name": privacy_name(patient),
        "citramac_number": patient.citramac_number,
        "identity_status": patient.identity_status,
        "age": patient.age_years,
        "sex": patient.gender,
        "arrival_at": te.arrival_at.isoformat(),
        "triage_version": te.triage_version,
        "priority": te.priority,
        "rules_version": signed.rules_version if signed else "",
        "wait": wait,
        "next_action": (
            {**items[0], "due_at": items[0]["due_at"].isoformat() if items[0]["due_at"] else None}
            if items
            else None
        ),
        "next_follow_up": next_follow_up,
        "observation": _obs(signed, labels, lane),
        "owner": {"id": str(owner.pk), "name": user_display(owner)} if owner else None,
        "team": admission.primary_care_team if admission else "",
        "attention": attention_chips(te, now, lane, wait, signed, alerts, proposals),
        "seen_at": te.psychiatry_review_started_at.isoformat()
        if te.psychiatry_review_started_at
        else None,
    }


def live_queue(now=None):
    from .services import concept_labels

    now = now or timezone.now()
    labels = concept_labels()
    latest = {}
    for te in (
        TriageEncounter.objects.filter(
            patient__archived_at__isnull=True, episode__status__in=EpisodeOfCare.OPEN_STATUSES
        )
        .select_related(
            "patient", "episode__care_manager", "psychiatry_encounter__opened_by", "encounter"
        )
        .order_by("arrival_at")
    ):
        latest[te.patient_id] = te
    lanes = {"awaiting": [], "waiting": [], "in_care": [], "discharged": []}
    for te in latest.values():
        if te.triage_version == 0:
            lane = "awaiting"
        elif te.psychiatry_review_started_at is None:
            lane = "waiting"
        else:
            lane = "in_care"
        lanes[lane].append(te)
    follow_up_patients = (
        Appointment.objects.filter(status="SCHEDULED", scheduled_for__gte=now)
        .filter(Q(origin__in=("DISCHARGE", "CARE_PLAN")) | ~Q(reason=""))
        .exclude(patient_id__in=list(latest))
        .values_list("patient_id", flat=True)
    )
    discharged = {}
    for te in (
        TriageEncounter.objects.filter(
            patient_id__in=list(follow_up_patients), patient__archived_at__isnull=True
        )
        .select_related(
            "patient", "episode__care_manager", "psychiatry_encounter__opened_by", "encounter"
        )
        .order_by("arrival_at")
    ):
        discharged[te.patient_id] = te
    lanes["discharged"] = list(discharged.values())

    by_priority = lambda te: (PRIORITY_ORDER.get(te.priority, 9), te.arrival_at)  # noqa: E731
    lanes["awaiting"].sort(key=lambda te: te.arrival_at)
    lanes["waiting"].sort(key=by_priority)
    lanes["in_care"].sort(key=by_priority)
    lanes["discharged"].sort(key=by_priority)
    rows = {lane: [_row(te, lane, now, labels) for te in tes] for lane, tes in lanes.items()}
    over = sum(1 for lane in ("awaiting", "waiting") for r in rows[lane] if r["wait"]["over"])
    return {
        "lanes": rows,
        "over_target": over,
        "now": now.isoformat(),
        "triage_target_minutes": triage_rules.TRIAGE_TARGET_MINUTES,
        "seen_target_minutes": v4.seen_targets(),
        "targets_approval": "illustrative — from client mockup, VERIFY",
    }


def patient_items(patient, now):
    """Triage items for the cross-client task list (attention.patient_items):
    vital-sign completion, re-check / re-triage, timed triage tasks, the minor
    prompt. Queue-only items (triage, to be seen) stay on the queue."""
    te = (
        TriageEncounter.objects.filter(patient=patient, triage_version__gt=0)
        .select_related("encounter")
        .order_by("-arrival_at")
        .first()
    )
    if te is None:
        return []
    return te_items(te, now, include_queue=False)
