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
    from apps.accounts.catalogue import ROLE_KEY_ORG_ADMIN
    from apps.accounts.models import User
    from apps.tenancy.context import platform_admin_context

    with platform_admin_context():
        return list(
            User.all_objects.filter(
                organization_id=organization_id,
                roles__system_key=ROLE_KEY_ORG_ADMIN,
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

    transaction.on_commit(lambda: _enqueue(delivery.id))
    return delivery


def _enqueue(delivery_id):
    """Hand a committed delivery to the worker. If the broker can't be reached
    the delivery is already saved as PENDING, so the periodic sweep
    (tasks.retry_pending_deliveries) sends it later — the request that queued
    it must not fail, or the person would retry and send it twice."""
    from .tasks import deliver_notification

    # No result is ever read (the outcome is on the delivery row), so skip the
    # result-backend subscribe and the publish retries: with Redis down each of
    # those blocked the request ~20 s before failing over to the sweep anyway.
    try:
        deliver_notification.apply_async((str(delivery_id),), ignore_result=True, retry=False)
    except Exception as exc:  # noqa: BLE001 — any broker failure leaves it to the sweep
        logger.warning(
            "notification_enqueue_deferred_to_sweep",
            delivery_id=str(delivery_id),
            error=f"{type(exc).__name__}: {exc}",
        )


def queue_email(organization_id, dedupe_key, address, email, reply_to=""):
    """
    One email to one address through the outbox, with no in-app notice — for a
    document a person chose to send (the NACADA report). Sent after the
    surrounding transaction commits, retried, and its outcome recorded on the
    returned NotificationDelivery. None if this event already went there.
    """
    return _queue_delivery(
        organization_id,
        None,
        dedupe_key,
        NotificationDelivery.CHANNEL_EMAIL,
        address,
        subject=email.subject,
        body_text=email.body_text,
        html_template=email.template,
        html_context=email.context,
        reply_to=reply_to,
    )


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


def _invite_key(token):
    import hashlib

    return f"activation-invite:{hashlib.sha256(token.encode()).hexdigest()}"


def queue_activation_invite(invite, *, resend=False):
    """
    The "activate your account" email for one ActivationInvite, through the
    outbox like every other notice: saved with the account in the same
    transaction, sent after it commits, retried, and its outcome recorded.
    An unreachable mail queue therefore never loses the new account (it used
    to roll the whole invite back), and a mail server that refuses it shows
    as FAILED / NOT_CONFIGURED on the staff list, never as sent.

    A resend is a person asking for another copy, so it is a new delivery
    rather than being de-duplicated against the first one.
    """
    from django.conf import settings
    from django.utils import timezone

    organization = invite.organization
    token = invite.token
    activation_link = f"{settings.FRONTEND_URL}/activate?token={token}"
    if organization is not None:
        subject = f"You've been invited to CITRAMAC — {organization.name}"
        body_text = (
            f"You've been invited to set up {organization.name} on CITRAMAC. "
            f"Activate your account: {activation_link}"
        )
    else:
        subject = "Welcome to CITRAMAC"
        body_text = (
            "You've been invited to join the CITRAMAC platform team. "
            f"Activate your account: {activation_link}"
        )
    dedupe_key = _invite_key(token)
    if resend:
        dedupe_key = f"{dedupe_key}:resend:{timezone.now().isoformat()}"
    return _queue_delivery(
        organization.id if organization is not None else None,
        None,
        dedupe_key,
        NotificationDelivery.CHANNEL_EMAIL,
        invite.user.email,
        subject=subject,
        body_text=body_text,
        html_template="notifications/emails/invite_email.html",
        html_context={
            "organization_name": organization.name if organization is not None else None,
            "activation_token": token,
            "activation_link": activation_link,
        },
    )


def latest_invite_delivery(user):
    """The most recent activation-invite email for a not-yet-activated user,
    or None when none has been queued through the outbox."""
    from apps.accounts.models import ActivationInvite

    invite = ActivationInvite.all_objects.filter(user=user).order_by("-created_at").first()
    if invite is None:
        return None
    return (
        NotificationDelivery.objects.filter(dedupe_key__startswith=_invite_key(invite.token))
        .order_by("-created_at")
        .first()
    )
