"""
Branch facility licence renewal reminders — the daily job that tells a
tenant's Org Admins (in-app, email and SMS via apps.notifications.dispatch)
that a branch's facility licence is coming up for its yearly renewal, or has
lapsed.

    T-n       when facility_license_valid_until comes within each of
              settings.FACILITY_LICENSE_REMINDER_DAYS days (0 = the day itself)
    EXPIRED   once, the first run after the licence's last valid day

Staged the same way as the subscription reminders (subscription_lifecycle.
reminder_stage): each run sends the notice for the stage the licence is in,
once per (branch, expiry date, stage) — the dedupe_key — so a re-run or a
missed day can't send a duplicate or skip a stage. Recording a renewal
(a new expiry date) starts a fresh set of stages.

Platform-wide like the subscription job (docs/04-MULTI-TENANCY.md §4): each
branch is processed in isolation; a failure is logged against it and the
rest carry on.
"""

from datetime import timedelta

import structlog
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.notifications.dispatch import EmailContent, notify, org_admins
from apps.notifications.models import Notification

from .context import platform_admin_context
from .models import Branch
from .subscription_lifecycle import reminder_stage

logger = structlog.get_logger(__name__)

BRANCHES_LINK = "/org-admin/branches"


def _frontend_url(path):
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _date(value):
    return f"{value:%d %b %Y}"


def _notify(branch, *, key_suffix, severity, title, paragraphs, sms):
    organization = branch.organization
    body = " ".join(paragraphs)
    facts = [
        {"label": "Branch", "value": branch.name},
        {"label": "Licence number", "value": branch.facility_license_number or "Not recorded"},
        {"label": "Valid until", "value": _date(branch.facility_license_valid_until)},
    ]
    notify(
        org_admins(organization.id),
        category=Notification.CATEGORY_FACILITY_LICENCE,
        severity=severity,
        title=title,
        body=body,
        link=BRANCHES_LINK,
        dedupe_key=(
            f"branch-licence:{branch.id}:{branch.facility_license_valid_until}:{key_suffix}"
        ),
        organization_id=organization.id,
        email=EmailContent(
            subject=f"CITRAMAC: {title}",
            body_text=f"{body}\n\n{_frontend_url(BRANCHES_LINK)}",
            context={
                "heading": title,
                "organization_name": organization.name,
                "severity": severity,
                "paragraphs": paragraphs,
                "facts": facts,
                "action_url": _frontend_url(BRANCHES_LINK),
                "action_label": "Update branch licence",
            },
        ),
        sms_text=sms,
    )


def _send_reminder(branch, stage, days):
    end = _date(branch.facility_license_valid_until)
    if stage == 0:
        title = f"{branch.name}: facility licence expires today"
        severity = Notification.SEVERITY_CRITICAL
    else:
        title = f"{branch.name}: facility licence expires in {days} day{'s' if days != 1 else ''}"
        severity = Notification.SEVERITY_WARNING if stage <= 30 else Notification.SEVERITY_INFO
    paragraphs = [
        f"The facility licence for {branch.name} is valid until {end}.",
        "Once it is renewed, record the new licence number and expiry date under Branches & "
        "Departments so these reminders stop and the renewal is kept in the branch's history.",
    ]
    _notify(
        branch,
        key_suffix=f"T-{stage}",
        severity=severity,
        title=title,
        paragraphs=paragraphs,
        sms=f"CITRAMAC: the facility licence for {branch.name} expires {end}. Renew and record it.",
    )


def _send_expired(branch):
    end = _date(branch.facility_license_valid_until)
    _notify(
        branch,
        key_suffix="EXPIRED",
        severity=Notification.SEVERITY_CRITICAL,
        title=f"{branch.name}: facility licence has expired",
        paragraphs=[
            f"The facility licence for {branch.name} expired on {end}.",
            "Record the renewed licence number and expiry date under Branches & Departments as "
            "soon as it is issued.",
        ],
        sms=f"CITRAMAC: the facility licence for {branch.name} expired {end}. Renew and record it.",
    )


def process_branch(branch, offsets, today):
    """Send whatever notice this branch's licence stage calls for; returns the outcome."""
    if branch.facility_license_valid_until is None:
        return None
    days = (branch.facility_license_valid_until - today).days
    if days < 0:
        _send_expired(branch)
        return "EXPIRED"
    stage = reminder_stage(days, offsets)
    if stage is None:
        return None
    _send_reminder(branch, stage, days)
    return f"REMINDED:T-{stage}"


def remind_all(today=None):
    offsets = settings.FACILITY_LICENSE_REMINDER_DAYS
    today = today or timezone.localdate()
    window_end = today + timedelta(days=max(offsets, default=0))
    outcomes = {}
    with platform_admin_context():
        branches = list(
            Branch.objects.select_related("organization").filter(
                is_active=True,
                facility_license_valid_until__isnull=False,
                facility_license_valid_until__lte=window_end,
            )
        )
        for branch in branches:
            try:
                with transaction.atomic():
                    outcome = process_branch(branch, offsets, today)
                if outcome:
                    outcomes[str(branch.id)] = outcome
            except Exception:  # noqa: BLE001 — isolate, log, continue with the rest
                logger.exception(
                    "facility_licence_reminder_failed",
                    branch_id=str(branch.id),
                    organization_id=str(branch.organization_id),
                )
                outcomes[str(branch.id)] = "FAILED"
    return outcomes
