"""Outcomes, planned-discharge checklist and in-record follow-up (mockup v4 stage 6)."""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.client_registry.models import Appointment

from . import outcomes, records, services
from .views import _patient


class ClientOutcomesOverviewView(APIView):
    def get(self, request, patient_id):
        return Response(outcomes.overview(_patient(patient_id)))


class ClientDischargeChecklistView(APIView):
    def get(self, request, patient_id):
        checklist = records.episode_discharge_checklist(_patient(patient_id))
        if checklist is None:
            raise ValidationError({"detail": "There is no open episode."})
        return Response(checklist)

    def patch(self, request, patient_id):
        patient = _patient(patient_id)
        if services.open_episode_for(patient) is None:
            raise ValidationError({"detail": "There is no open episode."})
        return Response(records.save_discharge_answers(patient, request.user, request.data))


class ClientFollowUpListView(APIView):
    def get(self, request, patient_id):
        return Response(records.client_follow_ups(_patient(patient_id)))


class AppointmentContactDoneView(APIView):
    def post(self, request, pk):
        appointment = get_object_or_404(Appointment.objects.select_related("patient"), pk=pk)
        records.complete_follow_up(appointment, request.user, request.data.get("note"))
        return Response(records.client_follow_ups(appointment.patient))


class AppointmentRebookView(APIView):
    def post(self, request, pk):
        appointment = get_object_or_404(Appointment.objects.select_related("patient"), pk=pk)
        records.rebook_missed(appointment, request.user, request.data)
        return Response(records.client_follow_ups(appointment.patient), status=status.HTTP_201_CREATED)
