"""
Interventions workspace (approved v4 mockup `INTERVENTION_MODULES`): the clinical
modules care is recorded from, which of them the record recommends, and the
care-plan actions each one serves.

The module list is the served value set `intervention-module` (seeded by
migration 0034; the database owns code/display afterwards). Group, sub-type
options and the billing service a module charges against are catalogue
metadata kept here, beside it. Rates are never set here: they come from the
facility tariff (BillingService), and a missing rate stays missing.

Recommendations only *suggest* — the clinician chooses what to record. They
mirror the mockup's `signal`s, derived from structured data (alert codes, the
risk register, intake substance, admission state, appointments, care-plan
actions). VERIFY (clinical approval): these rules are the owner's illustrative
mockup. Diagnosis cues match words in the coded ICD-11 display text and the
drug-level cue matches medicine names — both heuristics, not coded rules; no
ICD-11 or drug codes are asserted here (CLAUDE.md §6).
"""

import re

from django.utils import timezone

from .intake_schema import _code

VALUESET_ID = "intervention-module"
VALUESET_TITLE = "Intervention module"
GROUPS = ["Assess", "Treat", "Support", "Close-out"]

# code, display (mockup name), group, billing service name (None = not
# separately priced), unit, sub-interventions and the module note — all as the
# v4 workflow's CARE_MENU. Sub-interventions are labels for what was done, not
# clinical codes. Payer codes and pre-authorisation are never written here: they
# come from the facility's configured ServicePayerCode rows (CLAUDE.md §6).
MODULES = [
    {"code": "emergency_care", "display": "Emergency Care", "group": "Assess",
     "billing_service": "Emergency Care", "unit": "episode",
     "options": ["Stabilisation", "De-escalation first; rapid tranquillisation only if needed",
                 "SBAR handover", "Transfer escort"]},
    {"code": "observation_safety", "display": "Observation & Safety", "group": "Assess",
     "billing_service": None, "unit": "day",
     "note": "Included in the bed-day tariff — documented, not billed separately.",
     "options": ["Observation level & reason", "Signed observation entries", "Step-down review"]},
    {"code": "blood_work", "display": "Blood Work", "group": "Assess",
     "billing_service": "Blood Work", "unit": "test",
     "options": ["Order sets", "Organic work-up bundle",
                 "Drug-level monitoring (lithium, valproate, clozapine)"]},
    {"code": "medical_review", "display": "Medical Review", "group": "Assess",
     "billing_service": "Medical Review", "unit": "review",
     "options": ["Assessment of physical symptoms", "Abnormal vital-sign review", "Medical clearance",
                 "Transfer decision"]},
    {"code": "appointments", "display": "Appointments", "group": "Assess",
     "billing_service": "Appointments", "unit": "visit", "options": []},
    {"code": "psychiatry", "display": "Psychiatry", "group": "Treat",
     "billing_service": "Psychiatry", "unit": "review",
     "options": ["Initial consultation", "Psychiatric review", "Medication orders (allergy-checked)",
                 "Escalation to psychiatrist (SBAR)"]},
    {"code": "admission", "display": "Admission", "group": "Treat",
     "billing_service": "Admission", "unit": "bed-day",
     "note": "Legal status is decided in Legal & consent; the forms it requires are prepared there.",
     "options": ["Statutory forms linked to legal status", "Bed allocation", "Rights information"]},
    {"code": "withdrawal_management", "display": "Withdrawal Management (Detox)", "group": "Treat",
     "billing_service": "Withdrawal Management (Detox)", "unit": "day",
     "options": ["CIWA-Ar (alcohol)", "COWS (opioids)", "Symptom-triggered dosing",
                 "Thiamine promptly; never delay glucose"]},
    {"code": "opioid_agonist_therapy", "display": "Opioid Agonist Therapy", "group": "Treat",
     "billing_service": "Opioid Agonist Therapy", "unit": "day",
     "note": "Methadone or buprenorphine via a MAT clinic; naloxone kit and overdose-risk teaching at discharge.",
     "options": ["Methadone", "Buprenorphine", "Naloxone at discharge"]},
    {"code": "psychiatric_nursing", "display": "Psychiatric Nursing", "group": "Treat",
     "billing_service": "Psychiatric Nursing", "unit": "day",
     "options": ["Medication Administration Record (MAR)", "PRN effectiveness", "Physical care charts",
                 "SBAR shift handover"]},
    {"code": "restrictive_practice", "display": "Restrictive Practice", "group": "Treat",
     "billing_service": None, "unit": "event",
     "note": "Last resort. De-escalation must be documented first, and every episode ends with a "
             "debrief with the patient.",
     "options": ["De-escalation attempted", "Authoriser", "Circulation / airway / hydration checks",
                 "Patient debrief"]},
    # Not a card of its own: group sessions are documented once in the Group
    # programme and each attendee's record lands here; the Psychotherapy card
    # counts and lists them (`history_modules`).
    {"code": "group_psychotherapy", "display": "Group Psychotherapy", "group": "Treat",
     "billing_service": None, "unit": "session", "listed": False,
     "options": ["Group therapy"]},
    {"code": "psychotherapy", "display": "Psychotherapy", "group": "Treat",
     "billing_service": "Psychotherapy", "unit": "session",
     "history_modules": ["psychotherapy", "group_psychotherapy"],
     "options": ["Individual", "Group", "Family therapy",
                 "Morning Meeting Observations (inpatient)", "General Observations"]},
    {"code": "psychosocial_support", "display": "Psychosocial Support", "group": "Support",
     "billing_service": "Psychosocial Support", "unit": "session",
     "options": ["Social work", "Peer support (lived experience)", "Occupational therapy",
                 "Family psychoeducation", "Spiritual care (by choice)", "Case management",
                 "Psychoeducation (individual / group)", "Life skills / occupational"]},
    {"code": "nutrition_fitness", "display": "Nutrition & Fitness", "group": "Support",
     "billing_service": "Nutrition & Fitness", "unit": "session",
     "options": ["Fitness programme", "Nutrition assessment & counselling"]},
    {"code": "attachments", "display": "Attachments", "group": "Support",
     "billing_service": None, "unit": "", "options": []},
    {"code": "discharge", "display": "Discharge", "group": "Close-out",
     "billing_service": "Discharge", "unit": "episode",
     "note": "For inpatients: leaving inpatient care; follow-up continues in Psychotherapy, "
             "Psychiatry and Nursing.",
     "options": ["Discharge teaching (teach-back)", "Discharge summary", "Counter-referral letter",
                 "Medical report"]},
    {"code": "follow_up_aftercare", "display": "Follow-up & After-care", "group": "Close-out",
     "billing_service": "Follow-up & After-care", "unit": "visit",
     "note": "Includes 72-hour post-crisis contact and missed-appointment follow-up.",
     "options": ["72-hour contact", "Missed-appointment follow-up", "CRI repeat measure"]},
]
BY_CODE = {m["code"]: m for m in MODULES}

# Care-plan catalogue action (care_plan.CATALOGUE key) → the modules that
# deliver it (the mockup's per-module `actionId`).
ACTION_MODULES = {
    "psych_review": ["psychiatry"],
    "medical_review": ["medical_review", "blood_work"],
    "detox": ["withdrawal_management", "medical_review"],
    "safety": ["observation_safety", "restrictive_practice"],
    "therapy": ["psychotherapy", "group_psychotherapy"],
    "admission": ["admission", "psychiatric_nursing"],
    "outpatient": ["appointments", "discharge", "follow_up_aftercare"],
    "family": ["psychotherapy"],
    "social": ["psychosocial_support"],
    "nutrition": ["nutrition_fitness"],
    "referral": ["emergency_care"],
}
# A clinician-added action has no catalogue key; its `care-module` code decides.
CARE_MODULE_MODULES = {
    "ADMISSION": ["admission"],
    "PSYCHIATRY": ["psychiatry"],
    "NURSING": ["psychiatric_nursing"],
    "MEDICATION": ["psychiatric_nursing"],
    "THERAPY": ["psychotherapy", "group_psychotherapy"],
    "ASSESSMENT": ["medical_review"],
}
# care_plan.recommended_modules keys → module. Restrictive practice is never
# recommended (mockup: no signal), even when the safety action is in the plan.
PLAN_RECOMMENDATION_MODULES = {
    "sbar": "psychiatry",
    "meds": "psychiatry",
    "labs": "blood_work",
    "withdrawal": "withdrawal_management",
    "obs": "observation_safety",
    "therapy": "psychotherapy",
    "mar": "psychiatric_nursing",
    "legal": "admission",
    "oat": "opioid_agonist_therapy",
}

REASONS = {
    "emergency_care": "An acute psychosis or risk-to-others flag is recorded",
    "observation_safety": "A safety-related alert or flag is recorded",
    "blood_work": "A medicine requiring drug-level monitoring is listed",
    "medical_review": "Withdrawal, severe intoxication, or abnormal observations are documented",
    "appointments": "A next appointment is recorded",
    "psychiatry": "A diagnosis is recorded in this client record",
    "admission": "The client record indicates inpatient care",
    "withdrawal_management": "Diagnosis, alert, or flag references substance use or withdrawal",
    "opioid_agonist_therapy": "Opioid use or withdrawal is documented",
    "psychiatric_nursing": "The client record indicates inpatient care",
    "group_psychotherapy": (
        "The client is linked to a group therapy session or a relevant mental-health "
        "diagnosis is documented"
    ),
    "psychotherapy": "Psychological therapy is in the care plan or a relevant diagnosis is recorded",
    "discharge": "The client record indicates inpatient care",
    "follow_up_aftercare": "Follow-up is in the care plan or an appointment is recorded",
}

# Heuristic: medicine names the mockup treats as needing drug-level monitoring.
DRUG_LEVEL_MEDICINES = re.compile(r"lithium|valproate|clozapine", re.I)
SUBSTANCE_CODES = {_code("Alcohol"), _code("Opioids")}
SAFETY_ALERTS = {"SUICIDE_RISK", "AGGRESSION_RISK", "SAFEGUARDING"}
MEDICAL_ALERTS = {"WITHDRAWAL_RISK", "ABNORMAL_VITALS", "ALTERED_CONSCIOUSNESS"}


def modules_for_activity(activity):
    if activity.action_key:
        return ACTION_MODULES.get(activity.action_key, [])
    return CARE_MODULE_MODULES.get(activity.module, [])


# Modules whose charge is already raised by their own workflow (admitting a
# client, signing a discharge). Recording a delivery there must not bill again.
CHARGED_BY_WORKFLOW = {"admission": "admitting the client", "discharge": "signing the discharge"}


def billing_service_for(code):
    """The facility's active tariff line for a module, or None (not separately
    priced, charged by its own workflow, or the facility has not set the service up)."""
    from .models import BillingService

    name = BY_CODE[code]["billing_service"] if code in BY_CODE else None
    if not name or code in CHARGED_BY_WORKFLOW:
        return None
    return BillingService.objects.filter(name=name, active=True).first()


def _facts(patient, actions, register, diagnoses, medicines):
    from apps.client_registry.models import Appointment
    from apps.mhp_program.models import PsychotherapySession

    from . import services, withdrawal
    from .models import ClinicalAlert, InterventionRecord

    register_keys = {item["key"] for item in register}
    return {
        "alerts": set(
            ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").values_list(
                "alert_code", flat=True
            )
        ),
        "register": register_keys,
        "safety_score": any(k.startswith("score:") and k.endswith(":safety") for k in register_keys),
        "withdrawal_chart": any(k.startswith("withdrawal:") for k in register_keys),
        "dx": " ".join(d["description"] for d in diagnoses).lower(),
        "has_dx": bool(diagnoses),
        "inpatient": services.current_admission(patient) is not None,
        "substance": withdrawal.main_substance(patient),
        "opioid": withdrawal.is_opioid(patient),
        "drug_level": any(DRUG_LEVEL_MEDICINES.search(m["name"]) for m in medicines),
        "next_appointment": Appointment.objects.filter(
            patient=patient, status="SCHEDULED", scheduled_for__gte=timezone.now()
        ).exists(),
        "group": PsychotherapySession.objects.filter(patient=patient, session_type="GROUP").exists()
        or InterventionRecord.objects.filter(
            patient=patient, module="group_psychotherapy", voided_at__isnull=True
        ).exists(),
        "action_keys": {a.action_key for a in actions},
    }


def _signal(code, f):
    dx = f["dx"]
    if code == "emergency_care":
        return "AGGRESSION_RISK" in f["alerts"] or bool({"risk:violence", "psychosis"} & f["register"])
    if code == "observation_safety":
        return bool(SAFETY_ALERTS & f["alerts"]) or bool(
            {"risk:suicide", "risk:violence"} & f["register"]
        ) or f["safety_score"]
    if code == "blood_work":
        return f["drug_level"]
    if code == "medical_review":
        return (
            bool(MEDICAL_ALERTS & f["alerts"]) or "ews" in f["register"] or f["withdrawal_chart"]
            or bool(re.search(r"withdrawal|detox|intoxication", dx))
        )
    if code == "appointments":
        return f["next_appointment"]
    if code == "psychiatry":
        return f["has_dx"]
    if code in ("admission", "psychiatric_nursing", "discharge"):
        return f["inpatient"]
    if code == "withdrawal_management":
        return (
            "WITHDRAWAL_RISK" in f["alerts"] or f["withdrawal_chart"]
            or f["substance"] in SUBSTANCE_CODES
            or bool(re.search(r"withdrawal|detox|alcohol|opioid", dx))
        )
    if code == "opioid_agonist_therapy":
        return f["opioid"] or "opioid" in dx
    if code == "group_psychotherapy":
        return f["group"] or (
            not f["inpatient"] and bool(re.search(r"depress|anxiety|panic|bipolar|trauma|substance", dx))
        )
    if code == "psychotherapy":
        return "therapy" in f["action_keys"] or not f["inpatient"] or bool(
            re.search(r"depress|anxiety|panic|bipolar", dx)
        )
    if code == "follow_up_aftercare":
        return "outpatient" in f["action_keys"] or f["next_appointment"]
    return False


def _context(patient, actions, register, diagnoses, medicines):
    """v4 `appendModuleRecord` context rows. The risk line is the signed intake
    risk formulation only — a draft is not yet the team's position."""
    from . import intake
    from .interventions import allergy_text

    signed = intake.latest_signed(patient)
    risk = ((signed.sections if signed else {}) or {}).get("risk", {}) or {}
    return {
        "client": f"{patient.get_full_name()} · {patient.citramac_number}",
        "diagnoses": [f"{d['code']} {d['description']}" for d in diagnoses],
        "allergies": allergy_text(patient),
        "risk": (risk.get("summary") or "").strip(),
        "risk_change_72h": (risk.get("change_72h") or "").strip(),
        "alerts": [item["text"] for item in register],
        "medicines": [
            " ".join(part for part in (m["name"], m["dose"], m["frequency"]) if part)
            for m in medicines
        ],
        "goals": [a.title for a in actions],
    }


PRIORITY_ORDER = {"RED": 0, "ORANGE": 1, "YELLOW": 2, "GREEN": 3, "": 4}


def _payer_terms(services):
    """{service id: {"sha_code": str, "preauth": bool}} from the facility's
    configured payer codes — never generated (CLAUDE.md §6)."""
    from apps.insurance_claims.models import ServicePayerCode

    out = {}
    for row in ServicePayerCode.objects.filter(service__in=services, active=True):
        terms = out.setdefault(row.service_id, {"sha_code": "", "preauth": False})
        if row.payer == "SHA":
            terms["sha_code"] = row.payer_code
        terms["preauth"] = terms["preauth"] or row.requires_preauth
    return out


def workspace(patient):
    """Everything the Interventions screen shows: the plan's actions, the
    modules (recommended or not), and the clinical context carried forward."""
    from apps.clinical_encounter.models import DiagnosisCode

    from . import attention, care_plan, services
    from .models import CarePlan, InterventionRecord, MedicationHistoryEntry

    episode = services.current_or_latest_episode(patient)
    plan = CarePlan.objects.filter(episode=episode).first() if episode else None
    actions = list(plan.activities.exclude(decision="DECLINED")) if plan else []
    records = list(
        InterventionRecord.objects.filter(patient=patient, voided_at__isnull=True).select_related(
            "provider"
        )
    )
    register = attention.active_alerts(patient)
    diagnoses = [
        {"code": d.icd11_code.code, "description": d.icd11_code.description}
        for d in DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE")
        .select_related("icd11_code")
    ]
    medicines = list(
        MedicationHistoryEntry.objects.filter(patient=patient, superseded_at__isnull=True)
        .exclude(status="STOPPED")
        .values("name", "dose", "frequency")
    )
    facts = _facts(patient, actions, register, diagnoses, medicines)
    from_plan = care_plan.recommended_modules(patient)

    action_rows = []
    linked = {}
    now = timezone.now()
    actions.sort(key=lambda a: (PRIORITY_ORDER.get(a.priority, 4), a.created_at))
    for activity in actions:
        modules = modules_for_activity(activity)
        for code in modules:
            linked.setdefault(code, activity)
        own = [r for r in records if r.activity_id == activity.id]
        latest = own[0] if own else None
        action_rows.append({
            "id": str(activity.id),
            "title": activity.title,
            "goal": activity.goal,
            "modules": modules,
            "status": activity.status,
            "status_display": activity.get_status_display(),
            "priority": activity.priority,
            "instructions": activity.instructions,
            "decision_display": activity.get_decision_display() if activity.decision else "",
            "why": (activity.why or [""])[0] if activity.why else "",
            "due_at": activity.due_at.isoformat() if activity.due_at else None,
            # v4: past due, not done, and not Routine.
            "overdue": bool(
                activity.due_at and activity.due_at < now and activity.status != "COMPLETED"
                and activity.priority != "GREEN"
            ),
            "records": len(own),
            "latest_by": services.user_display(latest.provider) if latest else "",
            "latest_at": latest.performed_at.isoformat() if latest else None,
        })

    plan_reasons = {}
    for key, titles in from_plan.items():
        code = PLAN_RECOMMENDATION_MODULES.get(key)
        if code:
            plan_reasons.setdefault(code, []).extend(titles)

    displays = dict(_served_concepts().values_list("code", "display"))
    services_by_name = {s.name: s for s in _billing_services()}
    payer = _payer_terms(list(services_by_name.values()))
    module_rows = []
    for spec in MODULES:
        code = spec["code"]
        if code not in displays or not spec.get("listed", True):
            continue  # retired in the served value set, or shown inside another card
        signalled = _signal(code, facts)
        reason = REASONS.get(code, "") if signalled else ""
        if not signalled and code in plan_reasons:
            reason = f"Recommended by the plan: {'; '.join(dict.fromkeys(plan_reasons[code]))}"
        service = services_by_name.get(spec["billing_service"]) if spec["billing_service"] else None
        action = linked.get(code)
        history = spec.get("history_modules", [code])
        terms = payer.get(service.id, {}) if service else {}
        module_rows.append({
            "code": code,
            "name": displays[code],
            "group": spec["group"],
            "options": spec["options"],
            "recommended": bool(reason),
            "reason": reason,
            "action_id": str(action.id) if action else None,
            "billing_service": spec["billing_service"],
            "billable": service is not None and code not in CHARGED_BY_WORKFLOW,
            "charged_by": CHARGED_BY_WORKFLOW.get(code, ""),
            "rate": str(service.rate) if service and service.rate is not None else None,
            "delivered": sum(r.quantity for r in records if r.module in history),
            "history_modules": history,
            "unit": spec["unit"],
            "note": spec.get("note", ""),
            "linked_actions": [
                str(a.id) for a in actions if code in modules_for_activity(a)
            ],
            "sha_code": terms.get("sha_code", ""),
            "preauth": terms.get("preauth", False),
        })

    return {
        "has_plan": bool(actions),
        "plan_signed": bool(plan and plan.versions.exists()),
        "actions": action_rows,
        "modules": module_rows,
        "context": _context(patient, actions, register, diagnoses, medicines),
    }


def _served_concepts():
    from .models import LocalConcept

    return LocalConcept.objects.filter(valueset_id=VALUESET_ID, active=True)


def _billing_services():
    from .models import BillingService

    return BillingService.objects.filter(active=True)


def is_served(code):
    """A module can be recorded against while it is both catalogued and active."""
    return code in BY_CODE and _served_concepts().filter(code=code).exists()


def correct_record(user, record, reason):
    """Void a delivery recorded in error. The record stays (never deleted) and
    its charge stops counting in billing; the reason is kept in its trail."""
    from rest_framework.exceptions import ValidationError

    from . import services

    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationError({"reason": "Give the reason for the correction (at least 5 characters)."})
    if record.voided_at:
        raise ValidationError({"detail": "This record has already been corrected."})
    return services.void_intervention(user, record, reason)
