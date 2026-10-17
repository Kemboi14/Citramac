"""
Risk proposals, decision-specific capacity, visit consent, progress notes and
episode outcome. Everything here is append-only once signed: a correction is a
new record (CLAUDE.md §3 item 7), never an edit of a signed one.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import instruments, services
from .models import (
    CapacityAssessment,
    EpisodeOfCare,
    EpisodeOutcome,
    ProgressNote,
    RiskProposal,
    VisitConsent,
)

# ── risk proposals ──


def _propose(patient, source, source_key, row, option):
    proposal, _ = RiskProposal.objects.get_or_create(
        patient=patient,
        source_key=source_key,
        defaults={"organization_id": patient.organization_id, "source": source, "row": row, "option": option},
    )
    return proposal


def propose_from_score(patient, score):
    """A positive self-harm item (PHQ-9 item 9, EPDS item 10) is proposed for the
    risk register, never written to it silently."""
    spec = instruments.INSTRUMENTS[score.instrument]
    if instruments.safety_positive(score.instrument, score.items, score.detail):
        return _propose(patient, f"{spec['name']} self-harm item", f"score:{score.pk}", "suicide", "Thoughts")
    return None


def propose_from_mse(patient, mse, section=None):
    """INT-16: structured thought content "Suicidal" / "Homicidal" raises a risk
    proposal (never a silent write); a legacy record is read from its stored text."""
    from . import mental_state

    for label, row, option in mental_state.risk_signals(section, mse.thought_content):
        _propose(patient, f"MSE thought content: {label.lower()}", f"mse:{mse.pk}:{label}", row, option)


@transaction.atomic
def decide_proposal(proposal, user, action, reason=""):
    if proposal.status in ("ADDED", "DISMISSED"):
        raise ValidationError({"detail": "This finding has already been decided."})
    if action not in ("ADD", "DEFER", "DISMISS"):
        raise ValidationError({"action": "Choose add, not now or dismiss."})
    if action == "DISMISS" and not reason.strip():
        raise ValidationError({"reason": "Say why this finding is being dismissed."})
    if action == "ADD":
        from . import intake

        draft = intake.open_draft(proposal.patient, user)
        risk = dict(draft.sections.get("risk") or {})
        rows = {k: list(v) for k, v in (risk.get("rows") or {}).items()}
        if proposal.option not in rows.setdefault(proposal.row, []):
            rows[proposal.row].append(proposal.option)
        risk["rows"] = rows
        draft.sections = {**draft.sections, "risk": risk}
        draft.save(update_fields=["sections", "updated_at"])
    proposal.status = {"ADD": "ADDED", "DEFER": "DEFERRED", "DISMISS": "DISMISSED"}[action]
    proposal.decided_by, proposal.decided_at, proposal.reason = user, timezone.now(), reason.strip()
    proposal.save()
    return proposal


# ── capacity ──
def capacity_outcome(values):
    if any(v not in ("Yes", "No", "Unsure") for v in values):
        raise ValidationError({"detail": "Answer all four capacity questions."})
    if all(v == "Yes" for v in values):
        return "Has capacity"
    if "No" in values:
        return "Lacks capacity"
    return "Unclear — reassess"


def record_capacity(patient, user, data):
    from .models import LocalConcept

    decision = data.get("decision") or ""
    if not LocalConcept.objects.filter(valueset_id="capacity-decision", code=decision).exists():
        raise ValidationError({"decision": "Choose the decision the capacity assessment is for."})
    if decision == "OTHER" and not str(data.get("other_decision", "")).strip():
        raise ValidationError({"other_decision": "Say which decision this is for."})
    answers = [data.get(k) for k in ("understand", "retain", "weigh", "communicate")]
    return CapacityAssessment.objects.create(
        organization_id=patient.organization_id, patient=patient, decision=decision,
        other_decision=str(data.get("other_decision", ""))[:200],
        understand=answers[0], retain=answers[1], weigh=answers[2], communicate=answers[3],
        outcome=capacity_outcome(answers), reassess_by=data.get("reassess_by") or None,
        note=str(data.get("note", "")), assessed_by=user,
    )


def current_capacity(patient):
    """Latest assessment per decision — the one in force."""
    latest = {}
    for a in CapacityAssessment.objects.filter(patient=patient).order_by("-assessed_at"):
        latest.setdefault(a.decision, a)
    return list(latest.values())


# ── visit consent ──
def consent_warnings(patient, scope, party):
    warnings = []
    cap = next((a for a in current_capacity(patient) if a.decision == scope), None)
    if cap and cap.outcome == "Lacks capacity" and party == "PATIENT":
        warnings.append("Capacity for this decision was assessed as lacking — the client cannot give this consent")
    if patient.age_years is not None and patient.age_years < 18 and party == "PATIENT":
        warnings.append("Client is under 18 — consent from a parent or guardian is normally needed")
    if party == "DEFERRED":
        warnings.append("Deferred consent must be completed as soon as the client is able")
    return warnings


def record_visit_consent(patient, user, data):
    party = data.get("party")
    if party not in dict(VisitConsent.PARTY_CHOICES):
        raise ValidationError({"party": "Say who is giving consent."})
    scope = str(data.get("scope", "")).strip()
    if not scope:
        raise ValidationError({"scope": "Say what the consent is for."})
    if party in ("GUARDIAN", "SUBSTITUTE") and not str(data.get("given_by_name", "")).strip():
        raise ValidationError({"given_by_name": "Record the name of the person consenting."})
    return VisitConsent.objects.create(
        organization_id=patient.organization_id, patient=patient, scope=scope, party=party,
        method=str(data.get("method", ""))[:20], given_by_name=str(data.get("given_by_name", ""))[:150],
        warnings=consent_warnings(patient, scope, party), recorded_by=user,
    )


def complete_deferred(consent, user):
    if consent.party != "DEFERRED" or consent.completed_at:
        raise ValidationError({"detail": "This is not an open deferred consent."})
    consent.completed_at, consent.completed_by = timezone.now(), user
    consent.save(update_fields=["completed_at", "completed_by", "updated_at"])
    return consent


# ── progress notes ──
def _check_type(note_type):
    from .models import LocalConcept

    if not LocalConcept.objects.filter(valueset_id="note-type", code=note_type).exists():
        raise ValidationError({"note_type": "Choose the note type."})


def save_note(patient, user, data, note=None):
    if note is None:
        _check_type(data.get("note_type"))
        episode = services.get_or_open_episode(patient, user)
        note = ProgressNote.objects.create(
            organization_id=patient.organization_id, patient=patient, episode=episode,
            encounter=services.clinical_encounter_for(patient, episode, user),
            note_type=data["note_type"], author=user, amends=data.get("amends"),
        )
    if note.status == "SIGNED":
        raise ValidationError({"detail": "A signed note cannot be edited — add an addendum."})
    note.text = str(data.get("text", ""))
    note.save(update_fields=["text", "updated_at"])
    return note


def sign_note(note, user):
    if note.status == "SIGNED":
        raise ValidationError({"detail": "This note is already signed."})
    if not note.text.strip():
        raise ValidationError({"text": "A note cannot be signed empty."})
    note.status, note.signed_at, note.author = "SIGNED", timezone.now(), user
    note.save()
    return note


# ── episode outcome ──
# Checklist answers an episode keeps on its care plan (same keys and values as
# the inpatient DischargeSummary.readiness).
READINESS_ANSWERS = {
    "meds_reconciled": (True, False),
    "counter_referral": ("SENT", "NO_REFERRER", ""),
    "naloxone": ("OFFERED", "DECLINED", ""),
    "teach_back": (True, False),
}


def episode_discharge_checklist(patient, episode=None):
    """The planned-discharge checklist for the open episode (mockup v4 ~5911).
    When the episode's inpatient stay was discharged with a signed summary, its
    answers are used; otherwise the answers kept on the episode's care plan."""
    from django.conf import settings

    from apps.client_registry.models import Appointment
    from apps.ipd_ward.models import Admission

    from . import care_plan
    from .models import CarePlan, DischargeSummary

    episode = episode or services.open_episode_for(patient)
    if episode is None:
        return None
    signed = (
        DischargeSummary.objects.filter(episode=episode, status="COMPLETED").order_by("-version").first()
    )
    plan = CarePlan.objects.filter(episode=episode).first()
    answers = signed.readiness if signed else (plan.discharge_readiness if plan else {})
    booked = bool(
        (signed and signed.follow_up_appointment_id)
        or Appointment.objects.filter(
            patient=patient, status="SCHEDULED", scheduled_for__gte=timezone.now()
        ).exists()
        # The facility's schedule books the follow-up when the episode closes.
        or getattr(settings, "FOLLOW_UP_SCHEDULE", None)
    )
    items = services.readiness_checklist(
        patient, answers, booked, needs_safety_plan=bool(plan and care_plan.needs_safety_plan(plan))
    )
    if Admission.objects.filter(patient=patient, status="ADMITTED").exists():
        items.insert(0, {
            "key": "inpatient",
            "label": "Inpatient stay discharged through its signed discharge summary",
            "ok": False,
        })
    return {"source": "inpatient" if signed else "episode", "answers": answers or {}, "items": items}


def save_discharge_answers(patient, user, data):
    plan = services.get_or_create_care_plan(patient, user)
    answers = dict(plan.discharge_readiness or {})
    for key, allowed in READINESS_ANSWERS.items():
        if key in data:
            if data[key] not in allowed:
                raise ValidationError({key: "Choose one of the listed answers."})
            answers[key] = data[key]
    if "no_follow_up_reason" in data:
        answers["no_follow_up_reason"] = str(data["no_follow_up_reason"] or "").strip()[:400]
    plan.discharge_readiness = answers
    plan.updated_by = user
    plan.save(update_fields=["discharge_readiness", "updated_by", "updated_at"])
    return episode_discharge_checklist(patient)


@transaction.atomic
def close_episode(patient, user, outcome, destination="", reason=""):
    if outcome not in dict(EpisodeOutcome.OUTCOME_CHOICES):
        raise ValidationError({"outcome": "Choose how the episode ended."})
    episode = services.open_episode_for(patient)
    if episode is None:
        raise ValidationError({"detail": "There is no open episode to close."})
    if outcome != "PLANNED" and not reason.strip():
        raise ValidationError({"reason": "Give the reason when the episode did not end as a planned discharge."})
    if destination and destination not in services._valid_codes("episode-destination"):
        raise ValidationError({"destination": "Choose the destination from the list."})
    if outcome == "TRANSFERRED" and not destination.strip():
        raise ValidationError({"destination": "Say where the client was transferred to."})
    if outcome == "PLANNED":
        unmet = [i["label"] for i in episode_discharge_checklist(patient, episode)["items"] if not i["ok"]]
        if unmet:
            raise ValidationError({
                "checklist": unmet,
                "outcome": "Complete the discharge checklist before recording a planned discharge "
                           "— or choose another outcome.",
            })
    record = EpisodeOutcome.objects.create(
        organization_id=patient.organization_id, episode=episode, patient=patient, outcome=outcome,
        destination=destination.strip(), reason=reason.strip(), recorded_by=user,
    )
    episode.transition("finished", user)
    if outcome == "PLANNED":
        generate_follow_ups(patient, user, episode)
    return record


def start_new_episode(patient, user, presenting=""):
    if services.open_episode_for(patient):
        raise ValidationError({"detail": "An episode is already open."})
    return services.get_or_open_episode(patient, user, presenting)


# ── follow-up generation and missed appointments ──
def generate_follow_ups(patient, user, episode):
    """Create the facility's follow-up schedule when an episode closes as a planned
    discharge. The schedule is configuration (settings.FOLLOW_UP_SCHEDULE: a list of
    {"reason": <follow-up-reason code>, "after_hours": N}) — unset means none are
    generated, never a built-in default (VERIFY: facility protocol)."""
    from datetime import timedelta

    from django.conf import settings

    created = []
    for step in getattr(settings, "FOLLOW_UP_SCHEDULE", None) or []:
        created.append(
            services.book_follow_up(
                user, patient,
                {"reason": step["reason"],
                 "scheduled_for": timezone.now() + timedelta(hours=step["after_hours"]),
                 "mode": step.get("mode", "PHONE")},
                episode=episode, origin="DISCHARGE",
            )
        )
    return created


def mark_missed(appointment, user, reason):
    """Record a missed appointment with a coded reason. Whether it needs same-day
    re-contact is decided from live risk in attention.py, not stored here."""
    from .models import LocalConcept

    if not LocalConcept.objects.filter(valueset_id="missed-appointment-reason", code=reason).exists():
        raise ValidationError({"reason": "Choose why the appointment was missed."})
    if appointment.status not in ("SCHEDULED", "CONFIRMED"):
        raise ValidationError({"detail": "Only a scheduled appointment can be marked missed."})
    appointment.status, appointment.missed_reason = "NO_SHOW", reason
    appointment.save(update_fields=["status", "missed_reason", "updated_at"])
    return appointment


def action_missed(appointment, user):
    if appointment.status != "NO_SHOW":
        raise ValidationError({"detail": "This appointment was not missed."})
    appointment.dna_actioned_at = timezone.now()
    appointment.save(update_fields=["dna_actioned_at", "updated_at"])
    return appointment


# ── follow-up in the client record (same appointments as the follow-up worklist) ──
DUE_STATUSES = ("SCHEDULED", "CHECKED_IN")


def client_follow_ups(patient, now=None):
    """This client's follow-ups with Due / Overdue / Completed / Missed counts,
    the next one due, and whether a missed one needs same-day escalation."""
    from django.db.models import Q

    from apps.client_registry.models import Appointment

    from . import attention

    now = now or timezone.now()
    rows = list(
        Appointment.objects.filter(patient=patient)
        .filter(Q(origin__in=("DISCHARGE", "CARE_PLAN")) | ~Q(reason=""))
        .select_related("patient", "provider")
        .order_by("scheduled_for")
    )
    contacts = {
        n.appointment_id: n
        for n in ProgressNote.objects.filter(appointment__in=rows, status="SIGNED").select_related("author")
    }
    risky = any(a["severity"] == "high" for a in attention.active_alerts(patient))
    labels = services.concept_labels()
    items = []
    for appt in rows:
        row = services._follow_up_row(appt, labels)
        note = contacts.get(appt.id)
        row.update({
            "overdue": appt.status in DUE_STATUSES and appt.scheduled_for < now,
            "notes": appt.notes,
            "missed_reason": appt.missed_reason,
            "missed_reason_label": labels.get(("missed-appointment-reason", appt.missed_reason), appt.missed_reason),
            "dna_actioned_at": appt.dna_actioned_at.isoformat() if appt.dna_actioned_at else None,
            "escalate": appt.status == "NO_SHOW" and not appt.dna_actioned_at and risky,
            "contact_note": (
                {"text": note.text, "by": note.author.get_full_name() if note.author else "",
                 "at": note.signed_at.isoformat() if note.signed_at else None}
                if note else None
            ),
        })
        items.append(row)
    due = [r for r in items if r["status"] in DUE_STATUSES]
    return {
        "counts": {
            "due": len(due),
            "overdue": sum(1 for r in due if r["overdue"]),
            "completed": sum(1 for r in items if r["status"] == "COMPLETED"),
            "missed": sum(1 for r in items if r["status"] == "NO_SHOW"),
        },
        "next_due": due[0] if due else None,
        "active_risk": risky,
        "results": items,
    }


@transaction.atomic
def complete_follow_up(appointment, user, note):
    """Done — with the contact recorded as a signed follow-up note on the episode."""
    note = (note or "").strip()
    if len(note) < 3:
        raise ValidationError({"note": "Add a brief note of the contact."})
    if appointment.status not in DUE_STATUSES:
        raise ValidationError({"detail": "Only a follow-up that is due can be marked done."})
    ProgressNote.objects.create(
        organization_id=appointment.organization_id, patient=appointment.patient,
        episode=appointment.episode or services.open_episode_for(appointment.patient),
        note_type="FOLLOW_UP", text=note, status="SIGNED", author=user, signed_at=timezone.now(),
        appointment=appointment,
    )
    appointment.status = "COMPLETED"
    appointment.save(update_fields=["status", "updated_at"])
    return appointment


@transaction.atomic
def rebook_missed(appointment, user, data):
    """"Contacted & rebooked": the missed appointment is actioned and an outreach
    follow-up is booked on the same episode (idempotent on client_request_id)."""
    if appointment.status != "NO_SHOW" or appointment.dna_actioned_at:
        raise ValidationError({"detail": "Only a missed follow-up that is not yet actioned can be rebooked."})
    action_missed(appointment, user)
    return services.book_follow_up(
        user, appointment.patient,
        {"reason": "OUTREACH", "scheduled_for": data.get("scheduled_for"),
         "provider": str(appointment.provider_id) if appointment.provider_id else None,
         "mode": data.get("mode") or appointment.mode,
         "notes": f"Rebooked after the missed appointment of {appointment.scheduled_for:%Y-%m-%d}",
         "client_request_id": data.get("client_request_id") or ""},
        episode=appointment.episode, origin=appointment.origin,
    )
