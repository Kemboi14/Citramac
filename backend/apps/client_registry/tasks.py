import structlog
from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.notifications.email import get_email_connection_and_sender, send_html_email
from apps.tenancy.context import platform_admin_context

logger = structlog.get_logger(__name__)


@shared_task
def send_appointment_reminders():
    """
    Periodic scan (CELERY_BEAT_SCHEDULE, every 15 min) for the Appointments
    Calendar's email reminders — docs/07-CLINICAL-MODULES-SPEC.md §7.1.

    Picks up every SCHEDULED appointment whose `scheduled_for` falls within
    the next `APPOINTMENT_REMINDER_HOURS_BEFORE` hours and that hasn't had a
    reminder sent yet (`reminder_sent_at is null`). Because the scan runs
    often and the window is a rolling "next N hours" rather than an exact
    "N hours from now" match, an appointment booked less than N hours out
    still gets a reminder on the very next scan — booked-last-minute and
    booked-far-in-advance appointments are both covered by the same query,
    not two separate code paths. `AppointmentViewSet.perform_update` resets
    `reminder_sent_at` to null whenever `scheduled_for` changes, so a
    rescheduled appointment is treated as never-reminded and gets a fresh
    one for its new time.

    Runs cross-tenant under `platform_admin_context()` (Celery beat has no
    request-bound tenant, same pattern as the terminology sync tasks), and
    resolves each appointment's own organization's SMTP settings via
    `apps.notifications.email` so a reminder always sends through that
    tenant's configured mail server (or the platform/settings.py fallback).
    """
    now = timezone.now()
    window_end = now + timezone.timedelta(hours=settings.APPOINTMENT_REMINDER_HOURS_BEFORE)

    with platform_admin_context():
        from .models import Appointment

        due = (
            Appointment.objects.select_related("patient", "organization")
            .filter(
                status="SCHEDULED",
                reminder_sent_at__isnull=True,
                scheduled_for__gte=now,
                scheduled_for__lte=window_end,
            )
            .exclude(patient__contact_email="")
        )
        sent = 0
        for appointment in due:
            connection, from_email = get_email_connection_and_sender(appointment.organization)
            send_html_email(
                subject="Appointment reminder — CITRAMAC",
                template_name="notifications/emails/appointment_reminder_email.html",
                context={
                    "patient_name": appointment.patient.get_full_name(),
                    "organization_name": appointment.organization.name,
                    "scheduled_for": timezone.localtime(appointment.scheduled_for).strftime(
                        "%A, %d %B %Y at %H:%M"
                    ),
                    "appointment_type": appointment.appointment_type,
                    "location": appointment.location,
                    "mode": appointment.get_mode_display(),
                },
                plain_message=(
                    f"Reminder: you have an appointment on "
                    f"{timezone.localtime(appointment.scheduled_for):%A, %d %B %Y at %H:%M}."
                ),
                from_email=from_email,
                recipient_list=[appointment.patient.contact_email],
                connection=connection,
            )
            appointment.reminder_sent_at = now
            appointment.save(update_fields=["reminder_sent_at"])
            sent += 1

    logger.info("appointment_reminders_sent", count=sent)
    return sent
