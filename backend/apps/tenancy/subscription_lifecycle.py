"""
Tenant SaaS subscription lifecycle — the daily job that moves a
subscription through ACTIVE → PAST_DUE → EXPIRED as its dates pass, and
tells the tenant (and the platform) at every step, by in-app notice, email
and SMS (apps.notifications.dispatch).

    ACTIVE     reminders as the period end comes within each of
               SubscriptionPolicy.reminder_days_before days, and on the day
    PAST_DUE   the day after the period ends; full access continues through
               the grace period, with a reminder every day
    EXPIRED    after the grace period: read-only (apps.accounts.authentication)

Reminders are staged, not tied to exact days: each run sends the reminder
for the stage the subscription is currently in, once (dedupe_key). A run
that is missed, or a policy that changes, can't skip a stage or send one
twice. Renewal — a Super Admin moving `current_period_end` into the future
— returns a PAST_DUE/EXPIRED subscription to ACTIVE (SubscriptionSerializer)
and resets the stages, because the keys include the period end date.

This job iterates every tenant — the platform-wide subscription job that
docs/04-MULTI-TENANCY.md §4 names as the justified exception to per-tenant
tasks. Each subscription is processed in isolation; a failure is logged
against it and the rest carry on.
"""

from datetime import timedelta

import structlog
from django.db import transaction
from django.utils import timezone

from apps.notifications.dispatch import EmailContent, notify, org_admins, platform_admins
from apps.notifications.models import Notification

from .context import platform_admin_context
from .models import Subscription, SubscriptionPolicy

logger = structlog.get_logger(__name__)

SUBSCRIPTION_LINK = "/org-admin/subscription"
PLATFORM_LINK = "/super-admin/subscriptions"


def _frontend_url(path):
    from django.conf import settings

    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _date(value):
    return f"{value:%d %b %Y}"


def _renewal_line(policy):
    if policy.renewal_contact:
        return f"To renew, contact {policy.renewal_contact}."
    return "To renew, contact your CITRAMAC account manager."


def reminder_stage(days_left, offsets):
    """The smallest configured offset the period end is now within, or 0 on/after the day."""
    if days_left <= 0:
        return 0
    within = [o for o in offsets if days_left <= o]
    return min(within) if within else None


def _notify_tenant(subscription, policy, *, key_suffix, severity, title, paragraphs, sms):
    organization = subscription.organization
    body = " ".join(paragraphs)
    facts = [
        {"label": "Plan", "value": subscription.plan.name},
        {"label": "Period ends", "value": _date(subscription.current_period_end)},
    ]
    if subscription.grace_ends_on:
        facts.append({"label": "Grace period ends", "value": _date(subscription.grace_ends_on)})
    notify(
        org_admins(organization.id),
        category=Notification.CATEGORY_SUBSCRIPTION,
        severity=severity,
        title=title,
        body=body,
        link=SUBSCRIPTION_LINK,
        dedupe_key=f"sub:{subscription.id}:{subscription.current_period_end}:{key_suffix}",
        organization_id=organization.id,
        email=EmailContent(
            subject=f"CITRAMAC: {title}",
            body_text=f"{body}\n\n{_frontend_url(SUBSCRIPTION_LINK)}",
            context={
                "heading": title,
                "organization_name": organization.name,
                "severity": severity,
                "paragraphs": paragraphs,
                "facts": facts,
                "action_url": _frontend_url(SUBSCRIPTION_LINK),
                "action_label": "View subscription",
            },
        ),
        sms_text=sms,
        extra_email_addresses=[organization.support_email] if organization.support_email else [],
    )


def _send_active_reminder(subscription, policy, stage):
    name = subscription.organization.name
    end = _date(subscription.current_period_end)
    if stage == 0:
        title = f"Your CITRAMAC subscription ends today ({end})"
        lead = f"{name}'s subscription to CITRAMAC ends today."
        severity = Notification.SEVERITY_CRITICAL
    else:
        days = subscription.days_until_period_end
        title = f"Your CITRAMAC subscription ends in {days} day{'s' if days != 1 else ''}"
        lead = f"{name}'s subscription to CITRAMAC ends on {end}."
        severity = Notification.SEVERITY_WARNING if stage <= 7 else Notification.SEVERITY_INFO
    paragraphs = [
        lead,
        f"If it isn't renewed, you keep full access for a {policy.grace_period_days}-day grace "
        "period, after which CITRAMAC becomes read-only for your organisation: records stay "
        "viewable and exportable, but nothing new can be added. No data is deleted.",
        _renewal_line(policy),
    ]
    _notify_tenant(
        subscription,
        policy,
        key_suffix=f"T-{stage}",
        severity=severity,
        title=title,
        paragraphs=paragraphs,
        sms=f"CITRAMAC: {name}'s subscription ends {end}. {_renewal_line(policy)}",
    )


def _send_grace_reminder(subscription, policy, today, first):
    name = subscription.organization.name
    grace_end = _date(subscription.grace_ends_on)
    days = (subscription.grace_ends_on - today).days
    title = (
        "Your CITRAMAC subscription has ended — grace period started"
        if first
        else f"Grace period: {days} day{'s' if days != 1 else ''} until CITRAMAC becomes read-only"
    )
    # PAST_DUE can also be set by hand (e.g. an unpaid invoice) while the
    # period itself is still running.
    if subscription.current_period_end < subscription.past_due_since:
        status_line = f"{name}'s subscription ended on {_date(subscription.current_period_end)}."
    else:
        status_line = f"{name}'s subscription is past due."
    paragraphs = [
        f"{status_line} You still have full access until {grace_end}.",
        "After that CITRAMAC becomes read-only for your organisation until the subscription is "
        "renewed. Existing records stay viewable and exportable; no data is deleted.",
        _renewal_line(policy),
    ]
    _notify_tenant(
        subscription,
        policy,
        key_suffix="PAST_DUE" if first else f"GRACE:{today}",
        severity=Notification.SEVERITY_CRITICAL,
        title=title,
        paragraphs=paragraphs,
        sms=(
            f"CITRAMAC: {name}'s subscription has ended. Full access until {grace_end}, then "
            f"read-only. {_renewal_line(policy)}"
        ),
    )


def _send_expired_notice(subscription, policy):
    name = subscription.organization.name
    title = "CITRAMAC is now read-only for your organisation"
    paragraphs = [
        f"The grace period for {name}'s subscription ended on "
        f"{_date(subscription.grace_ends_on)}.",
        "Your staff can still sign in, view and export every record, but can't add or change "
        "anything until the subscription is renewed. No data has been deleted.",
        _renewal_line(policy),
    ]
    _notify_tenant(
        subscription,
        policy,
        key_suffix="EXPIRED",
        severity=Notification.SEVERITY_CRITICAL,
        title=title,
        paragraphs=paragraphs,
        sms=f"CITRAMAC: {name} is now read-only (subscription expired). {_renewal_line(policy)}",
    )


def notify_renewed(subscription):
    policy = SubscriptionPolicy.get_solo()
    end = _date(subscription.current_period_end)
    _notify_tenant(
        subscription,
        policy,
        key_suffix="RENEWED",
        severity=Notification.SEVERITY_INFO,
        title="Your CITRAMAC subscription has been renewed",
        paragraphs=[
            f"{subscription.organization.name}'s subscription is active until {end}.",
            "Full access is restored for all staff.",
        ],
        sms=f"CITRAMAC: {subscription.organization.name}'s subscription is renewed until {end}.",
    )


def process_subscription(subscription, policy, today):
    """Advance one subscription and send whatever notice its current stage calls for."""
    if subscription.status == Subscription.STATUS_ACTIVE:
        if subscription.current_period_end < today:
            subscription.status = Subscription.STATUS_PAST_DUE
            subscription.past_due_since = today
            subscription.save(update_fields=["status", "past_due_since", "updated_at"])
            _send_grace_reminder(subscription, policy, today, first=True)
            return "PAST_DUE"
        stage = reminder_stage(subscription.days_until_period_end, policy.reminder_days_before)
        if stage is not None:
            _send_active_reminder(subscription, policy, stage)
            return f"REMINDED:T-{stage}"
        return None

    if subscription.status == Subscription.STATUS_PAST_DUE:
        if subscription.grace_ends_on < today:
            subscription.status = Subscription.STATUS_EXPIRED
            subscription.save(update_fields=["status", "updated_at"])
            _send_expired_notice(subscription, policy)
            return "EXPIRED"
        _send_grace_reminder(
            subscription, policy, today, first=subscription.past_due_since == today
        )
        return "GRACE"
    return None


def process_all_subscriptions(today=None):
    today = today or timezone.localdate()
    policy = SubscriptionPolicy.get_solo()
    outcomes = {}
    with platform_admin_context():
        subscriptions = list(
            Subscription.objects.select_related("organization", "plan").filter(
                status__in=[Subscription.STATUS_ACTIVE, Subscription.STATUS_PAST_DUE]
            )
        )
        for subscription in subscriptions:
            try:
                with transaction.atomic():
                    outcome = process_subscription(subscription, policy, today)
                if outcome:
                    outcomes[str(subscription.id)] = outcome
            except Exception:  # noqa: BLE001 — isolate, log, continue with the rest
                logger.exception(
                    "subscription_lifecycle_failed",
                    subscription_id=str(subscription.id),
                    organization_id=str(subscription.organization_id),
                )
                outcomes[str(subscription.id)] = "FAILED"
        send_platform_digest(policy, today)
    return outcomes


def send_platform_digest(policy, today):
    """
    One daily notice to every Super Admin: tenants inside the reminder
    window, in grace, or expired — plus any notice that could not be
    delivered in the last day, so a missing SMTP/SMS setup is seen by
    someone who can fix it.
    """
    from apps.notifications.models import NotificationDelivery

    window_end = today + timedelta(days=policy.reminder_window_days)
    subscriptions = Subscription.objects.select_related("organization")
    ending = subscriptions.filter(
        status=Subscription.STATUS_ACTIVE, current_period_end__lte=window_end
    ).count()
    in_grace = subscriptions.filter(status=Subscription.STATUS_PAST_DUE).count()
    expired = subscriptions.filter(status=Subscription.STATUS_EXPIRED).count()
    undelivered = NotificationDelivery.objects.filter(
        status__in=[NotificationDelivery.STATUS_FAILED, NotificationDelivery.STATUS_NOT_CONFIGURED],
        updated_at__gte=timezone.now() - timedelta(days=1),
    ).count()
    if not (ending or in_grace or expired or undelivered):
        return

    lines = [
        f"{ending} tenant subscription(s) end within {policy.reminder_window_days} days.",
        f"{in_grace} tenant(s) are in their grace period.",
        f"{expired} tenant(s) are expired and read-only.",
    ]
    if undelivered:
        lines.append(
            f"{undelivered} notice(s) could not be delivered in the last 24 hours — check the "
            "platform email and SMS settings."
        )
    title = f"Subscriptions digest for {_date(today)}"
    notify(
        platform_admins(),
        category=Notification.CATEGORY_SUBSCRIPTION,
        severity=(
            Notification.SEVERITY_WARNING
            if (in_grace or expired or undelivered)
            else Notification.SEVERITY_INFO
        ),
        title=title,
        body=" ".join(lines),
        link=PLATFORM_LINK,
        dedupe_key=f"platform:subscription-digest:{today}",
        email=EmailContent(
            subject=f"CITRAMAC: {title}",
            body_text="\n".join(lines) + f"\n\n{_frontend_url(PLATFORM_LINK)}",
            context={
                "heading": title,
                "paragraphs": lines,
                "action_url": _frontend_url(PLATFORM_LINK),
                "action_label": "Open Subscriptions & Billing",
            },
        ),
    )
