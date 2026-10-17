"""
Group programme API — the v4 mockup's Group Psychotherapy workspace. Logic lives
in group_programme.py; these views only route, check access and log views.

Reading any client-specific content (a saved session's entries, a client's own
group entries) writes an audit view entry per entry returned (CLAUDE.md §4,
"AuditEvent on every access to a psychiatric record").
"""

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.sysadmin_audit.audit import log_view

from . import group_programme as gp
from .models import GroupProgrammeCategory, GroupSession, GroupSessionEntry
from .services import user_display
from .views import _patient


def _categories_payload(user):
    return {
        "results": [gp.category_row(c) for c in gp.categories(user.organization_id)],
        "can_configure": gp.can_configure_categories(user),
    }


class GroupCategoriesView(APIView):
    """GET / POST care/group-programme/categories/ — POST is administrator-only."""

    def get(self, request):
        return Response(_categories_payload(request.user))

    def post(self, request):
        gp.add_category(request.user, request.data.get("display"))
        return Response(_categories_payload(request.user), status=status.HTTP_201_CREATED)


class GroupCategoryView(APIView):
    """PATCH care/group-programme/categories/<code>/ — changes the display only."""

    def patch(self, request, code):
        category = get_object_or_404(GroupProgrammeCategory, code=code)
        gp.modify_category(request.user, category, request.data.get("display"))
        return Response(_categories_payload(request.user))


class GroupWorkspaceView(APIView):
    """Everything the workspace rail and attendance cards need. Shared facts and
    counts only — a saved session's entries are read from GroupSessionView."""

    def get(self, request):
        user = request.user
        categories = _categories_payload(user)
        return Response(
            {
                "categories": categories["results"],
                "can_configure": categories["can_configure"],
                "sessions": gp.recent_sessions(),
                "scheduled": gp.scheduled_sessions(),
                "clients": gp.eligible_clients(),
                "staff": gp.staff_directory(),
                "current_user": {"id": str(user.pk), "name": user_display(user)},
            }
        )


class GroupSessionsView(APIView):
    """POST care/group-programme/sessions/ — confirm a reviewed session."""

    def post(self, request):
        session = gp.confirm_session(request.user, request.data)
        detail, entries = gp.session_detail(session)
        for entry in entries:
            log_view(entry)
        return Response(detail, status=status.HTTP_201_CREATED)


def _session(pk):
    return get_object_or_404(GroupSession.objects.select_related("category"), pk=pk)


class GroupSessionView(APIView):
    """GET a saved session with its entries; PATCH corrects the shared details."""

    def get(self, request, pk):
        detail, entries = gp.session_detail(_session(pk))
        for entry in entries:
            log_view(entry)
        return Response(detail)

    def patch(self, request, pk):
        session = gp.correct_session(request.user, _session(pk), request.data)
        detail, entries = gp.session_detail(session)
        for entry in entries:
            log_view(entry)
        return Response(detail)


class GroupEntryView(APIView):
    """PATCH care/group-programme/entries/<id>/ — correct one client's entry."""

    def patch(self, request, pk):
        entry = get_object_or_404(GroupSessionEntry, pk=pk)
        entry = gp.correct_entry(request.user, entry, request.data)
        detail, entries = gp.session_detail(_session(entry.session_id))
        for row in entries:
            log_view(row)
        return Response(detail)


class GroupEntryFollowUpCompleteView(APIView):
    """POST …/entries/<id>/follow-up/complete/ — from the client's record card."""

    def post(self, request, pk):
        entry = gp.complete_follow_up(request.user, get_object_or_404(GroupSessionEntry, pk=pk))
        results, entries = gp.client_entries(entry.patient)
        for row in entries:
            log_view(row)
        return Response({"results": results})


class GroupUtilisationView(APIView):
    """Aggregate counts only — no observation or risk detail."""

    def get(self, request):
        return Response(gp.utilisation())


class ClientGroupEntriesView(APIView):
    """GET care/clients/<id>/group-entries/ — this client's entries only."""

    def get(self, request, patient_id):
        results, entries = gp.client_entries(_patient(patient_id))
        for entry in entries:
            log_view(entry)
        return Response({"results": results})
