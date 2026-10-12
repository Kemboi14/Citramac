"""
Intake & Clinical Assessment service (mockup v4 stage 3).

Lifecycle: a DRAFT is created (cloned from the latest signed version, or fresh
with triage carry-forward) and autosaved; `sign_intake` validates and locks it.
A signed intake is never edited — a correction is a new version
(CLAUDE.md §3 item 7: no re-authoring of signed records).

Carry-forward (core workflow rule): what Registration and Triage already
captured is pre-populated *with its source*, and the clinician confirms or
updates it — it is never re-asked.
"""

import copy

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.triage.models import MentalStatusExam

from . import intake_schema as schema
from .models import IntakeAssessment, MedicationHistoryEntry, OutcomeScore, TriageAssessment

MSE_FIELDS = [key for key, _label, _opts in schema.MSE_DOMAINS] + [
    "orientation",
    "attention",
    "reliability",
    "summary",
]


def can_view_restricted(user):
    """Restricted fields (trauma detail) reach treating clinicians only."""
    from django.conf import settings
    from django.db.models import Q

    if not (user and user.is_authenticated) or user.is_superuser:
        return False
    query = Q()
    for name in settings.INTAKE_RESTRICTED_VIEW_ROLES:
        query |= Q(name__iexact=name)
    return user.roles.filter(query).exists()


def latest_signed(patient):
    return (
        IntakeAssessment.objects.filter(patient=patient, status=IntakeAssessment.STATUS_SIGNED)
        .order_by("-version", "-created_at")
        .first()
    )


def current_draft(patient):
    return IntakeAssessment.objects.filter(
        patient=patient, status=IntakeAssessment.STATUS_DRAFT
    ).first()


def _latest_signed_triage(patient):
    return (
        TriageAssessment.objects.filter(
            triage_encounter__patient=patient, status="COMPLETED"
        )
        .order_by("-signed_at")
        .first()
    )


def triage_risk_items(answers):
    """[(row, option)] the triage answers imply — each starts unconfirmed."""
    items = []

    def add(row, option):
        if (row, option) not in items:
            items.append((row, option))

    if answers.get("d_suicidal") == "yes":
        add("suicide", "Thoughts")
        if answers.get("d_act_now") == "yes":
            add("suicide", "Intent")
        if answers.get("d_attempt") == "yes":
            add("suicide", "Recent attempt/self-harm")
        if answers.get("d_means") == "yes":
            add("suicide", "Access to means")
    if answers.get("e_thoughts") == "yes":
        add("violence", "Thoughts")
    if answers.get("e_behaviour") == "yes":
        add("violence", "Threats")
    if answers.get("e_act") == "yes":
        add("violence", "Recent violence")
    if answers.get("e_means") == "yes":
        add("violence", "Access to means")
    if answers.get("i_flags") or answers.get("i_safe") == "no":
        add("safeguarding", "Abuse" if "abuse" in (answers.get("i_flags") or []) else "Neglect")
    if answers.get("j_concern") == "yes":
        add("neglect", "Difficulty with self-care")
    return items


def _fresh_sections(patient):
    sections = {key: {} for key in schema.SECTION_KEYS}
    state = {}
    signed = _latest_signed_triage(patient)
    if signed:
        te = signed.triage_encounter
        provenance = {
            "stage": "Triage",
            "version": signed.version,
            "at": signed.signed_at.isoformat() if signed.signed_at else "",
            "by": signed.signed_by.get_full_name() if signed.signed_by_id else "",
        }
        concern = (signed.answers.get("c_concern") or te.presenting_concern or "").strip()
        if concern:
            sections["pres"]["own"] = concern
            sections["pres"]["_sources"] = {"own": provenance}
        sections["risk"]["rows"] = {}
        sections["risk"]["carried"] = {}
        for row, option in triage_risk_items(signed.answers):
            sections["risk"]["rows"].setdefault(row, []).append(option)
            sections["risk"]["carried"][f"{row}:{option}"] = {**provenance, "confirmed": False}
        informant = signed.answers.get("b_informant")
        sections["hdr"]["sources"] = ["CLIENT"] if informant in (None, "", "client") else ["FAMILY_OTHER"]
    if patient.referral_source and patient.referral_source != "Self-presented":
        sections["pres"]["referral_source"] = patient.referral_source
    return sections, state


@transaction.atomic
def open_draft(patient, user):
    """The editable version. Existing draft wins; else clone the latest signed
    one as version+1 (nothing is re-asked); else start fresh from triage."""
    draft = current_draft(patient)
    if draft:
        return draft
    previous = latest_signed(patient)
    if previous:
        sections = copy.deepcopy(previous.sections)
        state = copy.deepcopy(previous.section_state)
        version = previous.version + 1
    else:
        sections, state = _fresh_sections(patient)
        version = 1
    from . import services

    episode = services.get_or_open_episode(patient, user)
    encounter = services.clinical_encounter_for(patient, episode, user)
    return IntakeAssessment.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        episode=episode,
        encounter=encounter,
        author=user,
        version=version,
        status=IntakeAssessment.STATUS_DRAFT,
        sections=sections,
        section_state=state,
        current_section=previous.current_section if previous else "pres",
    )


def _validate_payload(sections, section_state):
    for key in sections or {}:
        if key not in schema.SECTION_KEYS:
            raise ValidationError({"sections": f"Unknown section “{key}”."})
        if not isinstance(sections[key], dict):
            raise ValidationError({"sections": f"Section “{key}” must be an object."})
    for key, value in (section_state or {}).items():
        if key not in schema.SECTION_KEYS:
            raise ValidationError({"section_state": f"Unknown section “{key}”."})
        if value not in schema.SECTION_STATES:
            raise ValidationError({"section_state": f"Unknown state “{value}”."})


@transaction.atomic
def save_draft(draft, user, data):
    if draft.status != IntakeAssessment.STATUS_DRAFT:
        raise ValidationError({"detail": "A signed intake cannot be edited — start a new version."})
    sections = data.get("sections") or {}
    section_state = data.get("section_state") or {}
    _validate_payload(sections, section_state)
    merged = copy.deepcopy(draft.sections)
    for key, payload in sections.items():
        merged.setdefault(key, {}).update(payload)
    draft.sections = merged
    state = dict(draft.section_state)
    state.update(section_state)
    draft.section_state = state
    if data.get("current_section") in schema.SECTION_KEYS:
        draft.current_section = data["current_section"]
    _sync_mse(draft, user)
    _mirror_legacy_columns(draft)
    draft.save()
    return draft


def _sync_mse(draft, user):
    values = {k: (draft.sections.get("mse", {}).get(k) or "") for k in MSE_FIELDS}
    if not any(values.values()):
        return
    if draft.mse_id:
        exam = draft.mse
        for key, value in values.items():
            setattr(exam, key, value)
        exam.save()
    else:
        draft.mse = MentalStatusExam.objects.create(
            organization_id=draft.organization_id,
            encounter=draft.encounter,
            recorded_by=user,
            **values,
        )
    from . import records

    records.propose_from_mse(draft.patient, draft.mse)


def _mirror_legacy_columns(draft):
    """Keep the one-shot columns other readers use (snapshot, export) in step."""
    s = draft.sections
    draft.presenting_concern = s.get("pres", {}).get("own", "")
    draft.history = s.get("sx", {}).get("hpi", "")
    draft.symptoms = s.get("sx", {}).get("list", []) or []
    draft.formulation = s.get("form", {}).get("summary", "")
    draft.care_needs = s.get("impr", {}).get("needs", []) or []
    draft.risk_notes = s.get("risk", {}).get("summary", "")
    level = s.get("risk", {}).get("concern_level", "")
    draft.risk_level = {"LOW": "LOW", "MODERATE": "MODERATE", "HIGH": "HIGH"}.get(level, "")


# ── completeness ──


def risk_rows_active(sections):
    rows = sections.get("risk", {}).get("rows", {}) or {}
    active = []
    for spec in schema.RISK_ROWS:
        chosen = rows.get(spec["key"], []) or []
        if any(option in spec["active"] for option in chosen):
            active.append(spec["key"])
    return active


def outstanding_items(draft):
    """Required items still missing for a COMPLETE signature (mockup intakeMissing)."""
    s = draft.sections
    state = draft.section_state
    patient = draft.patient
    missing = []
    if not str(s.get("pres", {}).get("own", "")).strip():
        missing.append("Section 1 Presenting concern in the client’s own words")
    risk = s.get("risk", {})
    carried = risk.get("carried", {}) or {}
    if any(not v.get("confirmed") for v in carried.values()):
        missing.append("Section 3 Confirm or clear each carried-forward triage finding")
    if risk_rows_active(s) and not risk.get("formulation_signed_at"):
        missing.append("Section 3 Sign the structured risk formulation")
    elif risk_rows_active(s):
        required = ["static", "dynamic", "protective", "change_72h", "summary"]
        if any(not str(risk.get(k, "")).strip() for k in required):
            missing.append("Section 3 Complete the structured risk formulation")
    meds = s.get("meds", {})
    has_meds = MedicationHistoryEntry.objects.filter(
        patient=patient, superseded_at__isnull=True
    ).exists()
    if not (has_meds or meds.get("none") or meds.get("unavailable")):
        missing.append("Section 5 Medication list — or tick ‘no current medication’")
    if patient.allergy_status == "UNKNOWN":
        missing.append("Section 6 Allergy status (or ‘no known allergies’)")
    elif patient.allergy_records.filter(verification_status="UNCONFIRMED").exists():
        missing.append("Section 6 Confirm the client-reported allergy record")
    mse = s.get("mse", {})
    if not (str(mse.get("mood", "")).strip() and str(mse.get("thought_content", "")).strip()):
        missing.append("Section 16 MSE — at least mood and thought content")
    from apps.clinical_encounter.models import DiagnosisCode

    from . import tools

    # A diagnosis is always an ICD-11 coded record (CLAUDE.md §5: no coded
    # clinical concept as free text); the Diagnosis tab writes it.
    if not DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE").exists():
        missing.append("Section 19 At least one coded working diagnosis (provisional is fine)")
    undecided = tools.recommended_undecided(patient)
    if undecided:
        missing.append(
            "Section 20 Accept or decline recommended tools: " + ", ".join(t["key"] for t in undecided)
        )
    return missing


def section_overview(draft):
    return {
        key: draft.section_state.get(key, "Not started") for key in schema.SECTION_KEYS
    }


@transaction.atomic
def sign_intake(draft, user, completeness, data=None):
    if draft.status != IntakeAssessment.STATUS_DRAFT:
        raise ValidationError({"detail": "This intake is already signed."})
    if completeness not in dict(IntakeAssessment.COMPLETENESS_CHOICES):
        raise ValidationError({"completeness": "Choose the intake status."})
    close = draft.sections.get("close", {})
    outstanding = outstanding_items(draft)
    if completeness == "COMPLETE" and outstanding:
        raise ValidationError(
            {
                "outstanding": outstanding,
                "completeness": "Cannot be signed as complete — items are outstanding. "
                "Choose ‘Partially complete’ if it is clinically safe to continue later.",
            }
        )
    if completeness != "COMPLETE":
        if not str(close.get("reason_incomplete", "")).strip():
            raise ValidationError({"reason_incomplete": "Give the reason the intake is incomplete."})
        if not str(close.get("message", "")).strip():
            raise ValidationError(
                {"message": "Write a handover message so the next clinician can continue."}
            )
    draft.status = IntakeAssessment.STATUS_SIGNED
    draft.completeness = completeness
    draft.outstanding = outstanding
    draft.signed_at = timezone.now()
    draft.signed_by = user
    _mirror_legacy_columns(draft)
    draft.save()
    return draft


def record_score(patient, user, instrument, score, intake=None):
    return OutcomeScore.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        instrument=instrument,
        score=score,
        source_intake=intake,
        recorded_by=user,
    )
