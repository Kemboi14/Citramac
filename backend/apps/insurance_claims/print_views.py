"""
The client's invoice and statement of services (INS-08) in the shared
professional document layout (apps.documents.printing): preview as HTML,
`?output=pdf` to download. Readable by whoever may open the client's billing
(read-only for non-finance staff, as the billing workspace itself); every
preview and download is in the audit log.
"""

from decimal import Decimal

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound
from rest_framework.views import APIView

from apps.billing.permissions import IsFinanceOrReadOnly
from apps.care_pathway import facility_time
from apps.client_registry.models import Patient
from apps.documents import printing
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import workspace


def _money(value, currency="KES"):
    amount = Decimal(str(value or 0))
    return f"{currency} {amount:,.2f}"


def _date(iso, fmt="%d %b %Y"):
    parsed = parse_datetime(iso) if isinstance(iso, str) else iso
    return facility_time.local_format(parsed, fmt) if parsed else ""


def _user_name(user):
    return (f"{user.first_name} {user.last_name}".strip() or user.email) if user else ""


def _base(request, patient, data, title, number):
    organization = patient.organization
    payer = data["payer"]
    coverage = payer.get("coverage") or {}
    return {
        "title": title,
        "letterhead": printing.letterhead(organization, printing.default_branch(organization)),
        "meta": [("Document no.", number), ("Date", _date(timezone.now()))],
        "client_name": patient.get_full_name(),
        "client_number": patient.citramac_number,
        "payer": payer.get("label", ""),
        "coverage": " · ".join(
            x
            for x in (
                coverage.get("scheme"),
                "verified" if coverage.get("verified") else "",
                coverage.get("member_status"),
            )
            if x
        ),
        "currency": data.get("currency", "KES"),
        "printed_by": _user_name(request.user),
    }


def _audit(request, patient, kind):
    write_event(
        patient.organization_id,
        AuditLogEntry.ACTION_VIEW,
        "client_registry.patient",
        patient.pk,
        {"document": kind, "output": "PDF download" if printing.wants_pdf(request) else "preview"},
    )


class InvoicePrintView(APIView):
    permission_classes = [IsFinanceOrReadOnly]

    def get(self, request, patient_id):
        patient = get_object_or_404(Patient, pk=patient_id)
        data = workspace.workspace(request.user, patient)
        invoice = data["invoice"]
        if invoice is None:
            raise NotFound("No invoice has been generated for this client.")
        currency = data.get("currency", "KES")
        context = _base(request, patient, data, "Invoice", f"{invoice['number']}")
        context["meta"] = [
            ("Invoice no.", invoice["number"]),
            ("Version", str(invoice["version"])),
            ("Issued", _date(invoice["created_at"])),
        ]
        context.update(
            {
                "table_title": "Services",
                "columns": [
                    {"label": "Service"},
                    {"label": "Qty", "numeric": True},
                    {"label": "Amount", "numeric": True},
                ],
                "rows": [
                    [
                        {"value": line["service"]},
                        {"value": line["quantity"], "numeric": True},
                        {"value": _money(line["amount"], currency), "numeric": True},
                    ]
                    for line in invoice["lines"]
                ],
                "totals": [
                    ("Invoice total", _money(invoice["total"], currency), False),
                    ("Paid (all payments)", _money(data["totals"]["paid"], currency), False),
                    ("Balance due", _money(data["totals"]["outstanding"], currency), True),
                ],
                "note": (
                    "Documented services have changed since this invoice was issued; a new "
                    "version will be issued."
                    if invoice.get("stale")
                    else ""
                ),
            }
        )
        _audit(request, patient, "invoice")
        html = printing.render("documents/print/billing.html", context)
        return printing.respond(request, html, printing.safe_filename("invoice", invoice["number"]))


class StatementPrintView(APIView):
    permission_classes = [IsFinanceOrReadOnly]

    def get(self, request, patient_id):
        patient = get_object_or_404(Patient, pk=patient_id)
        data = workspace.workspace(request.user, patient)
        currency = data.get("currency", "KES")
        overview = data["overview"]
        events = sorted(overview["events"], key=lambda e: e["delivered_at"])
        stem = patient.citramac_number or str(patient.id).split("-")[0].upper()
        context = _base(request, patient, data, "Statement of services", f"STM-{stem}")
        summary = overview.get("summary") or {}
        context.update(
            {
                "table_title": "Services delivered",
                "columns": [
                    {"label": "Date"},
                    {"label": "Service"},
                    {"label": "Status"},
                    {"label": "Amount", "numeric": True},
                ],
                "rows": [
                    [
                        {"value": _date(e["delivered_at"])},
                        {"value": e["service"]},
                        {"value": str(e["status"]).replace("_", " ").capitalize()},
                        {"value": _money(e["amount"], currency), "numeric": True},
                    ]
                    for e in events
                ],
                "totals": [
                    ("Total services", _money(data["totals"]["services"], currency), False),
                    (
                        "Not yet billed",
                        _money((summary.get("unbilled") or {}).get("amount"), currency),
                        False,
                    ),
                    (
                        "Claimed (unpaid)",
                        _money((summary.get("claimed") or {}).get("amount"), currency),
                        False,
                    ),
                    ("Paid", _money(data["totals"]["paid"], currency), False),
                    ("Outstanding", _money(data["totals"]["outstanding"], currency), True),
                ],
                "payments": [
                    {
                        "date": _date(p["paid_at"]),
                        "method": p["method_label"],
                        "reference": p["reference"],
                        "amount": _money(p["amount"], currency),
                    }
                    for p in data["payments"]
                ],
            }
        )
        _audit(request, patient, "statement")
        html = printing.render("documents/print/billing.html", context)
        return printing.respond(request, html, printing.safe_filename("statement", stem))
