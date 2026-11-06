"""
Psychiatry module — the psychiatrist's own assessment workspace.

It is deliberately separate from the psychiatry *queue*: the queue is a
triage-driven waiting list, while this module lists every client the system
suggests for psychiatric review **or** who has a signed intake, and gives the
psychiatrist one place to record the assessment, MSE, ICD-11 diagnosis and
medication orders.

Stores (CLAUDE.md §4 — one store per clinical concept):
- assessment → `care_pathway.ProgressNote` of type PSYCHIATRY (the one note
  store); `data` keeps the structured capture behind the rendered note;
- MSE → `triage.MentalStatusExam` (the one MSE store), with structured findings
  retained in the note exactly as the intake retains them in its section;
- diagnosis → `clinical_encounter.DiagnosisCode`;
- medication → the existing prescribing module / PrescriptionItem store.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.clinical_encounter.models import Encounter
from apps.sysadmin_audit.audit import log_view
from apps.triage.models import MentalStatusExam

from . import intake as intake_service
from . import intake_schema, mental_state, psychiatric_review, records, services
from .models import (
    PRIORITY_ORDER,
    CareTask,
    ClinicalAlert,
    EpisodeOfCare,
    IntakeAssessment,
    ProgressNote,
    TriageEncounter,
)

NOTE_TYPE = "PSYCHIATRY"
FREE_TEXT = "FREE_TEXT"
STRUCTURED = "STRUCTURED"
FORMATS = (FREE_TEXT, STRUCTURED)
STRUCTURED_SECTIONS = (
    ("presenting_concern", "Presenting concern"),
    ("history", "History"),
    ("risk", "Risk"),
    ("formulation", "Formulation"),
    ("plan", "Plan"),
)
REVIEW_FOCUS_TYPES = ("PSYCHIATRIC_REVIEW_WITHDRAWAL", "URGENT_PSYCHIATRIC_REVIEW")
OPEN_TASK_STATUSES = ("INITIATED", "PENDING")


def _iso(value):
    return value.isoformat() if value else None


def _latest_note(patient, status=None):
    notes = ProgressNote.objects.filter(patient=patient, note_type=NOTE_TYPE)
    if status:
        notes = notes.filter(status=status)
    return notes.order_by("-created_at").first()


def _open_review(patient):
    return (
        CareTask.objects.filter(
            patient=patient,
            focus_type__in=REVIEW_FOCUS_TYPES,
            status__in=OPEN_TASK_STATUSES,
        )
        .order_by("-created_at")
        .first()
    )


def ensure_psychiatry_encounter(patient, user):
    """Return the open PSYCHIATRY encounter, opening the review if needed.

    A client reaches this module either from a signed triage or with a signed
    intake. The triage path uses the same review-opening workflow as the queue,
    so there is one psychiatric encounter per episode rather than a parallel
    one for the module.
    """
    episode = services.open_episode_for(patient) or services.get_or_open_episode(patient, user)
    active = (
        Encounter.objects.filter(
            patient=patient,
            episode=episode,
            encounter_type="PSYCHIATRY",
            status__in=("OPEN", "IN_PROGRESS"),
        )
        .order_by("-opened_at")
        .first()
    )
    if active:
        return active

    signed = services.latest_signed_triage(patient)
    if signed and signed.psychiatry_encounter_id:
        linked = signed.psychiatry_encounter
        if linked.status in ("OPEN", "IN_PROGRESS"):
            return linked
    if signed and signed.triage_version > 0 and signed.psychiatry_encounter_id is None:
        opened = services.open_psychiatry_review(signed, user)
        return opened.psychiatry_encounter

    now = timezone.now()
    encounter = Encounter.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        episode=episode,
        opened_by=user,
        encounter_type="PSYCHIATRY",
        status="IN_PROGRESS",
        opened_at=now,
    )
    if signed:
        # The previous review (if any) is closed; this encounter belongs to the
        # current episode. Keep the triage's link current without touching the
        # signed triage assessment itself.
        signed.psychiatry_encounter = encounter
        signed.psychiatry_review_started_at = now
        signed.save(
            update_fields=["psychiatry_encounter", "psychiatry_review_started_at", "updated_at"]
        )
        psychiatric_review.start(signed)
    if episode.status != "active":
        episode.transition("active", user=user, at=now)
    return encounter


def _assessment_state(note, user):
    if note is None:
        return None
    data = note.data or {}
    return {
        "id": str(note.pk),
        "status": note.status,
        "format": data.get("format") or STRUCTURED,
        "free_text": data.get("free_text") or "",
        "structured": data.get("structured") or {},
        "text": note.text,
        "author": services.user_display(note.author),
        "created_at": _iso(note.created_at),
        "updated_at": _iso(note.updated_at),
        "signed_at": _iso(note.signed_at),
        "can_edit": note.status == "DRAFT" and note.author_id == user.id,
    }


def _history_row(note):
    data = note.data or {}
    return {
        "id": str(note.pk),
        "format": data.get("format") or STRUCTURED,
        "text": note.text,
        "author": services.user_display(note.author),
        "signed_at": _iso(note.signed_at),
    }


def _mse_from_exam(exam):
    if exam is None:
        return {}
    keys = [key for key, _label, _opts in intake_schema.MSE_DOMAINS] + [
        "orientation",
        "attention",
        "reliability",
        "summary",
    ]
    return {key: getattr(exam, key, "") for key in keys if getattr(exam, key, "")}


def _workspace_state(patient, encounter, note, user):
    data = (note.data or {}) if note else {}
    exam = None
    linked_id = data.get("mse_exam_id") if note else None
    if linked_id:
        exam = MentalStatusExam.objects.filter(pk=linked_id, encounter=encounter).first()
    if exam is None:
        exam = MentalStatusExam.objects.filter(encounter=encounter).order_by("-recorded_at").first()
    if note is not None and isinstance(data.get("mse"), dict):
        mse = data["mse"]
    else:
        mse = _mse_from_exam(exam)
    return {
        "patient_id": str(patient.pk),
        "encounter_id": str(encounter.pk),
        "episode_id": str(encounter.episode_id) if encounter.episode_id else None,
        "assessment": _assessment_state(note, user),
        "mse": mse,
        "history": [
            _history_row(n)
            for n in ProgressNote.objects.filter(
                patient=patient, note_type=NOTE_TYPE, status="SIGNED"
            ).order_by("-signed_at")[:10]
        ],
        "review": psychiatric_review.row(_open_review(patient)),
    }


def open_workspace(patient, user):
    encounter = ensure_psychiatry_encounter(patient, user)
    note = _latest_note(patient, status="DRAFT")
    # Every read of the client's record is audited (CLAUDE.md §4,
    # 2026-11-06 item 9). This POST is the read — there is no GET patient_id
    # for the middleware to catch — so log the client, not only a draft note.
    log_view(patient)
    return _workspace_state(patient, encounter, note, user)


def _clean_structured(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError({"structured": "Structured assessment must be an object."})
    return {
        key: str(value.get(key) or "").strip()
        for key, _label in STRUCTURED_SECTIONS
        if key in value
    }


def _mse_text(mse):
    values = mental_state.exam_text(mse)
    labels = {key: label for key, label, _opts in intake_schema.MSE_DOMAINS}
    labels.update(
        {
            "orientation": "Orientation",
            "attention": "Attention",
            "reliability": "Reliability",
            "summary": "Summary",
        }
    )
    return "\n".join(
        f"{labels[key]}: {value}" for key, value in values.items() if value and value.strip()
    )


def _render_note(fmt, free_text, structured, mse):
    parts = ["Psychiatric assessment"]
    if fmt == FREE_TEXT:
        if free_text.strip():
            parts += ["", free_text.strip()]
    else:
        for key, label in STRUCTURED_SECTIONS:
            value = (structured.get(key) or "").strip()
            if value:
                parts += ["", label, value]
    mse_text = _mse_text(mse)
    if mse_text:
        parts += ["", "Mental state examination", mse_text]
    return "\n".join(parts).strip()


def _has_content(fmt, free_text, structured, mse):
    if fmt == FREE_TEXT and free_text.strip():
        return True
    if fmt == STRUCTURED and any(value.strip() for value in structured.values()):
        return True
    return any(value.strip() for value in mental_state.exam_text(mse).values())


def _save_mse(patient, encounter, user, mse, note=None):
    """Save this draft's MSE into the one MSE store, versioned per assessment.

    Each draft note owns one exam (`data["mse_exam_id"]`). The first save of a
    draft creates a new exam; later saves of the same draft update it. A new
    assessment after a signed one creates a new exam and leaves the signed one
    untouched — overwriting it would mutate a signed record (CLAUDE.md §3
    item 7, P0), which the intake mirror (`intake._sync_mse`) avoids by keeping
    the exam on the draft itself.
    """
    values = mental_state.exam_text(mse)
    exam = None
    exam_id = (note.data or {}).get("mse_exam_id") if note is not None else None
    if exam_id:
        exam = MentalStatusExam.objects.filter(pk=exam_id, encounter=encounter).first()
    if exam is None:
        if not any(value.strip() for value in values.values()):
            return None
        exam = MentalStatusExam.objects.create(
            organization_id=patient.organization_id,
            encounter=encounter,
            recorded_by=user,
            **values,
        )
    else:
        for key, value in values.items():
            setattr(exam, key, value)
        exam.recorded_by = user
        exam.recorded_at = timezone.now()
        exam.save()
    records.propose_from_mse(patient, exam, mse)
    return exam


@transaction.atomic
def _save(patient, user, data):
    encounter = ensure_psychiatry_encounter(patient, user)
    note = _latest_note(patient, status="DRAFT")
    if note is not None and note.author_id != user.id:
        raise PermissionDenied("Only the author can edit this draft assessment.")
    if note is None:
        note = ProgressNote.objects.create(
            organization_id=patient.organization_id,
            patient=patient,
            episode=encounter.episode,
            encounter=encounter,
            note_type=NOTE_TYPE,
            author=user,
        )

    fmt = data.get("format") or STRUCTURED
    if fmt not in FORMATS:
        raise ValidationError({"format": "Choose free text or structured format."})
    free_text = str(data.get("free_text") or "")
    structured = _clean_structured(data.get("structured"))
    mse = data.get("mse") or {}
    if not isinstance(mse, dict):
        raise ValidationError({"mse": "MSE must be an object."})
    intake_service._validate_mse(mse)

    exam = _save_mse(patient, encounter, user, mse, note)
    payload = dict(note.data or {})
    payload.update(
        {
            "format": fmt,
            "free_text": free_text,
            "structured": structured,
            "mse": mse,
        }
    )
    if exam is not None:
        payload["mse_exam_id"] = str(exam.pk)
    # When the MSE is cleared, the linked exam id carried in `note.data` is
    # kept as-is, so the next save updates the same row rather than creating
    # a second (empty) exam.
    note.data = payload
    note.text = _render_note(fmt, free_text, structured, mse)
    note.encounter = encounter
    note.episode = encounter.episode
    note.save()
    return note


def save_workspace(patient, user, data):
    note = _save(patient, user, data)
    return _workspace_state(patient, note.encounter, note, user)


@transaction.atomic
def sign_workspace(patient, user, data):
    note = _save(patient, user, data)
    payload = note.data or {}
    if not _has_content(
        payload.get("format") or STRUCTURED,
        str(payload.get("free_text") or ""),
        payload.get("structured") or {},
        payload.get("mse") or {},
    ):
        raise ValidationError({"detail": "Record the assessment or mental state before signing."})
    records.sign_note(note, user)
    return _workspace_state(patient, note.encounter, note, user)


def _candidate_reason(triage, intake, review, signed_note, source_at):
    if review is not None:
        return review.action_label
    if signed_note and signed_note.signed_at and source_at:
        if signed_note.signed_at >= source_at:
            return "Psychiatric assessment signed"
    if triage is not None:
        if triage.priority in ("RED", "ORANGE"):
            return "Triage recommended urgent psychiatric review"
        return "Triage recommended psychiatric review"
    if intake is not None:
        return "Intake complete — psychiatric assessment pending"
    return "No psychiatric assessment yet"


def candidates():
    """Clients the system suggests for review, plus everyone with a signed intake."""
    latest_triage = {}
    for te in (
        TriageEncounter.objects.filter(
            triage_version__gt=0,
            episode__status__in=EpisodeOfCare.OPEN_STATUSES,
            patient__archived_at__isnull=True,
        )
        .select_related("patient", "last_triaged_by")
        .order_by("last_triaged_at")
    ):
        latest_triage[te.patient_id] = te

    latest_intake = {}
    for intake in (
        IntakeAssessment.objects.filter(
            status=IntakeAssessment.STATUS_SIGNED,
            episode__status__in=EpisodeOfCare.OPEN_STATUSES,
            patient__archived_at__isnull=True,
        )
        .select_related("patient")
        .order_by("signed_at")
    ):
        latest_intake[intake.patient_id] = intake

    patient_ids = set(latest_triage) | set(latest_intake)
    if not patient_ids:
        return []

    notes = ProgressNote.objects.filter(patient_id__in=patient_ids, note_type=NOTE_TYPE).order_by(
        "-created_at"
    )
    latest_note = {}
    signed_note = {}
    for note in notes:
        latest_note.setdefault(note.patient_id, note)
        if note.status == "SIGNED":
            signed_note.setdefault(note.patient_id, note)

    reviews = {}
    for task in CareTask.objects.filter(
        patient_id__in=patient_ids,
        focus_type__in=REVIEW_FOCUS_TYPES,
        status__in=OPEN_TASK_STATUSES,
    ).order_by("created_at"):
        reviews[task.patient_id] = task

    alerts = {}
    for alert in ClinicalAlert.objects.filter(patient_id__in=patient_ids, status="ACTIVE").order_by(
        "raised_at"
    ):
        alerts.setdefault(alert.patient_id, []).append(alert.label)

    rows = []
    for patient_id in patient_ids:
        triage = latest_triage.get(patient_id)
        intake = latest_intake.get(patient_id)
        patient = triage.patient if triage else intake.patient
        note = latest_note.get(patient_id)
        signed = signed_note.get(patient_id)
        review = reviews.get(patient_id)
        source_at = max(
            (
                value
                for value in (triage and triage.last_triaged_at, intake and intake.signed_at)
                if value
            ),
            default=None,
        )
        reviewed_after_source = bool(
            signed and signed.signed_at and source_at and signed.signed_at >= source_at
        )
        suggested = bool(review or (source_at and not reviewed_after_source))
        data = (note.data or {}) if note else {}
        rows.append(
            {
                "patient_id": str(patient.pk),
                "name": patient.get_full_name(),
                "citramac_number": patient.citramac_number,
                "mrn": patient.uhid_number,
                "age": patient.age_years,
                "sex": patient.gender,
                "priority": triage.priority if triage else "",
                "episode_id": str((triage.episode_id if triage else intake.episode_id) or ""),
                "presenting_concern": (
                    (triage.presenting_concern if triage else "")
                    or (intake.presenting_concern if intake else "")
                ),
                "last_triaged_at": _iso(triage.last_triaged_at) if triage else None,
                "intake_complete": intake is not None,
                "intake_signed_at": _iso(intake.signed_at) if intake else None,
                "suggested": suggested,
                "suggested_reason": _candidate_reason(triage, intake, review, signed, source_at),
                "review": psychiatric_review.row(review),
                "assessment_id": str(note.pk) if note else None,
                "assessment_status": note.status if note else "",
                "assessment_format": data.get("format") or "",
                "assessment_updated_at": _iso(note.updated_at) if note else None,
                "assessment_signed_at": _iso(signed.signed_at) if signed else None,
                "alerts": alerts.get(patient_id, []),
            }
        )
    return sorted(
        rows,
        key=lambda row: (
            not row["suggested"],
            PRIORITY_ORDER.get(row["priority"], 9),
            (row["name"] or "").lower(),
        ),
    )
