"""
Messages to a client about their own appointments — booked, moved, and the
reminder before (owner decisions 2026-11-05).

- Consent first: a channel is used only when the client's latest decision for
  it is YES (APPOINTMENT_SMS / APPOINTMENT_EMAIL, apps.client_registry.consent).
  Not asked or NO sends nothing. A branch that has turned SMS reminders off
  sends no SMS.
- Discreet: the organisation, branch, date and time only — never the type of
  appointment, the clinician, the service or anything clinical, since a phone
  or inbox may be seen by someone else.
- Through the outbox (apps.notifications.dispatch): each message is a
  NotificationDelivery, sent after the booking commits and retried, and its
  outcome is recorded — a message that could not be sent shows as FAILED or
  NOT_CONFIGURED on the appointment, never as sent. The dedupe key names the
  appointment, the event and the time, so a retry or a re-run never sends the
  same message twice, and a moved appointment gets fresh ones.

FHIR: each message is a `Communication` about the `Appointment` (not emitted
yet); the agreement is a `Consent` on the Patient.
"""

from django.utils import timezone

from apps.care_pathway import facility_time
from apps.notifications.dispatch import EmailContent, queue_email, queue_sms

from .consent import APPOINTMENT_EMAIL, APPOINTMENT_SMS, current_decision

BOOKED = "BOOKED"
RESCHEDULED = "RESCHEDULED"
REMINDER = "REMINDER"
KIND_LABELS = {BOOKED: "Booking", RESCHEDULED: "New time", REMINDER: "Reminder"}


def _key(appointment, kind):
    when = appointment.scheduled_for.strftime("%Y%m%dT%H%M")
    return f"appointment:{appointment.pk}:{kind}:{when}"


def _where(appointment):
    org = appointment.organization.name
    return f"{org} {appointment.branch.name}" if appointment.branch_id else org


def _text(appointment, kind):
    when = facility_time.local_format(appointment.scheduled_for, "%a %d %b %Y at %H:%M")
    where = _where(appointment)
    if kind == BOOKED:
        return f"Your appointment at {where} is booked for {when}."
    if kind == RESCHEDULED:
        return f"Your appointment at {where} has moved to {when}."
    return f"Reminder: appointment at {where} on {when}."


def channels(appointment):
    """[(channel, address)] this appointment's client may be messaged on."""
    patient = appointment.patient
    out = []
    sms_on = appointment.branch is None or appointment.branch.sms_reminders_enabled
    if patient.contact_phone and sms_on and current_decision(patient, APPOINTMENT_SMS) == "YES":
        out.append(("SMS", patient.contact_phone))
    if patient.contact_email and current_decision(patient, APPOINTMENT_EMAIL) == "YES":
        out.append(("EMAIL", patient.contact_email))
    return out


def send(appointment, kind):
    """Queue this event's message on every agreed channel. Returns the new
    deliveries (none for a past, cancelled or completed appointment)."""
    if appointment.status != "SCHEDULED" or appointment.scheduled_for <= timezone.now():
        return []
    text = _text(appointment, kind)
    key = _key(appointment, kind)
    queued = []
    for channel, address in channels(appointment):
        if channel == "SMS":
            delivery = queue_sms(appointment.organization_id, key, address, text)
        else:
            subject = {
                BOOKED: "Your appointment is booked",
                RESCHEDULED: "Your appointment has moved",
                REMINDER: "Appointment reminder",
            }[kind]
            delivery = queue_email(
                appointment.organization_id,
                key,
                address,
                EmailContent(
                    subject=subject,
                    body_text=text,
                    context={
                        "heading": subject,
                        "organization_name": appointment.organization.name,
                        "paragraphs": [
                            text,
                            "If you can't come, please contact us to change it.",
                        ],
                    },
                ),
            )
        if delivery is not None:
            queued.append(delivery)
    return queued


def booked(appointment):
    return send(appointment, BOOKED)


def rescheduled(appointment):
    return send(appointment, RESCHEDULED)


def status(appointment):
    """What was sent about this appointment: [{kind, channel, status, at}]."""
    from apps.notifications.models import NotificationDelivery

    rows = NotificationDelivery.objects.filter(
        dedupe_key__startswith=f"appointment:{appointment.pk}:"
    ).order_by("created_at")
    out = []
    for row in rows:
        kind = row.dedupe_key.split(":")[2]
        out.append(
            {
                "kind": kind,
                "label": KIND_LABELS.get(kind, kind),
                "channel": row.channel,
                "status": row.status,
                "at": (row.sent_at or row.created_at).isoformat(),
            }
        )
    return out
