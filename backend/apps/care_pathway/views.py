"""
Care pathway API — docs/15-CLINICAL-WORKSPACE-V3.md. Every screen of the
approved 2026-10-07 clinical workspace mockup reads and writes through here.
"""

import re
from datetime import timedelta

from django.conf import settings
from django.db.models import F, Func, Q, Value
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.client_registry.models import AllergyRecord, Appointment, ConsentRecord, Patient
from apps.clinical_encounter.models import DiagnosisCode
from apps.ipd_ward.models import Admission, Bed
from apps.sysadmin_audit.audit import log_view
from apps.triage.models import MentalStatusExam, VitalSigns
from config.errors import error_response

from . import ews, facility_time, instruments, tools
from . import intake as intake_service
from . import findings, intake_schema, services, triage_rules, triage_v4, triage_v5
from .models import (
    PRIORITY_ORDER,
    BillingService,
    CarePlanActivity,
    CareTask,
    ClinicalAlert,
    ConsentTemplate,
    DischargeSummary,
    EpisodeOfCare,
    IntakeAssessment,
    MedicationHistoryEntry,
    LocalValueSet,
    OutcomeScore,
    TriageAssessment,
    TriageEncounter,
)
from .serializers import (
    MSE_FIELDS,
    BillingServiceSerializer,
    CarePlanActivitySerializer,
    CarePlanSerializer,
    CareTaskSerializer,
    IntakeAssessmentSerializer,
    MedicationHistorySerializer,
    InterventionRecordSerializer,
    OutcomeScoreSerializer,
)
from .interventions import is_clinical_staff
from .services import EFFECTIVE_STATUS_LABELS, user_display


def _patient(pk):
    return get_object_or_404(Patient, pk=pk)


def _triage(pk):
    return get_object_or_404(
        TriageEncounter.objects.select_related("patient", "episode", "encounter"), pk=pk
    )


def _iso(value):
    return value.isoformat() if value else None


def _is_org_admin(user):
    return user.is_superuser or user.roles.filter(name="Org Admin").exists()


# ── Terminology ──


class ValueSetsView(APIView):
    """GET care/valuesets/?ids=a,b — the served drop-down lists ($expand)."""

    def get(self, request):
        ids = [i for i in (request.query_params.get("ids") or "").split(",") if i]
        valuesets = LocalValueSet.objects.prefetch_related("concepts")
        if ids:
            valuesets = valuesets.filter(id__in=ids)
        return Response(
            {
                vs.id: {
                    "title": vs.title,
                    "version": vs.version,
                    "concepts": [
                        {"code": c.code, "display": c.display}
                        for c in vs.concepts.all()
                        if c.active
                    ],
                }
                for vs in valuesets
            }
        )


# ── Registration (doc 15 §1.4) ──


def _emergency_arrival(patient):
    """What the desk recorded when a temporary record arrived — what the person
    resolving identity works from. Registration details, not clinical content."""
    from apps.client_registry.models import EmergencyContact

    if patient.identity_status == Patient.IDENTITY_IDENTIFIED:
        return None
    arrival = (
        TriageEncounter.objects.filter(patient=patient)
        .order_by("arrival_at")
        .values("arrival_at", "found_location", "arrival_referral_info", "identification_notes")
        .first()
    )
    brought_by = patient.emergency_contacts.filter(
        contact_role=EmergencyContact.ROLE_BROUGHT_BY
    ).first()
    return {
        "arrival_at": _iso(arrival["arrival_at"]) if arrival else None,
        "found_location": arrival["found_location"] if arrival else "",
        "arrival_referral_info": arrival["arrival_referral_info"] if arrival else "",
        "identification_notes": arrival["identification_notes"] if arrival else "",
        "brought_by": (
            {
                "name": brought_by.name,
                "relationship": brought_by.relationship,
                "phone": brought_by.phone,
            }
            if brought_by
            else None
        ),
    }


def _registration_row(patient):
    """Registration details only — Front Desk never sees clinical content."""
    allergies = ", ".join(
        patient.allergy_records.exclude(verification_status="REFUTED").values_list(
            "substance", flat=True
        )
    )
    next_of_kin = patient.next_of_kin
    return {
        "id": str(patient.id),
        "name": patient.get_full_name(),
        "identity_status": patient.identity_status,
        "identity_label": (
            patient.get_identity_status_display()
            if patient.identity_status != Patient.IDENTITY_IDENTIFIED
            else ""
        ),
        "identity_description": patient.identity_description,
        "citramac_number": patient.citramac_number,
        "first_name": patient.first_name,
        "middle_other_names": patient.middle_other_names,
        "last_name": patient.last_name,
        "preferred_name": patient.preferred_name,
        "pronouns": patient.pronouns,
        "date_of_birth": _iso(patient.date_of_birth),
        "estimated_age": patient.estimated_age,
        "age": patient.age_years,
        "sex": patient.gender,
        "phone": patient.contact_phone,
        "next_of_kin": next_of_kin.name if next_of_kin else "",
        "next_of_kin_relationship": next_of_kin.relationship if next_of_kin else "",
        "next_of_kin_phone": next_of_kin.phone if next_of_kin else "",
        "referral_source": patient.referral_source,
        # A temporary record awaiting identity resolution.
        "is_temporary": patient.identity_status != Patient.IDENTITY_IDENTIFIED,
        "emergency_arrival": _emergency_arrival(patient),
        "marital_status": patient.marital_status,
        "employment_status": patient.employment_status,
        "occupation": patient.occupation,
        "living_with_disability": patient.living_with_disability,
        "disability_details": patient.disability_details,
        "address": patient.address,
        "id_document_type": patient.id_document_type,
        "id_document_number": patient.id_document_number or patient.national_id,
        "preferred_language": patient.preferred_language,
        "interpreter": patient.interpreter,
        "allergy_status": patient.allergy_status,
        "allergy_details": allergies,
        "payer": patient.payer,
        "identifiers": [
            {"kind": i.kind, "value": i.value, "superseded": bool(i.superseded_at)}
            for i in patient.identifiers.all()
        ],
    }


# A phone number compared on its digits, without the 0 / 254 prefix, so
# "0712 345 678", "+254712345678" and "712345678" are the same number.
_PHONE_PREFIX = re.compile(r"^(?:254|0)")
_PHONE_MIN_DIGITS = 6


def _phone_core(text):
    digits = re.sub(r"\D", "", text)
    return _PHONE_PREFIX.sub("", digits) if len(digits) >= _PHONE_MIN_DIGITS else ""


def _search_term(term):
    """One word of the search, against every registration field."""
    match = (
        Q(identifiers__value__iexact=term)
        | Q(first_name__icontains=term)
        | Q(last_name__icontains=term)
        | Q(middle_other_names__icontains=term)
        | Q(preferred_name__icontains=term)
        | Q(identity_description__icontains=term)
        | Q(contact_phone__icontains=term)
        | Q(national_id__icontains=term)
        | Q(id_document_number__icontains=term)
        | Q(citramac_number__icontains=term)
        | Q(uhid_number__icontains=term)
    )
    core = _phone_core(term)
    return match | Q(phone_digits__contains=core) if core else match


class RegistrationSearchView(APIView):
    """Find an existing client from Registration: name (any words, any order),
    phone in any format, national ID, document number, CITRAMAC / UHID number
    or a registry identifier. Every word must match some field; the whole query
    also matches an identifier exactly. Registration details only."""

    def get(self, request):
        q = " ".join((request.query_params.get("q") or "").split())
        if not q:
            return Response({"results": []})
        words = Q()
        for term in q.split(" "):
            words &= _search_term(term)
        whole = Q(identifiers__value__iexact=q) | Q(national_id__iexact=q)
        core = _phone_core(q)
        if core:
            whole |= Q(phone_digits__contains=core)
        patients = (
            Patient.objects.filter(archived_at__isnull=True, merged_into__isnull=True)
            .annotate(
                phone_digits=Func(
                    F("contact_phone"),
                    Value(r"\D"),
                    Value(""),
                    Value("g"),
                    function="regexp_replace",
                )
            )
            .filter(words | whole)
            .select_related("next_of_kin")
            .distinct()
            .order_by("-registered_at")[:6]
        )
        return Response({"results": [_registration_row(p) for p in patients]})


class DuplicateCheckView(APIView):
    """Pre-submit duplicate check: exact identifier hits and probable matches.
    Registration details only, so Front Desk may call it."""

    def post(self, request):
        from apps.client_registry import identity as identity_service

        data = request.data
        kind = identity_service.DOCUMENT_KIND.get(data.get("id_document_type"))
        identifiers = {}
        if kind and data.get("id_document_number"):
            identifiers[kind] = str(data["id_document_number"]).strip()
        if data.get("unhcr_number"):
            identifiers["UNHCR"] = str(data["unhcr_number"]).strip()
        if data.get("sha_member_number"):
            identifiers["SHA_MEMBER"] = str(data["sha_member_number"]).strip()
        matches = identity_service.find_duplicates(
            request.user.organization_id,
            identifiers=identifiers,
            last_name=services._names_from(data)[2],
            date_of_birth=data.get("date_of_birth") or None,
            gender=data.get("sex") or "",
            phone=data.get("phone") or "",
        )
        return Response(
            {
                "matches": [
                    {
                        "match": item["match"],
                        "reason": item["reason"],
                        "client": _registration_row(item["patient"]),
                    }
                    for item in matches
                ]
            }
        )


class RegistrationView(APIView):
    def post(self, request):
        te = services.register_arrival(request.user, request.data)
        # Opening the encounter starts triage under the viewer, so only
        # clinical staff are sent there; front desk returns to the worklist.
        return Response(
            {
                "triage_encounter_id": str(te.id),
                "patient_id": str(te.patient_id),
                "open_triage": is_clinical_staff(request.user),
            },
            status=status.HTTP_201_CREATED,
        )


class RegistrationDetailsView(APIView):
    """One client's registration details: read them into the Registration form,
    and correct them in place without opening a triage encounter."""

    def get(self, request, patient_id):
        patient = _patient(patient_id)
        log_view(patient)
        return Response(_registration_row(patient))

    def patch(self, request, patient_id):
        patient = services.update_registration(request.user, _patient(patient_id), request.data)
        patient.refresh_from_db()
        return Response(_registration_row(patient))


class ResolveIdentityView(APIView):
    def post(self, request, patient_id):
        patient = services.resolve_identity(request.user, _patient(patient_id), request.data)
        patient.refresh_from_db()  # typed values (dates) for the row, not request strings
        return Response(_registration_row(patient))


# ── Triage (doc 15 §1.5–§1.7) ──


def _worklist_row(item):
    te = item["te"]
    patient = te.patient
    return {
        "id": str(te.id),
        "patient_id": str(patient.id),
        "name": patient.get_full_name(),
        "citramac_number": patient.citramac_number,
        "mrn": patient.uhid_number,
        "setting": "INPATIENT" if services.current_admission(patient) else "OUTPATIENT",
        "status": item["status"],
        "status_label": EFFECTIVE_STATUS_LABELS[item["status"]],
        "due_at": _iso(item["due_at"]),
        "is_overdue": item["is_overdue"],
        "recheck_overdue": item.get("recheck_overdue", False),
        "wait_minutes": item["wait_minutes"],
        "visit_number": te.visit_number,
        "triage_version": te.triage_version,
        "last_triaged_at": _iso(te.last_triaged_at),
        "priority": te.priority,
    }


def _evaluate(answers, labels):
    """Each answer set is evaluated by the rule set of its schema: v5, v4, or
    (anything else) the v3 rules (triage_rules.py)."""
    if triage_v5.is_v5(answers):
        from . import approved_assessments

        return triage_v5.evaluate(answers, labels, approved_assessments.names())
    if triage_v4.is_v4(answers):
        return triage_v4.evaluate(answers, labels)
    return triage_rules.evaluate(answers, labels)


class TriageWorklistView(APIView):
    def get(self, request):
        items = services.triage_worklist()
        return Response(
            {
                "results": [_worklist_row(i) for i in items],
                "overdue_count": sum(1 for i in items if i["is_overdue"]),
            }
        )


def _assessment_payload(assessment):
    if assessment is None:
        return None
    return {
        "id": str(assessment.id),
        "version": assessment.version,
        "status": assessment.status,
        "answers": assessment.answers,
        "findings": assessment.findings,
        "alerts": assessment.alerts,
        "recommendation": assessment.recommendation,
        "recommendation_reasons": assessment.recommendation_reasons,
        "final_priority": assessment.final_priority,
        "decision": assessment.decision,
        "override_reason": assessment.override_reason,
        "rules_version": assessment.rules_version,
        "tasks": assessment.tasks_snapshot,
        "draft_saved_at": _iso(assessment.draft_saved_at),
        "signed_at": _iso(assessment.signed_at),
        "signed_by": user_display(assessment.signed_by),
    }


def _recheck_payload(recheck):
    if recheck is None:
        return None
    return {
        "id": str(recheck.id),
        "version": recheck.version,
        "status": recheck.status,
        "change_since_last_check": recheck.change_since_last_check,
        "distress_behaviour": recheck.distress_behaviour,
        "observations": recheck.observations,
        "note": recheck.note,
        "draft_saved_at": _iso(recheck.draft_saved_at),
        "signed_at": _iso(recheck.signed_at),
        "signed_by": user_display(recheck.signed_by),
    }


class TriageEncounterView(APIView):
    """Everything the triage / re-check screen needs in one call."""

    def get(self, request, pk):
        te = _triage(pk)
        log_view(te)
        draft = services.current_triage_draft(te)
        signed = te.assessments.filter(status="COMPLETED").first()
        labels = services.concept_labels()
        answers = draft.answers if draft else {}
        editable = te.status in (TriageEncounter.STATUS_AWAITING, TriageEncounter.STATUS_IN_TRIAGE)
        # New and in-progress triages use the v5 rule set (a draft started on v4
        # opens on v5: what the two share is kept, v4-only answers are not); a
        # signed record keeps the rule set it was signed under (the screen reads
        # its stored result).
        record = signed.answers if signed else answers
        if editable:
            rules = triage_v5
        elif triage_v5.is_v5(record):
            rules = triage_v5
        elif triage_v4.is_v4(record):
            rules = triage_v4
        else:
            rules = None
        if rules is not None:
            answers = {**rules.DEFAULT_ANSWERS, **answers, "schema": rules.SCHEMA}
        return Response(
            {
                "id": str(te.id),
                "patient_id": str(te.patient_id),
                "episode_id": str(te.episode_id),
                "status": te.effective_status,
                "status_label": EFFECTIVE_STATUS_LABELS[te.effective_status],
                "visit_number": te.visit_number,
                "arrival_at": _iso(te.arrival_at),
                "due_at": _iso(te.due_at),
                "wait_minutes": max(0, int((timezone.now() - te.arrival_at).total_seconds() // 60)),
                "presenting_concern": te.presenting_concern,
                "referral_source": te.referral_source,
                "priority": te.priority,
                "triage_version": te.triage_version,
                "last_triaged_at": _iso(te.last_triaged_at),
                "last_triaged_by": user_display(te.last_triaged_by),
                "next_recheck_at": _iso(te.next_recheck_at),
                "triage_started_at": _iso(te.triage_started_at),
                "clinician": user_display(request.user),
                "tenant_location": request.user.organization.name,
                "defaults": rules.DEFAULT_ANSWERS if rules else triage_rules.DEFAULT_ANSWERS,
                "schema": rules.SCHEMA if rules else "v3",
                "draft": _assessment_payload(draft),
                "signed": _assessment_payload(signed),
                "evaluation": _evaluate(answers, labels),
                "tasks": CareTaskSerializer(te.tasks.all(), many=True).data,
                "recheck_draft": _recheck_payload(services.current_recheck_draft(te)),
                "rechecks": [_recheck_payload(r) for r in te.rechecks.filter(status="COMPLETED")],
            }
        )


class TriageStartView(APIView):
    def post(self, request, pk):
        te = services.start_triage(_triage(pk), request.user)
        return Response({"status": te.effective_status})


class TriageDraftView(APIView):
    def put(self, request, pk):
        te = _triage(pk)
        answers = request.data.get("answers") or {}
        draft = services.save_triage_draft(te, request.user, answers)
        return Response(
            {
                "draft_saved_at": _iso(draft.draft_saved_at),
                "evaluation": _evaluate(answers, services.concept_labels()),
            }
        )


class TriageFacilityLookupView(APIView):
    """Section H referral, in or out: the facility's official name from the DHA
    Facility Registry by FR code. When the registry can't be reached the
    clinician types the name, and the screen says it was not verified."""

    def get(self, request, pk):
        from apps.dha_interop import registries

        te = _triage(pk)
        fr_code = request.query_params.get("fr_code")
        try:
            found = registries.lookup_facility(te.organization_id, fr_code)
        except registries.RegistryError as exc:
            return error_response(
                "registry_refused",
                exc.message,
                # A missing code is the clinician's to fix; anything else is the registry.
                http_status=(
                    status.HTTP_400_BAD_REQUEST
                    if exc.field
                    else status.HTTP_503_SERVICE_UNAVAILABLE
                ),
                fields={exc.field: [exc.message]} if exc.field else None,
            )
        return Response({"match": found})


class TriageEvaluateView(APIView):
    def post(self, request, pk):
        _triage(pk)
        return Response(_evaluate(request.data.get("answers") or {}, services.concept_labels()))


class TriageSignView(APIView):
    def post(self, request, pk):
        te = _triage(pk)
        assessment = services.sign_triage(te, request.user, request.data)
        return Response(_assessment_payload(assessment), status=status.HTTP_201_CREATED)


def task_owner_choices(organization_id):
    """Section N "Responsible person / team": the organisation's clinical staff
    as people, and the clinical roles they hold as teams — both what Org Admin
    already maintains (Staff, Roles & Permissions), never a list of our own."""
    from apps.accounts.access import users_with_permission
    from apps.accounts.models import Role

    codename = "clinical.care.record"
    staff = users_with_permission([codename], organization_id).order_by(
        "first_name", "last_name"
    )
    held = Role.objects.filter(permissions__codename=codename, users__in=staff.values("pk"))
    teams = sorted(set(held.values_list("name", flat=True)))
    people = [{"id": str(u.pk), "name": user_display(u)} for u in staff]
    return {"teams": teams, "people": people}


class TaskOwnersView(APIView):
    def get(self, request):
        return Response(task_owner_choices(request.user.organization_id))


class TriageTasksView(APIView):
    """Section N "Register as trackable tasks" — one Task per ticked action,
    owned by a team (a clinical role) or assigned to a person (clinical staff)."""

    def post(self, request, pk):
        te = _triage(pk)
        codes = request.data.get("actions") or []
        owner = (request.data.get("owner") or "").strip() or "Psychiatry / Nursing"
        assignee = None
        if request.data.get("assignee"):
            choices = task_owner_choices(te.organization_id)
            person = next(
                (p for p in choices["people"] if p["id"] == str(request.data["assignee"])), None
            )
            if person is None:
                return Response(
                    {"assignee": "Choose a member of the clinical staff."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            assignee, owner = person["id"], person["name"]
        task_status = request.data.get("status") or "INITIATED"
        if task_status not in dict(CareTask.STATUS_CHOICES):
            return Response({"status": "Unknown status."}, status=status.HTTP_400_BAD_REQUEST)
        labels = services.concept_labels()
        created = []
        for code in codes:
            label = labels.get(("triage-action", code))
            if not label:
                continue
            created.append(
                CareTask.objects.create(
                    organization_id=te.organization_id,
                    patient=te.patient,
                    triage_encounter=te,
                    action_code=code,
                    action_label=label,
                    owner=owner[:150],
                    assignee_id=assignee,
                    status=task_status,
                    created_by=request.user,
                )
            )
        return Response(
            CareTaskSerializer(te.tasks.all(), many=True).data, status=status.HTTP_201_CREATED
        )


class CareTaskView(APIView):
    def patch(self, request, pk):
        from . import psychiatric_review

        task = get_object_or_404(CareTask, pk=pk)
        if task.focus_type == psychiatric_review.FOCUS:
            # A psychiatric review is completed with its outcome, never by a bare status.
            from apps.accounts.access import has_permission

            if not has_permission(request.user, "clinical.care.record"):
                raise PermissionDenied("Only clinical staff record a psychiatric review outcome.")
            if request.data.get("status") != "COMPLETED":
                raise ValidationError({"status": "Record the outcome to complete this review."})
            psychiatric_review.complete(
                task, request.user, request.data.get("outcome"), request.data.get("outcome_note")
            )
            return Response(CareTaskSerializer(task).data)
        serializer = CareTaskSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TriageRecheckDraftView(APIView):
    def put(self, request, pk):
        draft = services.save_recheck_draft(_triage(pk), request.user, request.data)
        return Response(_recheck_payload(draft))


class TriageRecheckSignView(APIView):
    def post(self, request, pk):
        recheck = services.sign_recheck(_triage(pk), request.user, request.data)
        return Response(_recheck_payload(recheck), status=status.HTTP_201_CREATED)


class TriageFullRetriageView(APIView):
    def post(self, request, pk):
        te = services.request_full_retriage(_triage(pk))
        return Response({"status": te.effective_status})


class TriageFhirView(APIView):
    def get(self, request, pk):
        from .fhir import build_triage_bundle

        return Response(build_triage_bundle(_triage(pk)))


class OpenPsychiatryReviewView(APIView):
    def post(self, request, pk):
        te = services.open_psychiatry_review(_triage(pk), request.user)
        return Response(
            {
                "patient_id": str(te.patient_id),
                "psychiatry_encounter_id": str(te.psychiatry_encounter_id),
            }
        )


# ── Psychiatry queue & documents (doc 15 §1.8, §1.14) ──


class PsychiatryQueueView(APIView):
    def get(self, request):
        from django.conf import settings

        from . import psychiatric_review
        from .triage_queue import responsible

        targets = getattr(settings, "SEEN_BY_CLINICIAN_TARGET_MINUTES", None) or {}
        now = timezone.now()
        rows = []
        for te in services.psychiatry_queue():
            owner, team = responsible(te)
            waited = (
                int((now - te.arrival_at).total_seconds() // 60)
                if not te.psychiatry_review_started_at
                else None
            )
            target = targets.get(te.priority)
            rows.append(
                {
                    "wait_minutes": waited,
                    "target_minutes": target,
                    "over_target": bool(waited is not None and target is not None and waited > target),
                    "id": str(te.id),
                    "patient_id": str(te.patient_id),
                    "name": te.patient.get_full_name(),
                    "citramac_number": te.patient.citramac_number,
                    "mrn": te.patient.uhid_number,
                    "priority": te.priority,
                    "presenting_concern": te.presenting_concern,
                    "signed_at": _iso(te.last_triaged_at),
                    "signed_by": user_display(te.last_triaged_by),
                    "review_started_at": _iso(te.psychiatry_review_started_at),
                    "withdrawal_review": psychiatric_review.row(psychiatric_review.for_triage(te)),
                    "age": te.patient.age_years,
                    "sex": te.patient.gender,
                    "alerts": list(
                        ClinicalAlert.objects.filter(
                            patient=te.patient, status="ACTIVE"
                        ).values_list("label", flat=True)
                    ),
                    "owner": (
                        {"id": str(owner.pk), "name": user_display(owner)} if owner else None
                    ),
                    "team": team,
                }
            )
        return Response({"results": rows})


class SignedDocumentsView(APIView):
    def get(self, request):
        assessments = (
            TriageAssessment.objects.filter(status="COMPLETED")
            .select_related("triage_encounter__patient", "signed_by")
            .order_by("-signed_at")
        )
        patient = request.query_params.get("patient")
        if patient:
            assessments = assessments.filter(triage_encounter__patient_id=patient)
        return Response(
            {
                "results": [
                    {
                        "id": str(a.id),
                        "document": "Signed triage assessment",
                        "triage_encounter_id": str(a.triage_encounter_id),
                        "patient_id": str(a.triage_encounter.patient_id),
                        "name": a.triage_encounter.patient.get_full_name(),
                        "citramac_number": a.triage_encounter.patient.citramac_number,
                        "mrn": a.triage_encounter.patient.uhid_number,
                        "priority": a.final_priority,
                        "version": a.version,
                        "signed_at": _iso(a.signed_at),
                        "signed_by": user_display(a.signed_by),
                    }
                    for a in assessments
                ]
            }
        )


class SignedAssessmentView(APIView):
    def get(self, request, pk):
        assessment = get_object_or_404(
            TriageAssessment.objects.select_related("triage_encounter__patient", "signed_by"),
            pk=pk,
            status="COMPLETED",
        )
        log_view(assessment)
        payload = _assessment_payload(assessment)
        payload["patient_id"] = str(assessment.triage_encounter.patient_id)
        payload["name"] = assessment.triage_encounter.patient.get_full_name()
        payload["labels"] = {
            f"{vs}:{code}": display for (vs, code), display in services.concept_labels().items()
        }
        return Response(payload)


# ── Client record (doc 15 §1.2, §1.9, §1.17) ──


class ClientBannerView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        log_view(patient)
        return Response(services.banner_for(patient))


class ClientTimelineView(APIView):
    def get(self, request, patient_id):
        return Response({"results": services.client_timeline(_patient(patient_id))})


def _vital_row(v):
    return {
        "id": str(v.id),
        "recorded_at": _iso(v.recorded_at),
        "systolic_bp": v.systolic_bp,
        "diastolic_bp": v.diastolic_bp,
        "heart_rate": v.heart_rate,
        "respiratory_rate": v.respiratory_rate,
        "temperature_c": str(v.temperature_c) if v.temperature_c is not None else None,
        "spo2": v.spo2,
        "blood_glucose_mmol": (
            str(v.blood_glucose_mmol) if v.blood_glucose_mmol is not None else None
        ),
        "consciousness": v.consciousness,
        "supplemental_o2": v.supplemental_o2,
        "ews": ews.from_vital(v),
        "recorded_by": user_display(v.recorded_by),
    }


class ClientVitalsView(APIView):
    def get(self, request, patient_id):
        vitals = VitalSigns.objects.filter(encounter__patient_id=patient_id).order_by("recorded_at")
        return Response({"results": [_vital_row(v) for v in vitals]})


class ClientSnapshotView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        signed = services.latest_signed_triage(patient)
        assessment = signed.assessments.filter(status="COMPLETED").first() if signed else None
        latest_vitals = (
            VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at").first()
        )
        next_appointment = (
            Appointment.objects.filter(
                patient=patient, scheduled_for__gte=timezone.now(), status="SCHEDULED"
            )
            .order_by("scheduled_for")
            .first()
        )
        plan = services.current_or_latest_episode(patient)
        activities = []
        if plan and hasattr(plan, "care_plan"):
            activities = CarePlanActivitySerializer(
                plan.care_plan.activities.exclude(decision="DECLINED"), many=True
            ).data
        diagnoses = DiagnosisCode.objects.filter(
            encounter__patient=patient, status="ACTIVE"
        ).select_related("icd11_code")
        scores = OutcomeScore.objects.filter(patient=patient).order_by("-recorded_at")
        latest_scores = {}
        for score in scores:
            latest_scores.setdefault(score.instrument, OutcomeScoreSerializer(score).data)
        return Response(
            {
                "presenting_concern": signed.presenting_concern if signed else "",
                "triage": _assessment_payload(assessment),
                "diagnoses": [
                    {
                        "id": str(d.id),
                        "code": d.icd11_code_id,
                        "description": d.icd11_code.description,
                        "is_primary": d.is_primary,
                    }
                    for d in diagnoses
                ],
                "latest_vitals": _vital_row(latest_vitals) if latest_vitals else None,
                "next_appointment": (
                    {
                        "scheduled_for": _iso(next_appointment.scheduled_for),
                        "appointment_type": next_appointment.appointment_type,
                    }
                    if next_appointment
                    else None
                ),
                "care_plan_activities": activities,
                "latest_scores": latest_scores,
                "episode": services.episode_summary(patient),
                "alerts": [
                    {
                        "id": str(a.id),
                        "code": a.alert_code,
                        "label": a.label,
                        "status": a.status,
                        "raised_at": _iso(a.raised_at),
                        "raised_by": user_display(a.raised_by),
                        "resolved_at": _iso(a.resolved_at),
                        "resolved_by": user_display(a.resolved_by),
                    }
                    for a in ClinicalAlert.objects.filter(patient=patient).select_related(
                        "raised_by", "resolved_by"
                    )
                ],
            }
        )


class ClientAttentionView(APIView):
    """Live risk register and outstanding items for one client (derived, not stored)."""

    def get(self, request, patient_id):
        from . import attention

        patient = _patient(patient_id)
        return Response({"alerts": attention.active_alerts(patient), "items": attention.patient_items(patient)})


class MyTasksView(APIView):
    def get(self, request):
        from . import attention

        return Response({"results": attention.my_tasks(request.user)})


def _ai_consent(patient):
    """AI-assisted note processing consent: offered only where the organisation
    has psychotherapy AI turned on; the wording is the facility's own."""
    from apps.client_registry.consent import current_record

    from . import psy_ai

    record = current_record(patient, psy_ai.AI_CONSENT)
    template = ConsentTemplate.objects.filter(consent_type=psy_ai.AI_CONSENT, active=True).first()
    return {
        "offered": psy_ai.org_enabled(patient.organization),
        "template": _template_payload(template),
        "decision": record.decision if record else "NOT_ASKED",
        "captured_at": _iso(record.captured_at) if record else None,
        "captured_by": user_display(record.captured_by) if record else "",
        "consent_text_version": record.consent_text_version if record else "",
    }


class ApprovedAssessmentsView(APIView):
    """The organisation's approved assessments (approved_assessments.py). GET
    for anyone in the organisation; PUT by its Org Admin, with the clinical
    lead named and the attestation given."""

    def get(self, request):
        from . import approved_assessments

        return Response(approved_assessments.payload(_is_org_admin(request.user)))

    def put(self, request):
        from . import approved_assessments

        if not _is_org_admin(request.user):
            raise PermissionDenied("Only an Org Admin can approve assessments.")
        approved_assessments.approve(
            request.user,
            request.data.get("purpose"),
            request.data.get("instrument"),
            clinical_lead=request.data.get("clinical_lead"),
            attest=request.data.get("attest"),
            confirm=request.data.get("confirm"),
        )
        return Response(approved_assessments.payload(True))


class PsychotherapyAssistSettingsView(APIView):
    """The organisation's psychotherapy AI / dictation switches. GET for anyone
    in the organisation; PUT by its Org Admin, only for capabilities Super
    Admin has allowed, and turning one on needs the data-protection attestation."""

    def _payload(self, org):
        from . import psy_ai

        return {
            "ai_platform_available": psy_ai.enabled(),
            "ai_allowed": org.psy_ai_allowed,
            "ai_enabled": org.psy_ai_enabled,
            "dictation_platform_available": bool(
                getattr(settings, "PSYCHOTHERAPY_DICTATION_ENABLED", False)
            ),
            "dictation_allowed": org.psy_dictation_allowed,
            "dictation_enabled": org.psy_dictation_enabled,
            "changed_by": org.psy_assist_changed_by,
            "changed_at": _iso(org.psy_assist_changed_at),
            "can_edit": _is_org_admin(self.request.user),
        }

    def get(self, request):
        return Response(self._payload(request.user.organization))

    def put(self, request):
        if not _is_org_admin(request.user):
            raise PermissionDenied("Only an Org Admin can change these settings.")
        org = request.user.organization
        changes = {}
        for key, allowed in (("ai_enabled", org.psy_ai_allowed), ("dictation_enabled", org.psy_dictation_allowed)):
            if key not in request.data:
                continue
            value = bool(request.data[key])
            if value and not allowed:
                return Response(
                    {key: "Not allowed for this organisation — ask the platform Super Admin."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            changes[f"psy_{key}"] = value
        turning_on = any(v and not getattr(org, k) for k, v in changes.items())
        if turning_on and request.data.get("attest") is not True:
            return Response(
                {"attest": "Confirm the organisation's data-protection review approves this."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if changes:
            for field, value in changes.items():
                setattr(org, field, value)
            org.psy_assist_changed_by = f"{user_display(request.user)} (Org Admin)"
            org.psy_assist_changed_at = timezone.now()
            org.save(update_fields=[*changes, "psy_assist_changed_by", "psy_assist_changed_at", "updated_at"])
        return Response(self._payload(org))


class ClientLegalView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        consents = ConsentRecord.objects.filter(patient=patient).order_by("-captured_at")
        admissions = Admission.objects.filter(patient=patient).order_by("-admitted_at")
        template = ConsentTemplate.objects.filter(
            consent_type="DATA_SHARING_HIE", active=True
        ).first()
        return Response(
            {
                "active_consent_template": _template_payload(template),
                "current_consent": {
                    "granted": patient.consent_data_sharing,
                    "captured_at": _iso(patient.consent_captured_at),
                },
                "ai_consent": _ai_consent(patient),
                "data_sharing_consent": [
                    {
                        "id": str(c.id),
                        "consent_type": c.get_consent_type_display(),
                        "granted": c.granted,
                        "consent_text_version": c.consent_text_version,
                        "captured_at": _iso(c.captured_at),
                        "captured_by": user_display(c.captured_by),
                    }
                    for c in consents
                ],
                "admissions": [
                    {
                        "id": str(a.id),
                        "admitted_at": _iso(a.admitted_at),
                        "status": a.get_status_display(),
                        "admission_type": a.admission_type,
                        "admission_type_label": a.get_admission_type_display(),
                        # Legal status first: the basis lives in the legal admission status.
                        "legal_status_linked": bool(a.legal_status_record_id),
                        "consent_status": (
                            a.get_consent_status_display() if a.consent_status else ""
                        ),
                        "capacity_assessed": a.capacity_assessed,
                        "consent_at": _iso(a.consent_at),
                        "legal_status": a.legal_status,
                        "legal_order_reference": a.legal_order_reference,
                        "legal_order_date": _iso(a.legal_order_date),
                        "legal_review_due_date": _iso(a.legal_review_due_date),
                        "authorizing_professional": a.authorizing_professional,
                        "next_of_kin_notification": a.get_next_of_kin_notification_display(),
                        "next_of_kin_notification_code": a.next_of_kin_notification,
                        "consent_status_code": a.consent_status,
                        "consent_notes": a.consent_notes,
                        "legal_rationale": a.legal_rationale,
                        "oversight_notes": a.oversight_notes,
                        "next_of_kin_notes": a.next_of_kin_notes,
                    }
                    for a in admissions
                ],
            }
        )


class ClientIntakeView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        intakes = IntakeAssessment.objects.filter(patient=patient).select_related("author")
        for intake in intakes[:1]:
            log_view(intake)
        return Response(
            {
                "results": IntakeAssessmentSerializer(
                    intakes, many=True, context={"request": request}
                ).data
            }
        )

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        serializer = IntakeAssessmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        episode = services.get_or_open_episode(patient, request.user)
        encounter = services.clinical_encounter_for(patient, episode, request.user)
        mse_values = {
            mse_field: serializer.validated_data.pop(field, "")
            for field, mse_field in MSE_FIELDS.items()
        }
        mse = None
        if any(mse_values.values()):
            mse = MentalStatusExam.objects.create(
                organization=request.user.organization,
                encounter=encounter,
                recorded_by=request.user,
                **mse_values,
            )
        intake = serializer.save(
            organization=request.user.organization,
            patient=patient,
            episode=episode,
            encounter=encounter,
            mse=mse,
            author=request.user,
            # A one-shot save is a signed record (the sectioned flow uses the
            # draft + sign endpoints instead).
            status="SIGNED",
            completeness="COMPLETE",
            signed_at=timezone.now(),
            signed_by=request.user,
            version=IntakeAssessment.objects.filter(patient=patient).count() + 1,
        )
        for instrument, score in (("GAD7", intake.gad7_score), ("PHQ9", intake.phq9_score)):
            if score is not None:
                OutcomeScore.objects.create(
                    organization=request.user.organization,
                    patient=patient,
                    instrument=instrument,
                    score=score,
                    source_intake=intake,
                    recorded_by=request.user,
                )
        return Response(
            IntakeAssessmentSerializer(intake, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class IntakeSchemaView(APIView):
    """GET care/intake/schema/ — the served section schema."""

    def get(self, request):
        return Response(intake_schema.served_schema())


def _draft_payload(draft, request):
    data = IntakeAssessmentSerializer(draft, context={"request": request}).data
    data["section_overview"] = intake_service.section_overview(draft)
    data["outstanding_now"] = intake_service.outstanding_items(draft)
    return data


class ClientIntakeDraftView(APIView):
    """GET opens (or creates) the editable draft; PUT autosaves it."""

    def get(self, request, patient_id):
        patient = _patient(patient_id)
        draft = intake_service.open_draft(patient, request.user)
        log_view(draft)
        return Response(_draft_payload(draft, request))

    def put(self, request, patient_id):
        patient = _patient(patient_id)
        draft = intake_service.current_draft(patient)
        if draft is None:
            raise ValidationError({"detail": "There is no draft to save — open the intake first."})
        draft = intake_service.save_draft(draft, request.user, request.data)
        return Response(_draft_payload(draft, request))


class ClientIntakeSignView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        draft = intake_service.current_draft(patient)
        if draft is None:
            raise ValidationError({"detail": "There is no draft to sign."})
        draft = intake_service.sign_intake(draft, request.user, request.data.get("completeness"))
        return Response(_draft_payload(draft, request))


class ClientMedicationHistoryView(APIView):
    """The shared structured medication list (one store for intake, MAR, discharge)."""

    def get(self, request, patient_id):
        rows = MedicationHistoryEntry.objects.filter(
            patient_id=patient_id, superseded_at__isnull=True
        )
        return Response({"results": MedicationHistorySerializer(rows, many=True).data})

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        serializer = MedicationHistorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            organization=request.user.organization, patient=patient, recorded_by=request.user
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


def _allergy_payload(patient):
    from . import allergies

    return allergies.payload(patient)


class ClientAllergyView(APIView):
    """Allergy status + records for the intake section; one store (AllergyRecord).
    GET the record; POST adds a reaction; PUT sets status / source of information,
    or `confirm: true` for "Confirm — unchanged" (INT-06)."""

    def get(self, request, patient_id):
        return Response(_allergy_payload(_patient(patient_id)))

    def post(self, request, patient_id):
        from . import allergies

        return Response(
            allergies.add_record(_patient(patient_id), request.user, request.data),
            status=status.HTTP_201_CREATED,
        )

    def put(self, request, patient_id):
        from . import allergies

        return Response(allergies.update_status(_patient(patient_id), request.user, request.data))


class AllergyVerifyView(APIView):
    """A clinician confirms (or refutes) a client-reported allergy; PATCH edits a
    record's type / severity / reaction or resolves / refutes it (never deletes)."""

    def patch(self, request, pk):
        from . import allergies

        record = get_object_or_404(AllergyRecord, pk=pk)
        return Response(allergies.update_record(record, request.user, request.data))

    def post(self, request, pk):
        record = get_object_or_404(AllergyRecord, pk=pk)
        verdict = request.data.get("verification_status")
        if verdict not in ("CONFIRMED", "REFUTED"):
            raise ValidationError({"verification_status": "Use CONFIRMED or REFUTED."})
        record.verification_status = verdict
        record.recorded_by = request.user
        record.save(update_fields=["verification_status", "recorded_by", "updated_at"])
        return Response(_allergy_payload(record.patient))


class MedicationHistoryEntryView(APIView):
    def delete(self, request, pk):
        """Retire — never delete — an entry (kept for the record)."""
        entry = get_object_or_404(MedicationHistoryEntry, pk=pk)
        entry.superseded_at = timezone.now()
        entry.save(update_fields=["superseded_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientOutcomesView(APIView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        scores = OutcomeScore.objects.filter(patient=patient)
        return Response(
            {
                "results": OutcomeScoreSerializer(scores, many=True).data,
                "summary": tools.outcome_summary(patient),
            }
        )


class InstrumentsView(APIView):
    """GET care/instruments/ — served definitions (items, options, bands, approval)."""

    def get(self, request):
        return Response({"results": instruments.served(), "ews": {
            "version": ews.VERSION, "approval": ews.APPROVAL}})


class ClientToolsView(APIView):
    def get(self, request, patient_id):
        return Response({"results": tools.overview(_patient(patient_id))})


class ToolDecisionView(APIView):
    def post(self, request, patient_id, tool):
        patient = _patient(patient_id)
        tools.decide(
            patient, request.user, tool, request.data.get("status"), request.data.get("reason", "")
        )
        return Response({"results": tools.overview(patient)}, status=status.HTTP_201_CREATED)


class ClientFindingsView(APIView):
    """The shared clinical finding store (findings.py): the current finding per
    domain with its source, time and recorder, and (with ?key=) its history."""

    def get(self, request, patient_id):
        patient = _patient(patient_id)
        log_view(patient)
        key = request.query_params.get("key")
        if key:
            return Response({"results": [findings.payload(f) for f in findings.history(patient, key)]})
        return Response({"results": [findings.payload(f) for f in findings.current(patient)]})


class ClientFindingReviewView(APIView):
    """Confirm a finding unchanged, or update it — a new version; the previous
    value stays in the history."""

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        data = request.data
        stage = str(data.get("stage") or "INTAKE").upper()[:20]
        finding = findings.review(
            patient,
            str(data.get("key") or ""),
            request.user,
            action=data.get("action"),
            stage=stage,
            status=data.get("status"),
            note=data.get("note", ""),
        )
        return Response(findings.payload(finding), status=status.HTTP_201_CREATED)


class ClientAssessmentsView(APIView):
    """Record one completed assessment (items or total) — stored once in
    OutcomeScore and shared by Intake, Care Plan and Outcomes."""

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        data = request.data
        score = tools.record_assessment(
            patient,
            request.user,
            data.get("instrument"),
            answers=data.get("answers"),
            total=data.get("total"),
            positive=data.get("positive"),
            context=data.get("context") or "",
            note=data.get("note") or "",
            detail=data.get("detail"),
            timepoint=data.get("timepoint") or "",
            assessed_at=data.get("assessed_at") or None,
        )
        return Response(OutcomeScoreSerializer(score).data, status=status.HTTP_201_CREATED)


class ClientWithdrawalView(APIView):
    """GET: withdrawal-chart status per scale. POST: an 'unable to score' attempt."""

    def get(self, request, patient_id):
        from . import withdrawal

        patient = _patient(patient_id)
        return Response({
            "scales": withdrawal.overview(patient),
            "recommended": withdrawal.recommended_scale(patient),
            "substance": withdrawal.substance_display(patient),
            "benzodiazepine": withdrawal.is_benzodiazepine(patient),
        })

    def post(self, request, patient_id):
        from . import withdrawal

        attempt = withdrawal.record_attempt(
            _patient(patient_id), request.user, request.data.get("instrument"), request.data.get("reason")
        )
        return Response({"id": str(attempt.pk)}, status=status.HTTP_201_CREATED)


class ClientCarePlanView(APIView):
    def _payload(self, patient, plan):
        data = CarePlanSerializer(plan).data
        data.update(services.care_plan_suggestions(patient, plan))
        return data

    def get(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        return Response(self._payload(patient, plan))

    def put(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        serializer = CarePlanSerializer(plan, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(self._payload(patient, plan))


class ClientCarePlanActivitiesView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        plan = services.get_or_create_care_plan(patient, request.user)
        serializer = CarePlanActivitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            organization=request.user.organization, care_plan=plan, created_by=request.user
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CarePlanActivityView(APIView):
    def patch(self, request, pk):
        activity = get_object_or_404(CarePlanActivity, pk=pk)
        serializer = CarePlanActivitySerializer(activity, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ClientInterventionsView(APIView):
    def get(self, request, patient_id):
        records = (
            _patient(patient_id)
            .interventions.select_related("activity", "provider", "billing_service")
            .all()
        )
        return Response({"results": InterventionRecordSerializer(records, many=True).data})

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        serializer = InterventionRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = serializer.validated_data.get("activity")
        if activity and activity.care_plan.patient_id != patient.id:
            raise PermissionDenied("That care plan action belongs to a different client.")
        record = services.record_intervention(
            request.user, patient, serializer.validated_data, activity=activity
        )
        return Response(InterventionRecordSerializer(record).data, status=status.HTTP_201_CREATED)


class ClientBillingView(APIView):
    def get(self, request, patient_id):
        return Response(services.billing_overview(_patient(patient_id)))


# ── Billing & tariff (doc 15 §1.15) ──


class BillingOverviewView(APIView):
    def get(self, request):
        return Response(services.billing_overview())


class BillingServicesView(APIView):
    def get(self, request):
        return Response(BillingServiceSerializer(BillingService.objects.all(), many=True).data)


class BillingServiceView(APIView):
    def patch(self, request, pk):
        if not _is_org_admin(request.user):
            raise PermissionDenied("Only an Org Admin can change the facility tariff.")
        service = get_object_or_404(BillingService, pk=pk)
        serializer = BillingServiceSerializer(service, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# ── Dashboard, outpatients, reports (doc 15 §1.3, §1.11, §1.16) ──


def _red_orange_count():
    count = 0
    for patient_id in (
        EpisodeOfCare.objects.filter(status__in=EpisodeOfCare.OPEN_STATUSES)
        .values_list("patient_id", flat=True)
        .distinct()
    ):
        latest = (
            TriageEncounter.objects.filter(patient_id=patient_id, triage_version__gt=0)
            .order_by("-last_triaged_at")
            .values_list("priority", flat=True)
            .first()
        )
        if latest in ("RED", "ORANGE"):
            count += 1
    return count


class DashboardView(APIView):
    def get(self, request):
        from apps.client_registry.views import CaseloadView

        from . import group_programme

        now = timezone.now()
        today = facility_time.local_date(now)
        today_bounds = facility_time.day_bounds(today)
        week_start = today - timedelta(days=today.weekday())
        patients = Patient.objects.filter(archived_at__isnull=True)
        admitted_ids = set(
            Admission.objects.filter(status__in=services.CURRENT_ADMISSION_STATUSES).values_list(
                "patient_id", flat=True
            )
        )
        total = patients.count()
        inpatients = len(admitted_ids)
        beds_available = Bed.objects.filter(status="AVAILABLE").count()
        worklist = services.triage_worklist()
        caseload = CaseloadView().get(request).data["results"]
        follow_ups = services.follow_up_overview("upcoming", now)["counts"]
        return Response(
            {
                "total_clients": total,
                "new_this_week": patients.filter(
                    registered_at__gte=facility_time.combine_local(week_start)
                ).count(),
                "inpatients": inpatients,
                "beds_available": beds_available,
                "outpatients": total - inpatients,
                "outpatients_new_today": patients.filter(
                    registered_at__gte=today_bounds[0], registered_at__lt=today_bounds[1]
                )
                .exclude(id__in=admitted_ids)
                .count(),
                "red_orange": _red_orange_count(),
                "triage_due": len(worklist),
                "psychiatry_queued": len(services.psychiatry_queue()),
                "caseload_count": len(caseload),
                "appointments_today": Appointment.objects.filter(
                    scheduled_for__gte=today_bounds[0], scheduled_for__lt=today_bounds[1]
                )
                .exclude(status="CANCELLED")
                .count(),
                "follow_ups_overdue": follow_ups["overdue"],
                "discharged_without_follow_up": follow_ups["unbooked"],
                **group_programme.dashboard_counts(),
                "recent_activity": services.recent_activity(),
                "triage_arrivals": [_worklist_row(i) for i in worklist[:5]],
                "generated_at": _iso(now),
            }
        )


class OutpatientsView(APIView):
    def get(self, request):
        admitted_ids = Admission.objects.filter(
            status__in=services.CURRENT_ADMISSION_STATUSES
        ).values_list("patient_id", flat=True)
        episodes = (
            EpisodeOfCare.objects.filter(
                status__in=EpisodeOfCare.OPEN_STATUSES, patient__archived_at__isnull=True
            )
            .exclude(patient_id__in=admitted_ids)
            .select_related("patient")
            .order_by("patient__last_name", "patient__first_name")
        )
        now = timezone.now()
        rows, seen = [], set()
        for episode in episodes:
            patient = episode.patient
            if patient.id in seen:
                continue
            seen.add(patient.id)
            diagnosis = (
                DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE")
                .select_related("icd11_code")
                .order_by("-is_primary", "-noted_at")
                .first()
            )
            signed = services.latest_signed_triage(patient)
            last_visit = (
                Appointment.objects.filter(patient=patient, scheduled_for__lt=now)
                .exclude(status__in=("CANCELLED", "NO_SHOW"))
                .order_by("-scheduled_for")
                .first()
            )
            next_visit = (
                Appointment.objects.filter(
                    patient=patient, scheduled_for__gte=now, status="SCHEDULED"
                )
                .order_by("scheduled_for")
                .first()
            )
            rows.append(
                {
                    "patient_id": str(patient.id),
                    "name": patient.get_full_name(),
                    "citramac_number": patient.citramac_number,
                    "diagnosis": (
                        f"{diagnosis.icd11_code_id} — {diagnosis.icd11_code.description}"
                        if diagnosis
                        else ""
                    ),
                    "priority": signed.priority if signed else "",
                    "last_visit": _iso(last_visit.scheduled_for) if last_visit else None,
                    "next_appointment": _iso(next_visit.scheduled_for) if next_visit else None,
                    "status": episode.get_status_display(),
                }
            )
        return Response({"results": rows})


class ReportsView(APIView):
    def get(self, request):
        today_bounds = facility_time.day_bounds(facility_time.local_date())
        worklist = services.triage_worklist()
        signed = list(
            TriageEncounter.objects.filter(triage_version__gt=0).values_list("priority", flat=True)
        )
        beds = Bed.objects.all()
        return Response(
            {
                "registered_clients": Patient.objects.filter(archived_at__isnull=True).count(),
                "awaiting_triage": sum(1 for i in worklist if i["status"] != "RECHECK_DUE"),
                "rechecks_due": sum(1 for i in worklist if i["status"] == "RECHECK_DUE"),
                "signed_triage_assessments": TriageAssessment.objects.filter(
                    status="COMPLETED"
                ).count(),
                "inpatients": Admission.objects.filter(
                    status__in=services.CURRENT_ADMISSION_STATUSES
                ).count(),
                "occupied_beds": beds.filter(status="OCCUPIED").count(),
                "total_beds": beds.count(),
                "appointments_today": Appointment.objects.filter(
                    scheduled_for__gte=today_bounds[0], scheduled_for__lt=today_bounds[1]
                )
                .exclude(status="CANCELLED")
                .count(),
                "priority_distribution": [
                    {"priority": p, "count": signed.count(p)}
                    for p in sorted(PRIORITY_ORDER, key=PRIORITY_ORDER.get)
                ],
            }
        )


# ── Legal & consent, alerts, chart thresholds (docs/15 §1.9, §1.2) ──


def _template_payload(template):
    if template is None:
        return None
    return {
        "id": str(template.id),
        "consent_type": template.consent_type,
        "version": template.version,
        "text": template.text,
        "active": template.active,
        "created_at": _iso(template.created_at),
        "created_by": user_display(template.created_by),
    }


class ConsentTemplatesView(APIView):
    """GET all versions; POST a new version (Org Admin), which becomes the
    active wording and retires the previous one."""

    def get(self, request):
        return Response({"results": [_template_payload(t) for t in ConsentTemplate.objects.all()]})

    def post(self, request):
        if not _is_org_admin(request.user):
            raise PermissionDenied("Only an Org Admin can set the facility's consent wording.")
        consent_type = request.data.get("consent_type") or "DATA_SHARING_HIE"
        version = (request.data.get("version") or "").strip()
        text = (request.data.get("text") or "").strip()
        errors = {}
        if consent_type not in dict(ConsentTemplate.CONSENT_TYPE_CHOICES):
            errors["consent_type"] = "Unknown consent type."
        if not version:
            errors["version"] = "Give this wording a version label."
        if not text:
            errors["text"] = "Enter the consent wording."
        if ConsentTemplate.objects.filter(consent_type=consent_type, version=version).exists():
            errors["version"] = "That version label is already used."
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        ConsentTemplate.objects.filter(consent_type=consent_type, active=True).update(active=False)
        template = ConsentTemplate.objects.create(
            organization=request.user.organization,
            consent_type=consent_type,
            version=version,
            text=text,
            created_by=request.user,
        )
        return Response(_template_payload(template), status=status.HTTP_201_CREATED)


CLIENT_CONSENT_TYPES = ("DATA_SHARING_HIE", "AI_NOTE_PROCESSING")


class ClientConsentView(APIView):
    """POST {granted, consent_type?} — capture or withdraw a client consent
    (HIE data sharing by default, or AI-assisted note processing) against the
    facility's active wording, snapshotted into the immutable ConsentRecord."""

    def post(self, request, patient_id):
        from apps.client_registry.consent import capture_consent

        patient = _patient(patient_id)
        if "granted" not in request.data:
            return Response({"granted": "Required."}, status=status.HTTP_400_BAD_REQUEST)
        consent_type = request.data.get("consent_type") or "DATA_SHARING_HIE"
        if consent_type not in CLIENT_CONSENT_TYPES:
            return Response({"consent_type": "Unknown consent type."}, status=status.HTTP_400_BAD_REQUEST)
        template = ConsentTemplate.objects.filter(consent_type=consent_type, active=True).first()
        if template is None:
            return Response(
                {
                    "detail": "No consent wording is configured for this facility. An Org "
                    "Admin must set it before consent can be recorded."
                },
                status=status.HTTP_409_CONFLICT,
            )
        record = capture_consent(
            patient,
            request.user,
            bool(request.data["granted"]),
            template.version,
            template.text,
            consent_type=consent_type,
        )
        return Response(
            {
                "id": str(record.id),
                "granted": record.granted,
                "consent_text_version": record.consent_text_version,
                "captured_at": _iso(record.captured_at),
            },
            status=status.HTTP_201_CREATED,
        )


class ResolveAlertView(APIView):
    def post(self, request, pk):
        alert = get_object_or_404(ClinicalAlert, pk=pk)
        if alert.status != "RESOLVED":
            alert.status = "RESOLVED"
            alert.resolved_at = timezone.now()
            alert.resolved_by = request.user
            alert.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])
        return Response({"id": str(alert.id), "status": alert.status})


class TriageThresholdsView(APIView):
    """The approved vital-sign thresholds, so charts can draw them."""

    def get(self, request):
        return Response(
            {
                "rules_version": triage_rules.RULES_VERSION,
                "vital_thresholds": triage_rules.VITAL_THRESHOLDS,
                "recheck_interval_minutes": triage_rules.RECHECK_INTERVAL_MINUTES,
                "triage_target_minutes": triage_rules.TRIAGE_TARGET_MINUTES,
            }
        )


# ── Follow-up (docs/17-DISCHARGE-AND-FOLLOW-UP.md) ──


def _uuid_or_404(value):
    import uuid

    from django.http import Http404

    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise Http404 from exc


class FollowUpsView(APIView):
    """GET care/follow-ups/?bucket=upcoming|overdue|missed|unbooked; POST books one."""

    def get(self, request):
        bucket = request.query_params.get("bucket", "upcoming")
        if bucket not in services.FOLLOW_UP_BUCKETS:
            from rest_framework.exceptions import ValidationError

            raise ValidationError(
                {"bucket": f"Use one of {', '.join(services.FOLLOW_UP_BUCKETS)}."}
            )
        return Response(services.follow_up_overview(bucket))

    def post(self, request):
        admission = None
        origin = "MANUAL"
        if request.data.get("admission"):
            admission = get_object_or_404(
                Admission.objects.select_related("patient", "episode"),
                pk=_uuid_or_404(request.data["admission"]),
            )
            patient = admission.patient
            origin = "DISCHARGE"
        else:
            patient = _patient(_uuid_or_404(request.data.get("patient")))
        appointment = services.book_follow_up(
            request.user,
            patient,
            request.data,
            episode=admission.episode if admission else None,
            admission=admission,
            origin=origin,
        )
        return Response(
            services._follow_up_row(appointment, services.concept_labels()),
            status=status.HTTP_201_CREATED,
        )


# ── Discharge planning (docs/17-DISCHARGE-AND-FOLLOW-UP.md) ──


def _admission(pk):
    return get_object_or_404(
        Admission.objects.select_related(
            "patient", "bed__ward", "encounter", "episode", "consultant"
        ),
        pk=pk,
    )


def _require_full_access(user, admission, summary=None):
    if not services.can_view_discharge_in_full(user, admission, summary):
        raise PermissionDenied(
            "Discharge content is confidential to the care team. Ask the care team or an Org Admin."
        )


def _discharge_payload(user, admission):
    latest = services.latest_discharge(admission)
    full = services.can_view_discharge_in_full(user, admission, latest)
    if latest and full:
        log_view(latest)
    return {
        "admission": {
            "id": str(admission.id),
            "patient_id": str(admission.patient_id),
            "patient_name": admission.patient.get_full_name(),
            "citramac_number": admission.patient.citramac_number,
            "bed_label": f"{admission.bed.ward.name} · Bed {admission.bed.bed_number}",
            "admission_type": admission.admission_type,
            "admitted_at": admission.admitted_at.isoformat(),
            "status": admission.status,
            "discharged_at": _iso(admission.discharged_at),
            "consultant_name": user_display(admission.consultant),
            "legacy_summary": admission.discharge_summary if full else "",
        },
        "restricted": not full,
        "summary": services.serialize_discharge(latest, full) if latest else None,
        "context": services.discharge_context(admission) if full else None,
        "versions": [
            {
                "id": str(v.id),
                "version": v.version,
                "status": v.status,
                "signed_at": _iso(v.signed_at),
                "signed_by_name": user_display(v.signed_by),
            }
            for v in DischargeSummary.objects.filter(admission=admission).order_by("-version")
        ],
    }


class DischargeWorklistView(APIView):
    """GET care/discharges/ — current inpatients and the last 30 days of discharges."""

    def get(self, request):
        return Response(services.discharge_worklist())


class AdmissionDischargeView(APIView):
    """GET the discharge form's data; PUT saves the draft."""

    def get(self, request, pk):
        return Response(_discharge_payload(request.user, _admission(pk)))

    def put(self, request, pk):
        admission = _admission(pk)
        _require_full_access(request.user, admission, services.latest_discharge(admission))
        services.save_discharge_draft(admission, request.user, request.data)
        return Response(_discharge_payload(request.user, admission))


class AdmissionDischargeSignView(APIView):
    """POST — sign the discharge and discharge the client (or sign an amendment)."""

    def post(self, request, pk):
        admission = _admission(pk)
        _require_full_access(request.user, admission, services.latest_discharge(admission))
        services.sign_discharge(admission, request.user, request.data)
        return Response(_discharge_payload(request.user, _admission(pk)))


class DischargeAmendView(APIView):
    """POST care/discharges/<id>/amend/ — start a new version of a signed summary."""

    def post(self, request, pk):
        summary = get_object_or_404(DischargeSummary.objects.select_related("admission"), pk=pk)
        admission = _admission(summary.admission_id)
        _require_full_access(request.user, admission, summary)
        services.amend_discharge(summary, request.user)
        return Response(_discharge_payload(request.user, admission), status=status.HTTP_201_CREATED)


class DischargeFhirView(APIView):
    """GET care/discharges/<id>/fhir/ — the signed summary as a FHIR document Bundle."""

    def get(self, request, pk):
        from .fhir import build_discharge_bundle

        summary = get_object_or_404(
            DischargeSummary.objects.select_related("admission__patient"), pk=pk
        )
        _require_full_access(request.user, summary.admission, summary)
        if summary.status != "COMPLETED":
            from .services import StateConflict

            raise StateConflict("Only a signed discharge summary can be exported.")
        log_view(summary)
        return Response(build_discharge_bundle(summary))


# ── proposals, capacity, consent, notes, episode outcome ──


def _proposal_row(p):
    return {"id": str(p.pk), "source": p.source, "row": p.row, "option": p.option, "status": p.status,
            "reason": p.reason, "created_at": _iso(p.created_at), "decided_at": _iso(p.decided_at),
            "decided_by": user_display(p.decided_by)}


class ClientProposalsView(APIView):
    def get(self, request, patient_id):
        from .models import RiskProposal

        rows = RiskProposal.objects.filter(patient=_patient(patient_id))
        return Response({"results": [_proposal_row(p) for p in rows]})


class ProposalDecisionView(APIView):
    def post(self, request, pk):
        from . import records
        from .models import RiskProposal

        proposal = get_object_or_404(RiskProposal, pk=pk)
        records.decide_proposal(proposal, request.user, request.data.get("action"), request.data.get("reason") or "")
        return Response(_proposal_row(proposal))


def _capacity_row(a):
    return {"id": str(a.pk), "decision": a.decision, "other_decision": a.other_decision, "understand": a.understand,
            "retain": a.retain, "weigh": a.weigh, "communicate": a.communicate, "outcome": a.outcome,
            "reassess_by": a.reassess_by, "note": a.note, "assessed_by": user_display(a.assessed_by),
            "assessed_at": _iso(a.assessed_at)}


class ClientCapacityView(APIView):
    def get(self, request, patient_id):
        from . import records
        from .models import CapacityAssessment

        patient = _patient(patient_id)
        return Response({
            "current": [_capacity_row(a) for a in records.current_capacity(patient)],
            "history": [_capacity_row(a) for a in CapacityAssessment.objects.filter(patient=patient)],
        })

    def post(self, request, patient_id):
        from . import records

        a = records.record_capacity(_patient(patient_id), request.user, request.data)
        return Response(_capacity_row(a), status=status.HTTP_201_CREATED)


def _consent_row(c):
    return {"id": str(c.pk), "scope": c.scope, "party": c.party, "method": c.method,
            "given_by_name": c.given_by_name, "warnings": c.warnings, "recorded_at": _iso(c.recorded_at),
            "recorded_by": user_display(c.recorded_by), "completed_at": _iso(c.completed_at),
            "open_deferred": c.party == "DEFERRED" and not c.completed_at}


class ClientVisitConsentView(APIView):
    def get(self, request, patient_id):
        from .models import VisitConsent

        return Response({"results": [_consent_row(c) for c in VisitConsent.objects.filter(patient=_patient(patient_id))]})

    def post(self, request, patient_id):
        from . import records

        c = records.record_visit_consent(_patient(patient_id), request.user, request.data)
        return Response(_consent_row(c), status=status.HTTP_201_CREATED)


class VisitConsentCompleteView(APIView):
    def post(self, request, pk):
        from . import records
        from .models import VisitConsent

        return Response(_consent_row(records.complete_deferred(get_object_or_404(VisitConsent, pk=pk), request.user)))


def _note_row(n):
    return {"id": str(n.pk), "note_type": n.note_type, "text": n.text, "status": n.status,
            "amends": str(n.amends_id) if n.amends_id else None, "author": user_display(n.author),
            "created_at": _iso(n.created_at), "signed_at": _iso(n.signed_at)}


class ClientNotesView(APIView):
    def get(self, request, patient_id):
        from .models import ProgressNote

        return Response({"results": [_note_row(n) for n in ProgressNote.objects.filter(patient=_patient(patient_id))]})

    def post(self, request, patient_id):
        from . import records
        from .models import ProgressNote

        data = dict(request.data)
        if request.data.get("amends"):
            data["amends"] = get_object_or_404(ProgressNote, pk=request.data["amends"], status="SIGNED")
        return Response(_note_row(records.save_note(_patient(patient_id), request.user, data)), status=status.HTTP_201_CREATED)


class NoteView(APIView):
    def put(self, request, pk):
        from . import records
        from .models import ProgressNote

        note = get_object_or_404(ProgressNote, pk=pk)
        if note.status == "DRAFT" and note.author_id != request.user.id:
            raise PermissionDenied("Only the author can edit a draft.")
        return Response(_note_row(records.save_note(note.patient, request.user, request.data, note)))

    def post(self, request, pk):
        from . import records
        from .models import ProgressNote

        return Response(_note_row(records.sign_note(get_object_or_404(ProgressNote, pk=pk), request.user)))


class ClientEpisodeOutcomeView(APIView):
    def get(self, request, patient_id):
        from .models import EpisodeOutcome

        rows = EpisodeOutcome.objects.filter(patient=_patient(patient_id)).order_by("-recorded_at")
        return Response({"results": [
            {"episode": str(o.episode_id), "outcome": o.outcome, "destination": o.destination,
             "reason": o.reason, "recorded_at": _iso(o.recorded_at), "by": user_display(o.recorded_by)} for o in rows]})

    def post(self, request, patient_id):
        from . import records

        d = request.data
        o = records.close_episode(_patient(patient_id), request.user, d.get("outcome"),
                                  d.get("destination") or "", d.get("reason") or "")
        return Response({"episode": str(o.episode_id), "outcome": o.outcome}, status=status.HTTP_201_CREATED)


class ClientNewEpisodeView(APIView):
    def post(self, request, patient_id):
        from . import records

        ep = records.start_new_episode(_patient(patient_id), request.user, request.data.get("presenting") or "")
        return Response({"episode": str(ep.pk)}, status=status.HTTP_201_CREATED)


class ClientTherapyView(APIView):
    def get(self, request, patient_id):
        from . import therapy

        return Response(therapy.overview(_patient(patient_id), request.user))

    def post(self, request, patient_id):
        from . import therapy

        e = therapy.start_therapy(_patient(patient_id), request.user, request.data)
        return Response({"id": str(e.pk)}, status=status.HTTP_201_CREATED)


class TherapyConfidentialityView(APIView):
    def post(self, request, pk):
        from . import therapy
        from .models import TherapyEpisode

        therapy.agree_confidentiality(get_object_or_404(TherapyEpisode, pk=pk))
        return Response({"confidentiality_agreed": True})


class ClientTherapySessionView(APIView):
    def post(self, request, patient_id):
        from . import therapy

        s = therapy.record_session(_patient(patient_id), request.user, request.data.get("episode"), request.data)
        return Response({"id": str(s.pk)}, status=status.HTTP_201_CREATED)


class ClientOatView(APIView):
    def get(self, request, patient_id):
        from .models import NaloxoneSupply, OatEnrolment

        patient = _patient(patient_id)
        return Response({
            "enrolments": [{"id": str(o.pk), "medicine": o.medicine, "clinic": o.clinic, "status": o.status,
                            "prescribed_dose": o.prescribed_dose, "supervised_dispensing": o.supervised_dispensing,
                            "status_reason": o.status_reason} for o in OatEnrolment.objects.filter(patient=patient)],
            "naloxone": [{"id": str(n.pk), "outcome": n.outcome, "quantity": n.quantity,
                          "training_given": n.training_given, "at": _iso(n.given_at)}
                         for n in NaloxoneSupply.objects.filter(patient=patient)],
        })

    def post(self, request, patient_id):
        from . import oat

        e = oat.refer(_patient(patient_id), request.user, request.data)
        return Response({"id": str(e.pk)}, status=status.HTTP_201_CREATED)


class OatStatusView(APIView):
    def post(self, request, pk):
        from . import oat
        from .models import OatEnrolment

        d = request.data
        e = oat.update_status(get_object_or_404(OatEnrolment, pk=pk), request.user, d.get("status"),
                              d.get("dose") or "", d.get("reason") or "", d.get("supervised_dispensing"))
        return Response({"id": str(e.pk), "status": e.status})


class ClientNaloxoneView(APIView):
    def post(self, request, patient_id):
        from . import oat

        d = request.data
        n = oat.record_naloxone(_patient(patient_id), request.user, d.get("outcome"), d.get("quantity"), d.get("training_given"))
        return Response({"id": str(n.pk)}, status=status.HTTP_201_CREATED)


class AppointmentMissedView(APIView):
    def post(self, request, pk):
        from . import records

        appt = get_object_or_404(Appointment, pk=pk)
        records.mark_missed(appt, request.user, request.data.get("reason"))
        return Response({"status": appt.status, "missed_reason": appt.missed_reason})


class AppointmentRecontactedView(APIView):
    def post(self, request, pk):
        from . import records

        appt = records.action_missed(get_object_or_404(Appointment, pk=pk), request.user)
        return Response({"dna_actioned_at": _iso(appt.dna_actioned_at)})


class ClientLabsView(APIView):
    def get(self, request, patient_id):
        from . import labs

        return Response(labs.lab_overview(_patient(patient_id), request.user))

    def post(self, request, patient_id):
        from . import labs

        orders = labs.place_orders(_patient(patient_id), request.user, request.data.get("codes") or [])
        return Response({"orders": [str(o.pk) for o in orders]}, status=status.HTTP_201_CREATED)


class LabAcknowledgeView(APIView):
    def post(self, request, pk):
        from apps.lims.models import LabResult

        from . import labs

        labs.acknowledge(get_object_or_404(LabResult, pk=pk), request.user, request.data.get("note") or "")
        return Response({"acknowledged": True})


class ClientLegalFormsView(APIView):
    def get(self, request, patient_id):
        from . import legal_forms
        from .models import LegalForm

        rows = LegalForm.objects.filter(patient=_patient(patient_id))
        return Response({
            "catalogue": [{"key": f["key"], "title": f["title"]} for f in legal_forms.catalogue()],
            "results": [{"id": str(f.pk), "form_key": f.form_key, "status": f.status,
                         "signed_at": _iso(f.signed_at), "signed_by": user_display(f.signed_by)} for f in rows],
        })

    def post(self, request, patient_id):
        from . import legal_forms

        f = legal_forms.prepare(_patient(patient_id), request.user, request.data.get("form_key"), request.data.get("content"))
        return Response({"id": str(f.pk)}, status=status.HTTP_201_CREATED)


class LegalFormSignView(APIView):
    def post(self, request, pk):
        from . import legal_forms
        from .models import LegalForm

        f = legal_forms.sign(get_object_or_404(LegalForm, pk=pk), request.user)
        return Response({"id": str(f.pk), "status": f.status})


class ClientModulesView(APIView):
    def get(self, request, patient_id):
        from . import care_plan

        return Response({"recommended": care_plan.recommended_modules(_patient(patient_id))})


class WardBoardTableView(APIView):
    def get(self, request):
        from . import attention

        return Response({"results": attention.ward_board()})
