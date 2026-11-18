"""Section N → care plan → Interventions as one piece of work (triage_care_plan.py)."""

from django.urls import reverse

from apps.accounts.models import Role
from apps.tenancy.context import platform_admin_context

from . import plan_views, services, triage_care_plan
from .models import CarePlan, CareTask, TriageEncounter
from .tests import CarePathwayApiTestCase


class TriageCarePlanTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            role, _ = Role.objects.get_or_create(
                organization=None, name="Nurse", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
        registered = self.register(allergy_status="NONE")
        self.pid = registered.data["patient_id"]
        self.te_id = registered.data["triage_encounter_id"]

    def register_tasks(self, *actions):
        return self.client.post(
            reverse("care-triage-tasks", args=[self.te_id]),
            {
                "schema": "v5",
                "tasks": [{"action": a, "assignee": str(self.nurse.pk)} for a in actions],
            },
            format="json",
            **self.auth,
        )

    def plan(self):
        te = TriageEncounter.objects.get(pk=self.te_id)
        return CarePlan.objects.get(episode=te.episode)

    def task(self, code):
        return CareTask.objects.get(triage_encounter_id=self.te_id, action_code=code)

    def test_ticked_actions_become_accepted_care_plan_actions(self):
        response = self.register_tasks(
            "safety_plan", "enhanced_observation", "safeguarding_intervention"
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            plan = self.plan()
            safety = plan.activities.get(action_key="safety")
            safeguarding = plan.activities.get(action_key="safeguarding")
            # Two ticks for one action: one action carrying both tasks.
            self.assertEqual(
                set(safety.triage_tasks.values_list("action_code", flat=True)),
                {"safety_plan", "enhanced_observation"},
            )
            self.assertEqual(safeguarding.triage_tasks.count(), 1)
            for activity in (safety, safeguarding):
                self.assertIn(activity.decision, ("ACCEPTED", "ADDED"))
                self.assertTrue(any("Started at triage" in w for w in activity.why))
            row = plan_views._activity_row(safety)
        self.assertEqual(len(row["triage_tasks"]), 2)
        self.assertEqual(row["triage_tasks"][0]["status"], "INITIATED")

    def test_actions_without_a_care_plan_home_stay_tasks_and_open_their_screen(self):
        self.register_tasks("safety_plan", "suicide_risk_assessment", "comprehensive_intake")
        with platform_admin_context():
            sra = self.task("suicide_risk_assessment")
            intake = self.task("comprehensive_intake")
            safety = self.task("safety_plan")
        self.assertIsNone(sra.care_plan_activity_id)
        self.assertEqual(triage_care_plan.task_link(sra), f"/clinical/triage/{self.te_id}")
        self.assertEqual(triage_care_plan.task_link(intake), f"/clinical/clients/{self.pid}/intake")
        self.assertEqual(
            triage_care_plan.task_link(safety),
            f"/clinical/clients/{self.pid}/interventions?module=observation_safety",
        )

    def test_recording_the_work_moves_and_completes_the_task(self):
        self.register_tasks("safeguarding_intervention")
        with platform_admin_context():
            activity = self.plan().activities.get(action_key="safeguarding")
            patient = activity.care_plan.patient
            services.record_intervention(
                self.nurse,
                patient,
                {"intervention": "Safeguarding review", "module": "psychosocial_support"},
                activity=activity,
            )
            self.assertEqual(self.task("safeguarding_intervention").status, "PENDING")
            services.record_intervention(
                self.nurse,
                patient,
                {
                    "intervention": "Safeguarding action recorded",
                    "module": "psychosocial_support",
                    "completes_activity": True,
                },
                activity=activity,
            )
            task = self.task("safeguarding_intervention")
        self.assertEqual(task.status, "COMPLETED")
        self.assertEqual(task.completed_by_id, self.nurse.pk)

    def test_signing_the_safety_plan_completes_only_the_safety_plan_task(self):
        self.register_tasks("safety_plan", "enhanced_observation")
        with platform_admin_context():
            patient = self.plan().patient
            done = triage_care_plan.safety_plan_signed(patient, self.nurse)
            self.assertEqual(done, 1)
            self.assertEqual(self.task("safety_plan").status, "COMPLETED")
            self.assertEqual(self.task("enhanced_observation").status, "INITIATED")

    def test_a_declined_action_is_accepted_again_when_ticked_at_triage(self):
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            plan, _ = CarePlan.objects.get_or_create(
                episode=te.episode,
                defaults={"organization_id": te.organization_id, "patient": te.patient},
            )
            plan.activities.create(
                organization_id=plan.organization_id,
                action_key="safeguarding",
                title="Safeguarding",
                decision="DECLINED",
                reason="Not indicated at the time",
            )
        self.register_tasks("safeguarding_intervention")
        with platform_admin_context():
            activity = self.plan().activities.get(action_key="safeguarding")
        self.assertEqual(activity.decision, "ADDED")
        self.assertEqual(activity.triage_tasks.count(), 1)
