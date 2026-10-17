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
# separately priced), sub-type options — all as the v4 mockup.
MODULES = [
    {"code": "emergency_care", "display": "Emergency Care", "group": "Assess",
     "billing_service": "Emergency Care",
     "options": ["Stabilisation review", "De-escalation support", "SBAR handover",
                 "Transfer coordination"]},
    {"code": "observation_safety", "display": "Observation & Safety", "group": "Assess",
     "billing_service": None,
     "options": ["Observation level & reason", "Observation review", "Step-down review"]},
    {"code": "blood_work", "display": "Blood Work", "group": "Assess",
     "billing_service": "Blood Work",
     "options": ["Order-set review", "Organic work-up coordination",
                 "Drug-level monitoring coordination"]},
    {"code": "medical_review", "display": "Medical Review", "group": "Assess",
     "billing_service": "Medical Review",
     "options": ["Physical health review", "Abnormal observation review", "Medical clearance",
                 "Transfer decision"]},
    {"code": "appointments", "display": "Appointments", "group": "Assess",
     "billing_service": "Appointments",
     "options": ["Psychiatry review appointment", "Outpatient follow-up"]},
    {"code": "psychiatry", "display": "Psychiatry", "group": "Treat",
     "billing_service": "Psychiatry",
     "options": ["Initial consultation", "Psychiatric review", "Risk formulation",
                 "Medication review"]},
    {"code": "admission", "display": "Admission", "group": "Treat",
     "billing_service": "Admission",
     "options": ["Admission review", "Ward coordination", "Rights-information follow-up"]},
    {"code": "withdrawal_management", "display": "Withdrawal Management (Detox)", "group": "Treat",
     "billing_service": "Withdrawal Management (Detox)",
     "options": ["Withdrawal assessment", "Withdrawal monitoring", "Review of withdrawal plan",
                 "Medical escalation"]},
    {"code": "opioid_agonist_therapy", "display": "Opioid Agonist Therapy", "group": "Treat",
     "billing_service": "Opioid Agonist Therapy",
     "options": ["Methadone review", "Buprenorphine review",
                 "Naloxone / overdose-risk education"]},
    {"code": "psychiatric_nursing", "display": "Psychiatric Nursing", "group": "Treat",
     "billing_service": "Psychiatric Nursing",
     "options": ["Medication Administration Record (MAR)", "PRN effectiveness review",
                 "Physical-care chart review", "SBAR shift handover"]},
    {"code": "restrictive_practice", "display": "Restrictive Practice", "group": "Treat",
     "billing_service": None,
     "options": ["De-escalation attempted", "Authorisation review",
                 "Monitoring and safety checks", "Patient debrief"]},
    {"code": "group_psychotherapy", "display": "Group Psychotherapy", "group": "Treat",
     "billing_service": None,
     "options": ["Stress-management group", "Coping skills group", "Relapse-prevention group",
                 "Psychoeducation group", "Peer-support group"]},
    {"code": "psychotherapy", "display": "Psychotherapy", "group": "Treat",
     "billing_service": "Psychotherapy",
     "options": ["CBT session", "Individual therapy", "Group therapy", "Family therapy",
                 "Psychoeducation"]},
    {"code": "psychosocial_support", "display": "Psychosocial Support", "group": "Support",
     "billing_service": "Psychosocial Support",
     "options": ["Social-work coordination", "Peer support", "Family psychoeducation",
                 "Case management"]},
    {"code": "nutrition_fitness", "display": "Nutrition & Fitness", "group": "Support",
     "billing_service": "Nutrition & Fitness",
     "options": ["Nutrition assessment coordination", "Fitness-programme referral"]},
    {"code": "attachments", "display": "Attachments", "group": "Support",
     "billing_service": None,
     "options": ["Attach clinical document", "Attach referral / correspondence"]},
    {"code": "discharge", "display": "Discharge", "group": "Close-out",
     "billing_service": "Discharge",
     "options": ["Discharge planning", "Discharge summary", "Counter-referral coordination"]},
    {"code": "follow_up_aftercare", "display": "Follow-up & After-care", "group": "Close-out",
     "billing_service": "Follow-up & After-care",
     "options": ["Outpatient psychiatry follow-up", "Missed-appointment follow-up",
                 "Care-plan review"]},
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
    from .interventions import allergy_text

    return {
        "client": f"{patient.get_full_name()} · {patient.citramac_number}",
        "diagnoses": [f"{d['code']} {d['description']}" for d in diagnoses],
        "allergies": allergy_text(patient),
        "alerts": [item["text"] for item in register],
        "medicines": [
            " ".join(part for part in (m["name"], m["dose"], m["frequency"]) if part)
            for m in medicines
        ],
        "goals": [a.title for a in actions],
    }


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
    module_rows = []
    for spec in MODULES:
        code = spec["code"]
        if code not in displays:
            continue  # retired in the served value set
        signalled = _signal(code, facts)
        reason = REASONS.get(code, "") if signalled else ""
        if not signalled and code in plan_reasons:
            reason = f"Recommended by the plan: {'; '.join(dict.fromkeys(plan_reasons[code]))}"
        service = services_by_name.get(spec["billing_service"]) if spec["billing_service"] else None
        action = linked.get(code)
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
            "delivered": sum(r.quantity for r in records if r.module == code),
        })

    return {
        "has_plan": bool(actions),
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
