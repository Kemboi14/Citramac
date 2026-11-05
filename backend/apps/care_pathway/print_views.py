"""
Clinical records printed in the shared professional document layout
(apps.documents.printing): preview as HTML, `?output=pdf` to download. Each
print is restricted like the record itself and is in the audit log.
"""

from django.shortcuts import get_object_or_404
from rest_framework.views import APIView

from apps.documents import printing
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import facility_time
from .models import DischargeSummary, TriageAssessment


def _when(value, fmt="%d %b %Y %H:%M"):
    return facility_time.local_format(value, fmt) if value else ""


def _day(value):
    """A plain date (no time zone), e.g. a date of birth."""
    if not value:
        return ""
    if isinstance(value, str):
        from django.utils.dateparse import parse_date

        value = parse_date(value)
    return value.strftime("%d %b %Y") if value else ""


def _name(user):
    return (f"{user.first_name} {user.last_name}".strip() or user.email) if user else ""


def _audit(instance, model, request):
    write_event(
        instance.organization_id,
        AuditLogEntry.ACTION_VIEW,
        model,
        instance.pk,
        {"output": "PDF download" if printing.wants_pdf(request) else "preview"},
    )


class DischargePrintView(APIView):
    """GET care/discharges/<id>/print/ — the discharge summary as a document."""

    def get(self, request, pk):
        from .services import concept_labels
        from .views import _require_full_access

        summary = get_object_or_404(
            DischargeSummary.objects.select_related(
                "admission__patient__organization",
                "admission__bed__ward",
                "episode__branch",
                "signed_by",
                "follow_up_appointment",
            ),
            pk=pk,
        )
        _require_full_access(request.user, summary.admission, summary)
        labels = concept_labels()
        patient = summary.patient
        admission = summary.admission
        organization = patient.organization
        branch = (
            summary.episode.branch if summary.episode_id and summary.episode.branch_id else None
        )
        signed = summary.status == "COMPLETED"
        bed = getattr(admission, "bed", None)
        follow = summary.follow_up_appointment
        context = {
            "title": "Discharge summary",
            "letterhead": printing.letterhead(
                organization, branch or printing.default_branch(organization)
            ),
            "meta": [
                ("Reference", f"DIS-{str(summary.pk)[:8].upper()} v{summary.version}"),
                ("Date", _when(summary.signed_at or summary.discharged_at, "%d %b %Y")),
                ("Status", "Signed" if signed else "Draft — not signed"),
            ],
            "watermark": "" if signed else "Draft — not signed",
            "client_name": patient.get_full_name(),
            "client_number": patient.citramac_number,
            "date_of_birth": _day(patient.date_of_birth),
            "admitted_at": _when(admission.admitted_at),
            "discharged_at": _when(summary.discharged_at),
            "ward": f"{bed.ward.name}, bed {bed.bed_number}" if bed else "",
            "disposition": labels.get(
                ("discharge-disposition", summary.disposition), summary.disposition
            ),
            "destination": summary.destination,
            "diagnoses": [
                {
                    "code": d.icd11_code.code if d.icd11_code_id else "",
                    "label": d.icd11_code.description if d.icd11_code_id else str(d),
                    "kind": "Primary" if d.is_primary else "Secondary",
                }
                for d in summary.diagnoses.select_related("icd11_code")
            ],
            "clinical_status": summary.clinical_status,
            "treatment_summary": summary.treatment_summary,
            "legal_status": summary.legal_status_at_discharge,
            "medications": [
                {
                    "drug": line.drug.generic_name if line.drug_id else "",
                    "dose": line.dose,
                    "route": line.route,
                    "frequency": line.frequency,
                    "duration": line.duration,
                    "action": labels.get(("discharge-medication-action", line.action), line.action),
                    "note": line.note,
                }
                for line in summary.medications.select_related("drug")
            ],
            "education": [
                labels.get(("discharge-education", c), c) for c in summary.education or []
            ],
            "follow_up": (
                f"{_when(follow.scheduled_for)}"
                + (f" · {follow.appointment_type}" if follow.appointment_type else "")
                if follow
                else ""
            ),
            "signed": signed,
            "signed_by": _name(summary.signed_by),
            "signed_role": summary.signed_role,
            "signed_at": _when(summary.signed_at),
            "signed_date": _when(summary.signed_at, "%d %b %Y"),
            "supersedes": summary.supersedes.version if summary.supersedes_id else "",
            "printed_by": _name(request.user),
        }
        _audit(summary, "care_pathway.dischargesummary", request)
        html = printing.render("documents/print/discharge.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename("discharge", patient.citramac_number, f"v{summary.version}"),
        )


PRIORITY_TEXT = {
    "RED": "RED — Emergency / Immediate",
    "ORANGE": "ORANGE — Urgent",
    "YELLOW": "YELLOW — Priority",
    "GREEN": "GREEN — Routine",
}


def _iso_when(value):
    from django.utils.dateparse import parse_datetime

    parsed = parse_datetime(value) if isinstance(value, str) and value else None
    return _when(parsed) if parsed else (value or "")


def _triage_sections(answers, labels):
    """Answers grouped by section letter, in the signed page's order and wording."""
    from .triage_print_items import ITEMS, SECTION_TITLES

    order = list(ITEMS)

    def translate(valuesets, code):
        for vs in valuesets or []:
            display = labels.get((vs, code))
            if display:
                return display
        return code

    def position(key):
        return (order.index(key), key) if key in order else (len(order), key)

    grouped = {}
    for key in sorted(answers or {}, key=position):
        raw = answers[key]
        if len(key) < 2 or key[1] != "_" or key[0] not in "abcdefghijklmn" or raw is None:
            continue
        label, valuesets = ITEMS.get(key, (key[2:].replace("_", " ").capitalize(), None))
        if isinstance(raw, list):
            parts = [str(c) for c in raw if str(c).strip()]
            if not parts:
                continue
            value = ", ".join(translate(valuesets, c) for c in parts)
        else:
            text = str(raw).strip()
            if not text:
                continue
            value = translate(valuesets, text) if valuesets else text
        grouped.setdefault(key[0], []).append({"label": label, "value": value})
    return [
        {"title": title, "lines": grouped[letter]}
        for letter, title in SECTION_TITLES
        if letter in grouped
    ]


class TriagePrintView(APIView):
    """GET care/assessments/<id>/print/ — a signed triage assessment as a document."""

    def get(self, request, pk):
        from .services import concept_labels

        assessment = get_object_or_404(
            TriageAssessment.objects.select_related(
                "triage_encounter__patient__organization", "signed_by"
            ),
            pk=pk,
            status="COMPLETED",
        )
        patient = assessment.triage_encounter.patient
        organization = patient.organization
        labels = concept_labels()
        decision = {"OVERRIDE": "Override", "CONFIRM": "Confirm recommendation"}.get(
            assessment.decision, "Not recorded"
        )
        findings = []
        for row in assessment.findings or []:
            row = list(row) + [None] * 5
            when = _iso_when(row[3])
            findings.append(
                {
                    "finding": row[0],
                    "status": row[1],
                    "source": row[2],
                    "when": " · ".join(x for x in (when, row[4] or "") if x),
                }
            )
        context = {
            "title": "Triage assessment",
            "letterhead": printing.letterhead(organization, printing.default_branch(organization)),
            "meta": [
                ("Reference", f"TRI-{str(assessment.pk)[:8].upper()} v{assessment.version}"),
                ("Date", _when(assessment.signed_at, "%d %b %Y")),
                ("Status", "Signed"),
            ],
            "client_name": patient.get_full_name(),
            "client_number": patient.citramac_number,
            "priority": PRIORITY_TEXT.get(assessment.final_priority, "Not recorded"),
            "recommendation": assessment.recommendation,
            "recommendation_reasons": assessment.recommendation_reasons,
            "decision": decision,
            "override_reason": (
                assessment.override_reason if assessment.decision == "OVERRIDE" else ""
            ),
            "alerts": [a.get("label", "") for a in assessment.alerts or [] if isinstance(a, dict)],
            "rules_version": assessment.rules_version,
            "findings": findings,
            "tasks": [
                {
                    "action": t.get("action_label", ""),
                    "owner": t.get("owner", ""),
                    "status": labels.get(("task-status", t.get("status")), t.get("status", "")),
                    "when": _iso_when(t.get("created_at")),
                }
                for t in assessment.tasks_snapshot or []
            ],
            "sections": _triage_sections(assessment.answers, labels),
            "signed_by": _name(assessment.signed_by),
            "signed_at": _when(assessment.signed_at),
            "signed_date": _when(assessment.signed_at, "%d %b %Y"),
            "printed_by": _name(request.user),
        }
        _audit(assessment, "care_pathway.triageassessment", request)
        html = printing.render("documents/print/triage.html", context)
        return printing.respond(
            request,
            html,
            printing.safe_filename("triage", patient.citramac_number, f"v{assessment.version}"),
        )
