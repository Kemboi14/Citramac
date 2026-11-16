"""
Psychotherapy Session note API (master prompt §7). Logic lives in
psychotherapy.py; these views route, and every return of note content is
audit-logged there (guide.md §4, AuditEvent on psychiatric record access).
"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import psychotherapy as psy
from .models import PsychotherapyNote, TherapyModel
from .views import _patient


def _note(pk):
    return get_object_or_404(
        PsychotherapyNote.objects.select_related("session", "patient", "author"), pk=pk
    )


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
        return Response(
            {
                "results": [psy.model_row(m) for m in rows],
                "can_configure": psy.can_configure(request.user),
            }
        )

    def post(self, request):
        model = psy.add_model(request.user, request.data)
        return Response(psy.model_row(model), status=status.HTTP_201_CREATED)


class TherapyModelView(APIView):
    def patch(self, request, code):
        model = get_object_or_404(TherapyModel, code=code)
        return Response(psy.model_row(psy.update_model(request.user, model, request.data)))


class PsyClientListView(APIView):
    """GET care/psychotherapy/clients/ — the Psychotherapy client list:
    clients in therapy or with a psychotherapy care-plan action (session
    counts only where the user has full MHP access; the view is audit-logged).

    ``?kind=family`` restricts the list to family-intervention clients."""

    def get(self, request):
        kind = (request.query_params.get("kind") or "individual").strip().lower()
        rows = psy.client_list(request.user, kind=kind)
        return Response({"results": rows, "count": len(rows)})


class PsyFamilySessionsView(APIView):
    """GET care/psychotherapy/sessions/ — sessions the user may read.

    ``?kind=individual`` lists individual sessions; the default is family."""

    def get(self, request):
        kind = (request.query_params.get("kind") or "family").strip().lower()
        if kind not in ("individual", "family"):
            kind = "family"
        return Response({"results": psy.session_list(request.user, kind)})


class ClientPsyNotesView(APIView):
    """GET the client's psychotherapy notes (summary); POST starts or resumes
    the clinician's draft for a therapy episode."""

    def get(self, request, patient_id):
        return Response({"results": psy.patient_notes(_patient(patient_id), request.user)})

    def post(self, request, patient_id):
        note, created = psy.start_or_resume(_patient(patient_id), request.user, request.data)
        return Response(
            psy.detail(note, request.user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


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


class PsyNoteSelfAssessmentView(APIView):
    """POST the therapist's self-assessment of a signed note, and optionally the
    supervision request it raises (psychotherapy.save_self_assessment)."""

    def post(self, request, pk):
        note = psy.save_self_assessment(_note(pk), request.user, request.data)
        return Response(psy.detail(note, request.user))


class PsyNoteFhirView(APIView):
    """GET care/psychotherapy-notes/<id>/fhir/ — the signed note as a FHIR R4
    document Bundle (psychotherapy_fhir.py). Same access as reading the note;
    every export is a VIEW audit entry marked as the FHIR output."""

    def get(self, request, pk):
        from rest_framework.exceptions import PermissionDenied

        from apps.sysadmin_audit.audit import write_entry
        from apps.sysadmin_audit.models import AuditLogEntry

        from .psychotherapy_fhir import build_psychotherapy_bundle
        from .services import StateConflict

        note = _note(pk)
        if not psy.can_read(request.user, note):
            raise PermissionDenied(
                "Psychotherapy notes are visible to the treating clinician and the care team only."
            )
        if note.status != "SIGNED":
            raise StateConflict("Only a signed psychotherapy note can be exported.")
        bundle = build_psychotherapy_bundle(note)
        write_entry(note, AuditLogEntry.ACTION_VIEW, {"output": "fhir"})
        return Response(bundle)
