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

from apps.accounts.access import has_permission
from apps.triage.models import MentalStatusExam

from . import intake_schema as schema
from . import mental_state
from .models import IntakeAssessment, MedicationHistoryEntry, OutcomeScore, TriageAssessment


def can_view_restricted(user):
    """Restricted fields (trauma detail) reach treating clinicians only — roles
    with the clinical.restricted_content.view permission."""
    return has_permission(user, "clinical.restricted_content.view")


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


# Triage safeguarding codes → intake risk-register (row, option), following the v4 mockup's
# triageRiskItems(). ASSUMPTION: domestic violence and threat/coercion are recorded as "Abuse";
# "other" is not mapped (the clinician sees it in the carried triage summary).
SAFEGUARDING_FLAG_ITEMS = {
    "abuse": ("safeguarding", "Abuse"),
    "domestic_violence": ("safeguarding", "Abuse"),
    "threat_coercion": ("safeguarding", "Abuse"),
    "neglect": ("safeguarding", "Neglect"),
    "sexual_violence": ("safeguarding", "Sexual violence/exploitation"),
    "child_safeguarding": ("safeguarding", "Child concern"),
    "vulnerable_adult": ("safeguarding", "Elder/vulnerable adult concern"),
    "financial_exploitation": ("neglect", "Exploitation/vulnerability concern"),
    "unsafe_environment": ("neglect", "Exploitation/vulnerability concern"),
}
TELEPHONE_MEDICAL_FLAGS = {"seizure", "loss_consciousness", "serious_injury"}


def triage_risk_items(answers):
    """[(row, option)] the triage answers imply — each starts unconfirmed."""
    items = []

    def add(row, option):
        if (row, option) not in items:
            items.append((row, option))

    if answers.get("schema") == "v4":
        return _triage_v4_risk_items(answers, add, items)
    if answers.get("b_present") == "no":
        # Telephone / third-party screen: only what the informant reported.
        reported = set(answers.get("k_flags") or [])
        if "suicide_concern" in reported:
            add("suicide", "Thoughts")
        if "recent_attempt" in reported:
            add("suicide", "Recent attempt/self-harm")
        if "access_to_means" in reported:
            add("suicide", "Access to means")
        if "risk_to_other" in reported:
            add("violence", "Threats")
        if reported & TELEPHONE_MEDICAL_FLAGS:
            add("medical", "Concern identified")
        return items

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
    for flag in answers.get("i_flags") or []:
        if flag in SAFEGUARDING_FLAG_ITEMS:
            add(*SAFEGUARDING_FLAG_ITEMS[flag])
    if answers.get("i_safe") == "no":
        add("neglect", "Exploitation/vulnerability concern")
    if answers.get("j_concern") == "yes":
        add("neglect", "Difficulty with self-care")
    if answers.get("h_concern") == "yes" or [f for f in answers.get("h_flags") or [] if f != "other"]:
        add("medical", "Concern identified")
    # v5 (the triage spec) uses the v3 keys above, plus the duty-to-protect step.
    if answers.get("e_named") == "yes":
        add("violence", "Intent")
    return items


V4_MEDICAL_FLAGS = {
    "altered_consciousness", "head_injury", "seizure", "catatonia", "nms_serotonin",
    "major_medical", "lithium_toxicity", "clozapine",
}


def _triage_v4_risk_items(answers, add, items):
    """v4 triage answers (triage_v4.py) → risk-register items, following the v4
    mockup's triageRiskItems() line for line."""
    if answers.get("b_present") == "no":
        suicide = answers.get("r_suicide")
        if suicide == "talked":
            add("suicide", "Thoughts")
        if suicide == "recent_attempt":
            add("suicide", "Recent attempt/self-harm")
        if answers.get("r_means") == "yes":
            add("suicide", "Access to means")
        if answers.get("r_harm_others") == "threatened":
            add("violence", "Threats")
        if answers.get("r_harm_others") == "attempted":
            add("violence", "Recent violence")
        if set(answers.get("r_medical") or []) & {
            "seizures", "loss_consciousness", "serious_injury", "acute_medical"
        }:
            add("medical", "Concern identified")
        return items
    suic = answers.get("suic") or "none"
    if suic in ("passive", "active", "plan", "intent"):
        add("suicide", "Thoughts")
    if suic in ("plan", "intent"):
        add("suicide", "Plan")
    if suic == "intent":
        add("suicide", "Intent")
    if (answers.get("selfharm") or "none") != "none":
        add("suicide", "Recent attempt/self-harm")
    flags = set(answers.get("flags") or [])
    if flags & {"recent_attempt", "overdose"}:
        add("suicide", "Recent attempt/self-harm")
    if "lethal_means" in flags:
        add("suicide", "Access to means")
    if "threatening_others" in flags:
        add("violence", "Threats")
    if "homicidal_named" in flags:
        add("violence", "Thoughts")
        add("violence", "Intent")
    if "postpartum" in flags:
        add("violence", "Thoughts")
        add("safeguarding", "Child concern")
    if "leaving_care" in flags:
        add("absconding", "Possible")
    if "self_care" in flags:
        add("neglect", "Difficulty with self-care")
    if "safeguarding" in flags or answers.get("feel_safe") == "no":
        add("neglect", "Exploitation/vulnerability concern")
    if "gbv_72h" in flags:
        add("safeguarding", "Sexual violence/exploitation")
    if "child_protection" in flags:
        add("safeguarding", "Child concern")
    if flags & V4_MEDICAL_FLAGS:
        add("medical", "Concern identified")
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
    if "mse" in (sections or {}):
        _validate_mse(sections["mse"])
    if "substances" in (sections or {}).get("subs", {}):
        _validate_substances(sections["subs"]["substances"])


def _validate_substances(cards):
    """INT-08-01: one card per substance, each a code of `intake-substance-rows`."""
    from .models import LocalConcept

    if not isinstance(cards, list) or not all(isinstance(c, dict) for c in cards):
        raise ValidationError({"subs": "Substance cards must be a list."})
    picked = [str(c.get("substance") or "") for c in cards]
    if len(set(picked)) != len(picked):
        raise ValidationError({"subs": "Each substance has one card."})
    known = set(
        LocalConcept.objects.filter(valueset_id="intake-substance-rows").values_list("code", flat=True)
    )
    unknown = [code for code in picked if code not in known]
    if unknown:
        raise ValidationError({"subs": f"Unknown substance(s): {', '.join(unknown) or 'blank'}."})


def _validate_mse(mse):
    """Structured MSE findings must be codes of the domain's served value set (INT-16)."""
    from .models import LocalConcept

    wanted = []
    findings = mse.get("findings")
    if findings is not None:
        if not isinstance(findings, dict):
            raise ValidationError({"mse": "MSE findings must be an object of domain → codes."})
        coded = {key for key, _label, opts in schema.MSE_DOMAINS if opts}
        for domain, picked in findings.items():
            if domain not in coded:
                raise ValidationError({"mse": f"Unknown MSE domain “{domain}”."})
            if not isinstance(picked, list) or not all(isinstance(c, str) for c in picked):
                raise ValidationError({"mse": f"MSE {domain}: send a list of codes."})
            wanted += [(mental_state.valueset_for(domain), c) for c in picked]
    for field, _sphere in mental_state.ORIENTATION_SPHERES:
        if mse.get(field):
            wanted.append(("intake-orientation", mse[field]))
    if not wanted:
        return
    # Retired concepts still validate: a draft may carry a code retired since it was picked.
    known = set(
        LocalConcept.objects.filter(valueset_id__in={vs for vs, _c in wanted}).values_list(
            "valueset_id", "code"
        )
    )
    unknown = [code for vs, code in wanted if (vs, code) not in known]
    if unknown:
        raise ValidationError({"mse": f"Unknown MSE code(s): {', '.join(unknown)}."})


@transaction.atomic
def save_draft(draft, user, data):
    if draft.status != IntakeAssessment.STATUS_DRAFT:
        raise ValidationError({"detail": "A signed intake cannot be edited — start a new version."})
    sections = data.get("sections") or {}
    section_state = data.get("section_state") or {}
    _validate_payload(sections, section_state)
    for key, value in section_state.items():
        # A required section cannot be set aside (a state stored before this rule is left as it is).
        if value == "Not applicable" and key in schema.REQUIRED_SECTIONS and draft.section_state.get(key) != value:
            raise ValidationError({"section_state": f"Section “{key}” is required — it cannot be set aside."})
    previous_risk = copy.deepcopy(draft.sections.get("risk", {}))
    sign_formulation = _pop_formulation_signature(sections.get("risk"), previous_risk)
    merged = copy.deepcopy(draft.sections)
    for key, payload in sections.items():
        merged.setdefault(key, {}).update(payload)
    if sign_formulation is not None:
        _apply_formulation_signature(merged.setdefault("risk", {}), user, sign_formulation)
    _stamp_resolved_carried(merged.get("risk", {}), previous_risk, user)
    _link_past_history(merged)
    _drop_hidden(merged)
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


FORMULATION_REQUIRED = ["static", "dynamic", "protective", "change_72h", "summary"]


def _pop_formulation_signature(risk_payload, previous_risk):
    """The client may only *request* a signature (truthy) or clear it (falsy);
    the signer and time are always set by the server (CLAUDE.md §4 provenance).
    Returns None when the payload leaves the signature as it is — including an
    autosave echoing back the stored signature time."""
    if not isinstance(risk_payload, dict):
        return None
    risk_payload.pop("formulation_signed_by", None)
    if "formulation_signed_at" not in risk_payload:
        return None
    requested = risk_payload.pop("formulation_signed_at")
    if requested and requested == previous_risk.get("formulation_signed_at"):
        return None
    return bool(requested)


def _apply_formulation_signature(risk, user, sign):
    if not sign:
        risk["formulation_signed_at"] = ""
        risk["formulation_signed_by"] = ""
        return
    if any(not str(risk.get(key, "")).strip() for key in FORMULATION_REQUIRED):
        raise ValidationError(
            {"risk": "Complete static, dynamic, protective, next 24–72 h and the summary before signing."}
        )
    risk["formulation_signed_at"] = timezone.now().isoformat()
    risk["formulation_signed_by"] = _user_name(user)


def _stamp_resolved_carried(risk, previous_risk, user):
    """Carried triage findings marked 'not present now' keep who resolved them and when.
    The first stamp is kept; later autosaves can't change it."""
    previous = previous_risk.get("carried") or {}
    for key, entry in (risk.get("carried") or {}).items():
        if not entry.get("not_present"):
            entry.pop("resolved_at", None)
            entry.pop("resolved_by", None)
            continue
        earlier = previous.get(key) or {}
        if earlier.get("not_present") and earlier.get("resolved_at"):
            entry["resolved_at"] = earlier["resolved_at"]
            entry["resolved_by"] = earlier.get("resolved_by", "")
        else:
            entry["resolved_at"] = timezone.now().isoformat()
            entry["resolved_by"] = _user_name(user)


def _drop_hidden(sections):
    """A field shown only for certain answers is not kept once hidden (X-08), e.g.
    harm-reduction prompts after injecting is changed to "No"."""
    for spec in schema.SECTIONS:
        values = sections.get(spec["key"])
        if not values:
            continue
        for field in spec["fields"]:
            rule = field.get("show_when")
            if rule and field["key"] in values and values.get(rule["field"]) not in rule["in"]:
                del values[field["key"]]


# INT-04-07 / 04-08: a past attempt or past violence is linked to the risk history
# object (Section 3 "Past history"), not kept as separate text.
PAST_HISTORY_LINKS = {"past_attempts": "suicide", "past_violence": "violence"}
PAST_HISTORY = "Past history"


def _link_past_history(sections):
    """Section 4 'Yes' puts "Past history" on the risk row; 'None' takes it off again,
    but only when this link put it there (a clinician's own tick stays)."""
    history = sections.get("mh", {})
    risk = sections.get("risk", {})
    linked = risk.get("linked") or {}
    for field, row in PAST_HISTORY_LINKS.items():
        key = f"{row}:{PAST_HISTORY}"
        chosen = (risk.get("rows") or {}).get(row) or []
        if history.get(field) == schema._code("Yes"):
            if PAST_HISTORY not in chosen:
                rows = sections.setdefault("risk", risk).setdefault("rows", {})
                rows[row] = [*chosen, PAST_HISTORY]
                linked[key] = {"from": f"mh.{field}"}
                risk["linked"] = linked
        elif key in linked:
            risk["rows"][row] = [o for o in chosen if o != PAST_HISTORY]
            del linked[key]


def _user_name(user):
    return user.get_full_name() or user.get_username()


def _sync_mse(draft, user):
    """Write the intake MSE into the one MSE store as readable text; the
    structured findings stay in the intake section (INT-16)."""
    section = draft.sections.get("mse", {})
    values = mental_state.exam_text(section)
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

    records.propose_from_mse(draft.patient, draft.mse, section)


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
        if any(not str(risk.get(k, "")).strip() for k in FORMULATION_REQUIRED):
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
    if not (mental_state.recorded(mse, "mood") and mental_state.recorded(mse, "thought_content")):
        missing.append("Section 16 MSE — at least mood and thought content")
    from apps.clinical_encounter.models import DiagnosisCode

    from . import tools

    # A diagnosis is always an ICD-11 coded record (CLAUDE.md §5: no coded
    # clinical concept as free text); the Diagnosis tab writes it.
    if not DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE").exclude(
        verification_status="RULED_OUT"
    ).exists():
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
    _review_carried_findings(draft, user)
    draft.status = IntakeAssessment.STATUS_SIGNED
    draft.completeness = completeness
    draft.outstanding = outstanding
    draft.signed_at = timezone.now()
    draft.signed_by = user
    _mirror_legacy_columns(draft)
    draft.save()
    _request_withdrawal_review(draft, user)
    return draft


def _request_withdrawal_review(draft, user):
    """Spec item 10: withdrawal identified at intake flags the client for
    psychiatric review — unless the triage already did (one per triage)."""
    from . import psychiatric_review
    from .models import TriageEncounter

    features = (draft.sections.get("subs") or {}).get("features") or []
    if schema._code("Withdrawal") not in features:
        return
    triage_encounter = (
        TriageEncounter.objects.filter(patient=draft.patient, episode=draft.episode)
        .exclude(triage_version=0)
        .order_by("-last_triaged_at")
        .first()
    )
    psychiatric_review.request(
        triage_encounter,
        user,
        ["withdrawal identified at intake"],
        triage_encounter.priority if triage_encounter else "",
        "intake",
    )


# Intake risk-register rows → the shared finding each one confirms (findings.py).
CARRIED_FINDING_KEYS = {
    "suicide": "SUICIDE_SELF_HARM",
    "violence": "HARM_TO_OTHERS",
    "safeguarding": "SAFEGUARDING",
    "medical": "MEDICAL",
}
SELF_CARE = "neglect:Difficulty with self-care"


def _carried_finding_key(item_key):
    if item_key == SELF_CARE:
        return "FUNCTIONAL"
    row = item_key.split(":", 1)[0]
    return "SAFEGUARDING" if row == "neglect" else CARRIED_FINDING_KEYS.get(row)


def _review_carried_findings(draft, user):
    """The Section 3 confirmation of each carried triage finding is the review of
    the shared finding — written once, at signing, so a triage finding is never
    confirmed twice. Only a finding still as triage left it is reviewed: a clone
    of an earlier intake does not re-confirm what nobody looked at again."""
    from . import findings

    carried = (draft.sections.get("risk", {}) or {}).get("carried") or {}
    by_key = {}
    for item_key, entry in carried.items():
        key = _carried_finding_key(item_key)
        if key and entry.get("confirmed"):
            by_key.setdefault(key, []).append((item_key.split(":", 1)[-1], entry))
    current = {f.key: f for f in findings.current(draft.patient)}
    for key, entries in by_key.items():
        finding = current.get(key)
        if finding is None or finding.stage != "TRIAGE":
            continue
        gone = [option for option, entry in entries if entry.get("not_present")]
        if len(gone) == len(entries):
            findings.review(
                draft.patient, key, user, action="UPDATED", stage="INTAKE", status="ABSENT",
                note="Not present now at intake: " + ", ".join(gone),
            )
        else:
            findings.review(draft.patient, key, user, action="CONFIRMED", stage="INTAKE")


def record_score(patient, user, instrument, score, intake=None):
    return OutcomeScore.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        instrument=instrument,
        score=score,
        source_intake=intake,
        recorded_by=user,
    )
