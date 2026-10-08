from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAuditLogReader

from .audit import log_audit_log_view
from .models import AuditLogEntry
from .serializers import AuditLogEntrySerializer

# Security Audit Logs screen (citramac_SUPER-ADMIN.html) reuses the same
# immutable trail, filtered to security-relevant actions rather than a
# separate audit pipeline.
SECURITY_ACTIONS = [
    AuditLogEntry.ACTION_LOGIN,
    AuditLogEntry.ACTION_LOGIN_FAILED,
    AuditLogEntry.ACTION_ERASURE,
]

PAGE_SIZE = 25


class AuditLogListView(APIView):
    """
    docs/09-SECURITY-COMPLIANCE.md §9.4: "Provide an Audit Log viewer
    (Super Admin: cross-tenant; Org Admin/Auditor role: scoped to their
    org) with filter/search." Not a ModelViewSet: AuditLogEntry is
    append-only (writes only ever happen via the signal-driven audit
    writer, never through this API) and doesn't carry actor/org FKs to
    select_related — this view resolves display names for the current
    page explicitly instead.
    """

    permission_classes = [IsAuditLogReader]

    def get(self, request):
        from apps.accounts.models import User
        from apps.tenancy.context import platform_admin_context
        from apps.tenancy.models import Organization

        queryset = AuditLogEntry.objects.all()
        user = request.user
        if not user.is_superuser:
            queryset = queryset.filter(organization_id=user.organization_id)

        params = request.query_params
        category = params.get("category")
        if category == "security":
            queryset = queryset.filter(action__in=SECURITY_ACTIONS)
        action_filter = params.get("action")
        if action_filter:
            queryset = queryset.filter(action=action_filter)
        model_filter = params.get("model")
        if model_filter:
            queryset = queryset.filter(model__icontains=model_filter)
        q = params.get("q")
        if q:
            queryset = queryset.filter(
                Q(model__icontains=q) | Q(object_id__icontains=q) | Q(actor_role__icontains=q)
            )

        for param, lookup in (("from", "timestamp__date__gte"), ("to", "timestamp__date__lte")):
            raw = params.get(param)
            if not raw:
                continue
            day = parse_date(raw)
            if day is None:
                return Response(
                    {
                        "error": {
                            "code": "VALIDATION_ERROR",
                            "message": f"'{param}' must be YYYY-MM-DD.",
                        }
                    },
                    status=400,
                )
            queryset = queryset.filter(**{lookup: day})

        try:
            page = max(int(params.get("page", 1)), 1)
        except ValueError:
            page = 1
        total = queryset.count()
        start = (page - 1) * PAGE_SIZE
        rows = list(queryset[start : start + PAGE_SIZE])

        actor_ids = {row.actor_user_id for row in rows if row.actor_user_id}
        org_ids = {row.organization_id for row in rows if row.organization_id}
        with platform_admin_context():
            actors = {
                str(u.id): u.get_full_name() for u in User.all_objects.filter(id__in=actor_ids)
            }
            orgs = {str(o.id): o.name for o in Organization.objects.filter(id__in=org_ids)}

        results = AuditLogEntrySerializer(rows, many=True).data
        for row, entry in zip(rows, results, strict=True):
            entry["actor_name"] = actors.get(str(row.actor_user_id), "System")
            entry["organization_name"] = orgs.get(str(row.organization_id), "")

        # Who opened the trail, and with what filters, is itself audited. Written
        # after the page was read so the entry never lists itself.
        applied = {
            key: params.get(key)
            for key in ("category", "action", "model", "q", "from", "to")
            if params.get(key)
        }
        log_audit_log_view(user.organization_id, applied, page)

        return Response({"count": total, "page": page, "page_size": PAGE_SIZE, "results": results})
