"""
Psychiatric review on withdrawal (triage spec item 10; owner decision
2026-10-29): when withdrawal from any substance is suspected or identified —
at a signed triage, or first at a signed intake — the client is flagged for
psychiatric review. The flag is a CareTask (FHIR Task) that records the
trigger, its status and its outcome:

- raised (INITIATED, FHIR "requested") with the reasons, urgent when the
  triage priority is RED / ORANGE, routine otherwise;
- in progress (PENDING) once the psychiatry review is opened;
- completed only with a coded outcome (`psychiatric-review-outcome`).

Every raise, start and outcome is an audit entry. One review per triage
encounter: a later finding of withdrawal does not raise a second one.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from .models import CareTask

FOCUS = "PSYCHIATRIC_REVIEW_WITHDRAWAL"
OWNER = "Psychiatry"
URGENT_PRIORITIES = {"RED", "ORANGE"}

VALUESETS = {
    "psychiatric-review-outcome": (
        "Psychiatric review — outcome",
        [
            ("managed_here", "Reviewed — managed here"),
            ("admitted_withdrawal", "Reviewed — admitted for withdrawal management"),
            ("referred_out", "Reviewed — referred out"),
            ("withdrawal_not_confirmed", "Reviewed — withdrawal not confirmed"),
            ("not_reviewed", "Not reviewed — client left / declined"),
        ],
    ),
}
OUTCOMES = dict(VALUESETS["psychiatric-review-outcome"][1])


def _audit(task, event, detail):
    write_event(
        task.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "care_pathway.caretask",
        task.id,
        {"event": event, "focus": FOCUS, **detail},
    )


def for_triage(triage_encounter):
    return (
        CareTask.objects.filter(triage_encounter=triage_encounter, focus_type=FOCUS)
        .order_by("-created_at")
        .first()
    )


@transaction.atomic
def request(triage_encounter, user, reasons, priority, source):
    """Raise the review for this triage encounter unless one already exists
    (in any status). `source` is "triage" or "intake"."""
    if triage_encounter is None or not reasons:
        return None
    existing = for_triage(triage_encounter)
    if existing:
        return existing
    task = CareTask.objects.create(
        organization_id=triage_encounter.organization_id,
        patient=triage_encounter.patient,
        triage_encounter=triage_encounter,
        action_code=FOCUS.lower(),
        action_label=f"Psychiatric review — withdrawal ({'; '.join(reasons)})"[:255],
        owner=OWNER,
        status="INITIATED",
        created_by=user,
        priority="urgent" if priority in URGENT_PRIORITIES else "routine",
        focus_type=FOCUS,
    )
    _audit(task, "RAISED", {"source": source, "reasons": reasons, "priority": task.priority})
    return task


def start(triage_encounter):
    """The psychiatry review was opened: an open review is now in progress."""
    task = for_triage(triage_encounter)
    if task and task.status == "INITIATED":
        task.status = "PENDING"
        task.save(update_fields=["status", "updated_at"])
        _audit(task, "STARTED", {})
    return task


@transaction.atomic
def complete(task, user, outcome, note=""):
    if task.focus_type != FOCUS:
        raise ValidationError({"outcome": "Only a psychiatric review records an outcome."})
    if task.status == "COMPLETED":
        raise ValidationError({"detail": "This review is already completed."})
    if outcome not in OUTCOMES:
        raise ValidationError({"outcome": "Choose the outcome of the review."})
    note = (note or "").strip()
    task.status = "COMPLETED"
    task.outcome = outcome
    task.outcome_note = note[:500]
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
    _audit(task, "COMPLETED", {"outcome": outcome, "note": task.outcome_note})
    return task


def row(task):
    """The queue's view of a review."""
    if task is None:
        return None
    return {
        "id": str(task.id),
        "label": task.action_label,
        "status": task.status,
        "priority": task.priority,
        "outcome": task.outcome,
        "outcome_label": OUTCOMES.get(task.outcome, ""),
        "outcome_note": task.outcome_note,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }
