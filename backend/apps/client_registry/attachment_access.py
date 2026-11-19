"""
Who may open, print or download a client attachment (owner decision 2026-11-19).

- **Preview**: anyone who may see the client's attachments opens the file in the
  page (served inline, never by its storage URL).
- **Download / print**: a copy that leaves the system needs an Org Admin's
  approval — one download within 24 hours of approval. Nobody approves their own
  request. Org Admins download directly.

Every preview, request, decision and download is audited. Requests are never
deleted. Not clinical data, so no FHIR resource.
"""

import mimetypes
from datetime import timedelta

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import is_org_admin
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from .models import AttachmentDownloadRequest as Request

APPROVAL_VALID_FOR = timedelta(hours=24)
AUDIT_MODEL = "client_registry.attachment"


def display_name(attachment):
    """The name a person sees: the given title, else the stored file's name."""
    return attachment.description or attachment.file.name.rsplit("/", 1)[-1]


def content_type(attachment):
    guessed, _ = mimetypes.guess_type(attachment.file.name)
    return guessed or "application/octet-stream"


def _audit(attachment, action, event, **detail):
    write_event(
        attachment.organization_id,
        action,
        AUDIT_MODEL,
        attachment.pk,
        {"event": event, "patient": str(attachment.patient_id), **detail},
    )


def _filename(attachment):
    name = display_name(attachment)
    stored_ext = (
        "." + attachment.file.name.rsplit(".", 1)[-1] if "." in attachment.file.name else ""
    )
    return name if name.lower().endswith(stored_ext.lower()) else name + stored_ext


def _live_approval(attachment, user, now=None):
    now = now or timezone.now()
    return (
        Request.objects.filter(
            attachment=attachment,
            requested_by=user,
            status=Request.STATUS_APPROVED,
            expires_at__gt=now,
        )
        .order_by("-decided_at")
        .first()
    )


def state(attachment, user):
    """What the user can do with a copy of this file, for the screen."""
    if is_org_admin(user):
        return {"download": "direct"}
    approval = _live_approval(attachment, user)
    if approval:
        return {"download": "approved", "expires_at": approval.expires_at.isoformat()}
    latest = (
        Request.objects.filter(attachment=attachment, requested_by=user)
        .order_by("-requested_at")
        .first()
    )
    if latest and latest.status == Request.STATUS_PENDING:
        return {"download": "pending", "requested_at": latest.requested_at.isoformat()}
    if latest and latest.status == Request.STATUS_DECLINED:
        return {"download": "declined", "reason": latest.decision_reason}
    return {"download": "request"}


def preview(attachment):
    _audit(attachment, AuditLogEntry.ACTION_VIEW, "attachment_previewed")
    response = FileResponse(
        attachment.file.open("rb"),
        as_attachment=False,
        filename=_filename(attachment),
        content_type=content_type(attachment),
    )
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@transaction.atomic
def request_download(attachment, user, reason):
    if is_org_admin(user):
        raise ValidationError({"detail_message": "As an Org Admin you can download it directly."})
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationError({"reason": "Say why a copy is needed."})
    open_request = Request.objects.filter(
        attachment=attachment, requested_by=user, status=Request.STATUS_PENDING
    ).first()
    if open_request or _live_approval(attachment, user):
        raise ValidationError({"detail_message": "You already have a request for this file."})
    req = Request.objects.create(
        organization_id=attachment.organization_id,
        attachment=attachment,
        requested_by=user,
        reason=reason[:255],
    )
    _audit(attachment, AuditLogEntry.ACTION_CREATE, "download_requested", request=str(req.pk))
    from apps.notifications.dispatch import notify, org_admins
    from apps.notifications.models import Notification

    notify(
        [admin for admin in org_admins(attachment.organization_id) if admin.pk != user.pk],
        category=Notification.CATEGORY_SYSTEM,
        organization_id=attachment.organization_id,
        title="Download request waiting for approval",
        body=f"{user.get_full_name() or user.email} asked to download a client document.",
        link="/org-admin/download-requests",
        dedupe_key=f"attachment-download:{req.pk}",
    )
    return req


@transaction.atomic
def decide(req, user, decision, reason=""):
    req = Request.objects.select_for_update().get(pk=req.pk)
    if not is_org_admin(user):
        raise PermissionDenied("Only an Org Admin can approve or decline a download.")
    if req.requested_by_id == user.pk:
        raise PermissionDenied("Nobody approves their own request.")
    if req.status != Request.STATUS_PENDING:
        raise ValidationError({"detail_message": "This request has already been decided."})
    reason = (reason or "").strip()
    now = timezone.now()
    if decision == "APPROVED":
        req.status, req.expires_at = Request.STATUS_APPROVED, now + APPROVAL_VALID_FOR
    elif decision == "DECLINED":
        if len(reason) < 5:
            raise ValidationError({"reason": "Say why the download is declined."})
        req.status = Request.STATUS_DECLINED
    else:
        raise ValidationError({"decision": "Choose APPROVED or DECLINED."})
    req.decided_by, req.decided_at, req.decision_reason = user, now, reason[:255]
    req.save()
    _audit(
        req.attachment,
        AuditLogEntry.ACTION_UPDATE,
        f"download_{decision.lower()}",
        request=str(req.pk),
    )
    from apps.notifications.dispatch import notify
    from apps.notifications.models import Notification

    notify(
        [req.requested_by],
        category=Notification.CATEGORY_SYSTEM,
        organization_id=req.organization_id,
        title=(
            "Download approved — available once, for 24 hours"
            if decision == "APPROVED"
            else "Download declined"
        ),
        body=display_name(req.attachment)
        + (f" — {reason}" if decision == "DECLINED" and reason else ""),
        link=f"/clinical/clients/{req.attachment.patient_id}/attachments",
        dedupe_key=f"attachment-download-decided:{req.pk}",
    )
    return req


@transaction.atomic
def download(attachment, user):
    """The file as a download: an Org Admin directly; anyone else once per
    approval, within 24 hours of it."""
    now = timezone.now()
    if is_org_admin(user):
        _audit(attachment, AuditLogEntry.ACTION_EXPORT, "attachment_downloaded", by="org_admin")
    else:
        approval = _live_approval(attachment, user, now)
        if approval is None:
            raise PermissionDenied(
                "Downloading or printing needs an Org Admin's approval. Request it first."
            )
        approval = Request.objects.select_for_update().get(pk=approval.pk)
        if approval.status != Request.STATUS_APPROVED:
            raise PermissionDenied("This approval has already been used.")
        approval.status, approval.used_at = Request.STATUS_USED, now
        approval.save(update_fields=["status", "used_at", "updated_at"])
        _audit(
            attachment,
            AuditLogEntry.ACTION_EXPORT,
            "attachment_downloaded",
            request=str(approval.pk),
        )
    response = FileResponse(
        attachment.file.open("rb"),
        as_attachment=True,
        filename=_filename(attachment),
        content_type=content_type(attachment),
    )
    response["Cache-Control"] = "no-store"
    return response
