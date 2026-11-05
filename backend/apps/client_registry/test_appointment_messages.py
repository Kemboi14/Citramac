"""Appointment messages by SMS / email (owner decisions 2026-11-05): only on the
channels the client agreed to, discreet wording, through the outbox, at booking,
on a new time and as the reminder — never twice for the same event."""

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway.models import ConsentTemplate
from apps.notifications.models import NotificationDelivery
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Branch, Organization

from . import appointment_messages
from .consent import appointment_channels, capture_appointment_consent
from .models import Appointment, Patient
from .tasks import send_appointment_reminders


class AppointmentMessageTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Cafric", slug="cafric-msg", facility_type="MENTAL_HEALTH_MHP"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Thika", facility_level="L3"
            )
            self.clinician = User.objects.create_user(
                email="desk@cafric-msg.test", organization=self.org, is_active=True
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Grace",
                last_name="Njeri",
                gender="FEMALE",
                date_of_birth="1989-06-14",
                contact_phone="+254700000001",
                contact_email="grace@example.com",
            )
        access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def wording(self):
        with platform_admin_context():
            ConsentTemplate.objects.create(
                organization=self.org,
                consent_type="APPOINTMENT_MESSAGES",
                version="2026-11",
                text="Facility wording.",
            )

    def agree(self, **decisions):
        with platform_admin_context():
            capture_appointment_consent(self.patient, self.clinician, decisions)

    def book(self, hours=48, **extra):
        response = self.client.post(
            reverse("appointment-list"),
            {
                "patient": str(self.patient.id),
                "branch": str(self.branch.id),
                "scheduled_for": (timezone.now() + timezone.timedelta(hours=hours)).isoformat(),
                "appointment_type": "Psychiatric review",
                **extra,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def deliveries(self, appointment_id, kind=None):
        prefix = f"appointment:{appointment_id}:" + (f"{kind}:" if kind else "")
        with platform_admin_context():
            return list(NotificationDelivery.objects.filter(dedupe_key__startswith=prefix))

    def test_nothing_is_sent_without_the_clients_agreement(self):
        appointment_id = self.book()
        self.assertEqual(self.deliveries(appointment_id), [])

    def test_agreement_needs_the_facilitys_wording(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError), platform_admin_context():
            capture_appointment_consent(self.patient, self.clinician, {"sms": "YES"})

    def test_booking_sends_a_discreet_message_on_each_agreed_channel(self):
        self.wording()
        self.agree(sms="YES", email="YES")
        appointment_id = self.book()
        sent = self.deliveries(appointment_id, "BOOKED")
        self.assertEqual({d.channel for d in sent}, {"SMS", "EMAIL"})
        for delivery in sent:
            self.assertIn("Cafric Thika", delivery.body_text)
            self.assertNotIn("Psychiatric", delivery.body_text)
            self.assertNotIn("Grace", delivery.body_text)

    def test_only_the_agreed_channel_is_used(self):
        self.wording()
        self.agree(sms="NO", email="YES")
        appointment_id = self.book()
        self.assertEqual([d.channel for d in self.deliveries(appointment_id)], ["EMAIL"])
        with platform_admin_context():
            self.assertEqual(appointment_channels(self.patient), {"sms": "NO", "email": "YES"})

    def test_a_branch_with_sms_turned_off_sends_no_sms(self):
        self.wording()
        self.agree(sms="YES")
        with platform_admin_context():
            Branch.objects.filter(pk=self.branch.pk).update(sms_reminders_enabled=False)
        appointment_id = self.book()
        self.assertEqual(self.deliveries(appointment_id), [])

    def test_a_new_time_sends_a_new_message_and_a_fresh_reminder(self):
        self.wording()
        self.agree(sms="YES")
        appointment_id = self.book(hours=48)
        new_time = (timezone.now() + timezone.timedelta(hours=72)).isoformat()
        response = self.client.patch(
            reverse("appointment-detail", args=[appointment_id]),
            {"scheduled_for": new_time},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(self.deliveries(appointment_id, "RESCHEDULED")), 1)
        # Editing anything else sends nothing more.
        self.client.patch(
            reverse("appointment-detail", args=[appointment_id]),
            {"notes": "Bring referral letter"},
            format="json",
            **self.auth,
        )
        self.assertEqual(len(self.deliveries(appointment_id)), 2)

    @override_settings(APPOINTMENT_REMINDER_HOURS_BEFORE=24)
    def test_reminder_once_and_not_right_after_a_late_booking(self):
        self.wording()
        self.agree(sms="YES")
        with platform_admin_context():
            early = Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                branch=self.branch,
                scheduled_for=timezone.now() + timezone.timedelta(hours=3),
            )
        late_id = self.book(hours=2)  # booked inside the window: the booking message suffices
        self.assertEqual(send_appointment_reminders(), 1)
        self.assertEqual(send_appointment_reminders(), 0)
        self.assertEqual(len(self.deliveries(early.pk, "REMINDER")), 1)
        self.assertEqual(self.deliveries(late_id, "REMINDER"), [])

    def test_past_and_cancelled_appointments_send_nothing(self):
        self.wording()
        self.agree(sms="YES")
        with platform_admin_context():
            past = Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() - timezone.timedelta(hours=1),
            )
            cancelled = Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() + timezone.timedelta(hours=5),
                status="CANCELLED",
            )
            self.assertEqual(appointment_messages.booked(past), [])
            self.assertEqual(appointment_messages.booked(cancelled), [])

    def test_the_appointment_shows_what_was_sent(self):
        self.wording()
        self.agree(sms="YES")
        appointment_id = self.book()
        data = self.client.get(
            reverse("appointment-detail", args=[appointment_id]), **self.auth
        ).data
        self.assertEqual(data["messages"][0]["kind"], "BOOKED")
        self.assertEqual(data["messages"][0]["channel"], "SMS")
        self.assertEqual(data["messages"][0]["status"], "PENDING")

    def test_consent_can_be_recorded_for_an_existing_client(self):
        self.wording()
        url = reverse("care-client-consent", args=[self.patient.pk])
        response = self.client.post(
            url, {"granted": True, "consent_type": "APPOINTMENT_SMS"}, format="json", **self.auth
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            self.assertEqual(appointment_channels(self.patient)["sms"], "YES")
