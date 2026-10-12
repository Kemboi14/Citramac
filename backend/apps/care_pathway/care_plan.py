"""
Care plan (mockup v4 stage 4): findings recommend actions, the clinician
accepts / modifies / declines each, then signs the plan.

The engine only *suggests*. It never sets a client's priority and never makes a
decision for the clinician: every recommendation carries its provenance
("Triggered by …"), lowering a recommended priority needs a written reason, and
declining needs one too.

VERIFY (clinical approval): the trigger rules and priority mapping below are
the owner's mockup, labelled illustrative there; `RULES_VERSION` is stored with
every decision so a signed plan says which rules produced its recommendations.
SHA tariff / fund codes and pre-authorisation flags from the mockup are NOT
carried over — national programme codes must come from the regulator (CLAUDE.md §6).
Drug-specific instructions (e.g. for withdrawal) are deliberately left out of the
task templates: they belong to the facility's protocol, entered by clinicians.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from . import ews as ews_module
from .intake_schema import _code
from .models import (
    CarePlan,
    CarePlanActivity,
    CarePlanTask,
    CarePlanVersion,
    OutcomeScore,
    SafetyPlan,
)
from .tools import _active_risk, _record_view

RULES_VERSION = "mockup-2026-10-illustrative"
RANK = {"RED": 0, "ORANGE": 1, "YELLOW": 2, "GREEN": 3}
LABEL = {"RED": "Emergency", "ORANGE": "Urgent", "YELLOW": "Priority", "GREEN": "Routine"}
# Minutes after the plan is signed until an action is due, by priority (mockup TASK_DUE).
DUE_MINUTES = {"RED": 0, "ORANGE": 60, "YELLOW": 24 * 60, "GREEN": 7 * 24 * 60}
MEANING = {
    "RED": "Safety action is required now — do not leave this in a normal appointment queue.",
    "ORANGE": "Prompt action is required because delay may increase clinical risk or deterioration.",
    "YELLOW": "Client is currently stable but needs timely action — schedule sooner than routine.",
    "GREEN": "No acute risk requiring faster action — schedule through the normal appointment process.",
}

CATALOGUE = [
    {"key": "psych_review", "name": "Psychiatric review", "low": False, "module": "PSYCHIATRY",
     "roles": ["psychiatrist", "clinician"],
     "tasks": ["SBAR request built from triage, MSE, risk and vitals",
               "Refer to on-call psychiatry or book a slot", "Medication review (allergy-checked)"]},
    {"key": "medical_review", "name": "Medical review", "low": False, "module": "ASSESSMENT",
     "roles": ["clinician", "psychiatrist", "nurse"],
     "tasks": ["Medical assessment of symptoms / abnormal vital signs",
               "Investigations where indicated", "Escalate / transfer if unstable"]},
    {"key": "detox", "name": "Detox / withdrawal management", "low": False, "module": "NURSING",
     "roles": ["nurse", "clinician", "psychiatrist"],
     "tasks": ["Withdrawal monitoring per the facility protocol",
               "Hydration and observation", "Step-down / aftercare plan"]},
    {"key": "safety", "name": "Safety plan / enhanced observation", "low": False,
     "module": "NURSING", "roles": ["nurse", "clinician", "psychiatrist", "therapist"],
     "tasks": ["Written client-held safety plan", "Lethal-means counselling",
               "Observation level reviewed", "Contact within 72 hours"]},
    {"key": "therapy", "name": "Psychological therapy", "low": True, "module": "THERAPY",
     "roles": ["therapist", "psychiatrist"],
     "tasks": ["Refer to therapy service", "Share formulation",
               "Agree modality, contract and schedule"]},
    {"key": "admission", "name": "Inpatient admission / residential care", "low": False,
     "module": "ADMISSION", "roles": ["nurse", "clinician", "psychiatrist"],
     "tasks": ["Legal status recorded and rights information given", "Observation level set",
               "Admission orders", "Allergy check before first dose", "Medication reconciliation",
               "Nursing assessment and care plan", "Review schedule agreed"]},
    {"key": "outpatient", "name": "Outpatient care / follow-up", "low": True, "module": "PSYCHIATRY",
     "roles": ["clinician", "psychiatrist", "therapist", "reception"],
     "tasks": ["Outpatient treatment plan", "Book appointments", "Outcome measures", "Follow-up plan"]},
    {"key": "family", "name": "Family intervention", "low": True, "module": "THERAPY",
     "roles": ["therapist", "psychiatrist"],
     "tasks": ["Confirm consent for family involvement", "Family session / psychoeducation"]},
    {"key": "social", "name": "Social work / case management", "low": True, "module": "THERAPY",
     "roles": ["therapist", "clinician"],
     "tasks": ["Housing / income / basic-needs review", "Link to community supports"]},
    {"key": "nutrition", "name": "Nutrition / fitness", "low": True, "module": "ASSESSMENT",
     "roles": ["therapist", "nurse"], "tasks": ["Nutrition assessment", "Fitness programme"]},
    {"key": "referral", "name": "Referral / emergency transfer", "low": False,
     "module": "ASSESSMENT", "roles": ["clinician", "psychiatrist"],
     "tasks": ["Select the receiving service", "Consent to share information",
               "Referral letter / SBAR with summary", "Confirm arrival at the receiving service",
               "Counter-referral on discharge"]},
]
BY_KEY = {a["key"]: a for a in CATALOGUE}

IMPR_MAP = {
    _code("Psychiatric review"): "psych_review",
    _code("Medical review"): "medical_review",
    _code("Detox/withdrawal management"): "detox",
    _code("Safety plan/enhanced observation"): "safety",
    _code("Psychological therapy"): "therapy",
    _code("Inpatient admission"): "admission",
    _code("Residential rehabilitation"): "admission",
    _code("Outpatient care"): "outpatient",
    _code("Family intervention"): "family",
    _code("Social work/case management"): "social",
    _code("Nutrition/fitness"): "nutrition",
    _code("Referral/emergency transfer"): "referral",
}


def higher(a, b):
    return a if RANK[a] < RANK[b] else b


def _rows(sections):
    return sections.get("risk", {}).get("rows", {}) or {}


def _has(sections, row, option):
    return option in (_rows(sections).get(row, []) or [])


def _last_score(patient, code):
    return OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()


def _latest_ews(patient):
    from apps.triage.models import VitalSigns

    vital = VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at").first()
    return (ews_module.from_vital(vital), vital) if vital else (None, None)


def _withdrawal(patient, sections):
    from .models import TriageAssessment

    signed = (
        TriageAssessment.objects.filter(triage_encounter__patient=patient, status="COMPLETED")
        .order_by("-signed_at")
        .first()
    )
    answers = signed.answers if signed else {}
    signs = [x for x in (answers.get("g_withdrawal") or []) if str(x).lower() != "none"]
    subs = sections.get("subs", {})
    kind = subs.get("kind")
    features = set(subs.get("features", []) or [])
    pawss = _last_score(patient, "PAWSS")
    why = []
    if signs:
        why.append("withdrawal symptoms reported at triage: " + ", ".join(str(s) for s in signs))
    if _code("Withdrawal") in features:
        why.append("withdrawal recorded under substance use")
    if pawss and pawss.score >= 4:
        why.append(f"PAWSS {pawss.score} — high risk of complicated withdrawal")
    life_threatening = bool(why) and kind in (_code("Alcohol"), _code("Benzodiazepines"))
    return {"active": bool(why), "life_threatening": life_threatening, "why": why}


def recommend(patient):
    """{action key: {priority, why[]}} — each with its provenance."""
    sections = _record_view(patient)
    recs = {}

    def add(key, priority, why):
        entry = recs.setdefault(key, {"priority": "GREEN", "why": []})
        entry["priority"] = higher(entry["priority"], priority)
        if why not in entry["why"]:
            entry["why"].append(why)

    def risk_text(row):
        return ", ".join(o.lower() for o in _active_risk(sections, row))

    if _active_risk(sections, "suicide"):
        if _has(sections, "suicide", "Intent") or (
            _has(sections, "suicide", "Plan") and _has(sections, "suicide", "Access to means")
        ):
            level = "RED"
        elif _has(sections, "suicide", "Plan") or _has(sections, "suicide", "Recent attempt/self-harm"):
            level = "ORANGE"
        else:
            level = "YELLOW"
        why = "Triggered by suicide-risk finding: " + risk_text("suicide")
        add("psych_review", level, why)
        add("safety", level, why)
    if _active_risk(sections, "violence"):
        why = "Triggered by risk-to-others finding: " + risk_text("violence")
        add("psych_review", "ORANGE", why)
        add("safety", "ORANGE", why)

    wd = _withdrawal(patient, sections)
    if wd["active"]:
        level = "ORANGE" if wd["life_threatening"] else "YELLOW"
        for reason in wd["why"]:
            add("detox", level, "Triggered by " + reason)
        if wd["life_threatening"]:
            add("medical_review", level,
                "Withdrawal from alcohol / sedatives can be life-threatening — medical oversight")

    score, vital = _latest_ews(patient)
    if score and (score["score"] >= 3 or score["single_parameter_3"] or score["glucose_low"]):
        level = "RED" if score["score"] >= 5 or score["glucose_low"] else "ORANGE"
        add("medical_review", level,
            f"Triggered by abnormal vital signs — {score['label']} ({vital.recorded_at:%Y-%m-%d %H:%M})")
    if _has(sections, "medical", "Concern identified"):
        add("medical_review", "ORANGE", "Triggered by medical-safety finding")

    mse = sections.get("mse", {})
    perception = str(mse.get("perception", "")).lower()
    content = str(mse.get("thought_content", "")).lower()
    if "hallucination" in perception or "delusion" in content:
        add("psych_review", "ORANGE", "Triggered by psychotic features on the mental state examination")

    for code in ("PHQ9", "PHQA"):
        row = _last_score(patient, code)
        if row:
            text = f"{code} {row.score}"
            if row.score >= 20:
                add("psych_review", "YELLOW", f"Triggered by {text}")
                add("therapy", "YELLOW", f"Triggered by {text}")
            elif row.score >= 10:
                add("therapy", "GREEN", f"Triggered by {text}")
    epds = _last_score(patient, "EPDS")
    if epds and epds.score >= 13:
        add("psych_review", "YELLOW", f"Triggered by EPDS {epds.score}")
    gad = _last_score(patient, "GAD7")
    if gad and gad.score >= 10:
        add("therapy", "YELLOW" if gad.score >= 15 else "GREEN", f"Triggered by GAD7 {gad.score}")
    mdq = _last_score(patient, "MDQ")
    if mdq and mdq.positive:
        add("psych_review", "YELLOW", f"Triggered by MDQ {mdq.score} (screen positive)")
    pcl = _last_score(patient, "PCL5")
    if pcl and pcl.score >= 33:
        add("therapy", "YELLOW", f"Triggered by PCL5 {pcl.score}")

    if _active_risk(sections, "safeguarding"):
        sensitive = _has(sections, "safeguarding", "Sexual violence/exploitation") or _has(
            sections, "safeguarding", "Child concern"
        )
        why = "Safeguarding pathway — " + risk_text("safeguarding")
        add("referral", "ORANGE" if sensitive else "YELLOW", why)
        add("social", "YELLOW", "Safeguarding — " + risk_text("safeguarding"))
    if _active_risk(sections, "neglect"):
        add("social", "YELLOW", "Difficulty with self-care / vulnerability — " + risk_text("neglect"))

    current = suggested_priority(patient, sections) or "GREEN"
    for need in sections.get("impr", {}).get("needs", []) or []:
        key = IMPR_MAP.get(need)
        if key:
            default = "GREEN" if BY_KEY[key]["low"] else current
            add(key, recs.get(key, {}).get("priority", default),
                "Selected at Intake Section 21 (clinical impression)")
    if not recs:
        add("outpatient", "GREEN", "No acute risk indicators identified — routine outpatient follow-up")
    return recs


def suggested_priority(patient, sections=None):
    """What the findings suggest as a priority (mockup riskPriority). A
    suggestion only — it never changes the triage priority."""
    sections = sections if sections is not None else _record_view(patient)
    level = "GREEN"
    if _has(sections, "suicide", "Intent") or (
        _has(sections, "suicide", "Plan") and _has(sections, "suicide", "Access to means")
    ):
        level = higher("RED", level)
    elif _has(sections, "suicide", "Plan") or _has(sections, "suicide", "Recent attempt/self-harm"):
        level = higher("ORANGE", level)
    elif _has(sections, "suicide", "Thoughts") or _has(sections, "suicide", "Access to means"):
        level = higher("YELLOW", level)
    if _has(sections, "violence", "Intent") and (
        _has(sections, "violence", "Plan") or _has(sections, "violence", "Access to means")
    ):
        level = higher("RED", level)
    elif _active_risk(sections, "violence"):
        level = higher("ORANGE", level)
    if _has(sections, "safeguarding", "Sexual violence/exploitation") or _has(
        sections, "safeguarding", "Child concern"
    ):
        level = higher("ORANGE", level)
    elif _active_risk(sections, "safeguarding"):
        level = higher("YELLOW", level)
    if _has(sections, "absconding", "Significant"):
        level = higher("ORANGE", level)
    elif _has(sections, "absconding", "Possible"):
        level = higher("YELLOW", level)
    if _has(sections, "medical", "Concern identified"):
        level = higher("ORANGE", level)
    if _active_risk(sections, "neglect"):
        level = higher("YELLOW", level)
    return level


# ── plan state ──


def live_activities(plan):
    return plan.activities.exclude(decision="DECLINED")


def declined_activities(plan):
    return plan.activities.filter(decision="DECLINED")


def _validate_priority(value):
    if value not in RANK:
        raise ValidationError({"priority": "Use RED, ORANGE, YELLOW or GREEN."})
    return value


@transaction.atomic
def decide_action(plan, user, key, decision, *, priority="", instructions="", reason=""):
    """Accept / modify / add / decline one catalogue action."""
    if key not in BY_KEY:
        raise ValidationError({"action_key": "Unknown care-plan action."})
    recs = recommend(plan.patient)
    rec = recs.get(key)
    spec = BY_KEY[key]
    activity = plan.activities.filter(action_key=key).first()
    reason = (reason or "").strip()

    if decision == "DECLINED":
        if not rec:
            raise ValidationError({"decision": "Only a recommended action can be declined."})
        if len(reason) < 5:
            raise ValidationError({"reason": "Give a reason for declining (clinical judgement)."})
        values = {"decision": "DECLINED", "reason": reason, "priority": "",
                  "recommended_priority": rec["priority"], "why": rec["why"]}
    elif decision in ("ACCEPTED", "MODIFIED", "ADDED"):
        chosen = _validate_priority(priority or (rec["priority"] if rec else ("GREEN" if spec["low"] else suggested_priority(plan.patient) or "GREEN")))
        if rec and RANK[chosen] > RANK[rec["priority"]] and len(reason) < 10:
            raise ValidationError(
                {"reason": f"Give a reason for setting the priority below the recommendation "
                           f"({LABEL[rec['priority']]})."}
            )
        outcome = "ADDED" if not rec else ("ACCEPTED" if chosen == rec["priority"] else "MODIFIED")
        values = {"decision": outcome, "priority": chosen, "instructions": instructions,
                  "reason": reason if rec and chosen != rec["priority"] else "",
                  "recommended_priority": rec["priority"] if rec else "",
                  "why": rec["why"] if rec else ["Added by clinician"]}
    else:
        raise ValidationError({"decision": "Use ACCEPTED, MODIFIED, ADDED or DECLINED."})

    if activity is None:
        activity = CarePlanActivity(
            organization_id=plan.organization_id,
            care_plan=plan,
            action_key=key,
            title=spec["name"],
            module=spec["module"],
            created_by=user,
        )
    for field, value in values.items():
        setattr(activity, field, value)
    activity.save()
    return activity


@transaction.atomic
def sync_tasks(activity, base_time):
    """Open the catalogue's checklist under an accepted action (once)."""
    if activity.decision == "DECLINED" or activity.tasks.exists():
        return
    spec = BY_KEY[activity.action_key]
    due = base_time + timedelta(minutes=DUE_MINUTES.get(activity.priority, DUE_MINUTES["GREEN"]))
    for label in spec["tasks"]:
        CarePlanTask.objects.create(
            organization_id=activity.organization_id,
            activity=activity,
            label=label,
            owner_role=spec["roles"][0],
            due_at=due,
        )


def conflicts(plan):
    """Plan-level contradictions the signer must explain (mockup planConflict)."""
    patient = plan.patient
    sections = _record_view(patient)
    live = list(live_activities(plan))
    keys = {a.action_key for a in live}
    out = []
    current = _current_triage_priority(patient)
    if live and current in ("RED", "ORANGE") and all(BY_KEY[a.action_key]["low"] for a in live if a.action_key):
        out.append(
            f"Client priority is {LABEL[current]} but the plan contains only lower-intensity actions."
        )
    if (_has(sections, "suicide", "Plan") or _has(sections, "suicide", "Intent")) and "safety" not in keys:
        out.append("A suicidal plan or intent is recorded but the plan has no safety plan action.")
    wd = _withdrawal(patient, sections)
    if wd["active"] and wd["life_threatening"] and "detox" not in keys:
        out.append("Alcohol / sedative withdrawal risk is active but no withdrawal-management action is planned.")
    return out


def _current_triage_priority(patient):
    from .services import latest_signed_triage

    signed = latest_signed_triage(patient)
    return signed.priority if signed else ""


def needs_safety_plan(plan):
    sections = _record_view(plan.patient)
    return bool(_active_risk(sections, "suicide")) or plan.activities.filter(
        action_key="safety"
    ).exclude(decision="DECLINED").exists()


def safety_plan_complete(patient):
    plan = SafetyPlan.objects.filter(patient=patient, signed_at__isnull=False).first()
    return bool(plan and (plan.warning_signs.strip() or plan.people_to_ask.strip()))


def outstanding(plan):
    """Items still needed before the plan can be signed."""
    items = []
    recs = recommend(plan.patient)
    decided = {a.action_key for a in plan.activities.all() if a.action_key}
    live = live_activities(plan)
    if not live.exists():
        items.append("At least one action")
    for key in recs:
        if key not in decided:
            items.append(f"Accept or decline the recommendation: {BY_KEY[key]['name']}")
    found = conflicts(plan)
    if found:
        if len((plan.rationale or "").strip()) < 10:
            items.append("Clinical rationale for the conflicting plan")
        if not plan.senior_reviewer_id:
            items.append("Senior review")
    if not plan.client_agreement:
        items.append("Client agreement status")
    if needs_safety_plan(plan):
        if not safety_plan_complete(plan.patient):
            items.append("Safety plan — signed, with warning signs or people to contact")
        if not plan.contact_72h_at:
            items.append("Contact within 72 hours")
        if not plan.follow_up_clinician.strip():
            items.append("Named follow-up clinician")
    return items, found


@transaction.atomic
def confirm_plan(plan, user):
    items, found = outstanding(plan)
    if items:
        raise ValidationError({"outstanding": items, "plan": f"Cannot sign yet — {len(items)} item(s) to complete."})
    now = timezone.now()
    plan.version += 1
    plan.confirmed_at = now
    plan.confirmed_by = user
    plan.updated_by = user
    plan.save()
    snapshot = {
        "actions": [
            {
                "key": a.action_key, "name": a.title, "decision": a.decision, "priority": a.priority,
                "recommended_priority": a.recommended_priority, "instructions": a.instructions,
                "reason": a.reason, "why": a.why,
            }
            for a in plan.activities.all()
        ],
        "client_agreement": plan.client_agreement,
        "disagreements": plan.disagreements,
        "what_matters": plan.what_matters,
        "rationale": plan.rationale,
        "rules_version": RULES_VERSION,
    }
    CarePlanVersion.objects.create(
        organization_id=plan.organization_id, care_plan=plan, patient=plan.patient,
        version=plan.version, snapshot=snapshot, conflicts=found, signed_by=user, signed_at=now,
    )
    for activity in live_activities(plan):
        sync_tasks(activity, now)
        if activity.due_at is None:
            activity.due_at = now + timedelta(minutes=DUE_MINUTES.get(activity.priority, DUE_MINUTES["GREEN"]))
            activity.status = "ACTIVE" if activity.status == "PLANNED" else activity.status
            activity.save(update_fields=["due_at", "status", "updated_at"])
    return plan


def served_catalogue():
    return [
        {"key": a["key"], "name": a["name"], "low": a["low"], "roles": a["roles"], "tasks": a["tasks"]}
        for a in CATALOGUE
    ]


# Which in-record modules a plan action calls for — the link between the plan and
# the Interventions stage, so the module menu is recommended from the plan.
ACTION_MODULES = {
    "psych_review": ["sbar", "meds"],
    "medical_review": ["labs"],
    "detox": ["withdrawal", "obs"],
    "safety": ["obs", "restraint"],
    "therapy": ["therapy"],
    "family": ["therapy"],
    "admission": ["mar", "legal"],
}


def recommended_modules(patient):
    """{module: [action titles]} for the activities the clinician has accepted."""
    from .models import CarePlanActivity

    out = {}
    for a in CarePlanActivity.objects.filter(care_plan__patient=patient).exclude(decision="DECLINED"):
        for module in ACTION_MODULES.get(a.action_key, []):
            out.setdefault(module, []).append(a.title)
    from . import withdrawal

    if withdrawal.is_opioid(patient):
        out.setdefault("oat", []).append("Opioid use recorded at intake")
    return out
