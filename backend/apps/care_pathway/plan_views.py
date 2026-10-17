"""Care plan, safety plan, MDT and co-signature endpoints (mockup v4 stage 4)."""

from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from . import care_plan, plan_extras, services
from .models import (
    CarePlanActivity,
    CarePlanTask,
    CosignRequest,
    MdtReview,
    NursingCarePlanEntry,
    SafetyPlan,
)
from .views import _patient


def _user_name(user):
    return (user.get_full_name() or str(user)) if user else ""


def _activity_row(a):
    return {
        "id": str(a.id),
        "key": a.action_key,
        "name": a.title,
        "decision": a.decision,
        "priority": a.priority,
        "recommended_priority": a.recommended_priority,
        "instructions": a.instructions,
        "reason": a.reason,
        "why": a.why,
        "status": a.status,
        "due_at": a.due_at,
        "bulk_accepted": a.bulk_accepted,
        "tasks": [
            {
                "id": str(t.id),
                "label": t.label,
                "owner_role": t.owner_role,
                "due_at": t.due_at,
                "done_at": t.done_at,
                "done_by": _user_name(t.done_by),
            }
            for t in a.tasks.all()
        ],
    }


def _workspace(patient, plan):
    recs = care_plan.recommend(patient)
    by_key = {a.action_key: a for a in plan.activities.all() if a.action_key}
    items, found = care_plan.outstanding(plan)
    return {
        "version": plan.version,
        "confirmed_at": plan.confirmed_at,
        "confirmed_by": _user_name(plan.confirmed_by),
        "rules_version": care_plan.RULES_VERSION,
        "rules_approval": "illustrative",  # VERIFY: clinical approval of the trigger rules
        "suggested_priority": care_plan.suggested_priority(patient),
        "recommendations": [
            {
                "key": key,
                "name": care_plan.BY_KEY[key]["name"],
                "priority": rec["priority"],
                "why": rec["why"],
                "decided": key in by_key,
            }
            for key, rec in sorted(recs.items(), key=lambda kv: care_plan.RANK[kv[1]["priority"]])
        ],
        "actions": [_activity_row(a) for a in plan.activities.exclude(action_key="")],
        "details": {
            "client_agreement": plan.client_agreement,
            "disagreements": plan.disagreements,
            "what_matters": plan.what_matters,
            "rationale": plan.rationale,
            "senior_reviewer": str(plan.senior_reviewer_id) if plan.senior_reviewer_id else "",
            "contact_72h_at": plan.contact_72h_at,
            "follow_up_clinician": plan.follow_up_clinician,
            "means_counselling_done": plan.means_counselling_done,
            "goal_items": plan.goal_items,
            "crisis_plan": plan.crisis_plan,
            "family_involvement": plan.family_involvement,
            "advance_statement": plan.advance_statement,
            "naloxone_teaching": plan.naloxone_teaching,
            "oat_offer": plan.oat_offer,
        },
        "client_ack": (
            {"at": plan.client_ack_at, "language": plan.client_ack_language,
             "recorded_by": _user_name(plan.client_ack_recorded_by)}
            if plan.client_ack_at else None
        ),
        "other_actions": [
            {"key": a["key"], "name": a["name"]} for a in care_plan.CATALOGUE if a["key"] not in recs
        ],
        "carried_scores": care_plan.carried_scores(patient),
        "intake": care_plan.intake_context(patient),
        "is_opioid": care_plan.is_opioid(patient),
        "family_consent": care_plan.family_consent(patient),
        "outstanding": items,
        "conflicts": found,
        "needs_safety_plan": care_plan.needs_safety_plan(plan),
        "priority_meaning": care_plan.MEANING,
    }


class CarePlanCatalogueView(APIView):
    def get(self, request):
        return Response({"results": care_plan.served_catalogue()})


class CarePlanWorkspaceView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        return Response(_workspace(patient, plan))


class CarePlanActionDecisionView(APIView):
    def post(self, request, patient_id, key):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        d = request.data
        care_plan.decide_action(
            plan, request.user, key, d.get("decision"), priority=d.get("priority", ""),
            instructions=d.get("instructions", ""), reason=d.get("reason", ""),
        )
        return Response(_workspace(patient, plan))

    def delete(self, request, patient_id, key):
        """Take back an action the clinician added, before it is signed."""
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        care_plan.remove_added(plan, key)
        return Response(_workspace(patient, plan))


class CarePlanAcceptRemainingView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        care_plan.accept_remaining(plan, request.user)
        return Response(_workspace(patient, plan))


def _coded(valueset_id, value, field, message):
    if value and value not in services._valid_codes(valueset_id):
        raise ValidationError({field: message})
    return value or ""


def _clean_disagreements(rows):
    if not isinstance(rows, list):
        raise ValidationError({"disagreements": "Send a list of disagreement points."})
    return [
        {
            "part": _coded("care-plan-disagreement-part", str(r.get("part") or ""), "disagreements",
                           "Choose which part of the plan the client disagrees with."),
            "words": str(r.get("words") or "")[:1000],
        }
        for r in rows
        if isinstance(r, dict)
    ]


def _clean_goals(rows):
    from datetime import date

    if not isinstance(rows, list):
        raise ValidationError({"goal_items": "Send a list of goals."})
    goals = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        key = str(r.get("action_key") or "")
        if key and key not in care_plan.BY_KEY:
            raise ValidationError({"goal_items": "A goal is linked to an unknown action."})
        review = str(r.get("review_date") or "")
        if review:
            try:
                date.fromisoformat(review)
            except ValueError as exc:
                raise ValidationError({"goal_items": "Enter the review date as a date."}) from exc
        goals.append({
            "goal": str(r.get("goal") or "")[:500],
            "action_key": key,
            "formulation": _coded("formulation-5p", str(r.get("formulation") or ""), "goal_items",
                                  "Choose a formulation heading from the list."),
            "owner": str(r.get("owner") or "")[:150],
            "review_date": review,
            "source": str(r.get("source") or "")[:80],
        })
    return goals


class CarePlanDetailsView(APIView):
    FIELDS = ["what_matters", "rationale", "contact_72h_at", "follow_up_clinician",
              "means_counselling_done", "crisis_plan", "family_involvement", "advance_statement",
              "naloxone_teaching"]

    def patch(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        data = request.data
        if "client_agreement" in data:
            plan.client_agreement = _coded(
                "care-plan-agreement", data["client_agreement"], "client_agreement", "Unknown agreement status."
            )
        if "disagreements" in data:
            plan.disagreements = _clean_disagreements(data["disagreements"])
        if "goal_items" in data:
            plan.goal_items = _clean_goals(data["goal_items"])
        if "oat_offer" in data:
            plan.oat_offer = _coded("oat-offer", data["oat_offer"], "oat_offer", "Choose an option from the list.")
        for field in self.FIELDS:
            if field in data:
                setattr(plan, field, data[field] if data[field] != "" or field != "contact_72h_at" else None)
        if "senior_reviewer" in data:
            if data["senior_reviewer"]:
                senior = get_object_or_404(User, pk=data["senior_reviewer"])
                if not plan_extras.can_cosign(senior):
                    raise ValidationError({"senior_reviewer": "That person cannot co-sign."})
                plan.senior_reviewer = senior
            else:
                plan.senior_reviewer = None
        plan.updated_by = request.user
        plan.save()
        return Response(_workspace(patient, plan))


class CarePlanConfirmView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        had_conflict = bool(care_plan.outstanding(plan)[1])
        care_plan.confirm_plan(plan, request.user, bulk_reviewed=request.data.get("bulk_reviewed") is True)
        if had_conflict and plan.senior_reviewer_id:
            plan_extras.request_cosign(
                patient, request.user, "CARE_PLAN_CONFLICT",
                f"Care plan v{plan.version} for a client whose plan conflicts with their priority",
                "CarePlan", plan.pk,
            )
        return Response(_workspace(patient, plan))


class CarePlanClientAckView(APIView):
    """The client read the plan in the co-production view and acknowledged it."""

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        language = request.data.get("language") or "en"
        if language not in ("en", "sw"):
            raise ValidationError({"language": "Use en or sw."})
        plan.client_ack_at = timezone.now()
        plan.client_ack_language = language
        plan.client_ack_recorded_by = request.user
        if not plan.client_agreement:
            plan.client_agreement = "AGREES"
        plan.updated_by = request.user
        plan.save()
        return Response(_workspace(patient, plan))


class SeniorsView(APIView):
    """Users who may co-sign, for the 'senior review' picker."""

    def get(self, request):
        query = Q()
        for name in settings.COSIGN_ROLES:
            query |= Q(roles__name__iexact=name)
        users = User.objects.filter(query, organization_id=request.user.organization_id).distinct()
        return Response({"results": [{"id": str(u.pk), "name": _user_name(u)} for u in users]})


class PlanTaskView(APIView):
    def patch(self, request, pk):
        task = get_object_or_404(CarePlanTask, pk=pk)
        done = request.data.get("done")
        if done is True:
            task.done_at, task.done_by = timezone.now(), request.user
        elif done is False:
            task.done_at, task.done_by = None, None
        else:
            raise ValidationError({"done": "Send true or false."})
        task.save()
        return Response(_activity_row(task.activity))


# ── safety plan ──


def _safety_row(plan):
    return {
        "id": str(plan.id),
        "version": plan.version,
        "signed_at": plan.signed_at,
        "signed_by": _user_name(plan.signed_by),
        "copy_given_at": plan.copy_given_at,
        **{f: getattr(plan, f) for f in plan_extras.SAFETY_FIELDS},
    }


class SafetyPlanView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        plan = plan_extras.open_safety_plan(patient, request.user)
        return Response(_safety_row(plan))

    def put(self, request, patient_id):
        patient = _patient(patient_id)
        plan = SafetyPlan.objects.filter(patient=patient, signed_at__isnull=True).first()
        if plan is None:
            raise ValidationError({"detail": "Open the safety plan first."})
        return Response(_safety_row(plan_extras.save_safety_plan(plan, request.data)))


class SafetyPlanSignView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = SafetyPlan.objects.filter(patient=patient, signed_at__isnull=True).first()
        if plan is None:
            raise ValidationError({"detail": "There is no draft safety plan to sign."})
        return Response(_safety_row(plan_extras.sign_safety_plan(plan, request.user)))


class SafetyPlanCopyView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = SafetyPlan.objects.filter(patient=patient, signed_at__isnull=False).first()
        if plan is None:
            raise ValidationError({"detail": "There is no signed safety plan."})
        return Response(_safety_row(plan_extras.give_copy(plan)))


# ── MDT ──


def _mdt_row(r):
    return {
        "id": str(r.id),
        "scheduled_for": r.scheduled_for,
        "held_at": r.held_at,
        "attendees": r.attendees,
        "notes": r.notes,
        "outcome": r.outcome,
        "dissent": r.dissent,
        "next_review": r.next_review,
    }


# ── nursing care plan ──


def _nursing_row(n):
    return {
        "id": str(n.id),
        "problem": n.problem,
        "goal": n.goal,
        "interventions": n.interventions,
        "evaluations": n.evaluations,
        "action_key": n.activity.action_key if n.activity_id else "",
        "action_name": n.activity.title if n.activity_id else "",
        "recorded_by": _user_name(n.recorded_by),
        "recorded_at": n.recorded_at,
    }


class NursingCarePlanView(APIView):
    def get(self, request, patient_id):
        plan = services.get_or_create_care_plan(_patient(patient_id), request.user)
        rows = plan.nursing_entries.select_related("activity", "recorded_by")
        return Response({"results": [_nursing_row(n) for n in rows]})

    def post(self, request, patient_id):
        plan = services.get_or_create_care_plan(_patient(patient_id), request.user)
        entry = plan_extras.add_nursing_problem(plan, request.user, request.data)
        return Response(_nursing_row(entry), status=status.HTTP_201_CREATED)


class NursingEvaluationView(APIView):
    def post(self, request, pk):
        entry = get_object_or_404(NursingCarePlanEntry, pk=pk)
        return Response(_nursing_row(plan_extras.evaluate_nursing_problem(entry, request.user, request.data)))


class MdtView(APIView):
    def get(self, request, patient_id):
        plan = services.get_or_create_care_plan(_patient(patient_id), request.user)
        return Response({"results": [_mdt_row(r) for r in plan.mdt_reviews.all()]})

    def post(self, request, patient_id):
        plan = services.get_or_create_care_plan(_patient(patient_id), request.user)
        review = plan_extras.schedule_mdt(plan, request.user, request.data.get("scheduled_for"))
        return Response(_mdt_row(review), status=status.HTTP_201_CREATED)


class MdtRecordView(APIView):
    def post(self, request, pk):
        review = get_object_or_404(MdtReview, pk=pk)
        return Response(_mdt_row(plan_extras.record_mdt(review, request.user, request.data)))


# ── co-sign ──


def _cosign_row(r, kind=""):
    return {
        "id": str(r.id),
        "patient_id": str(r.patient_id),
        "patient_name": r.patient.get_full_name(),
        "kind": r.kind,
        "what": r.what,
        "status": r.status,
        "requested_by": _user_name(r.requested_by),
        "requested_at": r.requested_at,
        "decided_by": _user_name(r.decided_by),
        "decided_at": r.decided_at,
        "decline_reason": r.decline_reason,
        "thread": r.thread,
        "inbox_kind": kind,
    }


class ClientCosignView(APIView):
    def get(self, request, patient_id):
        rows = CosignRequest.objects.filter(patient_id=patient_id).select_related("patient", "requested_by", "decided_by")
        return Response({"results": [_cosign_row(r) for r in rows]})

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        what = str(request.data.get("what", "")).strip()
        if len(what) < 5:
            raise ValidationError({"what": "Say what needs a senior signature."})
        req = plan_extras.request_cosign(patient, request.user, request.data.get("kind") or "GENERAL", what)
        return Response(_cosign_row(req), status=status.HTTP_201_CREATED)


class CosignDecideView(APIView):
    def post(self, request, pk):
        req = get_object_or_404(CosignRequest.objects.select_related("patient"), pk=pk)
        plan_extras.decide_cosign(req, request.user, request.data.get("action"), request.data.get("note", ""))
        return Response(_cosign_row(req))


class CosignAcknowledgeView(APIView):
    def post(self, request, pk):
        req = get_object_or_404(CosignRequest.objects.select_related("patient"), pk=pk)
        return Response(_cosign_row(plan_extras.acknowledge_declined(req, request.user)))


class DecisionInboxView(APIView):
    def get(self, request):
        items = plan_extras.inbox(request.user)
        return Response({"results": [_cosign_row(r, kind) for r, kind in items]})
