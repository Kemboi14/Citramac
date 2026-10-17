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
"""

import hashlib

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.clinical_encounter.models import Encounter
from apps.mhp_program.models import PsychotherapySession
from apps.mhp_program.permissions import has_full_mhp_access
from apps.sysadmin_audit.audit import log_view

from . import facility_time, intake_schema, psy_seed, records, services, therapy
from . import psy_organizer as org
from .models import (
    CarePlan,
    ClinicalAlert,
    ClinicalLexiconTerm,
    LocalConcept,
    OutcomeScore,
    PsychotherapyNote,
    PsychotherapyNoteAmendment,
    SafetyPlan,
    TherapyModel,
)

OTHER_CONCERN_VALUESET = "psy-safety-concern-other"
ATTENDANCE_VALUESET = "psy-attendance-mode"
ALERT_LABELS = dict(psy_seed.ALERTS)
SESSION_TYPES = ("INDIVIDUAL", "FAMILY")  # group attendance: group_programme.py only
PROPOSAL_SOURCE = "Psychotherapy session safety question"


def _by(user):
    return services.user_display(user)


def _now_iso():
    return timezone.now().isoformat()


def _audit(note, user, action, **detail):
    note.history = [*(note.history or []), {"at": _now_iso(), "by": _by(user), "action": action, **detail}]


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
            "version": m.version, "enabled": m.enabled}


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


def concern_options():
    """YES-answer concerns: the risk-register rows' live options (the same
    vocabulary the register uses — RULE-01) plus the served non-register ones."""
    rows = [{"row": r["key"], "label": r["label"], "options": list(r["active"])} for r in intake_schema.RISK_ROWS]
    other = [{"code": c.code, "label": c.display}
             for c in LocalConcept.objects.filter(valueset_id=OTHER_CONCERN_VALUESET, active=True)]
    return {"register": rows, "other": other}


def config(user):
    return {
        "questions": org.QUESTIONS,
        "safety_question": org.SAFETY_QUESTION,
        "safety_options": [{"code": c, "label": label} for c, label in org.SAFETY_OPTIONS],
        "detection_prompt": org.DETECTION_PROMPT,
        "watermark": org.WATERMARK,
        "sections": [{"key": k, "title": t} for k, t in org.SECTIONS],
        "therapy_models": [model_row(m) for m in therapy_models(user.organization_id)],
        "concerns": concern_options(),
        "attendance_modes": [{"code": c.code, "label": c.display}
                             for c in LocalConcept.objects.filter(valueset_id=ATTENDANCE_VALUESET, active=True)],
        "session_types": [{"code": c, "label": dict(PsychotherapySession.SESSION_TYPE_CHOICES)[c]}
                          for c in SESSION_TYPES],
        # X-12: browser dictation is off unless the organisation has approved it —
        # most browsers send the audio to the vendor's speech service.
        "dictation_enabled": bool(getattr(settings, "PSYCHOTHERAPY_DICTATION_ENABLED", False)),
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
        raise ValidationError({"session_type": "Individual or family — group sessions are recorded in the group programme."})
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
        answers={k: {"text": "", "mode": "TYPE"} for k in org.QUESTION_KEYS},
    )
    _audit(note, user, "CREATE")
    note.save()
    return note, True


def _set_answers(note, answers):
    if not isinstance(answers, dict):
        raise ValidationError({"answers": "Answers must be keyed by question."})
    current = dict(note.answers or {})
    for key, value in answers.items():
        if key not in org.QUESTION_KEYS or not isinstance(value, dict):
            raise ValidationError({"answers": f"Unknown question {key!r}."})
        mode = value.get("mode", (current.get(key) or {}).get("mode", "TYPE"))
        if mode not in ("SPEAK", "TYPE"):
            raise ValidationError({"answers": "Input mode is SPEAK or TYPE."})
        current[key] = {"text": str(value.get("text", ""))[:20000], "mode": mode}
    changed = current != (note.answers or {})
    note.answers = current
    return changed


def _clean_safety_detail(detail):
    detail = detail if isinstance(detail, dict) else {}
    register = {r["row"]: set(r["options"]) for r in concern_options()["register"]}
    other = {c["code"] for c in concern_options()["other"]}
    concerns = []
    for c in detail.get("concerns") or []:
        if not isinstance(c, dict):
            raise ValidationError({"safety_detail": "Choose concerns from the list."})
        if "other" in c:
            if c["other"] not in other:
                raise ValidationError({"safety_detail": "Choose concerns from the list."})
            concerns.append({"other": c["other"]})
        elif c.get("option") in register.get(c.get("row"), ()):
            concerns.append({"row": c["row"], "option": c["option"]})
        else:
            raise ValidationError({"safety_detail": "Choose concerns from the list."})
    return {"concerns": concerns, "description": str(detail.get("description", "")).strip()[:4000],
            "actions": str(detail.get("actions", "")).strip()[:4000]}


def _set_session_info(note, user, data):
    session = note.session
    fields = []
    if "session_date" in data and data["session_date"]:
        from django.utils.dateparse import parse_datetime

        when = parse_datetime(str(data["session_date"]))
        if when is None:
            raise ValidationError({"session_date": "Give the session date and time."})
        session.session_date = facility_time.make_local_aware(when)
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
    extra = dict(session.extra or {})
    if "attendance_mode" in data:
        mode = data["attendance_mode"] or ""
        if mode and not LocalConcept.objects.filter(valueset_id=ATTENDANCE_VALUESET, code=mode).exists():
            raise ValidationError({"attendance_mode": "Choose in person, virtual or telephone."})
        extra["attendance_mode"] = mode
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


def _apply_safety(note, user):
    """PSY-S side effects on the shared objects, applied when the draft is saved.

    YES → PSYCHOTHERAPY_SAFETY_CONCERN on the banner and each register concern
    queued as a RiskProposal (PSY-S-01; the clinician adds it to the register —
    never a silent write). A YES alert is never auto-resolved by changing the
    answer: a risk alert is resolved by a clinician through the alert workflow.
    NOT ASSESSED → SAFETY_NOT_ASSESSED until acknowledged with a reason (PSY-S-03,
    OQ-06 default: block). Any other answer clears that review flag."""
    answer = note.safety_answer
    if answer == org.SAFETY_YES:
        if note.safety_alert is None:
            note.safety_alert = _raise_alert(note, user, "PSYCHOTHERAPY_SAFETY_CONCERN")
            _audit(note, user, "RAISE_ALERT", code="PSYCHOTHERAPY_SAFETY_CONCERN")
        for concern in note.safety_detail.get("concerns") or []:
            if "row" in concern:
                records._propose(note.patient, PROPOSAL_SOURCE, _proposal_key(note, concern),
                                 concern["row"], concern["option"])
    if answer == org.SAFETY_NOT_ASSESSED and not note.safety_ack_at:
        if note.not_assessed_alert is None or note.not_assessed_alert.status != "ACTIVE":
            note.not_assessed_alert = _raise_alert(note, user, "SAFETY_NOT_ASSESSED")
            _audit(note, user, "RAISE_ALERT", code="SAFETY_NOT_ASSESSED")
    elif note.not_assessed_alert and note.not_assessed_alert.status == "ACTIVE":
        _resolve_alert(note.not_assessed_alert, user)
        _audit(note, user, "RESOLVE_ALERT", code="SAFETY_NOT_ASSESSED",
               reason="Acknowledged" if note.safety_ack_at else "Safety answer changed")


def _acknowledge(note, user, reason):
    reason = str(reason or "").strip()
    if note.safety_answer != org.SAFETY_NOT_ASSESSED:
        raise ValidationError({"acknowledge": "Only a 'not assessed' safety answer is acknowledged."})
    if len(reason) < 3:
        raise ValidationError({"acknowledge": "Give the reason safety was not assessed."})
    note.safety_ack_reason, note.safety_ack_at, note.safety_ack_by = reason[:2000], timezone.now(), user
    _audit(note, user, "ACKNOWLEDGE", reason=reason[:2000])


def _resolve_detection(note, user, data):
    key, reason = str(data.get("key") or ""), str(data.get("reason") or "").strip()
    if key not in {d["key"] for d in detections(note)}:
        raise ValidationError({"resolve_detection": "That prompt is no longer in the answers."})
    if len(reason) < 3:
        raise ValidationError({"resolve_detection": "Say what your review found."})
    note.detection_resolutions = {**(note.detection_resolutions or {}),
                                  key: {"reason": reason[:2000], "by": _by(user), "at": _now_iso()}}
    _audit(note, user, "RESOLVE_DETECTION", key=key, reason=reason[:2000])


def _goal_link(note, user, data):
    goals = {g["index"]: g for g in context_goals(note.patient)}
    try:
        index = int(data.get("goal_index"))
    except (TypeError, ValueError):
        raise ValidationError({"goal_link": "Choose a goal from the care plan."}) from None
    if index not in goals:
        raise ValidationError({"goal_link": "Choose a goal from the care plan."})
    decision = data.get("decision")
    if decision not in ("CONFIRMED", "DISMISSED"):
        raise ValidationError({"goal_link": "Confirm or dismiss the suggestion."})
    statement = str(data.get("statement") or "").strip()[:2000]
    if decision == "CONFIRMED" and not statement:
        raise ValidationError({"goal_link": "Write the progress statement you are confirming."})
    links = [link for link in (note.goal_links or []) if link["goal_index"] != index]
    links.append({"goal_index": index, "goal": goals[index]["goal"], "statement": statement,
                  "status": decision, "by": _by(user), "at": _now_iso()})
    note.goal_links = links
    _audit(note, user, f"GOAL_LINK_{decision}", goal=goals[index]["goal"], statement=statement)


@transaction.atomic
def save_draft(note, user, data):
    note = PsychotherapyNote.objects.select_for_update().get(pk=note.pk)
    _require_author(user, note)
    _require_draft(note)
    inputs_changed = False
    if "answers" in data:
        inputs_changed |= _set_answers(note, data["answers"])
    if "selected_models" in data:
        codes = data["selected_models"] or []
        enabled = {m.code for m in therapy_models(note.organization_id)}
        if not isinstance(codes, list) or any(c not in enabled for c in codes):
            raise ValidationError({"selected_models": "Choose models from the registry."})
        inputs_changed |= codes != note.selected_models
        note.selected_models = codes
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
        detail = _clean_safety_detail(data["safety_detail"])
        if detail != note.safety_detail:
            _audit(note, user, "UPDATE", field="safety_detail", previous=note.safety_detail, new=detail)
            note.safety_detail = detail
            inputs_changed = True
    if data.get("acknowledge_not_assessed") is not None:
        _acknowledge(note, user, (data["acknowledge_not_assessed"] or {}).get("reason"))
        inputs_changed = True
    if data.get("resolve_detection"):
        _resolve_detection(note, user, data["resolve_detection"])
        inputs_changed = True
    if data.get("goal_link"):
        _goal_link(note, user, data["goal_link"])
        inputs_changed = True
    inputs_changed |= _set_session_info(note, user, data)
    if "sections" in data:
        sections = data["sections"]
        if not isinstance(sections, dict) or any(k not in org.SECTION_KEYS for k in sections):
            raise ValidationError({"sections": "Unknown note section."})
        if not note.generated_at:
            raise ValidationError({"sections": "Organise the note before editing its sections."})
        merged = {**note.sections, **{k: str(v)[:20000] for k, v in sections.items()}}
        if merged != note.sections:
            _audit(note, user, "EDIT_SECTIONS", sections=sorted(k for k in sections if sections[k] != note.sections.get(k)))
            note.sections, note.sections_edited = merged, True
            note.accuracy_confirmed = False
    if inputs_changed:
        # The organised sections no longer reflect the answers: organise again
        # before signing (the previous text stays visible until then).
        note.generated_at = None
        note.accuracy_confirmed = False
    if "accuracy_confirmed" in data:
        note.accuracy_confirmed = bool(data["accuracy_confirmed"]) and bool(note.generated_at)
    _apply_safety(note, user)
    note.draft_saved_at = timezone.now()
    note.save()
    return note


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


def _safety_plan(patient):
    plan = SafetyPlan.objects.filter(patient=patient, signed_at__isnull=False).order_by("-version").first()
    return ({"id": str(plan.pk), "version": plan.version, "signed_at": facility_time.local_format(plan.signed_at)}
            if plan else None)


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
    }


# ── organizing, detection, flags ──


def detections(note):
    return org.detect_risk_language(note.answers or {}, lexicon("PSY_RISK"))


def _concern_labels(detail):
    labels = {c["code"]: c["label"] for c in concern_options()["other"]}
    rows = {r["key"]: r["label"] for r in intake_schema.RISK_ROWS}
    out = []
    for c in detail.get("concerns") or []:
        out.append(labels.get(c["other"], c["other"]) if "other" in c else f"{rows.get(c['row'], c['row'])} — {c['option']}")
    return out


def _session_info(note):
    s = note.session
    labels = services.concept_labels()
    ep = note.therapy_episode
    number = None
    if ep:
        number = PsychotherapySession.objects.filter(
            patient=note.patient, extra__therapy_episode=str(ep.pk), session_date__lt=s.session_date
        ).exclude(psy_note__status="DRAFT").count() + 1
    activity_id = (s.extra or {}).get("activity")
    from .models import CarePlanActivity

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
    """X-13: organise the answers into the seven PSY-OUT sections (replaces any
    edits — the clinician is told before regenerating)."""
    note = PsychotherapyNote.objects.select_for_update().get(pk=note.pk)
    _require_author(user, note)
    _require_draft(note)
    registry = [model_row(m) for m in therapy_models(note.organization_id)]
    safety = {"answer": note.safety_answer, "concern_labels": _concern_labels(note.safety_detail or {}),
              "description": (note.safety_detail or {}).get("description", ""),
              "actions": (note.safety_detail or {}).get("actions", ""), "ack_reason": note.safety_ack_reason}
    result = org.organize(
        note.answers or {}, safety, _session_info(note), registry, lexicon("PSY_REPORT_CUE"),
        detections=detections(note), resolutions=note.detection_resolutions or {},
        confirmed_links=[link for link in note.goal_links or [] if link["status"] == "CONFIRMED"],
        measure=(note.session.extra or {}).get("measure"),
        context={"safety_plan": _safety_plan(note.patient)}, selected_models=note.selected_models,
    )
    note.sections, note.models_applied = result["sections"], result["models_applied"]
    note.generated_at, note.sections_edited, note.accuracy_confirmed = timezone.now(), False, False
    _audit(note, user, "GENERATE", models=[m["code"] for m in note.models_applied])
    note.save()
    return note


def flags(note):
    texts = {k: (note.answers.get(k) or {}).get("text", "") for k in org.QUESTION_KEYS}
    texts.update({f"section:{k}": v for k, v in (effective_sections(note) or {}).items()})
    return org.stigma_flags(texts, lexicon("PSY_STIGMA"))


def blockers(note, found=None):
    """Why this note cannot be signed yet (empty = it can)."""
    found = detections(note) if found is None else found
    out = []

    def add(code, text):
        out.append({"code": code, "text": text})

    answer = note.safety_answer
    if not any((note.answers.get(k) or {}).get("text", "").strip() for k in org.QUESTION_KEYS):
        add("NO_CONTENT", "Answer at least one of the five questions.")
    if not answer:
        add("SAFETY_UNANSWERED", "Answer the safety question (PSY-S-04).")
    if answer == org.SAFETY_NOT_ASSESSED and not note.safety_ack_at:
        add("SAFETY_NOT_ASSESSED", "Safety was not assessed — acknowledge this with the reason before signing.")
    if answer == org.SAFETY_YES:
        detail = note.safety_detail or {}
        if not detail.get("concerns") or not detail.get("description"):
            add("SAFETY_DETAIL", "Record which concern was identified and describe it.")
    unresolved = [d for d in found if d["key"] not in (note.detection_resolutions or {})]
    if answer == org.SAFETY_NO and unresolved:
        add("DETECTION_MISMATCH", "Possible safety language was found but the safety answer is No — review each "
                                  "highlighted passage (change the answer, or record what your review found).")
    if not note.generated_at:
        add("NOT_GENERATED", "Organise the note from the current answers.")
    elif not note.accuracy_confirmed:
        add("ACCURACY", "Confirm you have reviewed the note and it is accurate.")
    return out


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
    return note


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


def detail(note, user):
    if not can_read(user, note):
        raise PermissionDenied("Psychotherapy notes are visible to the treating clinician and the care team only.")
    log_view(note)
    found = detections(note)
    resolutions = note.detection_resolutions or {}
    decided = {link["goal_index"] for link in note.goal_links or []}
    s = note.session
    extra = therapy.visible_extra(s.extra or {}, user)
    sections = effective_sections(note) if note.status == "SIGNED" else note.sections
    # jsonb does not keep key order: return the sections in PSY-OUT order.
    sections = {k: sections.get(k, "") for k in org.SECTION_KEYS} if sections else {}
    return {
        **summary(note, user),
        "is_author": note.author_id == user.pk,
        "watermark": org.WATERMARK if note.status == "DRAFT" else None,
        "session": {"id": str(s.pk), "session_date": s.session_date.isoformat(), "duration_minutes": s.duration_minutes,
                    "session_type": s.session_type, "attendance_mode": extra.get("attendance_mode", ""),
                    "activity": extra.get("activity", ""), "measure": extra.get("measure"),
                    "process_notes": extra.get("process_notes", "") if "process_notes" in extra else None},
        "answers": note.answers, "selected_models": note.selected_models,
        "safety_answer": note.safety_answer, "safety_detail": note.safety_detail,
        "safety_ack": ({"reason": note.safety_ack_reason, "at": note.safety_ack_at.isoformat(),
                        "by": _by(note.safety_ack_by)} if note.safety_ack_at else None),
        "alerts": [{"code": a.alert_code, "status": a.status} for a in (note.safety_alert, note.not_assessed_alert) if a],
        "detections": [{**d, "prompt": org.DETECTION_PROMPT, "resolution": resolutions.get(d["key"])} for d in found],
        "goal_suggestions": [g for g in org.goal_suggestions(context_goals(note.patient), note.answers or {})
                             if g["goal_index"] not in decided] if note.status == "DRAFT" else [],
        "goal_links": note.goal_links,
        "sections": sections, "sections_edited": note.sections_edited, "models_applied": note.models_applied,
        "generated_at": note.generated_at.isoformat() if note.generated_at else None,
        "accuracy_confirmed": note.accuracy_confirmed,
        "flags": flags(note),
        "blockers": blockers(note, found) if note.status == "DRAFT" else [],
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
