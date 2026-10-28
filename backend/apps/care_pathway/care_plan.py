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
from . import facility_time
from . import mental_state
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
# Agreement codes (served `care-plan-agreement`) that need the client's reasons
# recorded as structured disagreement points before the plan can be signed.
REASONS_NEEDED = ("PARTIAL", "DECLINED")
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
    if answers.get("subst_withdrawal_signs") == "yes" or answers.get("r_stopped_heavy") == "yes":
        signs.append("withdrawal signs / recent cessation (triage v4)")
    if answers.get("schema") == "v5" and answers.get("g_stopped") == "yes":
        signs.append("recently stopped heavy / frequent use (triage)")
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
            f"Triggered by abnormal vital signs — {score['label']} ({facility_time.local_format(vital.recorded_at)})")
    if _has(sections, "medical", "Concern identified"):
        add("medical_review", "ORANGE", "Triggered by medical-safety finding")

    mse = sections.get("mse", {})
    if mental_state.is_structured(mse):
        psychotic = mental_state.psychotic_features(mse)
    else:  # legacy free-text MSE
        perception = str(mse.get("perception", "")).lower()
        content = str(mse.get("thought_content", "")).lower()
        psychotic = "hallucination" in perception or "delusion" in content
    if psychotic:
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
                  "recommended_priority": rec["priority"], "why": rec["why"], "bulk_accepted": False}
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
                  "why": rec["why"] if rec else ["Added by clinician"], "bulk_accepted": False}
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
def accept_remaining(plan, user):
    """"Accept the N remaining recommendations as proposed": each is accepted at
    its recommended priority and marked bulk-accepted, so the signer must confirm
    they reviewed each one before signing (RULE-05)."""
    decided = set(plan.activities.exclude(action_key="").values_list("action_key", flat=True))
    accepted = []
    for key, rec in recommend(plan.patient).items():
        if key in decided:
            continue
        activity = decide_action(plan, user, key, "ACCEPTED", priority=rec["priority"])
        activity.bulk_accepted = True
        activity.save(update_fields=["bulk_accepted", "updated_at"])
        accepted.append(activity)
    return accepted


def remove_added(plan, key):
    """Take back an action the clinician added (not recommended) before it was
    signed into a version — once signed it has tasks and stays in the record."""
    activity = plan.activities.filter(action_key=key).first()
    if activity is None or activity.decision != "ADDED":
        raise ValidationError({"action_key": "Only an action you added can be removed."})
    if activity.tasks.exists() or activity.due_at:
        raise ValidationError(
            {"action_key": "This action is part of a signed plan — mark it completed instead."}
        )
    activity.delete()


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
    if live and _involuntary_admission(patient) and not keys & {"admission", "referral"}:
        out.append("Legal status is involuntary but no admission or transfer is planned.")
    if "detox" in keys and is_opioid(patient) and not opioid_safety_recorded(plan):
        out.append("Opioid withdrawal plan with no naloxone or opioid-agonist-therapy discussion recorded.")
    if "family" in keys and family_consent(patient) == "NO":
        out.append("Family intervention is planned but the client declined family involvement.")
    return out


def _involuntary_admission(patient):
    """The current legal status the record holds: an open involuntary admission.
    (Emergency detention outside an admission is not recorded anywhere yet.)"""
    from apps.ipd_ward.models import Admission

    return Admission.objects.filter(
        patient=patient, status="ADMITTED", admission_type="INVOLUNTARY"
    ).exists()


def is_opioid(patient):
    from . import withdrawal

    return withdrawal.is_opioid(patient)


def opioid_safety_recorded(plan):
    from .models import NaloxoneSupply, OatEnrolment

    return bool(
        plan.naloxone_teaching
        or plan.oat_offer
        or NaloxoneSupply.objects.filter(patient=plan.patient).exists()
        or OatEnrolment.objects.filter(patient=plan.patient).exists()
    )


def family_consent(patient):
    """The client's current decision on family involvement (ConsentRecord), or
    NOT_ASKED. The plan shows it next to the family field and never overrides it."""
    from apps.client_registry.models import ConsentRecord

    latest = ConsentRecord.objects.filter(
        patient=patient, consent_type="FAMILY_INVOLVEMENT"
    ).order_by("-captured_at").first()
    return latest.decision if latest else "NOT_ASKED"


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
    elif plan.client_agreement in REASONS_NEEDED and not any(
        str(d.get("words", "")).strip() for d in plan.disagreements or []
    ):
        items.append("Where the client disagrees — record each point in their words")
    if needs_safety_plan(plan):
        if not safety_plan_complete(plan.patient):
            items.append("Safety plan — signed, with warning signs or people to contact")
        if not plan.contact_72h_at:
            items.append("Contact within 72 hours")
        if not plan.follow_up_clinician.strip():
            items.append("Named follow-up clinician")
    return items, found


@transaction.atomic
def confirm_plan(plan, user, bulk_reviewed=False):
    items, found = outstanding(plan)
    if items:
        raise ValidationError({"outstanding": items, "plan": f"Cannot sign yet — {len(items)} item(s) to complete."})
    bulk = list(live_activities(plan).filter(bulk_accepted=True))
    if bulk and not bulk_reviewed:
        raise ValidationError({
            "bulk_reviewed": "Confirm you have reviewed each bulk-accepted action.",
            "bulk": [{"key": a.action_key, "name": a.title, "priority": a.priority, "why": a.why} for a in bulk],
        })
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
                "reason": a.reason, "why": a.why, "bulk": a.bulk_accepted,
            }
            for a in plan.activities.all()
        ],
        "bulk_reviewed_by": (user.get_full_name() or str(user)) if bulk else "",
        "client_agreement": plan.client_agreement,
        "disagreements": plan.disagreements,
        "what_matters": plan.what_matters,
        "goals": plan.goal_items,
        "crisis_plan": plan.crisis_plan,
        "family_involvement": plan.family_involvement,
        "advance_statement": plan.advance_statement,
        "naloxone_teaching": plan.naloxone_teaching,
        "oat_offer": plan.oat_offer,
        "client_acknowledged_at": plan.client_ack_at.isoformat() if plan.client_ack_at else "",
        "contact_72h_at": plan.contact_72h_at.isoformat() if plan.contact_72h_at else "",
        "follow_up_clinician": plan.follow_up_clinician,
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
    plan.activities.filter(bulk_accepted=True).update(bulk_accepted=False)
    book_72h_contact(plan, user)
    return plan


def book_72h_contact(plan, user):
    """The safety plan's 72-hour contact becomes a real follow-up appointment on
    the episode, so it appears in the follow-up worklist. Booked once per agreed
    time: a changed time moves the open booking, a re-signed plan never duplicates it."""
    from apps.client_registry.models import Appointment

    from . import services

    if not plan.contact_72h_at:
        return None
    booked = Appointment.objects.filter(episode=plan.episode, origin="CARE_PLAN", reason="CONTACT_72H")
    same_time = booked.filter(scheduled_for=plan.contact_72h_at).first()
    if same_time:
        return same_time
    open_booking = booked.filter(status="SCHEDULED").first()
    if open_booking:
        open_booking.scheduled_for = plan.contact_72h_at
        open_booking.reminder_sent_at = None
        open_booking.save(update_fields=["scheduled_for", "reminder_sent_at", "updated_at"])
        return open_booking
    notes = f"With {plan.follow_up_clinician}" if plan.follow_up_clinician else ""
    return services.book_follow_up(
        user, plan.patient,
        {"reason": "CONTACT_72H", "scheduled_for": plan.contact_72h_at, "notes": notes,
         "client_request_id": f"care-plan-72h:{plan.pk}:v{plan.version}"},
        episode=plan.episode, origin="CARE_PLAN",
    )


# Latest result of each instrument, carried onto the plan (AT-04: stored once,
# read here — never re-entered). Order as the mockup's carried chips.
CARRIED_INSTRUMENTS = ["CIWA", "COWS", "PAWSS", "AUDITC", "PHQ9", "PHQA", "EPDS", "GAD7", "MDQ", "PCL5", "CRI"]


def carried_scores(patient):
    from . import instruments

    out = []
    for code in CARRIED_INSTRUMENTS:
        row = _last_score(patient, code)
        if row:
            spec = instruments.INSTRUMENTS[code]
            out.append({
                "instrument": code, "name": spec["name"], "score": row.score, "max": spec["max"],
                "band": instruments.band_for(code, row.score), "at": row.recorded_at,
                "timepoint": row.timepoint, "approval": spec["approval"],
            })
    return out


def intake_context(patient):
    """What the plan carries from intake, and whether intake is finished — the
    plan warns but never blocks on an unsigned or partial intake."""
    from . import intake

    signed = intake.latest_signed(patient)
    draft = intake.current_draft(patient)
    source = draft or signed
    sections = source.sections if source else {}
    if signed is None:
        state = "unsigned" if draft else "none"
    else:
        state = "complete" if signed.completeness == "COMPLETE" else "partial"
    return {
        "state": state,
        "reason_incomplete": str((signed.sections.get("close") or {}).get("reason_incomplete", "")) if signed else "",
        "what_matters": str((sections.get("persp") or {}).get("matters", "")),
        "goals": str((sections.get("pres") or {}).get("goals", "")),
    }


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
