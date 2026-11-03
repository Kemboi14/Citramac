"""
Emailing a compiled NACADA NDO report — "Send to NACADA" and "Send to myself".

NACADA publishes no API for NDO reporting, so email is the only channel. The
report goes out through the server-side outbox (apps.notifications), from the
platform's or organisation's configured sender: the app cannot send from a
person's own mailbox. The sender is the reply-to address and, for a NACADA
send, gets a copy. The browser asks for confirmation; the API refuses a send
without `confirm: true` as well. Each send is a NacadaReportSend row plus a
REPORT_SENT audit entry; whether the email actually went is the delivery's
status, never assumed.
"""

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import has_active_role, has_permission
from apps.notifications.dispatch import EmailContent, queue_email
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from .models import NacadaReportSend
from .nacada_report import render_text

SEND_PERMISSION = "reports.nacada.send"
TEMPLATE = "notifications/emails/nacada_report_email.html"


def may_send(user):
    return has_active_role(user, "Org Admin") or has_permission(user, SEND_PERMISSION)


def may_edit_settings(user):
    return has_active_role(user, "Org Admin")


def _email(report, sender, test_copy):
    summary = report.summary_data
    title = (
        f"NACADA NDO report — {summary['organization_name']}, {summary['branch_name']} — "
        f"{summary['period_start']} to {summary['period_end']}"
    )
    sender_name = sender.get_full_name() or sender.email
    intro = (
        "Test copy — this has not been sent to NACADA."
        if test_copy
        else f"Sent to NACADA by {sender_name} ({sender.email}). Reply to this email to reach them."
    )
    return EmailContent(
        subject=f"[Test copy] {title}" if test_copy else title,
        body_text=f"{intro}\n\n{render_text(summary)}",
        template=TEMPLATE,
        context={
            "heading": "NACADA NDO report",
            "intro": intro,
            "summary": summary,
            "test_copy": test_copy,
        },
    )


def send_report(report, user, target, confirm):
    if not may_send(user):
        raise PermissionDenied(
            "You don't have permission to send the NACADA report. An Org Admin can give it "
            "to your role in Roles & Permissions.",
            code="nacada_send_not_permitted",
        )
    if confirm is not True:
        raise ValidationError({"confirm": "Confirm the send before it goes out."})
    if not report.definition:
        raise ValidationError(
            {"report": "This report was compiled in the old format. Compile it again to send it."}
        )
    if target == NacadaReportSend.TARGET_NACADA:
        address = report.organization.nacada_report_email
        if not address:
            raise ValidationError(
                {
                    "target": "No NACADA reporting email is set. An Org Admin can add it on "
                    "this page under “NACADA reporting email”."
                }
            )
    elif target == NacadaReportSend.TARGET_SELF:
        address = user.email
        if not address:
            raise ValidationError({"target": "Your account has no email address to send to."})
    else:
        raise ValidationError({"target": "Choose NACADA or yourself."})

    test_copy = target == NacadaReportSend.TARGET_SELF
    with transaction.atomic():
        send = NacadaReportSend.objects.create(
            organization_id=report.organization_id,
            report=report,
            target=target,
            address=address,
            sent_by=user,
        )
        email = _email(report, user, test_copy)
        dedupe_key = f"nacada-report-send:{send.id}"
        send.delivery = queue_email(
            report.organization_id,
            dedupe_key,
            address,
            email,
            reply_to="" if test_copy else user.email,
        )
        if not test_copy and user.email and user.email.casefold() != address.casefold():
            copy = EmailContent(
                subject=f"[Your copy] {email.subject}",
                body_text=email.body_text,
                template=email.template,
                context=email.context,
            )
            send.copy_delivery = queue_email(report.organization_id, dedupe_key, user.email, copy)
        send.save(update_fields=["delivery", "copy_delivery", "updated_at"])
        write_event(
            report.organization_id,
            AuditLogEntry.ACTION_REPORT_SENT,
            "mhp_program.nacadandoreport",
            report.id,
            {"target": target, "address": address, "send_id": str(send.id)},
        )
    return send
