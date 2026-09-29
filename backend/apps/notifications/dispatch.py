"""
One entry point for event notifications that reach a person on every
channel — in-app (the topbar bell), email and SMS — used by the
subscription lifecycle and records-retention jobs.

Every call carries a `dedupe_key` naming the event. The in-app row and each
outbound delivery are unique on it, so a scheduled job may be re-run or
retried at any point without anyone being told the same thing twice. The
outbound sends themselves happen in `deliver_notification` (tasks.py) after
the surrounding transaction commits, with retries, and their outcome is
recorded on NotificationDelivery — a notice that can't be sent is visible
as FAILED/NOT_CONFIGURED, never reported as sent.

Content rule: these notices go to phones and mailboxes outside the
platform's access controls, so they carry counts, dates and links only —
never a client's name or any clinical detail.
"""

from dataclasses import dataclass, field

import structlog
from django.db import IntegrityError, transaction

from .models import Notification, NotificationDelivery

logger = structlog.get_logger(__name__)


@dataclass
class EmailContent:
    subject: str
    body_text: str
    # The shared notice layout (templates/notifications/emails/notice_email.html)
    # renders `heading`, `paragraphs`, `action_label`/`action_url` and `footnote`.
    context: dict = field(default_factory=dict)
    template: str = "notifications/emails/notice_email.html"


def org_admins(organization_id):
    """Active Org Admins of one organization."""
    from apps.accounts.models import User
    from apps.tenancy.context import platform_admin_context

    with platform_admin_context():
        return list(
            User.all_objects.filter(
                organization_id=organization_id,
                roles__name__iexact="Org Admin",
                is_active=True,
            ).distinct()
        )


def platform_admins():
    from apps.accounts.models import User
    from apps.tenancy.context import platform_admin_context

    with platform_admin_context():
        return list(User.all_objects.filter(is_superuser=True, is_active=True))


def _create_in_app(recipient, organization_id, category, severity, title, body, link, dedupe_key):
    try:
        with transaction.atomic():
            return Notification.objects.create(
                recipient=recipient,
                organization_id=organization_id,
                category=category,
                severity=severity,
                title=title,
                body=body,
                link=link,
                dedupe_key=dedupe_key,
            )
    except IntegrityError:
        return None  # this recipient already has this event


def _queue_delivery(organization_id, notification, dedupe_key, channel, address, **content):
    try:
        with transaction.atomic():
            delivery = NotificationDelivery.objects.create(
                organization_id=organization_id,
                notification=notification,
                dedupe_key=dedupe_key,
                channel=channel,
                address=address,
                **content,
            )
    except IntegrityError:
        return None  # already queued (or sent) for this event

    from .tasks import deliver_notification

    transaction.on_commit(lambda: deliver_notification.delay(str(delivery.id)))
    return delivery


def notify(
    recipients,
    *,
    category,
    title,
    body,
    dedupe_key,
    organization_id=None,
    link="",
    severity=Notification.SEVERITY_INFO,
    email=None,
    sms_text=None,
    extra_email_addresses=(),
):
    """
    Notify each user in `recipients` in-app, plus by email (if `email` is
    given and they have an address) and SMS (if `sms_text` is given and they
    have a phone). `extra_email_addresses` reach a mailbox with no user
    account, such as an organization's support address, by email only.

    Returns the number of in-app notifications newly created.
    """
    created = 0
    seen_emails = set()
    for user in recipients:
        notification = _create_in_app(
            user, organization_id, category, severity, title, body, link, dedupe_key
        )
        if notification is not None:
            created += 1
        if email is not None and user.email:
            seen_emails.add(user.email.casefold())
            _queue_delivery(
                organization_id,
                notification,
                dedupe_key,
                NotificationDelivery.CHANNEL_EMAIL,
                user.email,
                subject=email.subject,
                body_text=email.body_text,
                html_template=email.template,
                html_context=email.context,
            )
        phone = getattr(user, "phone", "")
        if sms_text and phone:
            _queue_delivery(
                organization_id,
                notification,
                dedupe_key,
                NotificationDelivery.CHANNEL_SMS,
                phone,
                body_text=sms_text,
            )

    if email is not None:
        for address in extra_email_addresses:
            if address and address.casefold() not in seen_emails:
                seen_emails.add(address.casefold())
                _queue_delivery(
                    organization_id,
                    None,
                    dedupe_key,
                    NotificationDelivery.CHANNEL_EMAIL,
                    address,
                    subject=email.subject,
                    body_text=email.body_text,
                    html_template=email.template,
                    html_context=email.context,
                )

    logger.info(
        "event_notification_dispatched",
        category=category,
        dedupe_key=dedupe_key,
        organization_id=str(organization_id) if organization_id else None,
        recipients=len(recipients),
        new_in_app=created,
    )
    return created
