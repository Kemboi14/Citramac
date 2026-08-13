from rest_framework import viewsets
from rest_framework.response import Response

from .models import BiopsychosocialAssessment, CareTeamMembership, PsychotherapySession
from .permissions import has_full_ccp_access
from .serializers import (
    BiopsychosocialAssessmentRestrictedSerializer,
    BiopsychosocialAssessmentSerializer,
    CareTeamMembershipSerializer,
    PsychotherapySessionRestrictedSerializer,
    PsychotherapySessionSerializer,
)


class CareTeamRestrictedMixin:
    """Swaps in the restricted serializer per-object for anyone without full CCP access."""

    full_serializer_class = None
    restricted_serializer_class = None

    def get_serializer_class(self):
        return self.full_serializer_class

    def _serializer_for(self, obj, request):
        cls = (
            self.full_serializer_class
            if has_full_ccp_access(request.user, obj.patient)
            else self.restricted_serializer_class
        )
        return cls(obj, context={"request": request})

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(self._serializer_for(instance, request).data)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        objects = page if page is not None else queryset
        data = [self._serializer_for(obj, request).data for obj in objects]
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class BiopsychosocialAssessmentViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    full_serializer_class = BiopsychosocialAssessmentSerializer
    restricted_serializer_class = BiopsychosocialAssessmentRestrictedSerializer

    def get_queryset(self):
        return BiopsychosocialAssessment.objects.select_related("patient").order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, author=self.request.user)


class PsychotherapySessionViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    full_serializer_class = PsychotherapySessionSerializer
    restricted_serializer_class = PsychotherapySessionRestrictedSerializer

    def get_queryset(self):
        queryset = PsychotherapySession.objects.select_related("patient").order_by("-session_date")
        session_type = self.request.query_params.get("session_type")
        if session_type:
            queryset = queryset.filter(session_type=session_type)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, therapist=self.request.user)


class CareTeamMembershipViewSet(viewsets.ModelViewSet):
    """Org Admin/Supervisor tool for assigning the care team — docs/07 §7.14.7."""

    serializer_class = CareTeamMembershipSerializer

    def get_queryset(self):
        return CareTeamMembership.objects.select_related("patient", "user")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)
