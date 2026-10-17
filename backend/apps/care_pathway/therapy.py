"""
Therapy contract and sessions. Sessions live in the existing mhp_program
PsychotherapySession table (one store). Family sessions are written as one row
per participant, each with that participant's own note: no shared note, no list of
the other attendees on any row — a lawful disclosure about one participant must not
reveal the others' therapy (CLAUDE.md §4, unfixable after the fact).

Group psychotherapy attendance is recorded only through the Group Programme
workspace (group_programme.py — one GroupSessionEntry per client), so there is
a single store for it.
"""


from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.client_registry.models import Patient
from apps.mhp_program.models import PsychotherapySession

from . import instruments, intake, tools
from .models import CarePlanActivity, LocalConcept, OutcomeScore, TherapyEpisode


def _activity(patient, activity_id):
    """A care-plan action on this client's own plan, or None when not linked."""
    if not activity_id:
        return None
    activity = CarePlanActivity.objects.filter(pk=activity_id, care_plan__patient=patient).first()
    if activity is None:
        raise ValidationError({"activity": "Link an action from this client's care plan."})
    return activity


def link_options(patient):
    """Care-plan actions a session can be linked to (declined ones excluded)."""
    rows = CarePlanActivity.objects.filter(care_plan__patient=patient).exclude(decision="DECLINED").order_by("created_at")
    return [{"id": str(a.pk), "title": a.title, "goal": a.goal} for a in rows]


def _by(user):
    return (user.get_full_name() or str(user)) if user else ""


def _session_row(session, number, show_process):
    extra = session.extra or {}
    row = {
        "id": str(session.pk), "n": number, "at": session.session_date, "by": _by(session.therapist),
        "notes": session.session_notes, "homework": extra.get("homework", ""),
        "activity": extra.get("activity", ""), "measure": extra.get("measure"),
        "has_process_notes": bool(extra.get("process_notes")),
        # The structured psychotherapy note (psychotherapy.py), when written through it.
        "note_id": str(session.psy_note.pk) if hasattr(session, "psy_note") else None,
    }
    if show_process:
        row["process_notes"] = extra.get("process_notes", "")
    return row


def overview(patient, user):
    """Therapy episodes with their numbered sessions. Process notes are only
    sent to roles that may see restricted content (intake.can_view_restricted)."""
    show_process = intake.can_view_restricted(user)
    episodes = []
    for e in TherapyEpisode.objects.filter(patient=patient).select_related("activity"):
        sessions = PsychotherapySession.objects.filter(
            patient=patient, extra__therapy_episode=str(e.pk)
        ).exclude(psy_note__status="DRAFT").select_related("therapist").order_by("session_date")
        episodes.append({
            "id": str(e.pk), "modality": e.modality, "planned_sessions": e.planned_sessions,
            "frequency": e.frequency, "trauma_phase": e.trauma_phase,
            "confidentiality_agreed": bool(e.confidentiality_agreed_at),
            "consent_to_record": e.consent_to_record, "under_supervision": e.under_supervision,
            "activity": str(e.activity_id or ""), "activity_title": e.activity.title if e.activity else "",
            "ended": bool(e.ended_at),
            "sessions": [_session_row(s, n, show_process) for n, s in enumerate(sessions, start=1)],
        })
    return {"results": episodes, "link_options": link_options(patient), "can_view_process_notes": show_process}


def start_therapy(patient, user, data):
    modality = data.get("modality")
    if not LocalConcept.objects.filter(valueset_id="therapy-modality", code=modality).exists():
        raise ValidationError({"modality": "Choose the therapy modality."})
    phase = data.get("trauma_phase")
    if phase not in (None, "", 1, 2, 3):
        raise ValidationError({"trauma_phase": "Trauma-therapy phase is 1, 2 or 3."})
    activity = _activity(patient, data.get("activity"))
    return TherapyEpisode.objects.create(
        organization_id=patient.organization_id, patient=patient, modality=modality,
        planned_sessions=data.get("planned_sessions") or None, frequency=str(data.get("frequency", ""))[:60],
        trauma_phase=phase or None, consent_to_record=bool(data.get("consent_to_record")),
        under_supervision=bool(data.get("under_supervision")), started_by=user,
        activity=activity,
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
    activity = _activity(patient, data.get("activity")) if data.get("activity") else ep.activity
    return PsychotherapySession.objects.create(
        organization_id=patient.organization_id, patient=patient, session_type=data.get("session_type", "INDIVIDUAL"),
        therapist=user, modality=ep.modality, goals=str(data.get("goals", "")),
        session_notes=str(data.get("session_notes", "")),
        trauma_processing_stage=str(ep.trauma_phase or ""), progress_rating=data.get("progress_rating"),
        extra={"therapy_episode": str(ep.pk), "activity": str(activity.pk if activity else ""), **extra},
    )


def _measure(score):
    return {"score_id": str(score.pk), "instrument": score.instrument,
            "name": instruments.INSTRUMENTS[score.instrument]["name"], "total": score.score}


@transaction.atomic
def record_session(patient, user, episode_id, data):
    ep = _open_episode(patient, episode_id)
    if not str(data.get("session_notes", "")).strip():
        raise ValidationError({"session_notes": "Write the session note."})
    extra = {}
    if str(data.get("process_notes", "")).strip():
        if not intake.can_view_restricted(user):
            raise PermissionDenied("Process notes are restricted to treating clinicians.")
        extra["process_notes"] = data["process_notes"]  # restricted: see visible_extra
    if str(data.get("homework", "")).strip():
        extra["homework"] = str(data["homework"]).strip()
    # Measurement-based care lives in the shared outcome store: either a score
    # already recorded through the instruments form, or one recorded here.
    score = None
    if data.get("score_id"):
        score = OutcomeScore.objects.filter(pk=data["score_id"], patient=patient).first()
        if score is None:
            raise ValidationError({"score_id": "That score is not on this client's record."})
    elif data.get("score"):
        given = data["score"]
        score = tools.record_assessment(patient, user, given.get("instrument"), answers=given.get("answers"),
                                        total=given.get("total"), context="THERAPY")
    if score:
        extra["measure"] = _measure(score)
    return _session(patient, user, ep, data, extra)


def visible_extra(extra, user):
    """Process notes are for treating clinicians only — never in a shared view."""
    if intake.can_view_restricted(user):
        return extra
    return {k: v for k, v in (extra or {}).items() if k != "process_notes"}
