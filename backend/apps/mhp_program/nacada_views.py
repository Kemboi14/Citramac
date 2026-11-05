"""NACADA NDO report API — compile, view, FHIR, send, and the reporting address."""

from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.access import branches_for
from apps.retention.mixins import NoHardDeleteMixin
from apps.tenancy.context import get_active_branch_id

from .models import NacadaNdoReport, NacadaReportSend
from .nacada_fhir import bundle_for
from .nacada_report import DEFINITION, compile_report
from .nacada_send import may_edit_settings, may_send, send_report


def _name(user):
    return (user.get_full_name() or user.email) if user else ""


class NacadaReportSendSerializer(serializers.ModelSerializer):
    sent_by_name = serializers.SerializerMethodField()
    delivery_status = serializers.SerializerMethodField()
    delivery_error = serializers.SerializerMethodField()

    class Meta:
        model = NacadaReportSend
        fields = [
            "id",
            "target",
            "address",
            "sent_by_name",
            "sent_at",
            "delivery_status",
            "delivery_error",
        ]

    def get_sent_by_name(self, obj):
        return _name(obj.sent_by)

    def get_delivery_status(self, obj):
        return obj.delivery.status if obj.delivery else None

    def get_delivery_error(self, obj):
        return obj.delivery.last_error if obj.delivery else ""


class NacadaNdoReportSerializer(serializers.ModelSerializer):
    branch_name = serializers.SerializerMethodField()
    generated_by_name = serializers.SerializerMethodField()
    sends = NacadaReportSendSerializer(many=True, read_only=True)

    class Meta:
        model = NacadaNdoReport
        fields = [
            "id",
            "period_start",
            "period_end",
            "branch",
            "branch_name",
            "definition",
            "generated_by_name",
            "generated_at",
            "summary_data",
            "status",
            "sends",
        ]
        read_only_fields = fields

    def get_branch_name(self, obj):
        return obj.branch.name if obj.branch else ""

    def get_generated_by_name(self, obj):
        return _name(obj.generated_by)


class PeriodSerializer(serializers.Serializer):
    period_start = serializers.DateField()
    period_end = serializers.DateField()


class NacadaNdoReportViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    """
    A compiled report is a snapshot: created, read, sent — never edited. Counts
    only, small numbers withheld (apps.mhp_program.nacada_report).
    """

    serializer_class = NacadaNdoReportSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return (
            NacadaNdoReport.objects.select_related("branch", "generated_by")
            .prefetch_related("sends__sent_by", "sends__delivery")
            .order_by("-generated_at")
        )

    def _branch(self, branch_id):
        allowed = branches_for(self.request.user)
        if branch_id:
            branch = allowed.filter(pk=branch_id).first()
            if branch is None:
                raise ValidationError({"branch": "Choose one of your branches."})
            return branch
        active = get_active_branch_id()
        branch = allowed.filter(pk=active).first() if active else None
        if branch is None and allowed.count() == 1:
            branch = allowed.first()
        if branch is None:
            raise ValidationError({"branch": "Choose the branch (facility) to report for."})
        return branch

    def create(self, request, *args, **kwargs):
        dates = PeriodSerializer(data=request.data)
        dates.is_valid(raise_exception=True)
        start, end = dates.validated_data["period_start"], dates.validated_data["period_end"]
        if start > end:
            raise ValidationError({"period_end": "The period must end on or after its start."})
        if end > timezone.localdate():
            raise ValidationError({"period_end": "The period can't end in the future."})
        branch = self._branch(request.data.get("branch"))
        organization = request.user.organization
        report = NacadaNdoReport.objects.create(
            organization=organization,
            branch=branch,
            period_start=start,
            period_end=end,
            definition=DEFINITION,
            generated_by=request.user,
            summary_data=compile_report(organization, branch, start, end),
        )
        return Response(self.get_serializer(report).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        report = self.get_object()
        send_report(report, request.user, request.data.get("target"), request.data.get("confirm"))
        report = self.get_queryset().get(pk=report.pk)
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=["get"], url_path="print")
    def print_report(self, request, pk=None):
        """The report in the shared professional document layout (preview / `?output=pdf`)."""
        from apps.care_pathway import facility_time
        from apps.documents import printing
        from apps.sysadmin_audit.audit import write_event
        from apps.sysadmin_audit.models import AuditLogEntry

        report = self.get_object()
        if not report.definition:
            raise ValidationError(
                {"report": "This report was compiled in the old format and can't be printed."}
            )
        summary = report.summary_data
        organization = report.organization
        context = {
            "title": "NACADA National Drug Observatory report",
            "letterhead": printing.letterhead(
                organization, report.branch or printing.default_branch(organization)
            ),
            "meta": [
                ("Reference", f"NDO-{str(report.pk)[:8].upper()}"),
                ("Period", f"{summary.get('period_start', '')} to {summary.get('period_end', '')}"),
            ],
            "summary": summary,
            "period": f"{summary.get('period_start', '')} to {summary.get('period_end', '')}",
            "compiled_at": facility_time.local_format(report.generated_at, "%d %b %Y %H:%M"),
            "compiled_by": _name(report.generated_by),
            "printed_by": _name(request.user),
        }
        write_event(
            report.organization_id,
            AuditLogEntry.ACTION_VIEW,
            "mhp_program.nacadandoreport",
            report.pk,
            {"output": "PDF download" if printing.wants_pdf(request) else "preview"},
        )
        html = printing.render("documents/print/nacada.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename(
                "nacada-ndo", summary.get("branch_name"), summary.get("period_end")
            ),
        )

    @action(detail=True, methods=["get"])
    def fhir(self, request, pk=None):
        report = self.get_object()
        if not report.definition:
            raise ValidationError(
                {"report": "This report was compiled in the old format and has no FHIR form."}
            )
        return Response(bundle_for(report), content_type="application/fhir+json")


class NacadaSettingsView(APIView):
    """The organisation's NACADA reporting email — Org Admin sets it."""

    def _payload(self, request):
        user = request.user
        working = get_active_branch_id()
        return {
            "nacada_report_email": user.organization.nacada_report_email,
            "can_edit": may_edit_settings(user),
            "can_send": may_send(user),
            "my_email": user.email,
            "branches": [{"id": str(b.id), "name": b.name} for b in branches_for(user)],
            # Preselected in the branch picker; None when viewing all branches.
            "working_branch": str(working) if working else None,
        }

    def get(self, request):
        return Response(self._payload(request))

    def put(self, request):
        if not may_edit_settings(request.user):
            raise PermissionDenied("Only an Org Admin can change the NACADA reporting email.")
        field = serializers.EmailField(allow_blank=True)
        try:
            address = field.run_validation(request.data.get("nacada_report_email", ""))
        except serializers.ValidationError as exc:
            raise ValidationError({"nacada_report_email": exc.detail}) from exc
        organization = request.user.organization
        organization.nacada_report_email = address
        organization.save(update_fields=["nacada_report_email"])
        return Response(self._payload(request))
