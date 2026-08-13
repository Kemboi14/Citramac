from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import sha_gateway
from .models import InsuranceClaim, PreAuthorization, Remittance
from .serializers import InsuranceClaimSerializer, PreAuthorizationSerializer, RemittanceSerializer


class PreAuthorizationViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.11 — Module 11."""

    serializer_class = PreAuthorizationSerializer

    def get_queryset(self):
        return PreAuthorization.objects.select_related("patient").order_by("-id")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)

    @action(detail=True, methods=["post"], url_path="submit-to-sha")
    def submit_to_sha(self, request, pk=None):
        pre_auth = self.get_object()
        log_entry = sha_gateway.submit_pre_authorization(pre_auth)
        pre_auth.status = "SUBMITTED"
        pre_auth.sha_reference = str(log_entry.id)
        pre_auth.submitted_at = timezone.now()
        pre_auth.save(update_fields=["status", "sha_reference", "submitted_at"])
        return Response(PreAuthorizationSerializer(pre_auth).data)


class InsuranceClaimViewSet(viewsets.ModelViewSet):
    serializer_class = InsuranceClaimSerializer

    def get_queryset(self):
        return InsuranceClaim.objects.select_related("patient").order_by("-id")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)

    @action(detail=True, methods=["post"], url_path="submit-to-sha")
    def submit_to_sha(self, request, pk=None):
        claim = self.get_object()
        log_entry = sha_gateway.submit_e_claim(claim)
        claim.status = "SUBMITTED"
        claim.sha_reference = str(log_entry.id)
        claim.submitted_at = timezone.now()
        claim.save(update_fields=["status", "sha_reference", "submitted_at"])
        return Response(InsuranceClaimSerializer(claim).data)


class RemittanceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RemittanceSerializer

    def get_queryset(self):
        return Remittance.objects.select_related("claim").order_by("-remittance_date")
