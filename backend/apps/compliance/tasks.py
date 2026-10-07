from celery import shared_task
from django.utils import timezone

REMIND_HOURS_BEFORE = 12


@shared_task
def remind_breach_notification_deadlines():
    """Warn Org Admins and platform staff as a breach notification deadline
    approaches and again once it has passed (legal opinion §10). Deduplicated
    per track and stage, so re-runs never repeat a reminder."""
    from datetime import timedelta

    from apps.notifications.dispatch import notify, org_admins, platform_admins
    from apps.notifications.models import Notification
    from apps.tenancy.context import platform_admin_context

    from .models import BreachNotification

    now = timezone.now()
    soon = now + timedelta(hours=REMIND_HOURS_BEFORE)
    sent = 0
    with platform_admin_context():
        tracks = BreachNotification.all_objects.filter(
            required=True, notified_at__isnull=True, due_at__lte=soon
        ).select_related("incident")
        for track in tracks:
            overdue = track.due_at <= now
            incident = track.incident
            sent += notify(
                org_admins(incident.organization_id) + platform_admins(),
                category=Notification.CATEGORY_SYSTEM,
                severity=Notification.SEVERITY_CRITICAL,
                title=(
                    f"{'OVERDUE' if overdue else 'Due soon'}: breach notification to "
                    f"{track.get_track_display()} — {incident.reference}"
                ),
                body=f"Deadline {timezone.localtime(track.due_at):%Y-%m-%d %H:%M}.",
                dedupe_key=f"breach-track:{track.id}:{'overdue' if overdue else 'soon'}",
                organization_id=incident.organization_id,
                link="/org-admin/breach-incidents",
            )
    return sent
