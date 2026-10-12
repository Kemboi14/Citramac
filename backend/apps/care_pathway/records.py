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
MSE_SIGNALS = {"Suicidal": ("suicide", "Thoughts"), "Homicidal": ("violence", "Thoughts")}


def _propose(patient, source, source_key, row, option):
    proposal, _ = RiskProposal.objects.get_or_create(
        patient=patient,
        source_key=source_key,
        defaults={"organization_id": patient.organization_id, "source": source, "row": row, "option": option},
    )
    return proposal


def propose_from_score(patient, score):
    spec = instruments.INSTRUMENTS[score.instrument]
    index = spec.get("safety_item")
    if index is not None and score.items and score.items[index] > 0:
        return _propose(patient, f"{spec['name']} self-harm item", f"score:{score.pk}", "suicide", "Thoughts")
    return None


def propose_from_mse(patient, mse):
    for label, (row, option) in MSE_SIGNALS.items():
        if label in (mse.thought_content or ""):
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
@transaction.atomic
def close_episode(patient, user, outcome, destination="", reason=""):
    if outcome not in dict(EpisodeOutcome.OUTCOME_CHOICES):
        raise ValidationError({"outcome": "Choose how the episode ended."})
    episode = services.open_episode_for(patient)
    if episode is None:
        raise ValidationError({"detail": "There is no open episode to close."})
    if outcome != "PLANNED" and not reason.strip():
        raise ValidationError({"reason": "Give the reason when the episode did not end as a planned discharge."})
    if outcome == "TRANSFERRED" and not destination.strip():
        raise ValidationError({"destination": "Say where the client was transferred to."})
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
