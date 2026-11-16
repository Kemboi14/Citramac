"""General psychiatry review tasks raised from triage Section N."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from .models import CareTask, TriageEncounter

FOCUS = "TRIAGE_PSYCHIATRIC_REVIEW"
ACTION_CODE = "psychiatric_review"
URGENT_PRIORITIES = {"RED", "ORANGE"}


def for_triage(triage_encounter):
    return (
        CareTask.objects.filter(triage_encounter=triage_encounter, focus_type=FOCUS)
        .order_by("-created_at")
        .first()
    )


def _audit(task, event, detail):
    write_event(
        task.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "care_pathway.caretask",
        task.id,
        {"event": event, "focus": FOCUS, **detail},
    )


def _priority(triage_priority):
    if triage_priority in URGENT_PRIORITIES:
        return "urgent"
    if triage_priority in {"YELLOW", "GREEN"}:
        return "routine"
    return ""


@transaction.atomic
def register(triage_encounter, user, person, status, label):
    triage_encounter = TriageEncounter.objects.select_for_update().get(pk=triage_encounter.pk)
    existing = for_triage(triage_encounter)
    if existing:
        return existing, False
    task = CareTask.objects.create(
        organization_id=triage_encounter.organization_id,
        patient=triage_encounter.patient,
        triage_encounter=triage_encounter,
        action_code=ACTION_CODE,
        action_label=label,
        owner=person["name"][:150],
        assignee_id=person["id"],
        status=status,
        created_by=user,
        priority=_priority(triage_encounter.priority),
        focus_type=FOCUS,
    )
    _audit(task, "RAISED", {"triage_priority": triage_encounter.priority})
    return task, True


def set_final_priority(triage_encounter, priority):
    task = for_triage(triage_encounter)
    mapped = _priority(priority)
    if task and mapped and task.priority != mapped:
        task.priority = mapped
        task.save(update_fields=["priority", "updated_at"])
        _audit(task, "PRIORITY_SET", {"triage_priority": priority, "priority": mapped})


def start(triage_encounter):
    task = for_triage(triage_encounter)
    if task and task.status == "INITIATED":
        task.status = "PENDING"
        task.save(update_fields=["status", "updated_at"])
        _audit(task, "STARTED", {})
    return task


@transaction.atomic
def set_status(task, user, status):
    if status not in dict(CareTask.STATUS_CHOICES):
        raise ValidationError({"status": "Choose a valid task status."})
    if task.status == status:
        return task
    task.status = status
    if status == "COMPLETED":
        task.completed_at = timezone.now()
        task.completed_by = user
    else:
        task.completed_at = None
        task.completed_by = None
    task.save(update_fields=["status", "completed_at", "completed_by", "updated_at"])
    _audit(task, "STATUS_CHANGED", {"status": status})
    return task
