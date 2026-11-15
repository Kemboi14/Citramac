"""
The full client report as JSON (the screen) and as the shared printable
document (Preview, or `?output=pdf`). Both come from
`client_report.compile_report`, so the page and the PDF cannot drift apart.

Clinical staff only. Every opening is a VIEW entry in the audit log and every
PDF download an EXPORT entry (guide.md §4).
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from apps.documents import printing
from apps.sysadmin_audit.audit import write_entry
from apps.sysadmin_audit.models import AuditLogEntry

from . import client_report, facility_time, services
from .access import clinical_only
from .views import _patient

AUDIT_MODEL = "care_pathway.clientreport"


def _audit(patient, request, output):
    write_entry(
        patient,
        AuditLogEntry.ACTION_EXPORT if output == "PDF download" else AuditLogEntry.ACTION_VIEW,
        {"report": "full client report", "output": output},
    )


def _branch(patient):
    episode = services.current_or_latest_episode(patient)
    if episode and episode.branch_id:
        return episode.branch
    return printing.default_branch(patient.organization)


class ClientReportView(APIView):
    """GET care/clients/<id>/report/ — the report as data for the screen."""

    @clinical_only()
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        report = client_report.compile_report(patient, request.user)
        _audit(patient, request, "preview")
        return Response(report)


class ClientReportPrintView(APIView):
    """GET care/clients/<id>/report/print/ — the report as a document."""

    @clinical_only()
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        report = client_report.compile_report(patient, request.user)
        output = "PDF download" if printing.wants_pdf(request) else "preview"
        _audit(patient, request, output)
        context = {
            "title": client_report.TITLE,
            "letterhead": printing.letterhead(patient.organization, _branch(patient)),
            "meta": [
                ("Reference", report["reference"]),
                ("Client", report["client"]["citramac_number"] or report["client"]["mrn"]),
                ("Compiled", report["generated_on"]),
            ],
            "report": report,
            "printed_by": services.user_display(request.user),
            "printed_at": facility_time.local_format(facility_time.local_now(), "%d %b %Y %H:%M"),
        }
        html = printing.render("documents/print/client_report.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename(
                "client-report",
                patient.get_full_name(),
                facility_time.local_date().isoformat(),
            ),
        )
