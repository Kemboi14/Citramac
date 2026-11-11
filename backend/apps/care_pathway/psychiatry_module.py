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
from django.utils.dateparse import parse_date
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
    LocalConcept,
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
    ("risk", "Clinical Risk Assessment"),
    ("formulation", "Formulation"),
    ("plan", "Plan"),
)
# The structured assessment requires a clinical risk statement before signing.
REQUIRED_TO_SIGN = (("risk", "Risk"),)
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


def _risk_has_content(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        rows = value.get("rows") or {}
        if isinstance(rows, dict) and any(
            isinstance(row_values, list) and any(str(item).strip() for item in row_values)
            for row_values in rows.values()
        ):
            return True
        for key in (
            "other",
            "details",
            "static",
            "dynamic",
            "protective",
            "change_72h",
            "summary",
            "plan",
        ):
            entry = value.get(key)
            if isinstance(entry, str) and entry.strip():
                return True
        if value.get("actions"):
            return True
        return False
    return bool(str(value).strip())


def _clean_structured(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError({"structured": "Structured assessment must be an object."})
    cleaned = {}
    for key, _label in STRUCTURED_SECTIONS:
        if key not in value:
            continue
        entry = value.get(key)
        if key == "risk":
            if entry is None:
                continue
            if isinstance(entry, str):
                cleaned[key] = entry.strip()
            elif isinstance(entry, dict):
                rows = entry.get("rows") or {}
                clean_rows = {}
                if isinstance(rows, dict):
                    for row_key, row_values in rows.items():
                        if isinstance(row_values, list):
                            clean_rows[row_key] = [
                                str(v).strip() for v in row_values if str(v).strip()
                            ]
                clean = {"rows": clean_rows}
                for field in ("static", "dynamic", "protective", "change_72h", "summary"):
                    if field in entry and isinstance(entry.get(field), str):
                        clean[field] = entry[field].strip()
                has_risk_content = bool(
                    any(row_values for row_values in clean.get("rows", {}).values())
                    or any(
                        clean.get(field)
                        for field in ("static", "dynamic", "protective", "change_72h", "summary")
                    )
                )
                if has_risk_content:
                    cleaned[key] = clean
                elif isinstance(entry.get("text"), str) and entry.get("text").strip():
                    cleaned[key] = entry["text"].strip()
            else:
                cleaned[key] = str(entry).strip()
        else:
            cleaned[key] = str(entry or "").strip()
    if "risk" in value:
        cleaned["risk"] = _clean_risk(value["risk"])
    return cleaned


def _clean_risk(value):
    if value is None:
        return {"rows": {}}
    if isinstance(value, str):
        return {"summary": value.strip(), "rows": {}}
    if not isinstance(value, dict):
        raise ValidationError(
            {"structured": {"risk": "Clinical risk assessment must be an object."}}
        )

    raw_rows = value.get("rows") or {}
    if not isinstance(raw_rows, dict):
        raise ValidationError({"structured": {"risk": {"rows": "Risk rows must be an object."}}})
    rows = {}
    row_specs = {row["key"]: row for row in intake_schema.RISK_ROWS}
    for row_key, selections in raw_rows.items():
        spec = row_specs.get(row_key)
        if spec is None:
            raise ValidationError(
                {"structured": {"risk": {"rows": f"Unknown risk row: {row_key}."}}}
            )
        if not isinstance(selections, list):
            raise ValidationError(
                {"structured": {"risk": {"rows": f"Selections for {row_key} must be a list."}}}
            )
        selected = [str(item).strip() for item in selections if str(item).strip()]
        invalid = set(selected) - set(spec["options"])
        if invalid:
            raise ValidationError(
                {
                    "structured": {
                        "risk": {
                            "rows": (
                                f"Unknown selection(s) for {row_key}: "
                                f"{', '.join(sorted(invalid))}."
                            )
                        }
                    }
                }
            )
        if spec.get("single") and len(set(selected)) > 1:
            raise ValidationError(
                {"structured": {"risk": {"rows": f"Choose only one option for {row_key}."}}}
            )
        if set(selected) & set(spec["none"]) and set(selected) & set(spec["active"]):
            raise ValidationError(
                {
                    "structured": {
                        "risk": {
                            "rows": (
                                f"A 'none' option cannot be combined with active "
                                f"{row_key} risks."
                            )
                        }
                    }
                }
            )
        rows[row_key] = list(dict.fromkeys(selected))

    clean = {"rows": rows}
    for field in (
        "other",
        "details",
        "static",
        "dynamic",
        "protective",
        "change_72h",
        "summary",
        "plan",
        "review_by",
    ):
        item = value.get(field, "")
        if item is not None and not isinstance(item, str):
            raise ValidationError({"structured": {"risk": {field: "Enter text for this field."}}})
        clean[field] = item.strip() if isinstance(item, str) else ""
    if clean["review_by"] and parse_date(clean["review_by"]) is None:
        raise ValidationError({"structured": {"risk": {"review_by": "Enter a valid review date."}}})

    actions = value.get("actions") or []
    if not isinstance(actions, list) or not all(isinstance(item, str) for item in actions):
        raise ValidationError(
            {"structured": {"risk": {"actions": "Actions must be a list of codes."}}}
        )
    valid_actions = set(
        LocalConcept.objects.filter(valueset_id="intake-risk-actions", active=True).values_list(
            "code", flat=True
        )
    )
    if set(actions) - valid_actions:
        raise ValidationError(
            {"structured": {"risk": {"actions": "Choose actions from the served list."}}}
        )
    clean["actions"] = list(dict.fromkeys(actions))

    concern_level = value.get("concern_level") or ""
    if not isinstance(concern_level, str):
        raise ValidationError(
            {"structured": {"risk": {"concern_level": "Choose a level from the served list."}}}
        )
    if (
        concern_level
        and not LocalConcept.objects.filter(
            valueset_id="intake-concern-level", code=concern_level, active=True
        ).exists()
    ):
        raise ValidationError(
            {"structured": {"risk": {"concern_level": "Choose a level from the served list."}}}
        )
    clean["concern_level"] = concern_level
    signature = value.get("formulation_signed_at")
    if signature is not None and not isinstance(signature, str):
        raise ValidationError(
            {"structured": {"risk": {"formulation_signed_at": "Invalid formulation signature."}}}
        )
    clean["formulation_signed_at"] = signature or ""
    return clean


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


def _risk_to_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return str(value).strip()
    rows = value.get("rows") or {}
    if isinstance(rows, dict):
        parts = []
        for row in intake_schema.RISK_ROWS:
            row_key = row["key"]
            selected = rows.get(row_key) or []
            if selected:
                parts.append(f"{row['label']}: {', '.join(str(item) for item in selected)}")
        for field in (
            "other",
            "details",
            "static",
            "dynamic",
            "protective",
            "change_72h",
            "summary",
            "plan",
            "review_by",
        ):
            item = value.get(field)
            if isinstance(item, str) and item.strip():
                label = {
                    "other": "Other acute risk",
                    "details": "Immediate actions already taken",
                    "static": "Static factors",
                    "dynamic": "Dynamic factors",
                    "protective": "Protective factors",
                    "change_72h": "What could change in the next 24-72 hours?",
                    "summary": "Structured risk formulation",
                    "plan": "Risk management plan",
                    "review_by": "Review by",
                }.get(field, field)
                parts.append(f"{label}: {item.strip()}")
        actions = value.get("actions") or []
        if actions:
            labels = {
                concept.code: concept.display
                for concept in LocalConcept.objects.filter(
                    valueset_id="intake-risk-actions", code__in=actions
                )
            }
            parts.append("Actions: " + ", ".join(labels.get(code, code) for code in actions))
        concern_level = value.get("concern_level")
        if concern_level:
            display = (
                LocalConcept.objects.filter(valueset_id="intake-concern-level", code=concern_level)
                .values_list("display", flat=True)
                .first()
            )
            parts.append(f"Level of concern: {display or concern_level}")
        return "\n".join(parts)
    return str(value).strip()


def _render_note(fmt, free_text, structured, mse):
    parts = ["Psychiatric assessment"]
    if fmt == FREE_TEXT:
        if free_text.strip():
            parts += ["", free_text.strip()]
    else:
        for key, label in STRUCTURED_SECTIONS:
            value = structured.get(key)
            if key == "risk":
                rendered = _risk_to_text(value)
            else:
                rendered = (value or "").strip() if isinstance(value, str) else ""
            if rendered:
                parts += ["", label, rendered]
    mse_text = _mse_text(mse)
    if mse_text:
        parts += ["", "Mental state examination", mse_text]
    return "\n".join(parts).strip()


def _missing_to_sign(fmt, free_text, structured):
    """What the assessment still needs before it can be signed. The MSE has its
    own store and does not stand in for the assessment itself."""
    if fmt == FREE_TEXT:
        return [] if free_text.strip() else ["the assessment narrative"]
    missing = []
    for key, label in REQUIRED_TO_SIGN:
        if key == "risk":
            if not _risk_has_content(structured.get(key)):
                missing.append(label)
        elif not (structured.get(key) or "").strip():
            missing.append(label)
    return missing


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
    raw_structured = data.get("structured")
    previous_risk = (
        ((note.data or {}).get("structured") or {}).get("risk")
        if isinstance((note.data or {}).get("structured"), dict)
        else {}
    )
    formulation_sign = None
    if isinstance(raw_structured, dict) and isinstance(raw_structured.get("risk"), dict):
        raw_structured = dict(raw_structured)
        risk_payload = dict(raw_structured["risk"])
        formulation_sign = intake_service._pop_formulation_signature(
            risk_payload, previous_risk if isinstance(previous_risk, dict) else {}
        )
        raw_structured["risk"] = risk_payload
    structured = _clean_structured(raw_structured)
    if fmt == STRUCTURED and "risk" in structured:
        risk = structured["risk"]
        if formulation_sign is None and isinstance(previous_risk, dict):
            risk["formulation_signed_at"] = previous_risk.get("formulation_signed_at", "")
            risk["formulation_signed_by"] = previous_risk.get("formulation_signed_by", "")
        elif formulation_sign is not None:
            intake_service._apply_formulation_signature(risk, user, formulation_sign)
    # Only the chosen format's content is kept. Text from the other format
    # would sit in `data` without appearing in the rendered note, so a signed
    # record would carry content its text does not show.
    if fmt == FREE_TEXT:
        structured = {}
    else:
        free_text = ""
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
    missing = _missing_to_sign(
        payload.get("format") or STRUCTURED,
        str(payload.get("free_text") or ""),
        payload.get("structured") or {},
    )
    if missing:
        raise ValidationError(
            {"detail": f"Record {' and '.join(missing)} before signing the assessment."}
        )
    note = records.sign_note(note, user)
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
