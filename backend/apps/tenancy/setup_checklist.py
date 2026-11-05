"""
What an Org Admin still has to fill in for their organisation — shown on the
Org Admin dashboard, and sent as one in-app notice at sign-in while anything
required is outstanding (again only when the set of outstanding items
changes).

Each item: key, label, detail, done, required, link (the page that fixes it).
"""

import hashlib

import structlog

logger = structlog.get_logger(__name__)


def checklist(organization, admin=None):
    from apps.accounts import practitioner_profile as profile

    from .models import Branch

    items = []
    items.append(
        {
            "key": "nacada_report_email",
            "label": "NACADA reporting email",
            "detail": (
                organization.nacada_report_email
                or "Not set — the NACADA report can't be sent to NACADA."
            ),
            "done": bool(organization.nacada_report_email),
            "required": True,
            "link": "/org-admin/branch-settings#nacada-reporting",
        }
    )

    branches = list(
        Branch.objects.select_related("organization").filter(
            organization=organization, is_active=True
        )
    )
    incomplete = [
        b.name
        for b in branches
        if b.missing_identifiers
        or b.license_status in (Branch.LICENSE_MISSING, Branch.LICENSE_EXPIRED)
    ]
    items.append(
        {
            "key": "branch_identifiers",
            "label": "Branch registration and facility licence",
            "detail": (
                "Missing or expired for: " + ", ".join(incomplete)
                if incomplete
                else "Every active branch has its registration numbers and a current licence."
            ),
            "done": not incomplete,
            "required": True,
            "link": "/org-admin/branches",
        }
    )

    from apps.client_registry.consent import appointment_wording

    wording = appointment_wording(organization.id)
    items.append(
        {
            "key": "appointment_message_wording",
            "label": "Wording for appointment messages",
            "detail": (
                f"Version {wording.version} is in use."
                if wording
                else "Not set — clients can't agree to SMS / email about their appointments, "
                "so none are sent."
            ),
            "done": wording is not None,
            "required": True,
            "link": "/org-admin/consent-wording",
        }
    )

    items.append(
        {
            "key": "organisation_email",
            "label": "Organisation email (SMTP)",
            "detail": (
                "Configured — notices go out from your own address."
                if organization.has_email_credentials
                else "Not configured — notices go out from the platform's address."
            ),
            "done": bool(organization.has_email_credentials),
            "required": False,
            "link": "/org-admin/branch-settings",
        }
    )

    if admin is not None:
        own = profile.missing_items(admin)
        items.append(
            {
                "key": "own_profile",
                "label": "Your own profile",
                "detail": (
                    "Missing: " + "; ".join(i["label"] for i in own) if own else "Complete."
                ),
                "done": not own,
                "required": True,
                "link": "/org-admin/profile#professional-profile",
            }
        )

    awaiting = profile.awaiting_verification(organization.id).count()
    items.append(
        {
            "key": "profiles_awaiting_verification",
            "label": "Staff profiles awaiting verification",
            "detail": (
                f"{awaiting} submitted profile{'s' if awaiting != 1 else ''} to check."
                if awaiting
                else "None waiting."
            ),
            "done": awaiting == 0,
            "required": True,
            "link": "/org-admin/staff?credential_status=SUBMITTED",
            "count": awaiting,
        }
    )

    not_submitted = len(profile.clinical_staff_without_submission(organization.id))
    items.append(
        {
            "key": "profiles_not_submitted",
            "label": "Clinical staff who haven't submitted a profile",
            "detail": (
                f"{not_submitted} clinician{'s' if not_submitted != 1 else ''} still to submit. "
                "They are reminded each time they sign in."
                if not_submitted
                else "Every clinician has submitted."
            ),
            "done": not_submitted == 0,
            "required": False,
            "link": "/org-admin/staff?credential_status=DRAFT",
            "count": not_submitted,
        }
    )
    return items


def remind_at_sign_in(user):
    """One in-app notice to an Org Admin per distinct set of outstanding required items."""
    from apps.accounts.access import is_org_admin
    from apps.notifications.dispatch import notify
    from apps.notifications.models import Notification

    try:
        if not user.organization_id or user.is_superuser or not is_org_admin(user):
            return 0
        items = checklist(user.organization, admin=user)
        outstanding = [i for i in items if i["required"] and not i["done"]]
        if not outstanding:
            return 0
        keys = ",".join(sorted(i["key"] for i in outstanding))
        digest = hashlib.sha256(keys.encode()).hexdigest()[:16]
        return notify(
            [user],
            category=Notification.CATEGORY_SYSTEM,
            severity=Notification.SEVERITY_WARNING,
            title="Organisation setup is incomplete",
            body="Still to do: " + "; ".join(i["label"] for i in outstanding) + ".",
            link="/org-admin",
            dedupe_key=f"org-setup:{user.organization_id}:{user.pk}:{digest}",
            organization_id=user.organization_id,
        )
    except Exception:  # noqa: BLE001 — a reminder must never break sign-in
        logger.exception("org_setup_reminder_failed", user_id=str(user.pk))
        return 0
