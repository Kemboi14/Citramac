"""
Clinical Report endpoints (clinical_report.py): the report as JSON, as the
shared printable document (Preview / `?output=pdf`), and as a FHIR R4 Bundle.

Each call compiles the counts for the chosen branch and period afresh — nothing
is stored. Clinical staff and Org Admin can open it, for their own branches
only. Every compile is a VIEW entry in the audit log (CLAUDE.md §4).
"""

import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.access import branches_for, has_permission, is_org_admin
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import get_active_branch_id

from . import clinical_report, facility_time
from .access import CARE
from .services import user_display

AUDIT_MODEL = "care_pathway.clinicalreport"


class PeriodSerializer(serializers.Serializer):
    period_start = serializers.DateField(required=False)
    period_end = serializers.DateField(required=False)
    branch = serializers.UUIDField(required=False)


def last_month(today):
    first_this = today.replace(day=1)
    end = first_this - timedelta(days=1)
    return end.replace(day=1), end


def _branches(user):
    return branches_for(user).order_by("name")


def _compile(request, output):
    user = request.user
    if not (has_permission(user, CARE) or is_org_admin(user)):
        raise PermissionDenied("The clinical report is for clinical staff and Org Admin.")
    params = PeriodSerializer(data=request.query_params)
    params.is_valid(raise_exception=True)
    today = facility_time.local_date()
    default_start, default_end = last_month(today)
    start = params.validated_data.get("period_start") or default_start
    end = params.validated_data.get("period_end") or default_end
    if start > end:
        raise ValidationError({"period_end": "The period must end on or after its start."})
    if end > today:
        raise ValidationError({"period_end": "The period can't end in the future."})
    if (end - start).days > 366:
        raise ValidationError({"period_start": "Choose a period of at most a year."})

    allowed = _branches(user)
    wanted = params.validated_data.get("branch") or get_active_branch_id()
    branch = allowed.filter(pk=wanted).first() if wanted else None
    if branch is None and params.validated_data.get("branch"):
        raise ValidationError({"branch": "Choose one of your branches."})
    if branch is None and allowed.count() == 1:
        branch = allowed.first()
    if branch is None:
        raise ValidationError({"branch": "Choose the branch to report on."})

    organization = user.organization
    summary = clinical_report.compile_report(organization, branch, start, end)
    write_event(
        organization.id,
        AuditLogEntry.ACTION_VIEW,
        AUDIT_MODEL,
        branch.id,
        {"period_start": start.isoformat(), "period_end": end.isoformat(), "output": output},
    )
    return summary, branch, timezone.now()


def _reference(summary, branch):
    return f"CR-{str(branch.id)[:4].upper()}-{summary['period_end'].replace('-', '')}"


class ClinicalReportView(APIView):
    def get(self, request):
        summary, branch, generated_at = _compile(request, "screen")
        return Response(
            {
                **summary,
                "branch_id": str(branch.id),
                "reference": _reference(summary, branch),
                "generated_at": generated_at.isoformat(),
                "branches": [{"id": str(b.id), "name": b.name} for b in _branches(request.user)],
            }
        )


class ClinicalReportPrintView(APIView):
    """The report in the shared professional document layout."""

    def get(self, request):
        from apps.documents import printing

        output = "PDF download" if printing.wants_pdf(request) else "preview"
        summary, branch, generated_at = _compile(request, output)
        organization = request.user.organization
        period = f"{summary['period_start']} to {summary['period_end']}"
        context = {
            "title": "Clinical report",
            "letterhead": printing.letterhead(organization, branch),
            "meta": [("Reference", _reference(summary, branch)), ("Period", period)],
            "summary": summary,
            "period": period,
            "compiled_at": facility_time.local_format(generated_at, "%d %b %Y %H:%M"),
            "compiled_by": user_display(request.user),
            "printed_by": user_display(request.user),
        }
        html = printing.render("documents/print/clinical_report.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename(
                "clinical-report", summary["branch_name"], summary["period_end"]
            ),
        )


class ClinicalReportFhirView(APIView):
    def get(self, request):
        summary, branch, generated_at = _compile(request, "FHIR")
        return Response(
            clinical_report.bundle(
                uuid.uuid4(),
                summary,
                generated_at.isoformat(),
                branch.id,
                user_display(request.user),
            ),
            content_type="application/fhir+json",
        )
