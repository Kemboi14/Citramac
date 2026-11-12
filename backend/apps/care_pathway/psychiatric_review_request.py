"""Nurse-requested psychiatric reviews, raised from an inpatient admission."""

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import has_permission
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import psychiatric_review
from .models import CareTask, LocalValueSet

FOCUS = "PSYCHIATRIC_REVIEW_REQUEST"
OWNER = "Psychiatry"


def _audit(task, event, detail):
    write_event(
        task.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "care_pathway.caretask",
        task.id,
        {"event": event, "focus": FOCUS, **detail},
    )


def _task_for(admission):
    return (
        CareTask.objects.filter(focus_type=FOCUS, focus_id=str(admission.id))
        .order_by("-created_at")
        .first()
    )


@transaction.atomic
def request(admission, user):
    from apps.ipd_ward.models import Admission

    admission = (
        Admission.objects.select_for_update(of=("self",))
        .select_related("patient", "episode", "encounter")
        .get(pk=admission.pk)
    )
    if admission.status not in ("ADMITTED", "TRANSFERRED"):
        raise ValidationError({"admission": "A psychiatric review requires an active admission."})
    if not admission.episode_id or not admission.encounter_id:
        raise ValidationError(
            {"admission": "This admission has no EpisodeOfCare or Encounter for the review Task."}
        )

    existing = CareTask.objects.filter(
        focus_type=FOCUS,
        focus_id=str(admission.id),
        status__in=("INITIATED", "PENDING"),
    ).first()
    if existing:
        return existing, False

    from .interventions import build_sbar

    urgent = admission.clinical_priority in {"RED", "ORANGE"} or admission.priority == "EMERGENCY"
    task = CareTask.objects.create(
        organization_id=admission.organization_id,
        patient=admission.patient,
        episode=admission.episode,
        encounter=admission.encounter,
        action_code=FOCUS.lower(),
        action_label="Psychiatric review requested",
        owner=OWNER,
        status="INITIATED",
        created_by=user,
        priority="urgent" if urgent else "routine",
        focus_type=FOCUS,
        focus_id=str(admission.id),
        sbar=build_sbar(admission.patient, user),
    )
    _audit(task, "RAISED", {"admission": str(admission.id), "priority": task.priority})
    return task, True


def latest_for_admission(admission):
    return _task_for(admission)


def _require_senior_clinician(user):
    if not has_permission(user, "clinical.care.record") or not has_permission(
        user, "clinical.cosign"
    ):
        raise PermissionDenied("Only a senior clinician can manage a psychiatric review request.")


@transaction.atomic
def start(task, user):
    _require_senior_clinician(user)
    task = CareTask.objects.select_for_update().get(pk=task.pk, focus_type=FOCUS)
    if task.status == "PENDING":
        if task.assignee_id == user.pk:
            return task
        raise PermissionDenied("This psychiatric review is assigned to another clinician.")
    if task.status != "INITIATED":
        raise ValidationError({"status": "This psychiatric review is no longer waiting to start."})

    task.status = "PENDING"
    task.assignee = user
    task.owner = (user.get_full_name() or str(user))[:150]
    task.save(update_fields=["status", "assignee", "owner", "updated_at"])
    _audit(task, "STARTED", {})
    return task


@transaction.atomic
def complete(task, user, outcome, note=""):
    _require_senior_clinician(user)
    task = CareTask.objects.select_for_update().get(pk=task.pk, focus_type=FOCUS)
    if task.status != "PENDING":
        raise ValidationError(
            {"status": "Start the psychiatric review before recording its outcome."}
        )
    if task.assignee_id != user.pk:
        raise PermissionDenied("Only the psychiatrist who started this review can complete it.")
    if not isinstance(outcome, str) or not outcome:
        raise ValidationError({"outcome": "Choose the outcome of the review."})

    valueset = LocalValueSet.objects.filter(id="psychiatric-review-outcome").first()
    if valueset is None:
        raise ValidationError({"outcome": "Psychiatric review outcomes are not configured."})
    concept = valueset.concepts.filter(code=outcome, active=True).first()
    if concept is None:
        raise ValidationError({"outcome": "Choose an active, served psychiatric review outcome."})
    if not isinstance(note, str):
        raise ValidationError({"outcome_note": "Enter a text outcome note."})

    task.status = "COMPLETED"
    task.outcome = concept.code
    task.outcome_note = note.strip()[:500]
    task.completed_at = timezone.now()
    task.completed_by = user
    task.save(
        update_fields=[
            "status",
            "outcome",
            "outcome_note",
            "completed_at",
            "completed_by",
            "updated_at",
        ]
    )
    _audit(task, "COMPLETED", {"outcome": task.outcome})
    return task


def inbox(user):
    if not has_permission(user, "clinical.care.record") or not has_permission(
        user, "clinical.cosign"
    ):
        return CareTask.objects.none()
    return (
        CareTask.objects.filter(focus_type=FOCUS, status__in=("INITIATED", "PENDING"))
        .filter(Q(assignee__isnull=True) | Q(assignee=user))
        .select_related("patient", "created_by", "completed_by", "assignee")
        .order_by("created_at")
    )


def row(task, include_sbar=False):
    result = {
        "id": str(task.id),
        "patient_id": str(task.patient_id),
        "patient_name": task.patient.get_full_name(),
        "kind": "PSYCHIATRIC_REVIEW",
        "what": task.action_label,
        "status": task.status,
        "requested_by": (
            task.created_by.get_full_name() or str(task.created_by) if task.created_by else ""
        ),
        "requested_at": task.created_at,
        "decided_by": (
            task.completed_by.get_full_name() or str(task.completed_by) if task.completed_by else ""
        ),
        "decided_at": task.completed_at,
        "decline_reason": "",
        "thread": [],
        "inbox_kind": "psychiatric_review",
        "priority": task.priority,
        "assignee": str(task.assignee_id) if task.assignee_id else None,
        "assignee_name": (
            task.assignee.get_full_name() or str(task.assignee) if task.assignee else ""
        ),
        "outcome": task.outcome,
        "outcome_label": psychiatric_review.OUTCOMES.get(task.outcome, ""),
        "outcome_note": task.outcome_note,
    }
    if include_sbar:
        result["sbar"] = task.sbar
    return result
