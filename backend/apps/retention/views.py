"""
Records retention & archive API — docs/06-DATA-MODEL.md §6.7 ("never
hard-delete patient data"). Org Admin runs their own organization's
lifecycle (policy, batches, archived records, legal holds); Super Admin
owns the platform floor. Every queryset here is the tenant-scoped manager,
so an Org Admin only ever sees their own organization's rows.
"""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsOrgAdmin, IsPlatformSuperAdmin
from apps.client_registry.models import Patient
from apps.sysadmin_audit.models import AuditLogEntry

from . import services
from .models import (
    ArchiveBatch,
    OrganizationRetentionPolicy,
    RetentionPlatformSettings,
    RetentionScanRun,
)
from .serializers import (
    ArchiveBatchItemSerializer,
    ArchiveBatchSerializer,
    ArchivedPatientSerializer,
    DecisionSerializer,
    LegalHoldSerializer,
    OrganizationRetentionPolicySerializer,
    ReasonSerializer,
    RetentionPlatformSettingsSerializer,
    RetentionScanRunSerializer,
)


class RetentionPlatformSettingsView(APIView):
    permission_classes = [IsPlatformSuperAdmin]

    def get(self, request):
        return Response(
            RetentionPlatformSettingsSerializer(RetentionPlatformSettings.get_solo()).data
        )

    def patch(self, request):
        instance = RetentionPlatformSettings.get_solo()
        serializer = RetentionPlatformSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        verified_now = serializer.validated_data.get("floor_verified")
        extra = {"updated_by": request.user}
        if verified_now and not instance.floor_verified:
            extra.update(verified_by=request.user, verified_at=timezone.now())
        elif verified_now is False:
            extra.update(verified_by=None, verified_at=None)
        serializer.save(**extra)
        return Response(serializer.data)


class OrganizationRetentionPolicyView(APIView):
    permission_classes = [IsOrgAdmin]

    def _policy(self, request):
        policy, _ = OrganizationRetentionPolicy.objects.get_or_create(
            organization=request.user.organization
        )
        return policy

    def get(self, request):
        context = {"platform": RetentionPlatformSettings.get_solo()}
        return Response(
            OrganizationRetentionPolicySerializer(self._policy(request), context=context).data
        )

    def patch(self, request):
        context = {"platform": RetentionPlatformSettings.get_solo()}
        serializer = OrganizationRetentionPolicySerializer(
            self._policy(request), data=request.data, partial=True, context=context
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class RetentionScanRunViewSet(viewsets.ReadOnlyModelViewSet):
    """Scan history; `POST run/` runs the scan for the Org Admin's own organization now."""

    permission_classes = [IsOrgAdmin]
    serializer_class = RetentionScanRunSerializer

    def get_queryset(self):
        return RetentionScanRun.objects.select_related("batch").order_by("-created_at")

    @action(detail=False, methods=["post"])
    def run(self, request):
        run = services.scan_organization(request.user.organization)
        return Response(RetentionScanRunSerializer(run).data, status=201)


class ArchiveBatchViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsOrgAdmin]
    serializer_class = ArchiveBatchSerializer

    def get_queryset(self):
        queryset = ArchiveBatch.objects.select_related("decided_by").order_by("-created_at")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset

    @action(detail=True, methods=["get"])
    def items(self, request, pk=None):
        batch = self.get_object()
        queryset = batch.items.select_related("patient").order_by("retention_ends_on")
        page = self.paginate_queryset(queryset)
        serializer = ArchiveBatchItemSerializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        batch = services.approve_batch(
            self.get_object(), request.user, serializer.validated_data["note"]
        )
        return Response(ArchiveBatchSerializer(batch).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        batch = services.reject_batch(
            self.get_object(), request.user, serializer.validated_data["note"]
        )
        return Response(ArchiveBatchSerializer(batch).data)


class ArchivedPatientListView(generics.ListAPIView):
    permission_classes = [IsOrgAdmin]
    serializer_class = ArchivedPatientSerializer

    def get_queryset(self):
        queryset = Patient.objects.filter(archived_at__isnull=False).select_related("archived_by")
        q = self.request.query_params.get("q")
        if q:
            queryset = queryset.filter(
                Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(uhid_number__icontains=q)
                | Q(citramac_number__icontains=q)
            )
        return queryset.order_by("-archived_at")


class PatientLifecycleViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    /retention/patients/<id>/ — the retention state of one client record
    (readable by any staff member, for the chart header), plus the Org
    Admin-only lifecycle actions on it.
    """

    queryset = Patient.objects.all()

    def get_permissions(self):
        if self.action == "retrieve":
            return [IsAuthenticated()]
        return [IsOrgAdmin()]

    def retrieve(self, request, pk=None):
        patient = self.get_object()
        status_data = services.retention_status_for(patient)
        return Response(
            {
                "patient": str(patient.id),
                "archived_at": patient.archived_at,
                "archive_reason": patient.archive_reason,
                "legal_hold": patient.legal_hold,
                "legal_hold_reason": patient.legal_hold_reason if patient.legal_hold else "",
                **status_data,
            }
        )

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        patient = services.restore_patient(
            self.get_object(), request.user, serializer.validated_data["reason"]
        )
        return Response(ArchivedPatientSerializer(patient).data)

    @action(detail=True, methods=["post"], url_path="legal-hold")
    def legal_hold(self, request, pk=None):
        serializer = LegalHoldSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        patient = services.set_legal_hold(
            self.get_object(),
            request.user,
            serializer.validated_data["on"],
            serializer.validated_data["reason"],
        )
        return Response(ArchivedPatientSerializer(patient).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        patient = self.get_object()
        entries = AuditLogEntry.objects.filter(
            model="client_registry.patient",
            object_id=str(patient.id),
            action__in=[
                AuditLogEntry.ACTION_ARCHIVE,
                AuditLogEntry.ACTION_RESTORE,
                AuditLogEntry.ACTION_LEGAL_HOLD,
            ],
        ).order_by("-timestamp")[:100]
        from apps.accounts.models import User

        actors = {
            u.id: u
            for u in User.all_objects.filter(
                id__in={e.actor_user_id for e in entries if e.actor_user_id}
            )
        }
        return Response(
            [
                {
                    "action": entry.action,
                    "timestamp": entry.timestamp,
                    "actor_name": (
                        f"{actors[entry.actor_user_id].first_name} "
                        f"{actors[entry.actor_user_id].last_name}".strip()
                        if entry.actor_user_id in actors
                        else None
                    ),
                    "detail": {k: v.get("new") for k, v in (entry.field_diff or {}).items()},
                }
                for entry in entries
            ]
        )

    def get_object(self):
        # Tenant-scoped lookup, then the same object-level check DRF applies.
        patient = get_object_or_404(Patient.objects.all(), pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, patient)
        return patient
