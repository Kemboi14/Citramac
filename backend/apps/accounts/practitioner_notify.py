"""
Notices about practitioner profiles (apps.accounts.practitioner_profile):

- at sign-in, the staff member is asked to complete their profile while
  something is outstanding (once per profile state, never on every sign-in);
- on submission, every reviewer (Org Admins + holders of
  staff.credentials.verify) is told, in-app and by email;
- on verification or return, the staff member is told, in-app and by email;
- daily, practising licence / NACADA accreditation / indemnity expiry
  reminders at settings.PRACTITIONER_LICENCE_REMINDER_DAYS, then once when it
  has expired — to the staff member and the reviewers.

Content rule (apps.notifications.dispatch): staff names and dates only, never
client or clinical detail.
"""

import hashlib
from datetime import timedelta

import structlog
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.notifications.dispatch import EmailContent, notify
from apps.notifications.models import Notification

logger = structlog.get_logger(__name__)

CATEGORY = Notification.CATEGORY_PRACTITIONER_PROFILE
STAFF_LINK = "/org-admin/staff"


def _frontend_url(path):
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.email


def profile_link(user):
    """Where the person edits their own profile — the shell they work in."""
    from .access import is_org_admin

    shell = "org-admin" if is_org_admin(user) else "clinical"
    return f"/{shell}/profile#professional-profile"


def review_link(user):
    return f"{STAFF_LINK}?credential={user.pk}"


def _email(title, paragraphs, link, label, organization_name=""):
    return EmailContent(
        subject=f"CITRAMAC: {title}",
        body_text=" ".join(paragraphs) + f"\n\n{_frontend_url(link)}",
        context={
            "heading": title,
            "organization_name": organization_name,
            "paragraphs": paragraphs,
            "action_url": _frontend_url(link),
            "action_label": label,
        },
    )


def remind_at_sign_in(user):
    """One in-app notice per outstanding profile state. Never raises."""
    from . import practitioner_profile as profile

    try:
        if not user.organization_id or user.is_superuser:
            return 0
        cred = profile.credential_for(user)
        if not profile.needs_action(user, cred):
            return 0
        required = profile.credentials_required(user)
        status = cred.profile_status if (cred and required) else "DRAFT"
        if status == "RETURNED":
            title = "Your professional profile was returned"
            body = (
                "A reviewer returned your professional profile for changes: "
                f"{cred.returned_reason} Update it and submit it again."
            )
        elif required:
            title = "Complete your professional profile"
            body = (
                "Add your registration, current practising licence, qualifications and the "
                "documents for each, then submit your profile so it can be verified."
            )
        else:
            title = "Complete your profile"
            body = "Add your mobile phone number to your profile."
        missing = ",".join(sorted(i["key"] for i in profile.missing_items(user, cred)))
        digest = hashlib.sha256(missing.encode()).hexdigest()[:16]
        return notify(
            [user],
            category=CATEGORY,
            severity=Notification.SEVERITY_WARNING,
            title=title,
            body=body,
            link=profile_link(user),
            dedupe_key=f"profile-incomplete:{user.pk}:{status}:{digest}",
            organization_id=user.organization_id,
        )
    except Exception:  # noqa: BLE001 — a reminder must never break sign-in
        logger.exception("profile_sign_in_reminder_failed", user_id=str(user.pk))
        return 0


def profile_submitted(cred, review):
    from .practitioner_profile import reviewers

    user = cred.user
    who = _name(user)
    title = f"{who} submitted their professional profile"
    paragraphs = [
        f"{who} has filled in their professional profile and uploaded their documents.",
        "Check the registration and practising licence against the documents, then verify "
        "the profile or return it with what needs changing.",
    ]
    notify(
        reviewers(cred.organization_id, exclude=user),
        category=CATEGORY,
        title=title,
        body=" ".join(paragraphs),
        link=review_link(user),
        dedupe_key=f"credential-submitted:{review.pk}",
        organization_id=cred.organization_id,
        email=_email(
            title,
            paragraphs,
            review_link(user),
            "Review the profile",
            user.organization.name if user.organization_id else "",
        ),
    )


def profile_reviewed(cred, review):
    user = cred.user
    if review.action == review.ACTION_VERIFIED:
        title = "Your professional profile is verified"
        paragraphs = [f"{_name(review.actor)} verified your professional profile."]
        severity = Notification.SEVERITY_INFO
    else:
        title = "Your professional profile was returned"
        paragraphs = [
            f"{_name(review.actor)} returned your professional profile for changes.",
            f"What needs changing: {review.reason}",
            "Update it and submit it again.",
        ]
        severity = Notification.SEVERITY_WARNING
    notify(
        [user],
        category=CATEGORY,
        severity=severity,
        title=title,
        body=" ".join(paragraphs),
        link=profile_link(user),
        dedupe_key=f"credential-review:{review.pk}",
        organization_id=cred.organization_id,
        email=_email(
            title,
            paragraphs,
            profile_link(user),
            "Open my profile",
            user.organization.name if user.organization_id else "",
        ),
    )


# ── expiry reminders ───────────────────────────────────────────────────────

EXPIRING = (
    ("licence", "licence_expires_on", "licence_number", "practising licence"),
    ("nacada", "nacada_expires_on", "nacada_number", "NACADA accreditation"),
    ("indemnity", "indemnity_expires_on", "indemnity_number", "professional indemnity cover"),
)


def _date(value):
    return f"{value:%d %b %Y}"


def _expiry_notice(cred, kind, label, expires_on, stage, days):
    from .practitioner_profile import reviewers

    user = cred.user
    who = _name(user)
    end = _date(expires_on)
    if stage == "EXPIRED":
        own_title = f"Your {label} has expired"
        staff_title = f"{who}: {label} has expired"
        severity = Notification.SEVERITY_CRITICAL
        own = [f"Your {label} expired on {end}."]
        if kind == "licence":
            own.append("You can't sign clinical records until you record the renewed licence.")
    else:
        when = "today" if stage == 0 else f"in {days} day{'s' if days != 1 else ''}"
        own_title = f"Your {label} expires {when}"
        staff_title = f"{who}: {label} expires {when}"
        severity = Notification.SEVERITY_WARNING if stage <= 30 else Notification.SEVERITY_INFO
        own = [f"Your {label} is valid until {end}."]
    own.append("Once it is renewed, record the new number, dates and document in your profile.")
    key = f"practitioner-expiry:{cred.pk}:{kind}:{expires_on}:{stage}"
    notify(
        [user],
        category=CATEGORY,
        severity=severity,
        title=own_title,
        body=" ".join(own),
        link=profile_link(user),
        dedupe_key=key,
        organization_id=cred.organization_id,
        email=_email(own_title, own, profile_link(user), "Update my profile"),
    )
    notify(
        reviewers(cred.organization_id, exclude=user),
        category=CATEGORY,
        severity=severity,
        title=staff_title,
        body=f"{who}'s {label} {'expired' if stage == 'EXPIRED' else 'is valid until'} {end}.",
        link=review_link(user),
        dedupe_key=key,
        organization_id=cred.organization_id,
    )


def process_credential(cred, offsets, today):
    from apps.tenancy.subscription_lifecycle import reminder_stage

    outcomes = []
    for kind, date_attr, number_attr, label in EXPIRING:
        expires_on = getattr(cred, date_attr)
        if expires_on is None or not str(getattr(cred, number_attr) or "").strip():
            continue
        days = (expires_on - today).days
        if days < 0:
            _expiry_notice(cred, kind, label, expires_on, "EXPIRED", days)
            outcomes.append(f"{kind}:EXPIRED")
            continue
        stage = reminder_stage(days, offsets)
        if stage is None:
            continue
        _expiry_notice(cred, kind, label, expires_on, stage, days)
        outcomes.append(f"{kind}:T-{stage}")
    return outcomes


def remind_all(today=None):
    """The daily job. Each credential in isolation; a failure is logged and the rest go on."""
    from django.db.models import Q

    from apps.tenancy.context import platform_admin_context

    from .models import PractitionerCredential

    offsets = settings.PRACTITIONER_LICENCE_REMINDER_DAYS
    today = today or timezone.localdate()
    window_end = today + timedelta(days=max(offsets, default=0))
    outcomes = {}
    with platform_admin_context():
        due = Q()
        for _, date_attr, _, _ in EXPIRING:
            due |= Q(**{f"{date_attr}__lte": window_end})
        credentials = list(
            PractitionerCredential.objects.select_related("user", "user__organization").filter(
                due, user__is_active=True
            )
        )
        for cred in credentials:
            try:
                with transaction.atomic():
                    done = process_credential(cred, offsets, today)
                if done:
                    outcomes[str(cred.pk)] = done
            except Exception:  # noqa: BLE001 — isolate, log, continue
                logger.exception("practitioner_expiry_reminder_failed", credential_id=str(cred.pk))
                outcomes[str(cred.pk)] = "FAILED"
    return outcomes
