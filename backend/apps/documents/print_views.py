"""
Preview (HTML) and Download (PDF) of a generated document, in the shared
professional layout (apps.documents.printing). GET
`documents/generated/<id>/print/` — `?output=pdf` downloads. Who may open the
document may print it; every preview and download is in the audit log.
"""

from rest_framework.views import APIView

from apps.care_pathway import facility_time
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import printing
from .views import _doc, _user

SOURCE_LABEL = {
    "CLIENT_REPORT": "Client report",
    "THIRD_PARTY_REPORT": "Third-party report",
    "CLINICIAN_OBSERVATION": "Clinician observation",
    "MEASUREMENT": "Measurement",
    "ASSESSMENT_RESULT": "Assessment result",
    "PREVIOUS_RECORD": "Record",
    "CLINICIAN_ENTRY": "Clinician entry",
}
SIGNED_STATES = ("SIGNED", "RELEASED", "FILED")


def _when(iso_or_dt, fmt="%d %b %Y %H:%M"):
    if not iso_or_dt:
        return ""
    if isinstance(iso_or_dt, str):
        from django.utils.dateparse import parse_datetime

        parsed = parse_datetime(iso_or_dt)
        if parsed is None:
            return iso_or_dt
        iso_or_dt = parsed
    return facility_time.local_format(iso_or_dt, fmt)


def _item(item):
    value = item.get("value")
    out = {"label": item.get("label", ""), "list": None, "text": ""}
    if isinstance(value, list):
        out["list"] = [str(v) for v in value if v not in (None, "")] or None
    elif value not in (None, ""):
        out["text"] = str(value)
    source = SOURCE_LABEL.get(item.get("source") or "", item.get("source") or "")
    if source and item.get("recorded_at"):
        source = f"{source} · {_when(item['recorded_at'])}"
    out["source"] = source
    return out


def document_context(doc, user):
    c = doc.content or {}
    signed = doc.status in SIGNED_STATES
    recipient = ""
    if doc.recipient_type != "INTERNAL_TEAM":
        r = c.get("recipient") or {}
        recipient = ", ".join(x for x in (r.get("name"), r.get("organization")) if x) or r.get(
            "type_label", ""
        )
    sections = [{"title": "Client", "items": [_item(i) for i in c.get("subject") or []]}]
    if c.get("request"):
        sections.append({"title": "Details", "items": [_item(i) for i in c["request"]]})
    for s in c.get("sections") or []:
        sections.append(
            {"title": s.get("title", ""), "items": [_item(i) for i in s.get("items") or []]}
        )
    branch = doc.episode.branch if doc.episode_id and doc.episode.branch_id else None
    organization = doc.patient.organization
    author = c.get("author") or {}
    watermark = "" if signed else "Draft — clinician review required"
    return {
        "title": c.get("title") or doc.template_id,
        "letterhead": printing.letterhead(
            organization, branch or printing.default_branch(organization), c.get("facility")
        ),
        "meta": [
            ("Document no.", f"{doc.document_number} v{doc.version}"),
            ("Date", _when(doc.signed_at or doc.generated_at, "%d %b %Y")),
            ("Status", doc.get_status_display()),
        ],
        "watermark": watermark,
        "watermark_short": "DRAFT",
        "recipient": recipient,
        "purpose": c.get("purpose") or doc.purpose,
        "sections": sections,
        "monitoring": c.get("monitoring") or [],
        "clinician_comment": c.get("clinician_comment") or "",
        "verify_notice": c.get("verify_notice") or "",
        "signed": signed,
        "signed_by": _user(doc.signed_by),
        "signer_credentials": doc.signer_credentials,
        "signed_at": _when(doc.signed_at),
        "signed_date": _when(doc.signed_at, "%d %b %Y"),
        "content_hash_short": (doc.content_hash or "")[:16],
        "status_label": doc.get_status_display(),
        "author": " ".join(
            x
            for x in (
                author.get("name"),
                f"({author['credentials']})" if author.get("credentials") else "",
            )
            if x
        ),
        "organizer": c.get("organizer") or "",
        "printed_by": _user(user),
    }


class GeneratedPrintView(APIView):
    def get(self, request, pk):
        doc, _spec = _doc(pk, request.user)
        output = "PDF download" if printing.wants_pdf(request) else "preview"
        write_event(
            doc.organization_id,
            AuditLogEntry.ACTION_VIEW,
            "documents.generateddocument",
            doc.pk,
            {"output": output},
        )
        html = printing.render(
            "documents/print/generated.html", document_context(doc, request.user)
        )
        return printing.respond(
            request, html, printing.safe_filename(doc.document_number, f"v{doc.version}")
        )
