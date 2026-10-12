"""Intervention-module endpoints: observation & safety, observation sets, SBAR,
prescribing checks, MAR and restrictive practice."""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ipd_ward.models import MedicationAdministration

from . import interventions as iv
from .models import RestrictiveCheck, RestrictivePracticeEpisode
from .views import _patient, _vital_row


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
            own_supply=d.get("own_supply", False),
        )
        return Response(iv.mar_today(entry.admission.patient))


class MarEffectView(APIView):
    def post(self, request, pk):
        entry = get_object_or_404(MedicationAdministration, pk=pk)
        iv.record_effect(entry, request.user, request.data.get("effect"))
        return Response(iv.mar_today(entry.admission.patient))


def _episode_row(e):
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
        "checks": [
            {"id": str(c.id), "label": c.label, "due_at": c.due_at, "done_at": c.done_at,
             "done_by": iv._name(c.done_by)}
            for c in e.checks.all()
        ],
    }


class RestrictivePracticeView(APIView):
    def get(self, request, patient_id):
        rows = RestrictivePracticeEpisode.objects.filter(patient_id=patient_id).prefetch_related("checks")
        return Response({"results": [_episode_row(e) for e in rows], "de_escalation_options": iv.DE_ESCALATION})

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
        iv.end_episode(episode)
        return Response(_episode_row(episode))


class RestrictiveDebriefView(APIView):
    def post(self, request, pk):
        episode = get_object_or_404(RestrictivePracticeEpisode, pk=pk)
        return Response(_episode_row(iv.client_debrief(episode)))
