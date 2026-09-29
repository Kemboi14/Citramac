"""
Org Admin notices for the records-retention lifecycle — in-app, email and
SMS via apps.notifications.dispatch. Counts, dates and a link only: these
leave the platform's access controls, so no client is ever named in them.
"""

from apps.notifications.dispatch import EmailContent, notify, org_admins
from apps.notifications.models import Notification

from .services import frontend_url

RETENTION_LINK = "/org-admin/data-retention"


def _records(count):
    return f"{count} client record{'s' if count != 1 else ''}"


def notify_batch_proposed(organization, batch, floor_verified):
    count = batch.item_count
    if floor_verified:
        action = "Review the batch and approve or reject it in Data Retention & Archive."
    else:
        action = (
            "Archiving stays disabled until CITRAMAC confirms the statutory retention "
            "periods, so no record will be archived yet. You can review the list now."
        )
    title = f"{_records(count)} reached the end of their retention period"
    body = (
        f"Batch {batch.reference} lists {_records(count)} whose retention period has ended. "
        f"Nothing is archived until an Org Admin approves it, and archived records are kept "
        f"in full and can be restored. {action}"
    )
    notify(
        org_admins(organization.id),
        category=Notification.CATEGORY_RETENTION,
        severity=Notification.SEVERITY_WARNING,
        title=title,
        body=body,
        link=RETENTION_LINK,
        dedupe_key=f"retention:batch:{batch.id}:proposed",
        organization_id=organization.id,
        email=EmailContent(
            subject=f"CITRAMAC: {title}",
            body_text=f"{body}\n\nOpen: {frontend_url(RETENTION_LINK)}",
            context={
                "heading": title,
                "organization_name": organization.name,
                "severity": Notification.SEVERITY_WARNING,
                "paragraphs": [body],
                "facts": [
                    {"label": "Batch", "value": batch.reference},
                    {"label": "Records", "value": count},
                ],
                "action_url": frontend_url(RETENTION_LINK),
                "action_label": "Review batch",
            },
        ),
        sms_text=(
            f"CITRAMAC: {_records(count)} at {organization.name} reached end of retention "
            f"(batch {batch.reference}). Review in Data Retention & Archive."
        ),
    )


def notify_forecast(organization, forecast, today):
    """One notice per forecast window per month, and only when something is coming due."""
    for window, count in forecast.items():
        if not count:
            continue
        title = f"{_records(count)} reach end of retention within {window} days"
        body = (
            f"{_records(count)} will reach the end of their retention period in the next "
            f"{window} days. They will then be proposed for archiving for your approval. "
            f"Records with ongoing care, or on legal hold, are never proposed."
        )
        notify(
            org_admins(organization.id),
            category=Notification.CATEGORY_RETENTION,
            title=title,
            body=body,
            link=RETENTION_LINK,
            dedupe_key=f"retention:forecast:{organization.id}:{window}:{today:%Y-%m}",
            organization_id=organization.id,
            email=EmailContent(
                subject=f"CITRAMAC: {title}",
                body_text=f"{body}\n\nOpen: {frontend_url(RETENTION_LINK)}",
                context={
                    "heading": title,
                    "organization_name": organization.name,
                    "paragraphs": [body],
                    "action_url": frontend_url(RETENTION_LINK),
                    "action_label": "View retention forecast",
                },
            ),
            sms_text=(
                f"CITRAMAC: {_records(count)} at {organization.name} reach end of retention "
                f"within {window} days."
            ),
        )


def notify_batch_archived(batch):
    from apps.tenancy.models import Organization

    organization = Organization.objects.get(pk=batch.organization_id)
    title = f"Archive batch {batch.reference} approved"
    body = (
        f"{_records(batch.archived_count)} archived"
        + (f", {batch.skipped_count} skipped as no longer due" if batch.skipped_count else "")
        + ". Archived records are kept in full, are read-only, and can be restored from "
        "Data Retention & Archive."
    )
    notify(
        org_admins(organization.id),
        category=Notification.CATEGORY_RETENTION,
        title=title,
        body=body,
        link=RETENTION_LINK,
        dedupe_key=f"retention:batch:{batch.id}:archived",
        organization_id=organization.id,
        email=EmailContent(
            subject=f"CITRAMAC: {title}",
            body_text=f"{body}\n\nOpen: {frontend_url(RETENTION_LINK)}",
            context={
                "heading": title,
                "organization_name": organization.name,
                "paragraphs": [body],
                "facts": [
                    {"label": "Archived", "value": batch.archived_count},
                    {"label": "Skipped", "value": batch.skipped_count},
                ],
                "action_url": frontend_url(RETENTION_LINK),
                "action_label": "Open Data Retention & Archive",
            },
        ),
        sms_text=(
            f"CITRAMAC: archive batch {batch.reference} approved — "
            f"{_records(batch.archived_count)} archived."
        ),
    )
