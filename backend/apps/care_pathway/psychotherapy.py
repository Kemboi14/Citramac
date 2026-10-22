"""
Psychotherapy Session note — master prompt §7 (PSY-WF, PSY-Q, PSY-S, PSY-RD,
PSY-TM, PSY-GEN, PSY-OUT, PSY-LINK, PSY-SIGN), X-09 (server-side
save-and-resume), X-13 (deterministic organizer, psy_organizer.py).

One store: the session is the existing mhp_program.PsychotherapySession row
(created when the draft starts and hidden from session lists until signed),
hanging off a PSYCHOTHERAPY Encounter in the client's EpisodeOfCare; the note
is its one PsychotherapyNote. Risk findings go to the shared objects that
already exist — ClinicalAlert (banner) and RiskProposal (risk register, which
the clinician adds/defers/dismisses) — never to a private copy.

AI assistance (psy_ai.py) is optional and off by default. When on, Kiswahili /
Sheng answers get an English translation and the organised sections are
reworded in trauma-informed language — both in background tasks, stored beside
the clinician's own words with their provenance. When off or failing, the
rule-based organiser's text stands and the failure is logged and shown.
"""

import hashlib
import logging
import uuid
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.clinical_encounter.models import Encounter
from apps.mhp_program.models import PsychotherapySession
from apps.mhp_program.permissions import has_full_mhp_access
from apps.sysadmin_audit.audit import log_view, write_event
from apps.tenancy.context import platform_admin_context

from . import facility_time, intake_schema, psy_ai, psy_seed, records, services, therapy
from . import psy_organizer as org
from .models import (
    CarePlan,
    CarePlanActivity,
    ClinicalAlert,
    ClinicalLexiconTerm,
    LocalConcept,
    OutcomeScore,
    PsychotherapyNote,
    PsychotherapyNoteAmendment,
    RiskProposal,
    SafetyPlan,
    TherapyEpisode,
    TherapyModel,
)

logger = logging.getLogger(__name__)

OTHER_CONCERN_VALUESET = "psy-safety-concern-other"
CONCERN_VALUESET = "psy-safety-concern"
ACTION_VALUESET = "psy-safety-action"
ATTENDANCE_VALUESET = "psy-attendance-mode"
ALERT_LABELS = dict(psy_seed.ALERTS)
# Group attendance: group_programme.py only. Couple and family sessions are one
# note per client — each person's record stands alone (CLAUDE.md §4).
SESSION_TYPES = ("INDIVIDUAL", "COUPLE", "FAMILY")
PROPOSAL_SOURCE = "Psychotherapy session safety question"
DEFAULT_LANGUAGE = "en-GB"
SEED_MODEL_CODES = frozenset(code for code, *_ in psy_seed.THERAPY_MODELS)
SAFETY_PLAN_ACTION = "safety_plan_reviewed"
# A background AI step not finished after this long is treated as failed (the
# worker or broker is down): the rule-based text stands and signing is not held.
AI_STALE_AFTER = timedelta(minutes=10)

SYSTEM_ACTOR = "System (AI assistance)"
PROCESSED_AI = "Processed with Claude · trauma-informed language"
PROCESSED_RULES = "Organised from your words (rule-based)"
NOT_TRANSLATED = "Not translated — the note uses the original words"
NA_ACK_TEXT = "I have reviewed that safety was not assessed and will follow up at the next contact."
ATTESTATION_TEXT = "I have reviewed this note and confirm it accurately reflects the session."
DETECTION_NOTE = "This is a language screen only. It does not decide risk level."


def _by(user):
    return services.user_display(user)


def _now_iso():
    return timezone.now().isoformat()


def _audit(note, user, action, **detail):
    by = _by(user) if user else SYSTEM_ACTOR
    note.history = [*(note.history or []), {"at": _now_iso(), "by": by, "action": action, **detail}]


def _hhmm(value):
    return facility_time.local_format(value, "%H:%M")


# ── registry and lexicons (served data) ──


def can_configure(user):
    return user.is_superuser or user.roles.filter(name__iexact="Org Admin").exists()


def therapy_models(organization_id, enabled_only=True):
    """The organisation's therapy-model registry; the eight seed models are
    created on first use (PSY-TM-03). Disabled models stay on file."""
    if organization_id and not TherapyModel.objects.exists():
        TherapyModel.objects.bulk_create(
            [TherapyModel(organization_id=organization_id, code=code, name=name, aliases=aliases,
                          concepts=concepts, order=i)
             for i, (code, name, aliases, concepts) in enumerate(psy_seed.THERAPY_MODELS)],
            ignore_conflicts=True,
        )
    rows = TherapyModel.objects.all()
    return rows.filter(enabled=True) if enabled_only else rows


def model_row(m):
    return {"code": m.code, "name": m.name, "aliases": list(m.aliases or []), "concepts": list(m.concepts or []),
            "version": m.version, "enabled": m.enabled,
            # Added by the organisation (not one of the seed models): may be removed (disabled).
            "custom": m.code not in SEED_MODEL_CODES}


def _clean_list(value, field):
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValidationError({field: "Give a list of words or phrases."})
    return [v.strip()[:120] for v in value if v.strip()]


def add_model(user, data):
    if not can_configure(user):
        raise PermissionDenied("Only an administrator can add a therapy model.")
    therapy_models(user.organization_id)
    name = str(data.get("name") or "").strip()[:120]
    if not name:
        raise ValidationError({"name": "Enter the model's name."})
    from django.utils.text import slugify

    code = slugify(data.get("code") or name).replace("-", "_")[:60] or "model"
    if TherapyModel.objects.filter(code=code).exists() or TherapyModel.objects.filter(name__iexact=name).exists():
        raise ValidationError({"name": "This therapy model is already in the registry."})
    concepts = _clean_list(data.get("concepts") or [], "concepts")
    if not concepts:
        raise ValidationError({"concepts": "List the model's concepts."})
    last = TherapyModel.objects.order_by("-order").first()
    return TherapyModel.objects.create(
        organization_id=user.organization_id, code=code, name=name, concepts=concepts,
        aliases=_clean_list(data.get("aliases") or [], "aliases"), version=str(data.get("version") or "1")[:16],
        enabled=bool(data.get("enabled", True)), order=(last.order + 1) if last else 0,
    )


def update_model(user, model, data):
    """Enable/disable, or revise the concepts/aliases (a revision bumps the version
    so a signed note keeps saying which version it applied)."""
    if not can_configure(user):
        raise PermissionDenied("Only an administrator can change a therapy model.")
    changed = []
    if "enabled" in data:
        model.enabled = bool(data["enabled"])
        changed.append("enabled")
    for field in ("concepts", "aliases"):
        if field in data:
            setattr(model, field, _clean_list(data[field], field))
            changed.append(field)
    if "name" in data and str(data["name"]).strip():
        model.name = str(data["name"]).strip()[:120]
        changed.append("name")
    if set(changed) - {"enabled"}:
        model.version = str(data.get("version") or _next_version(model.version))[:16]
        changed.append("version")
    if changed:
        model.save(update_fields=[*changed, "updated_at"])
    return model


def _next_version(version):
    return str(int(version) + 1) if str(version).isdigit() else f"{version}.1"


def lexicon(name):
    return [{"id": t.pk, "category": t.category, "phrase": t.phrase, "suggestion": t.suggestion}
            for t in ClinicalLexiconTerm.objects.filter(lexicon=name, active=True)]


def _concepts(valueset_id):
    return [{"code": c.code, "label": c.display}
            for c in LocalConcept.objects.filter(valueset_id=valueset_id, active=True)]


def concern_options():
    """YES-answer concerns: the eight served categories, each with the
    risk-register row it maps to (and that row's live options, which the
    clinician may tick to queue for the register — RULE-01). `register` and
    `other` are the earlier shape, still read on notes written with it."""
    rows = {r["key"]: r for r in intake_schema.RISK_ROWS}
    categories = []
    for c in _concepts(CONCERN_VALUESET):
        row = rows.get(psy_seed.CONCERN_REGISTER_ROW.get(c["code"], ""))
        categories.append({**c, "register_row": row["key"] if row else None,
                           "register_label": row["label"] if row else "",
                           "options": list(row["active"]) if row else []})
    return {
        "categories": categories,
        "register": [{"row": r["key"], "label": r["label"], "options": list(r["active"])} for r in rows.values()],
        "other": _concepts(OTHER_CONCERN_VALUESET),
    }


def config(user):
    return {
        "questions": org.QUESTIONS,
        "safety_question": org.SAFETY_QUESTION,
        "safety_options": [{"code": c, "label": label} for c, label in org.SAFETY_OPTIONS],
        "detection_prompt": org.DETECTION_PROMPT,
        "detection_note": DETECTION_NOTE,
        "watermark": org.WATERMARK,
        "sections": [{"key": k, "title": t} for k, t in org.SECTIONS],
        "therapy_models": [model_row(m) for m in therapy_models(user.organization_id)],
        "concerns": concern_options(),
        "safety_actions": _concepts(ACTION_VALUESET),
        "attendance_modes": _concepts(ATTENDANCE_VALUESET),
        "session_types": [{"code": c, "label": dict(PsychotherapySession.SESSION_TYPE_CHOICES)[c]}
                          for c in SESSION_TYPES],
        "languages": [{"code": c, "label": label, "translated": c in org.TRANSLATED_LANGUAGES}
                      for c, label in org.LANGUAGES],
        "goal_decisions": [{"code": c, "label": label or "not relevant"} for c, label in org.GOAL_DECISIONS.items()],
        "not_assessed_ack_text": NA_ACK_TEXT,
        "attestation_text": ATTESTATION_TEXT,
        # X-12: browser dictation is off unless the organisation has approved it —
        # most browsers send the audio to the vendor's speech service.
        # Two keys per organisation (Super Admin allows, Org Admin turns on); AI
        # also needs each client's consent, reported on the note.
        "dictation_enabled": dictation_enabled(user.organization),
        "ai_enabled": psy_ai.org_enabled(user.organization),
        "processed_labels": {"ai": PROCESSED_AI, "rules": PROCESSED_RULES, "not_translated": NOT_TRANSLATED},
        "can_configure": can_configure(user),
    }


# ── access ──


def can_read(user, note):
    """Full note content: its author, or someone with full MHP access to the
    client (care-team member, Org Admin) — docs/07 §7.14.7."""
    return note.author_id == user.pk or has_full_mhp_access(user, note.patient)


def _require_author(user, note):
    if note.author_id != user.pk:
        raise PermissionDenied("Only the clinician who wrote this session note can change or sign it.")


def _require_draft(note):
    if note.status != "DRAFT":
        raise ValidationError({"detail": "A signed note cannot be edited — add an amendment."})


# ── draft lifecycle (X-09 save-and-resume, server-side only) ──


@transaction.atomic
def start_or_resume(patient, user, data):
    """The clinician's open draft for this therapy episode, or a new one. One
    draft per clinician per episode, so a retried request resumes it rather
    than creating a second session (idempotent)."""
    ep = therapy._open_episode(patient, data.get("episode"))
    existing = PsychotherapyNote.objects.filter(
        patient=patient, author=user, therapy_episode=ep, status="DRAFT"
    ).first()
    if existing:
        return existing, False
    session_type = data.get("session_type") or "INDIVIDUAL"
    if session_type not in SESSION_TYPES:
        raise ValidationError({"session_type": "Individual, couple or family — group sessions are recorded in the group programme."})
    activity = therapy._activity(patient, data.get("activity")) if data.get("activity") else ep.activity
    episode = services.get_or_open_episode(patient, user)
    encounter = Encounter.objects.create(
        organization_id=patient.organization_id, patient=patient, episode=episode, opened_by=user,
        encounter_type="PSYCHOTHERAPY", status="IN_PROGRESS",
    )
    session = PsychotherapySession.objects.create(
        organization_id=patient.organization_id, patient=patient, session_type=session_type, therapist=user,
        modality=ep.modality, trauma_processing_stage=str(ep.trauma_phase or ""),
        extra={"therapy_episode": str(ep.pk), "activity": str(activity.pk if activity else "")},
    )
    note = PsychotherapyNote(
        organization_id=patient.organization_id, patient=patient, therapy_episode=ep, episode=episode,
        encounter=encounter, session=session, author=user,
        answers={k: {"text": "", "mode": "TYPED", "language": DEFAULT_LANGUAGE, "answered_at": None}
                 for k in org.QUESTION_KEYS},
    )
    _audit(note, user, "CREATE")
    note.save()
    return note, True


def _digest(language, text):
    return hashlib.sha1(f"{language}|{text}".encode()).hexdigest()[:16]


def _set_answers(note, user, answers, to_translate):
    """Each answer keeps the clinician's own text with its input mode, time and
    language. A Kiswahili / Sheng answer gets a translation slot: queued when AI
    assistance is on, otherwise marked unavailable (the note uses the original)."""
    if not isinstance(answers, dict):
        raise ValidationError({"answers": "Answers must be keyed by question."})
    current = dict(note.answers or {})
    languages = dict(org.LANGUAGES)
    ai_on = psy_ai.enabled_for(note.patient)
    for key, value in answers.items():
        if key not in org.QUESTION_KEYS or not isinstance(value, dict):
            raise ValidationError({"answers": f"Unknown question {key!r}."})
        prev = current.get(key) or {}
        mode = org.LEGACY_MODES.get(value.get("mode"), value.get("mode")) or org.LEGACY_MODES.get(
            prev.get("mode"), prev.get("mode")) or "TYPED"
        if mode not in org.INPUT_MODES:
            raise ValidationError({"answers": "Input mode is TYPED or DICTATED."})
        language = value.get("language") or prev.get("language") or DEFAULT_LANGUAGE
        if language not in languages:
            raise ValidationError({"answers": "Choose a language from the list."})
        text = str(value.get("text", prev.get("text", "")))[:20000]
        entry = {"text": text, "mode": mode, "language": language, "answered_at": prev.get("answered_at")}
        content_changed = text != prev.get("text", "") or language != (prev.get("language") or DEFAULT_LANGUAGE)
        if content_changed:
            entry["answered_at"] = _now_iso() if text.strip() else None
            _audit(note, user, "ANSWER", question=key, mode=mode, language=language)
        if language in org.TRANSLATED_LANGUAGES and text.strip():
            digest = _digest(language, text)
            previous = prev.get("translation") or {}
            if previous.get("digest") == digest:
                entry["translation"] = previous
            else:
                entry["translation"] = {
                    "digest": digest, "status": "pending" if ai_on else "unavailable", "text": "",
                    "model": psy_ai.model_name() if ai_on else "", "requested_at": _now_iso(), "at": None,
                }
                if ai_on:
                    to_translate.append((key, digest))
        current[key] = entry
    changed = current != (note.answers or {})
    note.answers = current
    return changed


def _clean_safety_detail(note, detail):
    detail = detail if isinstance(detail, dict) else {}
    options = concern_options()
    categories = {c["code"]: c for c in options["categories"]}
    register = {r["row"]: set(r["options"]) for r in options["register"]}
    other = {c["code"] for c in options["other"]}
    concerns = []
    for c in detail.get("concerns") or []:
        if not isinstance(c, dict):
            raise ValidationError({"safety_detail": "Choose concerns from the list."})
        if "category" in c:
            cat = categories.get(c["category"])
            chosen = c.get("options") or []
            if cat is None or not isinstance(chosen, list) or any(o not in cat["options"] for o in chosen):
                raise ValidationError({"safety_detail": "Choose concerns from the list."})
            concerns.append({"category": cat["code"], "options": list(dict.fromkeys(chosen))})
        elif "other" in c:  # earlier shape
            if c["other"] not in other:
                raise ValidationError({"safety_detail": "Choose concerns from the list."})
            concerns.append({"other": c["other"]})
        elif c.get("option") in register.get(c.get("row"), ()):  # earlier shape
            concerns.append({"row": c["row"], "option": c["option"]})
        else:
            raise ValidationError({"safety_detail": "Choose concerns from the list."})
    codes = detail.get("action_codes") or []
    allowed = {a["code"] for a in safety_action_options(note.patient)}
    if not isinstance(codes, list) or any(code not in allowed for code in codes):
        raise ValidationError({"safety_detail": "Choose the actions taken from the list."})
    cleaned = {"concerns": concerns, "description": str(detail.get("description", "")).strip()[:4000],
               "action_codes": list(dict.fromkeys(codes)),
               "actions": str(detail.get("actions", "")).strip()[:4000]}
    if (note.safety_detail or {}).get("risk_link"):
        cleaned["risk_link"] = note.safety_detail["risk_link"]
    return cleaned


def _set_session_info(note, user, data):
    session = note.session
    fields = []
    if "session_date" in data and data["session_date"]:
        from django.utils.dateparse import parse_datetime

        when = parse_datetime(str(data["session_date"]))
        if when is None:
            raise ValidationError({"session_date": "Give the session date and time."})
        when = facility_time.make_local_aware(when)
        if when > timezone.now() + timedelta(hours=12):
            raise ValidationError({"session_date": "The session date cannot be in the future."})
        session.session_date = when
        fields.append("session_date")
    if "duration_minutes" in data:
        value = data["duration_minutes"]
        if value not in (None, ""):
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise ValidationError({"duration_minutes": "Duration is a number of minutes."}) from None
            if not 1 <= value <= 600:
                raise ValidationError({"duration_minutes": "Duration is between 1 and 600 minutes."})
        session.duration_minutes = value or None
        fields.append("duration_minutes")
    if "session_type" in data and data["session_type"] != session.session_type:
        if data["session_type"] not in SESSION_TYPES:
            raise ValidationError({"session_type": "Individual, couple or family — group sessions are recorded in the group programme."})
        session.session_type = data["session_type"]
        fields.append("session_type")
    extra = dict(session.extra or {})
    if "attendance_mode" in data:
        mode = data["attendance_mode"] or ""
        if mode and not LocalConcept.objects.filter(valueset_id=ATTENDANCE_VALUESET, code=mode).exists():
            raise ValidationError({"attendance_mode": "Choose in person, virtual or telephone."})
        extra["attendance_mode"] = mode
    if "location" in data:
        extra["location"] = str(data["location"] or "").strip()[:150]
    if "activity" in data:
        activity = therapy._activity(note.patient, data["activity"]) if data["activity"] else None
        extra["activity"] = str(activity.pk) if activity else ""
    if "process_notes" in data:
        from . import intake

        text = str(data["process_notes"] or "").strip()
        if text and not intake.can_view_restricted(user):
            raise PermissionDenied("Process notes are restricted to treating clinicians.")
        extra["process_notes"] = text  # restricted: therapy.visible_extra
    if "score_id" in data:
        if data["score_id"]:
            score = OutcomeScore.objects.filter(pk=data["score_id"], patient=note.patient).first()
            if score is None:
                raise ValidationError({"score_id": "That score is not on this client's record."})
            extra["measure"] = therapy._measure(score)
        else:
            extra.pop("measure", None)
    if extra != (session.extra or {}):
        session.extra = extra
        fields.append("extra")
    if fields:
        session.save(update_fields=[*fields, "updated_at"])
        _audit(note, user, "SESSION_INFO", fields=sorted(set(fields) - {"extra"}) or ["details"])
    return bool(fields)


def _raise_alert(note, user, code):
    return ClinicalAlert.objects.create(
        organization_id=note.organization_id, patient=note.patient, alert_code=code,
        label=ALERT_LABELS[code], raised_by=user,
    )


def _resolve_alert(alert, user):
    if alert and alert.status == "ACTIVE":
        alert.status, alert.resolved_at, alert.resolved_by = "RESOLVED", timezone.now(), user
        alert.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])


def _proposal_key(note, concern):
    digest = hashlib.sha1(f"{concern['row']}|{concern['option']}".encode()).hexdigest()[:10]
    return f"psy:{note.pk.hex}:{digest}"


def _register_findings(detail):
    """(row, option) pairs to queue for the risk register from the concerns."""
    out = []
    for c in detail.get("concerns") or []:
        if "row" in c:
            out.append((c["row"], c["option"]))
        elif "category" in c:
            row = psy_seed.CONCERN_REGISTER_ROW.get(c["category"])
            out.extend((row, option) for option in c.get("options") or [] if row)
    return out


def _apply_safety(note, user):
    """PSY-S side effects on the shared objects, applied when the draft is saved.

    YES → PSYCHOTHERAPY_SAFETY_CONCERN on the banner and each register finding
    the clinician ticked queued as a RiskProposal (PSY-S-01; the clinician adds
    it to the register — never a silent write). A YES alert is never
    auto-resolved by changing the answer: a risk alert is resolved by a
    clinician through the alert workflow. NOT ASSESSED → SAFETY_NOT_ASSESSED
    until acknowledged with a reason (PSY-S-03, OQ-06 default: block). Any other
    answer clears that review flag."""
    answer = note.safety_answer
    if answer == org.SAFETY_YES:
        if note.safety_alert is None:
            note.safety_alert = _raise_alert(note, user, "PSYCHOTHERAPY_SAFETY_CONCERN")
            _audit(note, user, "RAISE_ALERT", code="PSYCHOTHERAPY_SAFETY_CONCERN")
        for row, option in _register_findings(note.safety_detail or {}):
            records._propose(note.patient, PROPOSAL_SOURCE, _proposal_key(note, {"row": row, "option": option}),
                             row, option)
    if answer == org.SAFETY_NOT_ASSESSED and not note.safety_ack_at:
        if note.not_assessed_alert is None or note.not_assessed_alert.status != "ACTIVE":
            note.not_assessed_alert = _raise_alert(note, user, "SAFETY_NOT_ASSESSED")
            _audit(note, user, "RAISE_ALERT", code="SAFETY_NOT_ASSESSED")
    elif note.not_assessed_alert and note.not_assessed_alert.status == "ACTIVE":
        _resolve_alert(note.not_assessed_alert, user)
        _audit(note, user, "RESOLVE_ALERT", code="SAFETY_NOT_ASSESSED",
               reason="Acknowledged" if note.safety_ack_at else "Safety answer changed")


def _link_risk(note, user):
    """YES: link the risk record the YES path created — the safety-concern alert
    on the client record (FHIR Flag) and the register findings queued from it —
    so the note names it ("Linked risk assessment: <id> (opened HH:MM)")."""
    detail = note.safety_detail or {}
    if note.safety_answer != org.SAFETY_YES:
        raise ValidationError({"link_risk_assessment": "Only a Yes safety answer links a risk assessment."})
    if not detail.get("concerns") or not detail.get("description"):
        raise ValidationError({"link_risk_assessment": "Choose the concern(s) and describe them first."})
    alert = note.safety_alert
    proposals = RiskProposal.objects.filter(patient=note.patient, source_key__startswith=f"psy:{note.pk.hex}:")
    link = {"alert_id": str(alert.pk), "display_id": alert.pk.hex[:8].upper(),
            "opened_at": alert.raised_at.isoformat(), "opened": _hhmm(alert.raised_at),
            "proposal_ids": [str(p.pk) for p in proposals], "by": _by(user), "at": _now_iso()}
    note.safety_detail = {**detail, "risk_link": link}
    _audit(note, user, "RISK_LINK", risk_record=link["display_id"])


def _acknowledge(note, user, payload):
    payload = payload if isinstance(payload, dict) else {}
    reason = str(payload.get("reason") or note.safety_ack_reason or "").strip()
    if note.safety_answer != org.SAFETY_NOT_ASSESSED:
        raise ValidationError({"acknowledge": "Only a 'not assessed' safety answer is acknowledged."})
    if len(reason) < 3:
        raise ValidationError({"acknowledge": "Give the reason safety was not assessed."})
    if payload.get("acknowledged") is not True:
        raise ValidationError({"acknowledge": f"Tick: {NA_ACK_TEXT}"})
    note.safety_ack_reason, note.safety_ack_at, note.safety_ack_by = reason[:2000], timezone.now(), user
    _audit(note, user, "ACKNOWLEDGE", reason=reason[:2000], statement=NA_ACK_TEXT)


def _set_not_assessed_reason(note, user, reason):
    if note.safety_answer != org.SAFETY_NOT_ASSESSED:
        raise ValidationError({"not_assessed_reason": "Only a 'not assessed' safety answer takes a reason."})
    reason = str(reason or "").strip()[:2000]
    if reason != note.safety_ack_reason:
        note.safety_ack_reason, note.safety_ack_at, note.safety_ack_by = reason, None, None
        _audit(note, user, "UPDATE", field="not_assessed_reason", new=reason)


def _resolve_detection(note, user, data):
    """PSY-RD: the clinician marks a flagged passage reviewed (one click) — with
    what the review found, when they give it. Recorded with reviewer and time."""
    key, reason = str(data.get("key") or ""), str(data.get("reason") or "").strip()
    if key not in {d["key"] for d in detections(note)}:
        raise ValidationError({"resolve_detection": "That prompt is no longer in the answers."})
    note.detection_resolutions = {**(note.detection_resolutions or {}),
                                  key: {"reason": reason[:2000], "by": _by(user), "at": _now_iso()}}
    _audit(note, user, "REVIEW_DETECTION", key=key, reason=reason[:2000])


def _goal_link(note, user, data):
    goals = {g["index"]: g for g in context_goals(note.patient)}
    try:
        index = int(data.get("goal_index"))
    except (TypeError, ValueError):
        raise ValidationError({"goal_link": "Choose a goal from the care plan."}) from None
    if index not in goals:
        raise ValidationError({"goal_link": "Choose a goal from the care plan."})
    decision = data.get("decision")
    if decision not in (*org.GOAL_DECISIONS, *org.LEGACY_GOAL_DECISIONS):
        raise ValidationError({"goal_link": "Choose progress, no clear change, barrier or not relevant."})
    statement = str(data.get("statement") or "").strip()[:2000]
    if decision == "CONFIRMED" and not statement:
        raise ValidationError({"goal_link": "Write the progress statement you are confirming."})
    suggested = {s["goal_index"]: s["evidence"]
                 for s in org.goal_suggestions(list(goals.values()), note.answers or {})}
    evidence = suggested.get(index) or str(data.get("evidence") or "").strip()[:2000]
    links = [link for link in (note.goal_links or []) if link["goal_index"] != index]
    links.append({"goal_index": index, "goal": goals[index]["goal"], "evidence": evidence, "statement": statement,
                  "status": decision, "by": _by(user), "at": _now_iso()})
    note.goal_links = links
    _audit(note, user, f"GOAL_LINK_{decision}", goal=goals[index]["goal"], statement=statement)


def _model_decision(note, user, data):
    code, decision = str((data or {}).get("code") or ""), (data or {}).get("decision")
    if decision not in ("INCLUDE", "EXCLUDE"):
        raise ValidationError({"model_decision": "Include or exclude the approach."})
    if code not in {m["code"] for m in detected_models(note)}:
        raise ValidationError({"model_decision": "That approach is not detected in this session."})
    if (note.model_decisions or {}).get(code) == decision:
        return False
    note.model_decisions = {**(note.model_decisions or {}), code: decision}
    _audit(note, user, f"MODEL_{decision}", model=code)
    return True


def _compose_sections(note):
    """The sections as they stand: generated text, with each clinician edit in place."""
    edits = note.section_edits or {}
    base = note.generated_sections or {}
    note.sections = {k: (edits[k]["text"] if k in edits else base.get(k, "")) for k in org.SECTION_KEYS}
    note.sections_edited = bool(edits)


def _edit_sections(note, user, sections):
    if not isinstance(sections, dict) or any(k not in org.SECTION_KEYS for k in sections):
        raise ValidationError({"sections": "Unknown note section."})
    if not note.generated_at:
        raise ValidationError({"sections": "Organise the note before editing its sections."})
    if not note.generated_sections and note.sections:  # a draft organised before edits were kept apart
        note.generated_sections = dict(note.sections)
    edits = dict(note.section_edits or {})
    changed = []
    for key, value in sections.items():
        value = str(value)[:20000]
        if value == (note.generated_sections or {}).get(key, ""):
            if edits.pop(key, None) is not None:
                changed.append(key)
        elif (edits.get(key) or {}).get("text") != value:
            edits[key] = {"text": value, "by": _by(user), "at": _now_iso()}
            changed.append(key)
    if changed:
        _audit(note, user, "EDIT_SECTIONS", sections=sorted(changed))
        note.section_edits = edits
        _compose_sections(note)
        note.accuracy_confirmed = False


def _revert_section(note, user, key):
    if key not in org.SECTION_KEYS:
        raise ValidationError({"revert_section": "Unknown note section."})
    edits = dict(note.section_edits or {})
    if edits.pop(key, None) is None:
        raise ValidationError({"revert_section": "This section has no edit to revert."})
    note.section_edits = edits
    _compose_sections(note)
    note.accuracy_confirmed = False
    _audit(note, user, "REVERT_SECTION", section=key)


@transaction.atomic
def save_draft(note, user, data):
    note = PsychotherapyNote.objects.select_for_update().get(pk=note.pk)
    _require_author(user, note)
    _require_draft(note)
    inputs_changed = False
    to_translate = []
    if "answers" in data:
        inputs_changed |= _set_answers(note, user, data["answers"], to_translate)
    if "selected_models" in data:
        codes = data["selected_models"] or []
        enabled = {m.code for m in therapy_models(note.organization_id)}
        if not isinstance(codes, list) or any(c not in enabled for c in codes):
            raise ValidationError({"selected_models": "Choose models from the registry."})
        inputs_changed |= codes != note.selected_models
        note.selected_models = codes
    if data.get("model_decision"):
        inputs_changed |= _model_decision(note, user, data["model_decision"])
    if "safety_answer" in data:
        answer = data["safety_answer"] or ""
        if answer not in ("", *dict(org.SAFETY_OPTIONS)):
            raise ValidationError({"safety_answer": "Answer Yes, No or Not assessed."})
        if answer != note.safety_answer:
            _audit(note, user, "UPDATE", field="safety_answer", previous=note.safety_answer, new=answer)
            note.safety_answer = answer
            note.safety_ack_reason, note.safety_ack_at, note.safety_ack_by = "", None, None
            inputs_changed = True
    if "safety_detail" in data:
        detail = _clean_safety_detail(note, data["safety_detail"])
        if detail != note.safety_detail:
            _audit(note, user, "UPDATE", field="safety_detail", previous=note.safety_detail, new=detail)
            note.safety_detail = detail
            inputs_changed = True
    if "not_assessed_reason" in data:
        _set_not_assessed_reason(note, user, data["not_assessed_reason"])
        inputs_changed = True
    if data.get("acknowledge_not_assessed") is not None:
        _acknowledge(note, user, data["acknowledge_not_assessed"])
        inputs_changed = True
    if data.get("resolve_detection"):
        _resolve_detection(note, user, data["resolve_detection"])
        inputs_changed = True
    if data.get("goal_link"):
        _goal_link(note, user, data["goal_link"])
        inputs_changed = True
    inputs_changed |= _set_session_info(note, user, data)
    if "sections" in data:
        _edit_sections(note, user, data["sections"])
    if data.get("revert_section"):
        _revert_section(note, user, data["revert_section"])
    _apply_safety(note, user)
    if data.get("link_risk_assessment"):
        _link_risk(note, user)
        inputs_changed = True
    if inputs_changed:
        # The organised sections no longer reflect the answers: organise again
        # before signing (the previous text stays visible until then).
        note.generated_at = None
        note.accuracy_confirmed = False
    if "accuracy_confirmed" in data:
        note.accuracy_confirmed = bool(data["accuracy_confirmed"]) and bool(note.generated_at)
        if note.accuracy_confirmed:
            _audit(note, user, "ATTEST", statement=ATTESTATION_TEXT)
    note.draft_saved_at = timezone.now()
    note.save()
    for key, digest in to_translate:
        transaction.on_commit(lambda key=key, digest=digest: _enqueue("translate", str(note.pk), key, digest))
    return note


# ── background AI steps (tasks.py) ──


def _enqueue(kind, note_id, *args):
    """Queue a background AI step. If it cannot be queued (broker down), the
    step is marked failed at once — the rule-based text stands, logged."""
    from . import tasks

    task = tasks.translate_psy_answer if kind == "translate" else tasks.reword_psy_note
    try:
        task.delay(note_id, *args)
    except Exception:  # noqa: BLE001 — any broker failure degrades to rule-based
        logger.exception("psychotherapy AI step could not be queued", extra={"note": note_id, "step": kind})
        if kind == "translate":
            run_translation(note_id, *args, failure="The translation could not be queued.")
        else:
            run_reword(note_id, *args, failure="The rewording could not be queued.")


def run_translation(note_id, key, digest, failure=None):
    """Translate one Kiswahili / Sheng answer and store the English beside the
    original with its provenance. Stale requests (the answer changed since)
    are dropped."""
    with platform_admin_context():
        note = PsychotherapyNote.objects.filter(pk=note_id, status="DRAFT").first()
        answer = (note.answers or {}).get(key) if note else None
        slot = (answer or {}).get("translation") or {}
        if not answer or slot.get("digest") != digest or slot.get("status") != "pending":
            return
        if failure is None and not psy_ai.enabled_for(note.patient):
            failure = "AI assistance was turned off or the client's consent was withdrawn."
        if failure is None:
            try:
                english, model = psy_ai.translate(answer["text"])
                result = {"status": "done", "text": english, "model": model}
            except psy_ai.AIUnavailable as exc:
                logger.warning("psychotherapy translation failed: %s", exc, extra={"note": note_id, "question": key})
                result = {"status": "error", "text": "", "error": str(exc)}
        else:
            result = {"status": "error", "text": "", "error": failure}
        with transaction.atomic():
            note = PsychotherapyNote.objects.select_for_update().get(pk=note_id)
            answer = dict((note.answers or {}).get(key) or {})
            slot = answer.get("translation") or {}
            if note.status != "DRAFT" or slot.get("digest") != digest or slot.get("status") != "pending":
                return
            answer["translation"] = {**slot, **result, "at": _now_iso()}
            note.answers = {**note.answers, key: answer}
            if result["status"] == "done":
                # A new input for organising: organise again before signing.
                note.generated_at, note.accuracy_confirmed = None, False
                _audit(note, None, "TRANSLATE", question=key, model=result["model"])
            else:
                _audit(note, None, "TRANSLATE_FAILED", question=key, error=result["error"])
            note.save(update_fields=["answers", "generated_at", "accuracy_confirmed", "history", "updated_at"])


def run_reword(note_id, token, failure=None):
    """Reword the organised sections in trauma-informed language from the
    clinician's English words. All-or-nothing: if any section fails, every
    section keeps the rule-based text. Clinician-edited sections are untouched."""
    with platform_admin_context():
        note = PsychotherapyNote.objects.filter(pk=note_id, status="DRAFT").first()
        proc = (note.processing or {}) if note else {}
        if not note or proc.get("token") != token or proc.get("status") != "pending":
            return
        reworded, model, error = {}, "", failure
        if error is None and not psy_ai.enabled_for(note.patient):
            error = "AI assistance was turned off or the client's consent was withdrawn."
        if error is None:
            names = [m["name"] for m in note.models_applied or []]
            try:
                for q, section in org.QUESTION_SECTION.items():
                    text = org.english_text((note.answers or {}).get(q))
                    if text.strip():
                        out, model = psy_ai.rewrite_section(q, text, names)
                        reworded[section] = org.compose_reworded(q, out, proc.get("fixed") or {})
            except psy_ai.AIUnavailable as exc:
                logger.warning("psychotherapy note rewording failed: %s", exc, extra={"note": note_id})
                error = str(exc)
        with transaction.atomic():
            note = PsychotherapyNote.objects.select_for_update().get(pk=note_id)
            proc = dict(note.processing or {})
            if note.status != "DRAFT" or proc.get("token") != token or proc.get("status") != "pending":
                return
            at = _now_iso()
            if error:
                proc.update({"status": "error", "error": error, "at": at})
                _audit(note, None, "REWORD_FAILED", error=error)
            else:
                before = dict(note.sections or {})
                note.generated_sections = {**(note.generated_sections or {}), **reworded}
                sources = dict(proc.get("sections") or {})
                for section in reworded:
                    sources[section] = {"source": "ai", "model": model, "at": at}
                proc.update({"status": "done", "model": model or proc.get("model", ""), "at": at,
                             "sections": sources})
                _compose_sections(note)
                if note.sections != before:
                    note.accuracy_confirmed = False
                _audit(note, None, "REWORD", model=model, sections=sorted(reworded))
            note.processing = proc
            note.save()


def dictation_enabled(organization):
    """X-12: browser dictation sends the audio to the browser maker's speech
    service, so it needs the platform switch and both organisation keys."""
    return (
        bool(getattr(settings, "PSYCHOTHERAPY_DICTATION_ENABLED", False))
        and organization is not None
        and organization.psy_dictation_allowed
        and organization.psy_dictation_enabled
    )


def processing_state(note):
    """How the note's sections were produced, for the "processed" line."""
    proc = dict(note.processing or {})
    status = proc.get("status") or ""
    if status == "pending":
        requested = proc.get("requested_at")
        if requested and timezone.now() - datetime.fromisoformat(requested) > AI_STALE_AFTER:
            status, proc["error"] = "error", "The AI step did not finish; the rule-based text is used."
    ai_done = status == "done" and proc.get("engine") == "ai"
    return {"engine": proc.get("engine", "rules"), "status": status or "none", "model": proc.get("model", ""),
            "at": proc.get("at"), "error": proc.get("error", ""),
            "label": PROCESSED_AI if ai_done else PROCESSED_RULES,
            "reason": "" if ai_done else psy_ai.unavailable_reason(note.patient),
            "sections": proc.get("sections") or {}}


def _translation_pending(note):
    for answer in (note.answers or {}).values():
        slot = (answer or {}).get("translation") or {}
        if slot.get("status") == "pending":
            requested = slot.get("requested_at")
            if not requested or timezone.now() - datetime.fromisoformat(requested) <= AI_STALE_AFTER:
                return True
    return False


# ── context (PSY-WF-02) ──


def context_goals(patient):
    episode = services.open_episode_for(patient)
    plan = CarePlan.objects.filter(episode=episode).first() if episode else None
    goals = []
    for i, g in enumerate((plan.goal_items if plan else None) or []):
        text = str((g or {}).get("goal", "")).strip()
        if text:
            goals.append({"index": i, "goal": text, "owner": g.get("owner", ""), "review_date": g.get("review_date", "")})
    return goals


def _active_safety_plan(patient):
    return SafetyPlan.objects.filter(patient=patient, signed_at__isnull=False).order_by("-version").first()


def _safety_plan(patient):
    plan = _active_safety_plan(patient)
    return ({"id": str(plan.pk), "display_id": plan.pk.hex[:8].upper(), "version": plan.version,
             "signed_at": facility_time.local_format(plan.signed_at)} if plan else None)


def safety_action_options(patient):
    """The actions-taken checklist for this client: the safety-plan action only
    when an active signed safety plan exists, labelled with that plan."""
    plan = _active_safety_plan(patient)
    out = []
    for a in _concepts(ACTION_VALUESET):
        if a["code"] == SAFETY_PLAN_ACTION:
            if not plan:
                continue
            a = {**a, "label": f"Safety plan {plan.pk.hex[:8].upper()} (version {plan.version}) reviewed with client"}
        out.append(a)
    return out


def _diagnoses(patient):
    from apps.clinical_encounter.models import DiagnosisCode

    rows = (DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE")
            .select_related("icd11_code").order_by("-is_primary", "-noted_at"))
    return [f"{d.icd11_code_id} — {d.icd11_code.description}" for d in rows]


def effective_sections(note):
    sections = dict(note.sections or {})
    for a in note.amendments.all():
        sections[a.section] = a.new_text
    return sections


def _previous(note, user):
    prev = (PsychotherapyNote.objects.filter(patient=note.patient, status="SIGNED")
            .exclude(pk=note.pk).select_related("signed_by").order_by("-signed_at").first())
    if prev:
        if not can_read(user, prev):
            return {"restricted": True, "at": prev.signed_at.isoformat()}
        log_view(prev)
        sections = effective_sections(prev)
        return {"id": str(prev.pk), "at": prev.signed_at.isoformat(), "by": _by(prev.signed_by),
                "response": sections.get("response", ""), "plan": sections.get("plan", ""),
                "risk_safety": sections.get("risk_safety", "")}
    legacy = (PsychotherapySession.objects.filter(patient=note.patient).exclude(pk=note.session_id)
              .exclude(psy_note__status="DRAFT").exclude(session_notes="").order_by("-session_date").first())
    if legacy:
        return {"id": None, "at": legacy.session_date.isoformat(), "by": _by(legacy.therapist),
                "text": legacy.session_notes[:2000]}
    return None


def context(note, user):
    from . import attention

    return {
        "goals": context_goals(note.patient),
        "previous_note": _previous(note, user),
        "risk": attention.active_alerts(note.patient),
        "safety_plan": _safety_plan(note.patient),
        "diagnoses": _diagnoses(note.patient),
    }


# ── organizing, detection, flags ──


def detections(note):
    return org.detect_risk_language(note.answers or {}, lexicon("PSY_RISK"))


def detected_models(note):
    """Models named in Q3 or suggested by Q3+Q4 content, each with whether it
    is included (the clinician's decision, else named → in, suggested → out)."""
    registry = [model_row(m) for m in therapy_models(note.organization_id)]
    answers = note.answers or {}
    found = org.detect_models(org.english_text(answers.get("q3")), org.english_text(answers.get("q4")), registry)
    decisions = note.model_decisions or {}
    for m in found:
        default = "INCLUDE" if m["how"] == "named" else "EXCLUDE"
        m["included"] = decisions.get(m["code"], default) == "INCLUDE"
    return found


def applied_models(note):
    registry = {m["code"]: m for m in (model_row(x) for x in therapy_models(note.organization_id))}
    texts = [org.english_text((note.answers or {}).get(k)) for k in ("q3", "q4")]
    applied = [m for m in detected_models(note) if m["included"]]
    for code in note.selected_models or []:  # ticked on an earlier draft
        if code in registry and code not in {m["code"] for m in applied}:
            m = registry[code]
            applied.append({**m, "concepts": org.supported_concepts(m, texts)})
    return applied


def _concern_labels(detail):
    options = concern_options()
    categories = {c["code"]: c["label"] for c in options["categories"]}
    labels = {c["code"]: c["label"] for c in options["other"]}
    rows = {r["key"]: r["label"] for r in intake_schema.RISK_ROWS}
    out = []
    for c in detail.get("concerns") or []:
        if "category" in c:
            label = categories.get(c["category"], c["category"])
            out.append(f"{label} — {', '.join(c['options'])}" if c.get("options") else label)
        elif "other" in c:
            out.append(labels.get(c["other"], c["other"]))
        else:
            out.append(f"{rows.get(c['row'], c['row'])} — {c['option']}")
    return out


def _action_labels(note, detail):
    labels = {a["code"]: a["label"] for a in safety_action_options(note.patient)}
    labels.update({a["code"]: a["label"] for a in _concepts(ACTION_VALUESET) if a["code"] not in labels})
    out = [labels.get(code, code) for code in detail.get("action_codes") or []]
    if detail.get("actions"):
        out.append(detail["actions"])
    return out


def _session_number(note):
    s, ep = note.session, note.therapy_episode
    if not ep:
        return None
    return PsychotherapySession.objects.filter(
        patient=note.patient, extra__therapy_episode=str(ep.pk), session_date__lt=s.session_date
    ).exclude(psy_note__status="DRAFT").count() + 1


def _session_info(note):
    s = note.session
    labels = services.concept_labels()
    ep = note.therapy_episode
    number = _session_number(note)
    activity_id = (s.extra or {}).get("activity")
    activity = CarePlanActivity.objects.filter(pk=activity_id).first() if activity_id else None
    local = timezone.localtime(s.session_date, facility_time.facility_tz())
    episode_text = ""
    if ep:
        episode_text = labels.get(("therapy-modality", ep.modality), ep.modality)
        if number:
            episode_text += f", session {number}" + (f" of {ep.planned_sessions}" if ep.planned_sessions else "")
    return {
        "date": local.strftime("%Y-%m-%d"), "time": local.strftime("%H:%M"), "duration": s.duration_minutes,
        "clinician": _by(note.author), "session_type": s.get_session_type_display(),
        "mode": labels.get((ATTENDANCE_VALUESET, (s.extra or {}).get("attendance_mode", "")), ""),
        "episode": episode_text, "activity": activity.title if activity else "",
    }


@transaction.atomic
def generate(note, user):
    """X-13: organise the answers into the seven PSY-OUT sections. A section the
    clinician edited keeps the edit (Revert restores the newly generated text).
    With AI assistance on, the narrative sections are then reworded in the
    background; until that finishes (or if it fails) the rule-based text stands."""
    note = PsychotherapyNote.objects.select_for_update().get(pk=note.pk)
    _require_author(user, note)
    _require_draft(note)
    registry = [model_row(m) for m in therapy_models(note.organization_id)]
    detail = note.safety_detail or {}
    safety = {"answer": note.safety_answer, "concern_labels": _concern_labels(detail),
              "description": detail.get("description", ""), "actions": _action_labels(note, detail),
              "link": detail.get("risk_link") if note.safety_answer == org.SAFETY_YES else None,
              "ack_reason": note.safety_ack_reason}
    result = org.organize(
        note.answers or {}, safety, _session_info(note), registry, lexicon("PSY_REPORT_CUE"),
        detections=detections(note), resolutions=note.detection_resolutions or {},
        confirmed_links=[link for link in note.goal_links or [] if link["status"] == "CONFIRMED"],
        goal_links=note.goal_links or [], measure=(note.session.extra or {}).get("measure"),
        context={"safety_plan": _safety_plan(note.patient)}, applied_models=applied_models(note),
    )
    if not note.generated_sections and note.sections and note.sections_edited and not note.section_edits:
        # A draft whose edits predate keeping them apart: keep the edited text as edits.
        note.section_edits = {k: {"text": v, "by": _by(user), "at": _now_iso()}
                              for k, v in note.sections.items() if v != result["sections"].get(k)}
    note.generated_sections, note.models_applied = result["sections"], result["models_applied"]
    now = _now_iso()
    rules = {k: {"source": "rules", "at": now} for k in org.SECTION_KEYS}
    if psy_ai.enabled_for(note.patient):
        token = uuid.uuid4().hex
        note.processing = {"engine": "ai", "status": "pending", "model": psy_ai.model_name(), "token": token,
                           "requested_at": now, "requested_by": _by(user), "fixed": result["fixed"],
                           "sections": rules}
        transaction.on_commit(lambda: _enqueue("reword", str(note.pk), token))
    else:
        note.processing = {"engine": "rules", "status": "disabled", "at": now, "sections": rules}
    _compose_sections(note)
    note.generated_at, note.accuracy_confirmed = timezone.now(), False
    _audit(note, user, "GENERATE", models=[m["code"] for m in note.models_applied],
           engine=note.processing["engine"], kept_edits=sorted(note.section_edits or {}))
    note.save()
    return note


def flags(note):
    texts = {k: (note.answers.get(k) or {}).get("text", "") for k in org.QUESTION_KEYS}
    texts.update({f"section:{k}": v for k, v in (effective_sections(note) or {}).items()})
    return org.stigma_flags(texts, lexicon("PSY_STIGMA"))


def _goal_progress(note):
    """(all goal suggestions, the undecided ones)."""
    if note.status != "DRAFT":
        return [], []
    suggestions = org.goal_suggestions(context_goals(note.patient), note.answers or {})
    decided = {link["goal_index"] for link in note.goal_links or []}
    return suggestions, [g for g in suggestions if g["goal_index"] not in decided]


def blockers(note, found=None):
    """Why this note cannot be signed yet (empty = it can)."""
    found = detections(note) if found is None else found
    out = []

    def add(code, text):
        out.append({"code": code, "text": text})

    answer = note.safety_answer
    detail = note.safety_detail or {}
    if not any((note.answers.get(k) or {}).get("text", "").strip() for k in org.QUESTION_KEYS):
        add("NO_CONTENT", "Answer at least one of the five questions.")
    if not answer:
        add("SAFETY_UNANSWERED", "Answer the safety question (PSY-S-04).")
    if answer == org.SAFETY_NOT_ASSESSED and not note.safety_ack_at:
        add("SAFETY_NOT_ASSESSED", "Safety was not assessed — record the reason and acknowledge it before signing.")
    if answer == org.SAFETY_YES:
        if not detail.get("concerns") or not detail.get("description"):
            add("SAFETY_DETAIL", "Record which concern was identified and describe it.")
        elif not detail.get("risk_link"):
            add("RISK_LINK", "Link the risk assessment for the safety concern.")
    unreviewed = [d for d in found if d["key"] not in (note.detection_resolutions or {})]
    if unreviewed:
        add("DETECTION_UNREVIEWED", f"{org.DETECTION_PROMPT} Mark each flagged passage reviewed "
                                    f"({len(found) - len(unreviewed)} of {len(found)} reviewed).")
    _, undecided = _goal_progress(note)
    if undecided:
        add("GOALS_UNRESOLVED", "Decide each treatment-plan goal suggestion (progress, no clear change, "
                                "barrier or not relevant).")
    if _translation_pending(note):
        add("TRANSLATION_PENDING", "A translation is still in progress.")
    if processing_state(note)["status"] == "pending":
        add("PROCESSING", "The note is still being processed.")
    if not note.generated_at:
        add("NOT_GENERATED", "Organise the note from the current answers.")
    elif not note.accuracy_confirmed:
        add("ACCURACY", "Confirm you have reviewed the note and it is accurate.")
    return out


def checklist(note, found, pending):
    """The sign-off checklist (done / total), from the same rules as blockers."""
    codes = {b["code"] for b in pending}
    answer = note.safety_answer
    detail = note.safety_detail or {}
    answered = sum(1 for k in org.QUESTION_KEYS if (note.answers.get(k) or {}).get("text", "").strip())
    reviewed = sum(1 for d in found if d["key"] in (note.detection_resolutions or {}))
    suggestions, undecided = _goal_progress(note)
    labels = dict(org.SAFETY_OPTIONS)
    items = [
        {"key": "questions", "label": "Guided questions answered", "done": answered > 0,
         "detail": f"{answered} of {len(org.QUESTION_KEYS)} answered"},
        {"key": "safety", "label": "Safety question answered", "done": bool(answer),
         "detail": labels.get(answer, "Not answered")},
    ]
    if answer == org.SAFETY_YES:
        items.append({"key": "safety_yes", "label": "Concern described and risk assessment linked",
                      "done": bool(detail.get("concerns") and detail.get("description") and detail.get("risk_link")),
                      "detail": ""})
    if answer == org.SAFETY_NOT_ASSESSED:
        items.append({"key": "safety_na", "label": "Reason recorded and acknowledged",
                      "done": bool(note.safety_ack_at), "detail": ""})
    items += [
        {"key": "flags", "label": "Flagged safety language reviewed", "done": reviewed == len(found),
         "detail": f"{reviewed}/{len(found)}"},
        {"key": "goals", "label": "Goal suggestions resolved", "done": not undecided,
         "detail": f"{len(suggestions) - len(undecided)}/{len(suggestions)}"},
        {"key": "attestation", "label": "Clinician attestation", "done": not ({"NOT_GENERATED", "ACCURACY"} & codes),
         "detail": ATTESTATION_TEXT},
    ]
    return {"items": items, "done": sum(1 for i in items if i["done"]), "total": len(items)}


@transaction.atomic
def sign(note, user):
    note = PsychotherapyNote.objects.select_for_update().get(pk=note.pk)
    _require_author(user, note)
    _require_draft(note)
    pending = blockers(note)
    if pending:
        raise ValidationError({"detail": "This note cannot be signed yet.", "blockers": pending})
    now = timezone.now()
    note.status, note.signed_at, note.signed_by = "SIGNED", now, user
    _audit(note, user, "SIGN")
    note.save()
    session = note.session
    session.session_notes = org.render(note.sections, watermark=False)
    session.save(update_fields=["session_notes", "updated_at"])
    Encounter.objects.filter(pk=note.encounter_id).update(status="CLOSED", closed_at=now)
    _record_delivery(note, user)
    return note


def _record_delivery(note, user):
    """v4 `recordDelivery("Psychotherapy", 1)` on sign: the session counts as
    delivered on the Interventions card, moves the linked therapy action on and
    raises the tariff charge — so the session is never documented twice. Only
    the fact of the session is written; its content stays on the signed note."""
    from . import intervention_catalogue, services

    if note.intervention_record_id:
        return
    session = note.session
    activity_id = (session.extra or {}).get("activity")
    activity = (
        CarePlanActivity.objects.filter(pk=activity_id, care_plan__patient=note.patient).first()
        if activity_id else None
    ) or (note.therapy_episode.activity if note.therapy_episode_id else None)
    number = _session_number(note)
    service = intervention_catalogue.billing_service_for("psychotherapy")
    note.intervention_record = services.record_intervention(
        user,
        note.patient,
        {
            "module": "psychotherapy",
            "intervention": "Family therapy" if session.session_type == "FAMILY" else "Individual",
            "performed_at": session.session_date,
            "provider": note.author or user,
            "note": f"Psychotherapy session {number} — signed note" if number else "Psychotherapy session — signed note",
            "billable": service is not None,
            "billing_service": service,
        },
        activity=activity,
    )
    note.save(update_fields=["intervention_record", "updated_at"])
    _audit(note, user, "DELIVERY_RECORDED", intervention=str(note.intervention_record_id))


@transaction.atomic
def amend(note, user, data):
    """AT-18: a signed note's section is changed only by an audited amendment."""
    if note.status != "SIGNED":
        raise ValidationError({"detail": "Edit the draft directly — amendments are for signed notes."})
    if not can_read(user, note):
        raise PermissionDenied("You cannot amend this note.")
    section = data.get("section")
    if section not in org.SECTION_KEYS:
        raise ValidationError({"section": "Choose the section to amend."})
    text, reason = str(data.get("text") or "").strip(), str(data.get("reason") or "").strip()
    current = effective_sections(note).get(section, "")
    if not text or text == current:
        raise ValidationError({"text": "Write the amended text."})
    if len(reason) < 3:
        raise ValidationError({"reason": "Give the reason for the amendment."})
    return PsychotherapyNoteAmendment.objects.create(
        organization_id=note.organization_id, note=note, patient=note.patient, section=section,
        previous_text=current, new_text=text[:20000], reason=reason[:2000], amended_by=user,
    )


# ── payloads ──


def summary(note, user):
    row = {"id": str(note.pk), "status": note.status, "session_date": note.session.session_date.isoformat(),
           "session_type": note.session.session_type, "author": _by(note.author),
           "therapy_episode": str(note.therapy_episode_id or ""),
           "signed_at": note.signed_at.isoformat() if note.signed_at else None}
    if can_read(user, note):
        row.update({"safety_answer": note.safety_answer, "amendments": note.amendments.count(),
                    "draft_saved_at": note.draft_saved_at.isoformat()})
    else:
        row["restricted"] = True
    return row


def transcript(note):
    """Each answer verbatim, with how and when it was given, its language and —
    for Kiswahili / Sheng — the English translation and its provenance."""
    titles = {q["key"]: q["title"] for q in org.QUESTIONS}
    out = []
    for key in org.QUESTION_KEYS:
        answer = (note.answers or {}).get(key) or {}
        out.append({"question": key, "title": titles[key], "text": answer.get("text", ""),
                    "mode": org.LEGACY_MODES.get(answer.get("mode"), answer.get("mode") or "TYPED"),
                    "answered_at": answer.get("answered_at"), "language": answer.get("language") or DEFAULT_LANGUAGE,
                    "translation": answer.get("translation")})
    return out


def detail(note, user):
    if not can_read(user, note):
        raise PermissionDenied("Psychotherapy notes are visible to the treating clinician and the care team only.")
    log_view(note)
    found = detections(note)
    resolutions = note.detection_resolutions or {}
    s = note.session
    extra = therapy.visible_extra(s.extra or {}, user)
    sections = effective_sections(note) if note.status == "SIGNED" else note.sections
    # jsonb does not keep key order: return the sections in PSY-OUT order.
    sections = {k: sections.get(k, "") for k in org.SECTION_KEYS} if sections else {}
    pending = blockers(note, found) if note.status == "DRAFT" else []
    _, undecided = _goal_progress(note)
    patient = note.patient
    return {
        **summary(note, user),
        "is_author": note.author_id == user.pk,
        "patient": {"id": str(patient.pk), "name": patient.get_full_name(), "number": patient.citramac_number},
        "session_number": _session_number(note),
        "watermark": org.WATERMARK if note.status == "DRAFT" else None,
        "session": {"id": str(s.pk), "session_date": s.session_date.isoformat(), "duration_minutes": s.duration_minutes,
                    "session_type": s.session_type, "attendance_mode": extra.get("attendance_mode", ""),
                    "location": extra.get("location", ""), "encounter": str(note.encounter_id),
                    "activity": extra.get("activity", ""), "measure": extra.get("measure"),
                    "process_notes": extra.get("process_notes", "") if "process_notes" in extra else None},
        "answers": note.answers, "selected_models": note.selected_models,
        "models_detected": detected_models(note) if note.status == "DRAFT" else [],
        "transcript": transcript(note),
        "safety_answer": note.safety_answer, "safety_detail": note.safety_detail,
        "safety_action_options": safety_action_options(patient) if note.status == "DRAFT" else [],
        "not_assessed_reason": note.safety_ack_reason,
        "safety_ack": ({"reason": note.safety_ack_reason, "at": note.safety_ack_at.isoformat(),
                        "by": _by(note.safety_ack_by)} if note.safety_ack_at else None),
        "alerts": [{"code": a.alert_code, "status": a.status} for a in (note.safety_alert, note.not_assessed_alert) if a],
        "detections": [{**d, "prompt": org.DETECTION_PROMPT, "resolution": resolutions.get(d["key"])} for d in found],
        "goal_suggestions": undecided,
        "goal_links": note.goal_links,
        "sections": sections, "sections_edited": note.sections_edited,
        "edited_sections": sorted(note.section_edits or {}) if note.status == "DRAFT" else [],
        "models_applied": note.models_applied,
        "processing": processing_state(note),
        "generated_at": note.generated_at.isoformat() if note.generated_at else None,
        "accuracy_confirmed": note.accuracy_confirmed,
        "flags": flags(note),
        "blockers": pending,
        "checklist": checklist(note, found, pending) if note.status == "DRAFT" else None,
        "rendered": org.render(sections, watermark=note.status == "DRAFT") if sections else "",
        "amendments": [{"id": str(a.pk), "section": a.section, "previous_text": a.previous_text, "new_text": a.new_text,
                        "reason": a.reason, "by": _by(a.amended_by), "at": a.amended_at.isoformat()}
                       for a in note.amendments.select_related("amended_by")],
        "history": note.history,
        "context": context(note, user),
    }


def patient_notes(patient, user):
    rows = PsychotherapyNote.objects.filter(patient=patient).select_related("session", "author")
    return [summary(n, user) for n in rows]


# ── Individual Psychotherapy client list ──


def client_list(user):
    """Clients with an open therapy episode or a psychotherapy action on their
    care plan. Session counts and dates are psychotherapy content: they are sent
    only for clients the user has full MHP access to (care team / Org Admin);
    everyone else sees that the client is in therapy. The view is audit-logged."""
    from apps.client_registry.models import Appointment, Patient

    episode_patients = set(TherapyEpisode.objects.filter(ended_at__isnull=True).values_list("patient_id", flat=True))
    activity_patients = set(
        CarePlanActivity.objects.exclude(decision="DECLINED").exclude(status="COMPLETED")
        .filter(Q(action_key__in=("therapy", "family")) | Q(module="THERAPY"))
        .values_list("care_plan__patient_id", flat=True)
    )
    patients = (Patient.objects.filter(pk__in=episode_patients | activity_patients, archived_at__isnull=True)
                .order_by("last_name", "first_name"))
    now = timezone.now()
    rows, viewed = [], []
    for patient in patients:
        episode = (TherapyEpisode.objects.filter(patient=patient, ended_at__isnull=True,
                                                 confidentiality_agreed_at__isnull=False)
                   .order_by("-created_at").first())
        appointment = (Appointment.objects.filter(patient=patient, scheduled_for__gte=now,
                                                  status__in=("SCHEDULED", "CHECKED_IN"))
                       .order_by("scheduled_for").first())
        diagnoses = _diagnoses(patient)
        row = {"patient_id": str(patient.pk), "name": patient.get_full_name(), "number": patient.citramac_number,
               "diagnosis": diagnoses[0] if diagnoses else "",
               "next_appointment": appointment.scheduled_for.isoformat() if appointment else None,
               "episode_id": str(episode.pk) if episode else None,
               "in_therapy": patient.pk in episode_patients}
        if has_full_mhp_access(user, patient):
            signed = PsychotherapyNote.objects.filter(patient=patient, status="SIGNED")
            last = signed.aggregate(last=Max("session__session_date"))["last"]
            row.update({"sessions_recorded": signed.count(), "last_session": last.isoformat() if last else None})
            viewed.append(str(patient.pk))
        else:
            row["restricted"] = True
        rows.append(row)
    write_event(user.organization_id, "VIEW", "care_pathway.psychotherapynote", "client-list",
                {"context": "individual_psychotherapy_list", "patients": viewed})
    return rows
