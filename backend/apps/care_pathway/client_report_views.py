"""
The full client report as JSON (the screen) and as the shared printable
document (Preview, or `?output=pdf`). Both come from
`client_report.compile_report`, so the page and the PDF cannot drift apart.

Clinical staff only. Every opening is a VIEW entry in the audit log and every
PDF download an EXPORT entry (guide.md §4).
"""

from django.http import Http404
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


# One record printed on its own: ?part=<part>&item=<id>. Its title, and where
# it is found in the compiled report. Triage and discharge summaries have
# their own full printouts (care/assessments/<id>/print/, care/discharges/<id>/print/).
PARTS = {
    "intake": "Intake assessment",
    "session": "Therapy session record",
    "action": "Care-plan intervention",
    "note": "Clinical note",
    "group": "Group session record",
    "admission": "Admission record",
    "outcome": "Outcome measure",
    "plan": "Care plan",
    "mse": "Mental status examination",
    "billing": "Billing summary",
}


def _find(report, part, item):
    """The one record `part`/`item` names in the compiled report, or None."""
    if part == "plan":
        return report["care_plan"]
    if part == "mse":
        return report["mse"]
    if part == "billing":
        return report["billing"]
    if part == "outcome":
        rows = report["outcomes"]["summary"]
        return next((row for row in rows if row["instrument"] == item), None)
    if part == "session":
        rows = [r for group in report["interventions"] for r in group["records"]]
    elif part == "action":
        rows = report["interventions"]
    else:
        rows = {
            "intake": report["intakes"],
            "note": report["notes"],
            "group": report["group_sessions"],
            "admission": report["admissions"],
        }[part]
    return next((row for row in rows if row["id"] == item), None)


class ClientReportPrintView(APIView):
    """GET care/clients/<id>/report/print/ — the report as a document, or one
    record of it with ?part=<part>&item=<id>."""

    @clinical_only()
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        report = client_report.compile_report(patient, request.user)
        output = "PDF download" if printing.wants_pdf(request) else "preview"
        part = request.query_params.get("part") or ""
        if part:
            return self._one(request, patient, report, part, output)
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

    def _one(self, request, patient, report, part, output):
        if part not in PARTS:
            raise Http404
        item = request.query_params.get("item") or ""
        record = _find(report, part, item)
        if record is None:
            raise Http404
        write_entry(
            patient,
            AuditLogEntry.ACTION_EXPORT if output == "PDF download" else AuditLogEntry.ACTION_VIEW,
            {"report": f"client record: {part}", "item": item, "output": output},
        )
        title = PARTS[part]
        context = {
            "title": title,
            "letterhead": printing.letterhead(patient.organization, _branch(patient)),
            "meta": [
                ("Reference", f"{report['reference']}-{part.upper()[:3]}"),
                ("Client", report["client"]["citramac_number"] or report["client"]["mrn"]),
                ("Printed", report["generated_on"]),
            ],
            "report": report,
            "part": part,
            "record": record,
            "printed_by": services.user_display(request.user),
        }
        html = printing.render("documents/print/client_record.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename(
                part, patient.get_full_name(), facility_time.local_date().isoformat()
            ),
        )
