"""Safety plan, MDT review and senior co-signature (mockup v4 stage 4)."""

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import active_roles

from .models import CosignRequest, MdtReview, NursingCarePlanEntry, SafetyPlan

SAFETY_FIELDS = [
    "warning_signs", "coping", "self_talk", "places_people_distract", "people_to_ask",
    "professionals", "safer_surroundings", "reasons_for_living", "keepsake", "language",
]


# ── safety plan ──


@transaction.atomic
def open_safety_plan(patient, user):
    """The editable plan: the open draft, else a clone of the signed one as the
    next version (a signed plan is never edited), else a blank v1."""
    plans = SafetyPlan.objects.filter(patient=patient)
    draft = plans.filter(signed_at__isnull=True).first()
    if draft:
        return draft
    latest = plans.first()
    values = {f: getattr(latest, f) for f in SAFETY_FIELDS} if latest else {}
    return SafetyPlan.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        version=(latest.version + 1) if latest else 1,
        **values,
    )


def save_safety_plan(plan, data):
    if plan.signed_at:
        raise ValidationError({"detail": "A signed safety plan cannot be edited — start a revision."})
    for field in SAFETY_FIELDS:
        if field in data:
            setattr(plan, field, data[field] or "")
    if plan.language not in ("en", "sw"):
        raise ValidationError({"language": "Use en or sw."})
    plan.save()
    return plan


def sign_safety_plan(plan, user):
    if plan.signed_at:
        raise ValidationError({"detail": "Already signed."})
    if not (plan.warning_signs.strip() or plan.people_to_ask.strip()):
        raise ValidationError(
            {"detail": "Add warning signs or the people to ask for help before signing."}
        )
    plan.signed_at = timezone.now()
    plan.signed_by = user
    plan.save(update_fields=["signed_at", "signed_by", "updated_at"])
    return plan


def give_copy(plan):
    if not plan.signed_at:
        raise ValidationError({"detail": "Sign the safety plan before giving the client a copy."})
    plan.copy_given_at = timezone.now()
    plan.save(update_fields=["copy_given_at", "updated_at"])
    return plan


# ── MDT review ──


def schedule_mdt(plan, user, scheduled_for):
    if not scheduled_for:
        raise ValidationError({"scheduled_for": "Choose a date."})
    return MdtReview.objects.create(
        organization_id=plan.organization_id,
        care_plan=plan,
        patient=plan.patient,
        scheduled_for=scheduled_for,
        recorded_by=user,
    )


def record_mdt(review, user, data):
    if review.held_at:
        raise ValidationError({"detail": "This review has already been recorded."})
    if not str(data.get("notes", "")).strip():
        raise ValidationError({"notes": "Record what was discussed."})
    review.held_at = timezone.now()
    review.attendees = data.get("attendees", "")
    review.notes = data["notes"]
    review.outcome = data.get("outcome", "")
    review.dissent = str(data.get("dissent", "") or "").strip()
    review.next_review = data.get("next_review") or None
    review.recorded_by = user
    review.save()
    if review.next_review:
        schedule_mdt(review.care_plan, user, review.next_review)
    return review


# ── nursing care plan ──


def add_nursing_problem(plan, user, data):
    problem = str(data.get("problem", "")).strip()
    goal = str(data.get("goal", "")).strip()
    if not problem or not goal:
        raise ValidationError({"problem": "Problem and goal are required."})
    activity = None
    if data.get("action_key"):
        activity = plan.activities.exclude(decision="DECLINED").filter(action_key=data["action_key"]).first()
        if activity is None:
            raise ValidationError({"action_key": "Link to an action that is in the plan."})
    entry = NursingCarePlanEntry.objects.create(
        organization_id=plan.organization_id,
        care_plan=plan,
        patient=plan.patient,
        activity=activity,
        problem=problem[:300],
        goal=goal[:300],
        interventions=str(data.get("interventions", "")).strip(),
        recorded_by=user,
    )
    if str(data.get("evaluation", "")).strip():
        evaluate_nursing_problem(entry, user, data)
    return entry


def evaluate_nursing_problem(entry, user, data):
    """Append an evaluation — earlier ones stay, with who wrote them and when."""
    text = str(data.get("evaluation", "")).strip()
    if not text:
        raise ValidationError({"evaluation": "Write the evaluation."})
    entry.evaluations = [
        *entry.evaluations,
        {"text": text, "by": user.get_full_name() or str(user), "by_id": str(user.pk),
         "at": timezone.now().isoformat()},
    ]
    entry.save(update_fields=["evaluations", "updated_at"])
    return entry


# ── co-signature ──


def can_cosign(user):
    if not (user and user.is_authenticated) or user.is_superuser:
        return False
    query = Q()
    for name in settings.COSIGN_ROLES:
        query |= Q(name__iexact=name)
    return active_roles(user).filter(query).exists()


def request_cosign(patient, user, kind, what, subject_type="", subject_id=""):
    existing = CosignRequest.objects.filter(
        patient=patient, kind=kind, what=what, status="REQUESTED"
    ).first()
    if existing:
        return existing
    return CosignRequest.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        kind=kind,
        what=what,
        subject_type=subject_type,
        subject_id=str(subject_id),
        requested_by=user,
    )


@transaction.atomic
def decide_cosign(req, user, action, note=""):
    if req.status != "REQUESTED":
        raise ValidationError({"detail": "This request has already been decided."})
    if not can_cosign(user):
        raise PermissionDenied("Only a senior clinician can co-sign.")
    if req.requested_by_id == user.pk:
        raise PermissionDenied("You cannot co-sign your own request.")
    note = (note or "").strip()
    now = timezone.now()
    if action == "SIGN":
        if req.subject_type == "LegalForm":
            from . import legal_forms

            legal_forms.complete_cosigned(req, user)
        req.status = "SIGNED"
        req.decided_by, req.decided_at = user, now
    elif action == "DECLINE":
        if len(note) < 5:
            raise ValidationError({"note": "Give a reason for declining (returned to the requester)."})
        req.status = "DECLINED"
        req.decline_reason = note
        req.decided_by, req.decided_at = user, now
    elif action == "DISCUSS":
        if len(note) < 5:
            raise ValidationError({"note": "Write what you want to discuss."})
        req.thread = [*req.thread, {"by": user.get_full_name() or str(user), "at": now.isoformat(), "note": note}]
    else:
        raise ValidationError({"action": "Use SIGN, DECLINE or DISCUSS."})
    req.save()
    return req


def acknowledge_declined(req, user):
    if req.status != "DECLINED":
        raise ValidationError({"detail": "Only a declined request can be acknowledged."})
    if req.requested_by_id != user.pk:
        raise PermissionDenied("Only the requester can acknowledge a returned request.")
    req.status = "ACKNOWLEDGED"
    req.save(update_fields=["status", "updated_at"])
    return req


def inbox(user):
    """Needs-my-decision: requests waiting for a senior (not mine), and my own
    declined requests that came back, and discussions awaiting my reply."""
    items = []
    if can_cosign(user):
        for r in CosignRequest.objects.filter(status="REQUESTED").exclude(requested_by=user):
            items.append((r, "cosign"))
    mine = CosignRequest.objects.filter(requested_by=user)
    for r in mine.filter(status="DECLINED"):
        items.append((r, "returned"))
    for r in mine.filter(status="REQUESTED").exclude(thread=[]):
        items.append((r, "discuss"))
    return items
