"""
Therapy contract and sessions. Sessions live in the existing mhp_program
PsychotherapySession table (one store). Group and family sessions are written as
one row per participant, each with that participant's own note: no shared note, no
list of the other attendees on any row — a lawful disclosure about one participant
must not reveal the others' therapy (CLAUDE.md §4, unfixable after the fact).
"""

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.client_registry.models import Patient
from apps.mhp_program.models import PsychotherapySession

from . import intake, tools
from .models import LocalConcept, TherapyEpisode


def start_therapy(patient, user, data):
    modality = data.get("modality")
    if not LocalConcept.objects.filter(valueset_id="therapy-modality", code=modality).exists():
        raise ValidationError({"modality": "Choose the therapy modality."})
    phase = data.get("trauma_phase")
    if phase not in (None, "", 1, 2, 3):
        raise ValidationError({"trauma_phase": "Trauma-therapy phase is 1, 2 or 3."})
    return TherapyEpisode.objects.create(
        organization_id=patient.organization_id, patient=patient, modality=modality,
        planned_sessions=data.get("planned_sessions") or None, frequency=str(data.get("frequency", ""))[:60],
        trauma_phase=phase or None, consent_to_record=bool(data.get("consent_to_record")),
        under_supervision=bool(data.get("under_supervision")), started_by=user,
        activity_id=data.get("activity") or None,
    )


def agree_confidentiality(episode):
    episode.confidentiality_agreed_at = timezone.now()
    episode.save(update_fields=["confidentiality_agreed_at", "updated_at"])
    return episode


def _open_episode(patient, episode_id):
    ep = TherapyEpisode.objects.filter(pk=episode_id, patient=patient, ended_at__isnull=True).first()
    if ep is None:
        raise ValidationError({"episode": "Start a therapy episode for this client first."})
    if not ep.confidentiality_agreed_at:
        raise ValidationError({"detail": "Record that the limits of confidentiality were explained and agreed before writing session notes."})
    return ep


def _session(patient, user, ep, data, extra):
    return PsychotherapySession.objects.create(
        organization_id=patient.organization_id, patient=patient, session_type=data.get("session_type", "INDIVIDUAL"),
        therapist=user, modality=ep.modality, goals=str(data.get("goals", "")),
        session_notes=str(data.get("session_notes", "")),
        trauma_processing_stage=str(ep.trauma_phase or ""), progress_rating=data.get("progress_rating"),
        extra={"therapy_episode": str(ep.pk), "activity": str(ep.activity_id or ""), **extra},
    )


@transaction.atomic
def record_session(patient, user, episode_id, data):
    ep = _open_episode(patient, episode_id)
    extra = {}
    if str(data.get("process_notes", "")).strip():
        extra["process_notes"] = data["process_notes"]  # restricted: see visible_extra
    session = _session(patient, user, ep, data, extra)
    score = data.get("score")
    if score:  # measurement-based care writes to the shared outcome store
        tools.record_assessment(patient, user, score.get("instrument"), answers=score.get("answers"),
                                total=score.get("total"), context="THERAPY")
    return session


@transaction.atomic
def record_group_session(user, facilitator_note, attendees, data):
    """attendees: [{patient, episode, session_notes}] — one separate row each."""
    group_ref = str(uuid.uuid4())
    rows = []
    for a in attendees:
        patient = Patient.objects.get(pk=a["patient"])
        ep = _open_episode(patient, a.get("episode"))
        rows.append(_session(patient, user, ep, {**data, "session_notes": a.get("session_notes", "")},
                             {"group_ref": group_ref, "attendance": a.get("attendance", "PRESENT")}))
    return rows


def visible_extra(extra, user):
    """Process notes are for treating clinicians only — never in a shared view."""
    if intake.can_view_restricted(user):
        return extra
    return {k: v for k, v in (extra or {}).items() if k != "process_notes"}
