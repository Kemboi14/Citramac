"""
Section N → care plan → Interventions, as one piece of work (guide.md 2026-11-18).

A ticked Section N action, once registered as a named person's task, is added
to the episode's care plan as an accepted action ("Started at triage by …"),
which is what opens its Interventions module. The triage task *is* that
action's task: the care plan and Interventions show it, its checklist steps go
to the same person (care_plan.sync_tasks), opening it goes to the work, and the
work itself completes it.

- Several ticks for one care-plan action become one action carrying every task.
- A plan that is already signed is not changed: the action is an accepted
  addition that the care-plan clinician signs into the next version.
- An action the plan had declined is accepted again: the triaging clinician
  has just decided it is needed. The earlier decline stays in the signed version.
- Actions with no care-plan home stay named tasks only, and still open the
  screen where the work is done.
- A psychiatric review is never completed here: it needs its coded outcome.

FHIR: the task stays an R4 `Task`, with `basedOn` → the episode's `CarePlan`;
the accepted action is a `CarePlan.activity`. No new code system.
"""

from django.db import transaction
from django.utils import timezone

from .models import CarePlan, CareTask

# Section N `triage-action` code → care-plan catalogue key (care_plan.CATALOGUE).
TRIAGE_TO_PLAN = {
    "safety_plan": "safety",
    "enhanced_observation": "safety",
    "psychiatric_review": "psych_review",
    "psychiatric_review_withdrawal": "psych_review",
    "urgent_psychiatric_review": "psych_review",
    "priority_psychiatric_review": "psych_review",
    "routine_psychiatric_review": "psych_review",
    "urgent_medical_review": "medical_review",
    "withdrawal_monitoring": "detox",
    "detox_assessment": "detox",
    "pawss": "detox",
    "ciwa_ar": "detox",
    "cows": "detox",
    "admission_assessment": "admission",
    "outpatient_appointment": "outpatient",
    "emergency_transfer": "referral",
    "external_referral": "referral",
    "safeguarding_intervention": "safeguarding",
}

# Care-plan key → the Interventions module the task opens on.
PLAN_MODULE = {
    "safety": "observation_safety",
    "psych_review": "psychiatry",
    "medical_review": "medical_review",
    "detox": "withdrawal_management",
    "outpatient": "appointments",
    "referral": "emergency_care",
    "safeguarding": "psychosocial_support",
}

STARTED_AT_TRIAGE = "Started at triage by {name}"


def _triage_priority(te):
    from .care_plan import RANK

    assessment = te.assessments.order_by("-version").first()
    priority = assessment.final_priority if assessment else ""
    return priority if priority in RANK else ""


def _accept(plan, te, key, user):
    """The care-plan action for `key`, accepted (or added) by the triaging clinician."""
    from . import care_plan
    from .services import user_display

    activity = plan.activities.filter(action_key=key).first()
    if activity is not None and activity.decision != "DECLINED":
        return activity
    rec = care_plan.recommend(plan.patient).get(key)
    priority = rec["priority"] if rec else (_triage_priority(te) or "GREEN")
    activity = care_plan.decide_action(
        plan, user, key, "ACCEPTED" if rec else "ADDED", priority=priority
    )
    note = STARTED_AT_TRIAGE.format(name=user_display(user))
    activity.why = [*(activity.why or []), note]
    activity.save(update_fields=["why", "updated_at"])
    return activity


@transaction.atomic
def link_registered_tasks(te, tasks, user):
    """Put newly registered Section N tasks on the episode's care plan. Returns
    the activities they now belong to."""
    if not te.episode_id:
        return []
    by_key = {}
    for task in tasks:
        key = TRIAGE_TO_PLAN.get(task.action_code)
        if key and task.care_plan_activity_id is None:
            by_key.setdefault(key, []).append(task)
    if not by_key:
        return []
    plan, _ = CarePlan.objects.get_or_create(
        episode=te.episode,
        defaults={"organization_id": te.organization_id, "patient": te.patient},
    )
    activities = []
    for key, group in by_key.items():
        activity = _accept(plan, te, key, user)
        CareTask.objects.filter(pk__in=[t.pk for t in group]).update(care_plan_activity=activity)
        for task in group:
            task.care_plan_activity = activity
        activities.append(activity)
    return activities


def task_link(task):
    """Where opening this task takes the clinician: the screen the work is done on."""
    patient = task.patient_id
    key = TRIAGE_TO_PLAN.get(task.action_code)
    if key == "admission":
        return f"/clinical/inpatient?patient={patient}"
    module = PLAN_MODULE.get(key)
    if module:
        return f"/clinical/clients/{patient}/interventions?module={module}"
    if task.action_code == "comprehensive_intake":
        return f"/clinical/clients/{patient}/intake"
    if task.triage_encounter_id:
        return f"/clinical/triage/{task.triage_encounter_id}"
    return f"/clinical/clients/{patient}/snapshot"


def _complete(tasks, user):
    now = timezone.now()
    done = 0
    for task in tasks:
        if task.focus_type or task.completed_at or task.status == "COMPLETED":
            continue
        task.status = "COMPLETED"
        task.completed_at = now
        task.completed_by = user
        task.save(update_fields=["status", "completed_at", "completed_by", "updated_at"])
        done += 1
    return done


def _start(tasks):
    for task in tasks:
        if not task.focus_type and task.status == "INITIATED":
            task.status = "PENDING"
            task.save(update_fields=["status", "updated_at"])


def _unlinked_tasks(activity):
    """The client's open Section N tasks for this action that were registered
    before tasks were linked to care-plan actions (2026-11-18): matched by
    their triage action code, never a task that needs a coded outcome."""
    codes = [code for code, key in TRIAGE_TO_PLAN.items() if key == activity.action_key]
    if not codes:
        return []
    return list(
        CareTask.objects.filter(
            patient_id=activity.care_plan.patient_id,
            action_code__in=codes,
            care_plan_activity__isnull=True,
            focus_type="",
        ).exclude(status="COMPLETED")
    )


def close_unlinked_for_completed(patient, user):
    """One-off for actions completed before unlinked tasks were closed with them."""
    from .models import CarePlanActivity

    done = 0
    for activity in CarePlanActivity.objects.filter(
        care_plan__patient=patient, status="COMPLETED"
    ).select_related("care_plan"):
        done += _complete(_unlinked_tasks(activity), user)
    return done


def work_recorded(activity, user, completes):
    """A delivery was recorded against a care-plan action: its triage tasks are
    in progress, or done when the delivery completes the action."""
    if activity is None:
        return
    tasks = list(activity.triage_tasks.all()) + _unlinked_tasks(activity)
    if completes:
        _complete(tasks, user)
    else:
        _start(tasks)


def safety_plan_signed(patient, user):
    """Signing the client's safety plan is the work a Safety Plan task asks for."""
    tasks = CareTask.objects.filter(patient=patient, action_code="safety_plan").exclude(
        status="COMPLETED"
    )
    return _complete(list(tasks), user)
