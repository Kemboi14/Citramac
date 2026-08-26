from rest_framework import generics, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsPlatformSuperAdmin

from .evaluate import compute_tenant_security, evaluate_security_alerts
from .models import MANDATORY_CONTROLS, SecurityAlert, SecurityPolicy
from .serializers import SecurityAlertSerializer, SecurityPolicySerializer


class SecurityPolicyView(generics.RetrieveUpdateAPIView):
    """citramac_SUPER-ADMIN.html "Security Policies" — the platform-wide
    configurable baseline. Mandatory controls are a fixed constant, exposed
    read-only alongside it so the frontend renders one screen."""

    permission_classes = [IsPlatformSuperAdmin]
    serializer_class = SecurityPolicySerializer

    def get_object(self):
        return SecurityPolicy.get_solo()

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        response.data["mandatory_controls"] = MANDATORY_CONTROLS
        return response

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        response.data["mandatory_controls"] = MANDATORY_CONTROLS
        return response


class SecurityDashboardView(APIView):
    """citramac_SUPER-ADMIN.html "Security Dashboard" — stat cards + the
    Tenant Security Compliance table, computed live from real data."""

    permission_classes = [IsPlatformSuperAdmin]

    def get(self, request):
        from apps.tenancy.context import platform_admin_context
        from apps.tenancy.models import Organization

        with platform_admin_context():
            organizations = list(Organization.objects.all())

        org_ids = [org.id for org in organizations]
        evaluate_security_alerts(org_ids)

        rows = [compute_tenant_security(org.id) for org in organizations]
        for row, org in zip(rows, organizations, strict=True):
            row["organization_name"] = org.name
            row["organization_slug"] = org.slug

        counts = {"Secure": 0, "Warning": 0, "Non-Compliant": 0, "Critical": 0}
        for row in rows:
            counts[row["status"]] = counts.get(row["status"], 0) + 1

        active_alerts = SecurityAlert.objects.filter(
            status__in=[SecurityAlert.STATUS_NEW, SecurityAlert.STATUS_INVESTIGATING]
        )
        critical_alerts = active_alerts.filter(severity=SecurityAlert.SEVERITY_CRITICAL).count()
        total_failed_logins = sum(row["failed_logins_24h"] for row in rows)
        avg_mfa = (
            round(sum(row["mfa_adoption_percent"] for row in rows) / len(rows)) if rows else 100
        )

        return Response(
            {
                "total_tenants": len(organizations),
                "fully_compliant_tenants": counts["Secure"],
                "tenants_with_warnings": counts["Warning"],
                "non_compliant_tenants": counts["Non-Compliant"] + counts["Critical"],
                "critical_security_issues": critical_alerts,
                "mfa_adoption_percent": avg_mfa,
                "active_alerts": active_alerts.count(),
                "failed_logins_24h": total_failed_logins,
                "tenants": rows,
            }
        )


class SecurityAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """List + triage actions for the Security Alerts screen."""

    permission_classes = [IsPlatformSuperAdmin]
    serializer_class = SecurityAlertSerializer

    def get_queryset(self):
        from apps.tenancy.context import platform_admin_context
        from apps.tenancy.models import Organization

        with platform_admin_context():
            org_ids = list(Organization.objects.values_list("id", flat=True))
        evaluate_security_alerts(org_ids)
        return SecurityAlert.objects.all()

    def get_serializer_context(self):
        from apps.tenancy.context import platform_admin_context
        from apps.tenancy.models import Organization

        context = super().get_serializer_context()
        with platform_admin_context():
            context["org_names"] = {str(org.id): org.name for org in Organization.objects.all()}
        return context

    def _set_status(self, request, pk, new_status):
        from django.utils import timezone

        alert = self.get_object()
        alert.status = new_status
        if new_status in (SecurityAlert.STATUS_RESOLVED, SecurityAlert.STATUS_DISMISSED):
            alert.resolved_at = timezone.now()
        alert.save(update_fields=["status", "resolved_at", "updated_at"])
        return Response(self.get_serializer(alert).data)

    @action(detail=True, methods=["post"])
    def investigate(self, request, pk=None):
        return self._set_status(request, pk, SecurityAlert.STATUS_INVESTIGATING)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        return self._set_status(request, pk, SecurityAlert.STATUS_RESOLVED)

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        return self._set_status(request, pk, SecurityAlert.STATUS_DISMISSED)
