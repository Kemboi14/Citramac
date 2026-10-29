"""
Signing a v4 triage (triage_v4.py) — the v4 counterpart of services.sign_triage.

What a signature writes, all inside one transaction:
- the TriageAssessment, locked, with the v4 recommendation, reasons, findings
  (each row stamped with time and recorder — AT-20) and RULES_VERSION;
- the priority on the TriageEncounter and the re-check time;
- clinical alerts (Flag) for every trigger, whatever the source (AT-08);
- the vital signs, with ACVPU consciousness and supplemental oxygen, into the
  shared VitalSigns store so the early-warning score is complete;
- the waiting-room observation level and named observer into the shared
  observation store (interventions.py);
- timed tasks: call-back, PEP / emergency-contraception decision, the
  duty-to-protect senior decision;
- co-signature requests: a priority downgrade by a clinician who cannot
  co-sign, and the duty-to-protect decision;
- an OVERRIDE audit entry whenever the clinician departs from the system
  recommendation (TRI-M-06, AT-05).
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import plan_extras, triage_rules
from . import triage_v4 as v4
from .models import (
    PRIORITY_ORDER,
    CareTask,
    ClinicalAlert,
    ObservationLevelChange,
    ObserverHandover,
    TriageEncounter,
)

CALLBACK_OWNER_LABELS = dict(v4.VALUESETS["triage-v4-callback-owner"][1])


def _error(problems):
    # No "detail" key: the project exception handler would collapse the dict to a
    # single message and drop the keys the screen uses to focus each item.
    return ValidationError(
        {
            "problems": [message for message, _key in problems],
            "missing_keys": [key for _message, key in problems],
        }
    )


@transaction.atomic
def sign_triage_v4(triage_encounter, user, payload, rules=v4):
    """`rules` is the rule-set module: triage_v4, or triage_v5 (same interface;
    a v5 signature also writes the shared clinical finding store)."""
    from . import findings, services

    if triage_encounter.status not in (
        TriageEncounter.STATUS_AWAITING,
        TriageEncounter.STATUS_IN_TRIAGE,
    ):
        raise ValidationError({"detail": "This triage has already been signed."})
    raw = payload.get("answers") or {}
    answers = rules.clean_answers(raw)  # X-08: hidden fields are never stored
    labels = services.concept_labels()
    result = rules.evaluate(answers, labels)
    recommended = result["priority"]
    final = payload.get("final_priority") or answers.get("m_final_priority") or recommended
    if final not in PRIORITY_ORDER:
        raise ValidationError({"final_priority": "Select a final priority."})
    override = final != recommended
    reason = (payload.get("override_reason") or answers.get("m_override_reason") or "").strip()

    problems = rules.required_problems(answers) + rules.safety_problems(answers, final)
    if problems:
        raise _error(problems)
    if override and len(reason) < rules.OVERRIDE_REASON_MIN:
        # TRI-M-05 / AT-05: an override is blocked without a reason.
        raise _error(
            [
                (
                    "Override reason — why your clinical judgement differs (a full sentence)",
                    "m_override_reason",
                )
            ]
        )
    downgrade = triage_rules.PRIORITY_RANK[final] < triage_rules.PRIORITY_RANK[recommended]
    senior = plan_extras.can_cosign(user)

    now = timezone.now()
    by = services.user_display(user)
    answers["m_decision"] = "OVERRIDE" if override else "CONFIRM"
    answers["m_final_priority"] = final
    answers["m_override_reason"] = reason if override else ""
    if downgrade:
        answers["m_cosign"] = "self" if senior else "requested"
    else:
        answers.pop("m_cosign", None)

    assessment = services.save_triage_draft(triage_encounter, user, answers)
    assessment.findings = rules.stamp_findings(result["finding_items"], now.isoformat(), by)
    assessment.alerts = result["alerts"]
    assessment.recommendation = result["recommendation"]
    assessment.recommendation_reasons = result["reasons"]
    assessment.final_priority = final
    assessment.decision = answers["m_decision"]
    assessment.override_reason = answers["m_override_reason"]
    assessment.rules_version = rules.RULES_VERSION
    assessment.tasks_snapshot = [
        {**t, "created_at": t["created_at"].isoformat()}
        for t in triage_encounter.tasks.values("action_label", "owner", "status", "created_at")
    ]
    assessment.signed_at = now
    assessment.signed_by = user
    assessment.status = "COMPLETED"
    assessment.save()

    patient = triage_encounter.patient
    present = rules.present_of(answers) == "yes"
    triage_encounter.priority = final
    concern = (answers.get("c_concern") or "").strip()
    if concern:
        triage_encounter.presenting_concern = concern
    triage_encounter.triage_version += 1
    triage_encounter.status = TriageEncounter.STATUS_COMPLETED
    triage_encounter.last_triaged_at = now
    triage_encounter.last_triaged_by = user
    # Quick re-checks are for a client who is here; a telephone triage has its
    # call-back / arrival task instead (mockup patientPending).
    triage_encounter.next_recheck_at = (
        triage_rules.recheck_due_after(final, now) if present else None
    )
    triage_encounter.save()

    encounter = triage_encounter.encounter
    if encounter.status != "CLOSED":
        encounter.status = "CLOSED"
        encounter.closed_at = now
        encounter.save(update_fields=["status", "closed_at", "updated_at"])

    active = set(
        ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").values_list(
            "alert_code", flat=True
        )
    )
    for alert in result["alerts"]:
        if alert["code"] not in active:
            ClinicalAlert.objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                alert_code=alert["code"],
                label=alert["label"],
                source_assessment=assessment,
                raised_at=now,
                raised_by=user,
            )

    if hasattr(rules, "domain_findings"):
        findings.record_from_triage(
            assessment, rules.domain_findings(answers, labels), user, now
        )
    if present:
        _record_vitals(encounter, user, answers, now)
        _record_observation(patient, user, answers, assessment.version, labels)
    _create_tasks(triage_encounter, user, answers, assessment, labels)
    services.apply_triage_allergies(patient, answers, user)

    if downgrade and not senior:
        plan_extras.request_cosign(
            patient,
            user,
            "TRIAGE_DOWNGRADE",
            f"Triage downgrade {recommended} → {final} (triage v{assessment.version}): {reason}"[
                :300
            ],
            "TriageAssessment",
            assessment.id,
        )
    if override:
        write_event(
            assessment.organization_id,
            AuditLogEntry.ACTION_UPDATE,
            "care_pathway.triageassessment",
            assessment.id,
            {
                "event": "OVERRIDE",
                "system_priority": recommended,
                "final_priority": final,
                "reason": reason,
                "rules_version": rules.RULES_VERSION,
                "clinician": by,
                "at": now.isoformat(),
                "cosign": answers.get("m_cosign", ""),
            },
        )
    return assessment


def _record_vitals(encounter, user, answers, now):
    from apps.triage.models import VitalSigns

    values = {}
    for key, (field, _ews) in v4.VITALS.items():
        raw = (answers.get(key) or "").strip() if isinstance(answers.get(key), str) else ""
        if raw:
            number = float(raw)
            values[field] = (
                round(number, 1)
                if field in ("temperature_c", "blood_glucose_mmol")
                else int(round(number))
            )
    acvpu = answers.get("acvpu") if answers.get("acvpu") in v4.ACVPU_SCORED else ""
    o2 = answers.get("v_o2")
    if not values and not acvpu:
        return None
    # v5 records when they were measured and where they come from.
    measured = v4.parse_local_datetime(answers.get("v_measured_at"))
    return VitalSigns.objects.create(
        organization_id=encounter.organization_id,
        encounter=encounter,
        recorded_by=user,
        recorded_at=measured or now,
        source=answers.get("v_source") or "",
        consciousness=acvpu,
        supplemental_o2=(o2 == "supplemental") if o2 else None,
        **values,
    )


def _record_observation(patient, user, answers, version, labels):
    level = answers.get("safety_obs") or ""
    if level:
        current = ObservationLevelChange.objects.filter(patient=patient).first()
        if not current or current.level != level:
            where = answers.get("safety_location") or ""
            reason = f"Set at triage v{version}"
            if where:
                reason += f" — waits in: {labels.get(('triage-v4-location', where), where)}"
            ObservationLevelChange.objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                level=level,
                reason=reason[:400],
                changed_by=user,
            )
    observer = (answers.get("safety_observer") or "").strip()
    if observer:
        current = ObserverHandover.objects.filter(patient=patient).first()
        if not current or current.observer_name != observer:
            ObserverHandover.objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                observer_name=observer[:150],
                observer_gender=(answers.get("safety_observer_gender") or "")[:10],
                recorded_by=user,
            )


def _task(te, user, focus, label, owner, due, priority="urgent"):
    exists = CareTask.objects.filter(
        triage_encounter=te, focus_type=focus, status__in=("INITIATED", "PENDING")
    ).first()
    if exists:
        changed = []
        if exists.due_at != due:
            exists.due_at = due
            changed.append("due_at")
        if exists.action_label != label:
            exists.action_label = label
            changed.append("action_label")
        if changed:
            exists.save(update_fields=changed + ["updated_at"])
        return exists
    return CareTask.objects.create(
        organization_id=te.organization_id,
        patient=te.patient,
        triage_encounter=te,
        action_code=focus.lower(),
        action_label=label[:255],
        owner=owner[:150],
        status="INITIATED",
        created_by=user,
        priority=priority,
        due_at=due,
        focus_type=focus,
    )


def _create_tasks(te, user, answers, assessment, labels):
    flags = answers.get("flags") or []
    # v4 flags, or the v5 answers that open the same detail blocks.
    gbv = "gbv_72h" in flags or answers.get("i_sv_recent") == "yes"
    duty = "homicidal_named" in flags or answers.get("e_named") == "yes"
    if v4.present_of(answers) == "no" and answers.get("r_disposition") == "callback":
        due = v4.parse_local_datetime(answers.get("r_callback_at"))
        owner = CALLBACK_OWNER_LABELS.get(answers.get("r_callback_owner"), "Triage nurse")
        informant = labels.get(
            ("triage-informant", answers.get("b_informant") or "client"), "caller"
        )
        _task(
            te, user, "TRIAGE_CALLBACK", f"Call back ({informant}) — telephone triage", owner, due
        )
    if gbv:
        closes = v4.pep_deadline(answers)
        _task(
            te,
            user,
            "PEP_EC_DECISION",
            f"PEP & emergency-contraception decision — window closes "
            f"{timezone.localtime(closes).strftime('%Y-%m-%d %H:%M') if closes else '—'}",
            "Clinician on duty",
            closes,
            "asap",
        )
    # v5 H — the next step chosen for an acute medical concern.
    step = answers.get("h_next")
    if step == "urgent_medical_review":
        _task(
            te,
            user,
            "URGENT_MEDICAL_REVIEW",
            "Urgent medical review — acute medical concern",
            "Medical officer on duty",
            None,
            "asap",
        )
    elif step == "psychiatric_review":
        _task(
            te,
            user,
            "URGENT_PSYCHIATRIC_REVIEW",
            "Psychiatric review — acute medical concern",
            "Psychiatry on duty",
            None,
        )
    elif step == "refer_out":
        _task(
            te,
            user,
            "EXTERNAL_REFERRAL",
            f"Refer to {answers.get('h_refer_facility') or 'another facility'} — acute medical "
            "concern",
            "Triage clinician",
            None,
            "asap",
        )
    if duty:
        _task(
            te,
            user,
            "DUTY_TO_PROTECT",
            "Duty to protect — senior decision on informing the named person / police",
            "Senior clinician",
            None,
            "asap",
        )
        plan_extras.request_cosign(
            te.patient,
            user,
            "DUTY_TO_PROTECT",
            "Duty to protect — decide on informing the named person / police",
            "TriageAssessment",
            assessment.id,
        )
