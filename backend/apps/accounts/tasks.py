import structlog
from celery import shared_task
from django.utils import timezone

from apps.tenancy.context import platform_admin_context

logger = structlog.get_logger(__name__)


@shared_task
def enforce_access_windows():
    """
    Periodic scan (CELERY_BEAT_SCHEDULE, hourly) for time-bound accounts
    (User.access_ends_at — e.g. a locum or fixed-term contractor) whose
    window has closed. Deactivates them the same way StaffViewSet.destroy
    does (is_active=False, is_on_duty=False), so an already-expired grant is
    reflected in the admin UI even for a user who never attempts to log in
    again — the reactive checks in authentication.py/auth_views.py alone
    would only ever catch this at that user's next request.

    Runs cross-tenant under platform_admin_context() — Celery beat has no
    request-bound tenant, same pattern as the terminology sync and
    appointment-reminder tasks.
    """
    from .models import User

    now = timezone.now()
    count = 0
    with platform_admin_context():
        expired = User.all_objects.filter(
            is_active=True, access_ends_at__isnull=False, access_ends_at__lte=now
        )
        # Saved one at a time, not a bulk .update() — a bulk update bypasses
        # the pre_save/post_save signals apps.sysadmin_audit relies on for
        # its automatic AuditLogEntry trail (see signals.py), and losing
        # that trail for an account deactivation isn't acceptable even
        # though the volume here (time-bound accounts only) is small.
        for user in expired:
            user.is_active = False
            user.is_on_duty = False
            user.save(update_fields=["is_active", "is_on_duty"])
            count += 1

    if count:
        logger.info("access_window_enforced", deactivated_count=count)
    return count
