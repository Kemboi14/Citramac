"""
Care pathway API — docs/15-CLINICAL-WORKSPACE-V3.md. Every screen of the
approved 2026-10-07 clinical workspace mockup reads and writes through here.
"""

from datetime import timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.client_registry.models import Appointment, ConsentRecord, Patient
from apps.clinical_encounter.models import DiagnosisCode
from apps.ipd_ward.models import Admission, Bed
from apps.sysadmin_audit.audit import log_view
from apps.triage.models import MentalStatusExam, VitalSigns

from . import services, triage_rules
from .models import (
    PRIORITY_ORDER,
    BillingService,
    CarePlanActivity,
    CareTask,
    ClinicalAlert,
    ConsentTemplate,
    EpisodeOfCare,
    IntakeAssessment,
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
    InterventionRecordSerializer,
    OutcomeScoreSerializer,
)
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


def _registration_row(patient):
    """Registration details only — Front Desk never sees clinical content."""
    allergies = ", ".join(
        patient.allergy_records.exclude(verification_status="REFUTED").values_list(
            "substance", flat=True
        )
    )
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
        "next_of_kin": patient.next_of_kin.name if patient.next_of_kin else "",
        "address": patient.address,
        "id_document_type": patient.id_document_type,
        "id_document_number": patient.id_document_number or patient.national_id,
        "preferred_language": patient.preferred_language,
        "interpreter": patient.interpreter,
        "allergy_status": patient.allergy_status,
        "allergy_details": allergies,
        "payer": patient.payer,
    }


class RegistrationSearchView(APIView):
    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"results": []})
        patients = (
            Patient.objects.filter(archived_at__isnull=True)
            .filter(
                Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(middle_other_names__icontains=q)
                | Q(preferred_name__icontains=q)
                | Q(identity_description__icontains=q)
                | Q(contact_phone__icontains=q)
                | Q(national_id__icontains=q)
                | Q(id_document_number__icontains=q)
                | Q(citramac_number__icontains=q)
                | Q(uhid_number__icontains=q)
            )
            .select_related("next_of_kin")
            .order_by("-registered_at")[:6]
        )
        return Response({"results": [_registration_row(p) for p in patients]})


class RegistrationView(APIView):
    def post(self, request):
        te = services.register_arrival(request.user, request.data)
        return Response(
            {"triage_encounter_id": str(te.id), "patient_id": str(te.patient_id)},
            status=status.HTTP_201_CREATED,
        )


class ResolveIdentityView(APIView):
    def post(self, request, patient_id):
        patient = services.resolve_identity(request.user, _patient(patient_id), request.data)
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
        "wait_minutes": item["wait_minutes"],
        "visit_number": te.visit_number,
        "triage_version": te.triage_version,
        "last_triaged_at": _iso(te.last_triaged_at),
        "priority": te.priority,
    }


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
                "defaults": triage_rules.DEFAULT_ANSWERS,
                "draft": _assessment_payload(draft),
                "signed": _assessment_payload(signed),
                "evaluation": triage_rules.evaluate(answers, labels),
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
                "evaluation": triage_rules.evaluate(answers, services.concept_labels()),
            }
        )


class TriageEvaluateView(APIView):
    def post(self, request, pk):
        _triage(pk)
        return Response(
            triage_rules.evaluate(request.data.get("answers") or {}, services.concept_labels())
        )


class TriageSignView(APIView):
    def post(self, request, pk):
        te = _triage(pk)
        assessment = services.sign_triage(te, request.user, request.data)
        return Response(_assessment_payload(assessment), status=status.HTTP_201_CREATED)


class TriageTasksView(APIView):
    """Section N "Register as trackable tasks" — one Task per ticked action."""

    def post(self, request, pk):
        te = _triage(pk)
        codes = request.data.get("actions") or []
        owner = (request.data.get("owner") or "").strip() or "Psychiatry / Nursing"
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
                    owner=owner,
                    status=task_status,
                    created_by=request.user,
                )
            )
        return Response(
            CareTaskSerializer(te.tasks.all(), many=True).data, status=status.HTTP_201_CREATED
        )


class CareTaskView(APIView):
    def patch(self, request, pk):
        task = get_object_or_404(CareTask, pk=pk)
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
        rows = []
        for te in services.psychiatry_queue():
            rows.append(
                {
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
            activities = CarePlanActivitySerializer(plan.care_plan.activities.all(), many=True).data
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
        return Response({"results": IntakeAssessmentSerializer(intakes, many=True).data})

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
        return Response(IntakeAssessmentSerializer(intake).data, status=status.HTTP_201_CREATED)


class ClientOutcomesView(APIView):
    def get(self, request, patient_id):
        scores = OutcomeScore.objects.filter(patient_id=patient_id)
        return Response({"results": OutcomeScoreSerializer(scores, many=True).data})


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
        activity = serializer.validated_data["activity"]
        if activity.care_plan.patient_id != patient.id:
            raise PermissionDenied("That care plan action belongs to a different client.")
        record = services.record_intervention(request.user, activity, serializer.validated_data)
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

        now = timezone.now()
        today = timezone.localdate()
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
        return Response(
            {
                "total_clients": total,
                "new_this_week": patients.filter(registered_at__date__gte=week_start).count(),
                "inpatients": inpatients,
                "beds_available": beds_available,
                "outpatients": total - inpatients,
                "outpatients_new_today": patients.filter(registered_at__date=today)
                .exclude(id__in=admitted_ids)
                .count(),
                "red_orange": _red_orange_count(),
                "triage_due": len(worklist),
                "psychiatry_queued": len(services.psychiatry_queue()),
                "caseload_count": len(caseload),
                "appointments_today": Appointment.objects.filter(scheduled_for__date=today)
                .exclude(status="CANCELLED")
                .count(),
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
        today = timezone.localdate()
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
                "appointments_today": Appointment.objects.filter(scheduled_for__date=today)
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


class ClientConsentView(APIView):
    """POST {granted} — capture or withdraw data-sharing consent against the
    facility's active wording, snapshotted into the immutable ConsentRecord."""

    def post(self, request, patient_id):
        from apps.client_registry.consent import capture_consent

        patient = _patient(patient_id)
        if "granted" not in request.data:
            return Response({"granted": "Required."}, status=status.HTTP_400_BAD_REQUEST)
        template = ConsentTemplate.objects.filter(
            consent_type="DATA_SHARING_HIE", active=True
        ).first()
        if template is None:
            return Response(
                {
                    "detail": "No consent wording is configured for this facility. An Org "
                    "Admin must set it before consent can be recorded."
                },
                status=status.HTTP_409_CONFLICT,
            )
        record = capture_consent(
            patient, request.user, bool(request.data["granted"]), template.version, template.text
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
