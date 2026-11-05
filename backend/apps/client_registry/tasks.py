import structlog
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.tenancy.context import platform_admin_context

logger = structlog.get_logger(__name__)


@shared_task
def send_appointment_reminders():
    """
    Periodic scan (CELERY_BEAT_SCHEDULE, every 15 min): the reminder before
    each SCHEDULED appointment due within the next
    `APPOINTMENT_REMINDER_HOURS_BEFORE` hours that hasn't had one
    (`reminder_sent_at` is null; a moved appointment is reset to null, so it
    gets a fresh reminder for its new time).

    The message itself is apps.client_registry.appointment_messages: only on
    the channels the client agreed to, discreet wording, through the
    notification outbox so each send's outcome is recorded. An appointment
    booked or moved inside the reminder window already got its booking message
    for that time, so it isn't sent a second one minutes later.

    Runs cross-tenant under `platform_admin_context()` (Celery beat has no
    request-bound tenant); each delivery goes through its own organisation's
    SMTP / SMS settings.
    """
    from datetime import timedelta

    from apps.notifications.models import NotificationDelivery

    from . import appointment_messages

    now = timezone.now()
    lead = timedelta(hours=settings.APPOINTMENT_REMINDER_HOURS_BEFORE)
    sent = 0
    with platform_admin_context():
        from .models import Appointment

        due = Appointment.objects.select_related("patient", "organization", "branch").filter(
            status="SCHEDULED",
            reminder_sent_at__isnull=True,
            scheduled_for__gte=now,
            scheduled_for__lte=now + lead,
        )
        for appointment in due:
            when = appointment.scheduled_for.strftime("%Y%m%dT%H%M")
            told_recently = NotificationDelivery.objects.filter(
                dedupe_key__in=[
                    f"appointment:{appointment.pk}:{kind}:{when}"
                    for kind in (appointment_messages.BOOKED, appointment_messages.RESCHEDULED)
                ],
                created_at__gte=appointment.scheduled_for - lead,
            ).exists()
            if not told_recently:
                sent += len(appointment_messages.send(appointment, appointment_messages.REMINDER))
            appointment.reminder_sent_at = now
            appointment.save(update_fields=["reminder_sent_at"])

    logger.info("appointment_reminders_queued", count=sent)
    return sent
