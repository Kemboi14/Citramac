"""
Psychotherapy Session note API (master prompt §7). Logic lives in
psychotherapy.py; these views route, and every return of note content is
audit-logged there (CLAUDE.md §4, AuditEvent on psychiatric record access).
"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import psychotherapy as psy
from .models import PsychotherapyNote, TherapyModel
from .views import _patient


def _note(pk):
    return get_object_or_404(PsychotherapyNote.objects.select_related("session", "patient", "author"), pk=pk)


class PsyConfigView(APIView):
    """GET care/psychotherapy/config/ — questions, safety question, registry,
    concern options and the served prompt/watermark text."""

    def get(self, request):
        return Response(psy.config(request.user))


class TherapyModelsView(APIView):
    """GET care/psychotherapy/models/ — the whole registry (disabled included);
    POST adds a model (administrator only, AT-17)."""

    def get(self, request):
        rows = psy.therapy_models(request.user.organization_id, enabled_only=False)
        return Response({"results": [psy.model_row(m) for m in rows], "can_configure": psy.can_configure(request.user)})

    def post(self, request):
        model = psy.add_model(request.user, request.data)
        return Response(psy.model_row(model), status=status.HTTP_201_CREATED)


class TherapyModelView(APIView):
    def patch(self, request, code):
        model = get_object_or_404(TherapyModel, code=code)
        return Response(psy.model_row(psy.update_model(request.user, model, request.data)))


class PsyClientListView(APIView):
    """GET care/psychotherapy/clients/ — the Individual Psychotherapy list:
    clients in therapy or with a psychotherapy care-plan action (session
    counts only where the user has full MHP access; the view is audit-logged)."""

    def get(self, request):
        rows = psy.client_list(request.user)
        return Response({"results": rows, "count": len(rows)})


class ClientPsyNotesView(APIView):
    """GET the client's psychotherapy notes (summary); POST starts or resumes
    the clinician's draft for a therapy episode."""

    def get(self, request, patient_id):
        return Response({"results": psy.patient_notes(_patient(patient_id), request.user)})

    def post(self, request, patient_id):
        note, created = psy.start_or_resume(_patient(patient_id), request.user, request.data)
        return Response(psy.detail(note, request.user), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PsyNoteView(APIView):
    def get(self, request, pk):
        return Response(psy.detail(_note(pk), request.user))

    def patch(self, request, pk):
        note = psy.save_draft(_note(pk), request.user, request.data)
        return Response(psy.detail(note, request.user))


class PsyNoteGenerateView(APIView):
    def post(self, request, pk):
        return Response(psy.detail(psy.generate(_note(pk), request.user), request.user))


class PsyNoteSignView(APIView):
    def post(self, request, pk):
        return Response(psy.detail(psy.sign(_note(pk), request.user), request.user))


class PsyNoteAmendView(APIView):
    def post(self, request, pk):
        note = _note(pk)
        psy.amend(note, request.user, request.data)
        return Response(psy.detail(note, request.user), status=status.HTTP_201_CREATED)
