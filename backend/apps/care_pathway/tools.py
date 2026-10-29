"""
Assessment tools: recommended from the record, decided by the clinician, scored
once (mockup v4 TOOLS / toolTriggers / toolStatus / measureForm).

Findings recommend a tool — the clinician accepts, starts anyway, or declines
with a reason. Nothing is auto-ordered. Scores are stored once in
OutcomeScore and flow to the Care Plan and Outcomes.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import approved_assessments, facility_time, instruments, mental_state
from .intake import latest_signed
from .intake_schema import RISK_ROWS, _code
from .models import AssessmentToolDecision, LocalConcept, OutcomeScore

LINK_TOOLS = {
    "SRA": "Structured suicide / clinical risk formulation",
    "SAFETY": "Safety Plan",
    "SAFEGUARD": "Risk addendum / safeguarding workflow",
}
# Tools completed elsewhere — never block intake sign-off.
LATER_TOOLS = {"SAFETY", "CRI"}
TOOL_ORDER = ["SRA", "SAFETY", "PAWSS", "AUDITC", "PHQ9", "PHQA", "EPDS", "GAD7", "MDQ", "PCL5",
              "COG", "SAFEGUARD", "CRI"]
_ACTIVE = {row["key"]: set(row["active"]) for row in RISK_ROWS}


def tool_name(key):
    return LINK_TOOLS.get(key) or instruments.INSTRUMENTS[key]["title"]


def _record_view(patient):
    """The sections the triggers read: the open draft if there is one, else the
    latest signed intake. Empty when no intake has been started."""
    from .intake import current_draft

    source = current_draft(patient) or latest_signed(patient)
    return source.sections if source else {}


def _active_risk(sections, row):
    chosen = (sections.get("risk", {}).get("rows", {}) or {}).get(row, []) or []
    return [o for o in chosen if o in _ACTIVE[row]]


def triggers(patient):
    """{tool key: [reasons]} — why each tool is recommended now."""
    s = _record_view(patient)
    why = {}

    def add(key, reason):
        why.setdefault(key, []).append(reason)

    sx = set(s.get("sx", {}).get("list", []) or [])
    subs = s.get("subs", {})
    mse = s.get("mse", {})
    age = patient.age_years
    if mental_state.is_structured(mse):
        suicidal_content = mental_state.has(mse, "thought_content", "Suicidal")
        low_affect = (
            mental_state.has(mse, "affect", "Flat")
            or mental_state.has(mse, "affect", "Blunted")
            or mental_state.has(mse, "thought_content", "Hopelessness")
        )
        elevated_affect = mental_state.has(mse, "affect", "Elevated")
    else:  # legacy free-text MSE (pre-v4 intakes are read as stored)
        affect = str(mse.get("affect", "")).lower()
        content = str(mse.get("thought_content", "")).lower()
        suicidal_content = "suicidal" in content
        low_affect = "flat" in affect or "blunted" in affect or "hopelessness" in content
        elevated_affect = "elevated" in affect

    # The shared finding store (findings.py): what triage found triggers the
    # tools before an intake exists, and goes on doing so until a clinician
    # updates the finding.
    from .findings import current as current_findings

    for finding in current_findings(patient):
        if finding.status != "PRESENT":
            continue
        if finding.key == "SUICIDE_SELF_HARM":
            add("SRA", f"{finding.title} ({finding.stage.lower()}): {finding.summary}")
            add("SAFETY", f"{finding.title} ({finding.stage.lower()})")
        elif finding.key == "HARM_TO_OTHERS":
            add("SRA", f"{finding.title} ({finding.stage.lower()}): {finding.summary}")
        elif finding.key == "SAFEGUARDING":
            add("SAFEGUARD", f"{finding.title} ({finding.stage.lower()}): {finding.summary}")
        elif finding.key == "SUBSTANCE:alcohol":
            add("PAWSS", f"Alcohol use recorded at {finding.stage.lower()} — predict withdrawal risk")

    suicide = _active_risk(s, "suicide")
    if suicide:
        reason = "Suicide / self-harm finding: " + ", ".join(o.lower() for o in suicide)
        add("SRA", reason)
        add("SAFETY", reason)
    if suicidal_content:
        add("SRA", "MSE thought content: suicidal")
    violence = _active_risk(s, "violence")
    if violence:
        reason = "Violence risk: " + ", ".join(o.lower() for o in violence)
        add("SRA", reason)
        add("SAFETY", reason)

    # CIWA-Ar / COWS (withdrawal severity) belong to the withdrawal module, which
    # needs a clinical protocol source — they are not recommended here.
    current_cards = {
        c.get("substance") for c in subs.get("substances") or [] if isinstance(c, dict) and c.get("current") == _code("Yes")
    }
    if subs.get("kind") == _code("Alcohol") or _code("Alcohol") in current_cards:
        add("PAWSS", "Alcohol use recorded — predict withdrawal risk")
        add("AUDITC", "Alcohol use recorded — structured screen")

    low = [x for x in ("Low mood", "Loss of interest/pleasure") if _code(x) in sx]
    if low:
        teen = age is not None and 12 <= age < 18
        add("PHQA" if teen else "PHQ9", ("Adolescent with " if teen else "Symptoms: ") + ", ".join(x.lower() for x in low))
    if low_affect:
        add("PHQA" if age is not None and age < 18 else "PHQ9", "MSE: low affect / hopelessness")
    anxious = [x for x in ("Anxiety/worry", "Panic") if _code(x) in sx]
    if anxious:
        add("GAD7", "Symptoms: " + ", ".join(x.lower() for x in anxious))
    manic = [x for x in ("Elevated/expansive mood", "Reduced need for sleep", "Racing thoughts", "Impulsivity") if _code(x) in sx]
    if manic:
        add("MDQ", "Possible manic symptoms: " + ", ".join(x.lower() for x in manic))
    if elevated_affect:
        add("MDQ", "MSE: elevated affect")
    if _code("Trauma symptoms") in sx:
        add("PCL5", "Symptoms: trauma symptoms")
    if _code("Trauma symptoms identified") in set(s.get("trauma", {}).get("flags", []) or []):
        add("PCL5", "Trauma section: trauma symptoms identified")
    if _code("Memory concerns") in sx or _code("Confusion/disorientation") in sx or (age is not None and age >= 65):
        add("COG", "Memory concerns reported" if _code("Memory concerns") in sx else "Age 65 or over / confusion reported")
    safeguard = _active_risk(s, "safeguarding")
    if safeguard:
        add("SAFEGUARD", "Safeguarding: " + ", ".join(o.lower() for o in safeguard))
    neglect = _active_risk(s, "neglect")
    if neglect:
        add("SAFEGUARD", "Vulnerability: " + ", ".join(o.lower() for o in neglect))
    if _code("Immediate safeguarding concern identified") in set(s.get("trauma", {}).get("flags", []) or []):
        add("SAFEGUARD", "Immediate safeguarding concern (trauma section)")
    if s.get("medical", {}).get("preg_status") in (_code("Pregnant"), _code("Postpartum")):
        add("EPDS", "Pregnant or postpartum")
    # CRI is offered once a care plan is confirmed (phase d).
    return why


def _decision(patient, key):
    return AssessmentToolDecision.objects.filter(patient=patient, tool=key).first()


def status_of(patient, key, why, sections):
    decision = _decision(patient, key)
    if decision and decision.status == "DECLINED":
        return "Declined"
    if key == "SRA" and sections.get("risk", {}).get("formulation_signed_at"):
        return "Completed"
    if key == "SAFEGUARD" and _code("Safeguarding pathway") in set(sections.get("risk", {}).get("actions", []) or []):
        return "Completed"
    if key in instruments.INSTRUMENTS and OutcomeScore.objects.filter(patient=patient, instrument=key).exists():
        return "Completed"
    # Spec 6.1: a tool that needs the organisation's approval is shown, never
    # started, until an Org Admin approves it (approved_assessments.py).
    if not approved_assessments.is_approved(key):
        return "Not approved"
    if decision and decision.status == "ACCEPTED":
        return "In progress"
    return "Recommended" if key in why else "Not indicated"


def overview(patient):
    why = triggers(patient)
    sections = _record_view(patient)
    out = []
    for key in TOOL_ORDER:
        status = status_of(patient, key, why, sections)
        last = (
            OutcomeScore.objects.filter(patient=patient, instrument=key).order_by("-recorded_at").first()
            if key in instruments.INSTRUMENTS
            else None
        )
        decision = _decision(patient, key)
        out.append(
            {
                "key": key,
                "name": tool_name(key),
                "kind": "link" if key in LINK_TOOLS else "score",
                "status": status,
                "why": why.get(key, []),
                "later": key in LATER_TOOLS,
                "note": (
                    "Not approved for this organisation — use clinical judgement. An Org Admin "
                    "approves a trauma assessment under Clinical Assessments."
                    if status == "Not approved"
                    else ""
                ),
                "decision": (
                    {
                        "status": decision.status,
                        "reason": decision.reason,
                        "at": decision.decided_at,
                        "by": decision.decided_by.get_full_name() if decision.decided_by_id else "",
                    }
                    if decision
                    else None
                ),
                "last": (
                    {
                        "score": last.score,
                        "band": instruments.band_for(key, last.score),
                        "at": last.recorded_at,
                    }
                    if last
                    else None
                ),
            }
        )
    rank = {
        "Recommended": 0,
        "In progress": 1,
        "Completed": 2,
        "Declined": 3,
        "Not approved": 4,
        "Not indicated": 5,
    }
    return sorted(out, key=lambda row: rank[row["status"]])


def recommended_undecided(patient):
    """Recommended, not-later tools — must be accepted or declined before a
    complete intake is signed."""
    return [t for t in overview(patient) if t["status"] == "Recommended" and not t["later"]]


@transaction.atomic
def decide(patient, user, key, status, reason=""):
    if key not in TOOL_ORDER:
        raise ValidationError({"tool": "Unknown tool."})
    if status not in ("ACCEPTED", "DECLINED", "RECONSIDERED"):
        raise ValidationError({"status": "Use ACCEPTED, DECLINED or RECONSIDERED."})
    reason = (reason or "").strip()
    if status == "DECLINED" and len(reason) < 5:
        raise ValidationError({"reason": "Give a reason for declining (clinical judgement)."})
    if status == "ACCEPTED" and not approved_assessments.is_approved(key):
        raise ValidationError({"tool": "Not approved for this organisation."})
    return AssessmentToolDecision.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        tool=key,
        status=status,
        reason=reason,
        why=triggers(patient).get(key, ["Started by clinician (not auto-triggered)"]),
        decided_by=user,
    )


@transaction.atomic
def record_assessment(patient, user, instrument, *, answers=None, total=None, positive=None,
                      context="", note="", intake=None, detail=None, timepoint="", assessed_at=None):
    if instrument not in instruments.INSTRUMENTS:
        raise ValidationError({"instrument": "Unknown instrument."})
    spec = instruments.INSTRUMENTS[instrument]
    if not approved_assessments.is_approved(instrument):
        raise ValidationError({"instrument": "Not approved for this organisation."})
    if timepoint and not LocalConcept.objects.filter(
        valueset_id="assessment-timepoint", code=timepoint, active=True
    ).exists():
        raise ValidationError({"timepoint": "Choose the timepoint (baseline, repeat, …)."})
    recorded_at = _assessment_time(assessed_at)
    try:
        detail = instruments.validate_detail(instrument, detail)
        if instruments.items_skipped(instrument, detail):
            total, items = 0, []
        elif spec["kind"] == "items":
            total, items = instruments.score_items(instrument, answers)
        else:
            items = []
            total = instruments.validate_total(instrument, total)
    except ValueError as exc:
        raise ValidationError({"score": str(exc)}) from exc
    flags = instruments.result_flags(instrument, items, detail)
    if spec.get("positive_rule"):
        positive = instruments.positive_for(instrument, total, detail)
    elif not spec.get("has_positive_flag"):
        positive = None
    score = OutcomeScore.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        instrument=instrument,
        score=total,
        items=items,
        flags=flags,
        positive=positive,
        detail=detail,
        context=context[:24],
        timepoint=timepoint,
        note=(note or "")[:400],
        source_intake=intake,
        recorded_by=user,
        recorded_at=recorded_at,
    )
    from . import records

    records.propose_from_score(patient, score)
    # Recording implies the tool was accepted.
    if not _decision(patient, instrument):
        AssessmentToolDecision.objects.create(
            organization_id=patient.organization_id,
            patient=patient,
            tool=instrument,
            status="ACCEPTED",
            why=triggers(patient).get(instrument, ["Started by clinician (not auto-triggered)"]),
            decided_by=user,
        )
    return score


def _assessment_time(value):
    """When the assessment was done: now, or an earlier time the clinician gives
    (a measure completed on paper and entered later) — never in the future."""
    from django.utils.dateparse import parse_datetime

    if not value:
        return timezone.now()
    moment = parse_datetime(value) if isinstance(value, str) else value
    if moment is None:
        raise ValidationError({"assessed_at": "Enter the assessment date and time."})
    moment = facility_time.make_local_aware(moment)
    if moment > timezone.now() + timedelta(minutes=5):
        raise ValidationError({"assessed_at": "The assessment date cannot be in the future."})
    return moment


def outcome_summary(patient):
    """Per instrument: series, baseline, latest, band, change in words."""
    summary = []
    for code in instruments.CODES:
        rows = list(
            OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("recorded_at")
        )
        if not rows:
            continue
        spec = instruments.INSTRUMENTS[code]
        totals = [r.score for r in rows]
        summary.append(
            {
                "instrument": code,
                "name": spec["name"],
                "max": spec["max"],
                "approval": spec["approval"],
                "baseline": {"score": totals[0], "at": rows[0].recorded_at},
                "latest": {
                    "score": totals[-1],
                    "band": instruments.band_for(code, totals[-1]),
                    "at": rows[-1].recorded_at,
                    "flags": rows[-1].flags,
                },
                "series": [{"score": r.score, "at": r.recorded_at} for r in rows],
                "change": instruments.change_text(code, totals),
            }
        )
    return summary
