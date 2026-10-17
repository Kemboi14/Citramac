"""Intervention-module endpoints: the v4 Interventions workspace and record
corrections, observation & safety, observation sets, SBAR, prescribing checks and
structured orders, MAR and restrictive practice."""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ipd_ward.models import MedicationAdministration

from . import intervention_catalogue
from . import interventions as iv
from .models import CosignRequest, InterventionRecord, RestrictiveCheck, RestrictivePracticeEpisode
from .serializers import InterventionRecordSerializer
from .views import _is_org_admin, _patient, _vital_row


class InterventionWorkspaceView(APIView):
    """GET care/clients/<id>/interventions/workspace/ — care-plan actions, the
    clinical modules (with recommendations and tariff) and carried context."""

    def get(self, request, patient_id):
        return Response(intervention_catalogue.workspace(_patient(patient_id)))


class InterventionVoidView(APIView):
    """POST care/interventions/<id>/void/ {reason} — correct a delivery recorded
    in error. Only its provider or an Org Admin may correct it."""

    def post(self, request, pk):
        record = get_object_or_404(InterventionRecord, pk=pk)
        if record.provider_id != request.user.id and not _is_org_admin(request.user):
            raise PermissionDenied("Only the recording clinician or an Org Admin can correct this record.")
        record = intervention_catalogue.correct_record(request.user, record, request.data.get("reason"))
        return Response(InterventionRecordSerializer(record).data)


class ObservationConfigView(APIView):
    def get(self, request):
        return Response(iv.served_observation())


class ObservationStateView(APIView):
    def get(self, request, patient_id):
        return Response(iv.observation_state(_patient(patient_id)))


class ObservationLevelView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        iv.set_observation_level(patient, request.user, request.data.get("level"), request.data.get("reason"))
        return Response(iv.observation_state(patient), status=status.HTTP_201_CREATED)


class ObserverHandoverView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        iv.hand_over_observer(patient, request.user, request.data.get("observer_name"), request.data.get("observer_gender", ""))
        return Response(iv.observation_state(patient), status=status.HTTP_201_CREATED)


class ObservationEntryView(APIView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        d = request.data
        iv.add_observation_entry(patient, request.user, d.get("location"), d.get("engagement", ""), d.get("note", ""))
        return Response(iv.observation_state(patient), status=status.HTTP_201_CREATED)


class ObservationSetView(APIView):
    """POST care/clients/<id>/observation-sets/ — a full set of vital signs, with
    the early warning score computed and unmeasured parameters reported."""

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        vital, warnings, skipped = iv.record_observation_set(patient, request.user, request.data)
        return Response(
            {**_vital_row(vital), "warnings": warnings, "not_measured": skipped},
            status=status.HTTP_201_CREATED,
        )


class SbarView(APIView):
    def get(self, request, patient_id):
        return Response({"text": iv.build_sbar(_patient(patient_id), request.user)})


class PrescribingChecksView(APIView):
    def post(self, request, patient_id):
        return Response(iv.prescribing_checks(_patient(patient_id), request.data.get("drug")))


class PrescribingView(APIView):
    """GET care/clients/<id>/prescribing/ — allergy lock, who may prescribe and
    recent orders. POST — a structured order, checked before it is placed."""

    def get(self, request, patient_id):
        return Response(iv.prescribing_state(_patient(patient_id), request.user))

    def post(self, request, patient_id):
        from apps.billing.gate import BillingNotCleared

        patient = _patient(patient_id)
        try:
            iv.place_order(patient, request.user, request.data)
        except BillingNotCleared as exc:
            return Response(
                {"error": {"code": "BILLING_NOT_CLEARED", "message": str(exc)}},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        return Response(iv.prescribing_state(patient, request.user), status=status.HTTP_201_CREATED)


class MarView(APIView):
    def get(self, request, patient_id):
        return Response(iv.mar_today(_patient(patient_id)))


class MarAdministerView(APIView):
    def post(self, request, pk):
        entry = get_object_or_404(MedicationAdministration, pk=pk)
        d = request.data
        iv.record_administration(
            entry, request.user, d.get("outcome"), notes=d.get("notes", ""),
            indication=d.get("prn_indication", ""), witness=d.get("witness_name", ""),
            own_supply=d.get("own_supply", False), override_reason=d.get("override_reason", ""),
        )
        return Response(iv.mar_today(entry.admission.patient))


class MarOrderAdministerView(APIView):
    """POST care/clients/<id>/mar/orders/<item>/administer/ {slot?, outcome, …} —
    a dose against an order at one of today's dose times, or unscheduled."""

    def post(self, request, patient_id, item_id):
        from apps.clinical_encounter.models import PrescriptionItem

        from . import services

        patient = _patient(patient_id)
        admission = services.current_admission(patient)
        if admission is None:
            raise ValidationError({"detail": "This client is not admitted, so there is no MAR to record on."})
        item = get_object_or_404(iv.admission_orders(admission), pk=item_id)
        d = request.data
        iv.administer_order(
            admission, item, request.user, d.get("outcome"), slot=d.get("slot") or "",
            notes=d.get("notes", ""), indication=d.get("prn_indication", ""),
            witness=d.get("witness_name", ""), own_supply=d.get("own_supply", False),
            override_reason=d.get("override_reason", ""),
        )
        return Response(iv.mar_today(patient), status=status.HTTP_201_CREATED)


class MarEffectView(APIView):
    def post(self, request, pk):
        entry = get_object_or_404(MedicationAdministration, pk=pk)
        iv.record_effect(entry, request.user, request.data.get("effect"))
        return Response(iv.mar_today(entry.admission.patient))


def _episode_row(e):
    cosign = CosignRequest.objects.filter(subject_type="RestrictivePracticeEpisode", subject_id=str(e.pk)).first()
    return {
        "id": str(e.id),
        "kind": e.kind,
        "kind_display": e.get_kind_display(),
        "de_escalation": e.de_escalation,
        "authorised_by": iv._name(e.authorised_by),
        "start_at": e.start_at,
        "end_at": e.end_at,
        "injury_check": e.get_injury_check_display(),
        "incident_reference": e.incident_reference,
        "client_debrief_at": e.client_debrief_at,
        "staff_debrief_held": e.staff_debrief_held,
        "senior_review_due": iv.seclusion_review_due(e),
        "recorded_by": iv._name(e.recorded_by),
        "cosign_status": cosign.status if cosign else None,
        "checks": [
            {"id": str(c.id), "label": c.label, "due_at": c.due_at, "done_at": c.done_at,
             "done_by": iv._name(c.done_by)}
            for c in e.checks.all()
        ],
    }


class RestrictivePracticeView(APIView):
    def get(self, request, patient_id):
        rows = RestrictivePracticeEpisode.objects.filter(patient_id=patient_id).prefetch_related("checks")
        from . import plan_extras

        return Response({
            "results": [_episode_row(e) for e in rows],
            "de_escalation_options": iv.DE_ESCALATION,
            "authorisers": [
                {"id": str(u.pk), "name": iv._name(u), "senior": plan_extras.can_cosign(u)}
                for u in iv.restrictive_authorisers(request.user.organization_id)
            ],
        })

    def post(self, request, patient_id):
        episode = iv.record_restrictive_episode(_patient(patient_id), request.user, request.data)
        return Response(_episode_row(episode), status=status.HTTP_201_CREATED)


class RestrictiveCheckView(APIView):
    def post(self, request, pk):
        check = get_object_or_404(RestrictiveCheck, pk=pk)
        iv.complete_check(check, request.user)
        return Response(_episode_row(check.episode))


class RestrictiveEndView(APIView):
    def post(self, request, pk):
        episode = get_object_or_404(RestrictivePracticeEpisode, pk=pk)
        iv.end_episode(episode, request.data.get("end_at"))
        return Response(_episode_row(episode))


class RestrictiveDebriefView(APIView):
    def post(self, request, pk):
        episode = get_object_or_404(RestrictivePracticeEpisode, pk=pk)
        return Response(_episode_row(iv.client_debrief(episode)))


class LabResultEntryView(APIView):
    """POST care/labs/orders/<id>/result/ {value, interpretation, unit?, reference_range?}
    — a result from the laboratory report; it awaits laboratory validation."""

    def post(self, request, pk):
        from apps.lims.models import LabOrder

        from . import labs

        order = get_object_or_404(LabOrder.objects.select_related("encounter__patient"), pk=pk)
        labs.enter_result(order, request.user, request.data)
        return Response(labs.lab_overview(order.encounter.patient, request.user), status=status.HTTP_201_CREATED)
