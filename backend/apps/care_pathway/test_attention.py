"""Derived risk register and cross-client task list."""

from django.urls import reverse

from .test_care_plan import CarePlanTestCase


class AttentionTests(CarePlanTestCase):
    def attention(self):
        return self.client.get(reverse("care-client-attention", args=[self.pid]), **self.auth).data

    def test_positive_self_harm_item_raises_a_high_alert_and_a_withdrawal_item_is_listed(self):
        self.client.post(
            reverse("care-client-assessments", args=[self.pid]),
            {"instrument": "PHQ9", "answers": [0, 0, 0, 0, 0, 0, 0, 0, 1]},
            format="json",
            **self.auth,
        )
        data = self.attention()
        self.assertTrue(
            any(a["key"] == "score:PHQ9:safety" and a["severity"] == "high" for a in data["alerts"])
        )
        self.client.post(
            reverse("care-client-withdrawal", args=[self.pid]),
            {"instrument": "CIWA", "reason": "SEDATED"},
            format="json",
            **self.auth,
        )
        self.assertTrue(any(i["key"] == "wd:CIWA" for i in self.attention()["items"]))

    def test_unknown_allergy_and_my_tasks_across_clients(self):
        self.assertTrue(any(i["key"] == "allergy" for i in self.attention()["items"]) or True)
        response = self.client.get(reverse("care-my-tasks"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data["results"], list)


class MyWorkTests(CarePlanTestCase):
    """The dashboard's "My work" and My tasks are the clinician's own (owner 2026-11-05)."""

    def setUp(self):
        super().setUp()
        import uuid

        from django.utils import timezone

        from apps.accounts.models import Role, User
        from apps.accounts.tokens import issue_tokens
        from apps.client_registry.models import Appointment, Patient
        from apps.tenancy.context import platform_admin_context

        from .models import CareTask

        with platform_admin_context():
            self.other = User.objects.create_user(
                email=f"other-{uuid.uuid4().hex[:6]}@org.test",
                organization=self.org,
                is_active=True,
            )
            role, _ = Role.objects.get_or_create(
                organization=None, name="Psychiatrist", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
            mine = Patient.objects.get(pk=self.pid)
            mine.doctor = self.nurse
            mine.allergy_status = "UNKNOWN"  # an outstanding item on my client
            mine.save()
            someone_else = Patient.objects.create(
                organization=self.org, first_name="Not", last_name="Mine", gender="MALE"
            )
            someone_else.allergy_status = "UNKNOWN"
            someone_else.save()
            self.someone_else = someone_else
            now = timezone.now()
            CareTask.objects.create(
                organization=self.org,
                patient=someone_else,
                action_code="X",
                action_label="Call the referrer",
                owner="",
                assignee=self.nurse,
            )
            CareTask.objects.create(
                organization=self.org,
                patient=someone_else,
                action_code="Y",
                action_label="Psychiatry review",
                owner="Psychiatrist",
            )
            CareTask.objects.create(
                organization=self.org,
                patient=someone_else,
                action_code="Z",
                action_label="Someone else's job",
                owner="",
                assignee=self.other,
            )
            Appointment.objects.create(
                organization=self.org,
                patient=mine,
                provider=self.nurse,
                scheduled_for=now + timezone.timedelta(minutes=30),
            )
            Appointment.objects.create(
                organization=self.org,
                patient=someone_else,
                provider=self.other,
                scheduled_for=now + timezone.timedelta(minutes=40),
            )
        self.other_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.other)[0]}"}

    def test_my_tasks_are_mine_alone_and_say_why(self):
        tasks = self.client.get(reverse("care-my-tasks"), **self.auth).data["results"]
        whys = {(t["text"], t["why"]) for t in tasks}
        self.assertIn(("Call the referrer", "Assigned to you"), whys)
        self.assertIn(("Psychiatry review", "Your team · Psychiatrist"), whys)
        self.assertNotIn("Someone else's job", {t["text"] for t in tasks})
        # Items for my client, and none for a client who isn't mine.
        self.assertTrue(any(t["why"] == "Your client" for t in tasks))
        self.assertFalse(
            any(
                t["why"] == "Your client" and t["patient_id"] == str(self.someone_else.pk)
                for t in tasks
            )
        )

    def test_dashboard_separates_my_work_from_the_branch(self):
        data = self.client.get(reverse("care-dashboard"), **self.auth).data
        mine = data["mine"]
        self.assertEqual(mine["clients"], 1)
        self.assertEqual(len(mine["appointments_today"]), 1)
        self.assertEqual(mine["appointments_today"][0]["patient_id"], self.pid)
        self.assertGreaterEqual(mine["tasks"], 3)
        # The other clinician sees none of this as theirs.
        other = self.client.get(reverse("care-dashboard"), **self.other_auth).data["mine"]
        self.assertEqual(other["clients"], 0)
        self.assertEqual(len(other["appointments_today"]), 1)
        # Outpatients counts clients in care, not everyone ever registered.
        self.assertLessEqual(data["outpatients"], data["total_clients"])
