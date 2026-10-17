"""v4 Interventions workspace: module records, billing from the module's tariff
line, corrections (void), the workspace endpoint and its recommendations."""

from decimal import Decimal

from django.urls import reverse

from apps.client_registry.models import Patient
from apps.ipd_ward.models import Admission, Bed, Ward
from apps.tenancy.context import platform_admin_context

from .models import BillingService, CarePlanActivity, ChargeItem, ClinicalAlert, InterventionRecord
from .test_care_plan import CarePlanTestCase


class InterventionWorkspaceTests(CarePlanTestCase):
    def record(self, auth=None, **body):
        payload = {"module": "psychotherapy", "intervention": "CBT session", "note": "Session 1", **body}
        return self.client.post(
            reverse("care-client-interventions", args=[self.pid]), payload, format="json",
            **(auth or self.auth),
        )

    def activity(self):
        return self.client.post(
            reverse("care-client-activities", args=[self.pid]),
            {"title": "Psychological therapy", "goal": "CBT", "module": "THERAPY"},
            format="json", **self.auth,
        ).data["id"]

    def workspace(self):
        response = self.client.get(
            reverse("care-client-interventions-workspace", args=[self.pid]), **self.auth
        )
        self.assertEqual(response.status_code, 200)
        return response.data

    def void(self, record_id, reason, auth=None):
        return self.client.post(
            reverse("care-intervention-void", args=[record_id]), {"reason": reason}, format="json",
            **(auth or self.auth),
        )

    def set_rate(self, name, rate):
        with platform_admin_context():
            BillingService.objects.filter(organization=self.org, name=name).update(rate=rate)

    def test_a_record_need_not_be_linked_to_a_care_plan_action(self):
        response = self.record(module="psychiatry", intervention="Psychiatric review", note="Reviewed")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["activity"])
        self.assertEqual(response.data["activity_title"], "")
        self.assertEqual(response.data["module"], "psychiatry")

    def test_delivery_marks_the_action_active_and_completes_it_when_ticked(self):
        activity_id = self.activity()
        self.assertEqual(self.record(activity=activity_id).status_code, 201)
        with platform_admin_context():
            self.assertEqual(CarePlanActivity.objects.get(pk=activity_id).status, "ACTIVE")
        self.assertEqual(self.record(activity=activity_id, completes_activity=True).status_code, 201)
        with platform_admin_context():
            self.assertEqual(CarePlanActivity.objects.get(pk=activity_id).status, "COMPLETED")

    def test_a_module_with_a_tariff_line_creates_its_charge_automatically(self):
        response = self.record(billable=False, quantity=2)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["billable"])
        self.assertEqual(response.data["billing_service_name"], "Psychotherapy")
        unpriced = self.record(module="observation_safety", intervention="Observation review", note="Calm")
        self.assertFalse(unpriced.data["billable"])
        with platform_admin_context():
            charges = ChargeItem.objects.filter(patient_id=self.pid)
            self.assertEqual(charges.count(), 1)
            self.assertEqual(charges[0].quantity, 2)
            self.assertIsNone(charges[0].unit_price)  # no rate configured: reported as unpriced

    def test_admission_and_discharge_deliveries_never_charge_twice(self):
        # Their charge comes from admitting the client / signing the discharge.
        for module, chip in (("admission", "Admission review"), ("discharge", "Discharge planning")):
            response = self.record(module=module, intervention=chip, note="Done")
            self.assertEqual(response.status_code, 201, response.data)
            self.assertFalse(response.data["billable"])
        with platform_admin_context():
            self.assertFalse(ChargeItem.objects.filter(patient_id=self.pid).exists())
        modules = {m["code"]: m for m in self.workspace()["modules"]}
        self.assertEqual(modules["discharge"]["charged_by"], "signing the discharge")
        self.assertFalse(modules["discharge"]["billable"])

    def test_a_voided_record_leaves_billing_and_delivered_counts(self):
        self.set_rate("Psychotherapy", Decimal("5000"))
        record_id = self.record().data["id"]
        self.assertEqual(len(self.client.get(reverse("care-billing"), **self.auth).data["events"]), 1)
        self.assertEqual(self.void(record_id, "no").status_code, 400)
        voided = self.void(record_id, "Recorded against the wrong client")
        self.assertEqual(voided.status_code, 200, voided.data)
        self.assertIsNotNone(voided.data["voided_at"])
        self.assertEqual(voided.data["corrections"][0]["reason"], "Recorded against the wrong client")
        self.assertEqual(self.client.get(reverse("care-billing"), **self.auth).data["events"], [])
        modules = {m["code"]: m for m in self.workspace()["modules"]}
        self.assertEqual(modules["psychotherapy"]["delivered"], 0)
        self.assertEqual(self.void(record_id, "Second correction").status_code, 400)
        with platform_admin_context():
            self.assertTrue(InterventionRecord.objects.filter(pk=record_id).exists())

    def test_only_the_recording_clinician_or_an_org_admin_can_void(self):
        record_id = self.record().data["id"]
        self.assertEqual(self.void(record_id, "Not my record", auth=self.psych_auth).status_code, 403)

    def test_workspace_shape_and_recommendations_for_an_inpatient_in_withdrawal(self):
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            ward = Ward.objects.create(organization=self.org, name="Ward")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="1", status="OCCUPIED")
            Admission.objects.create(organization=self.org, patient=patient, bed=bed, admitted_by=self.nurse)
            ClinicalAlert.objects.create(
                organization=self.org, patient=patient, alert_code="WITHDRAWAL_RISK", label="Withdrawal risk"
            )
        activity_id = self.activity()
        self.record(activity=activity_id)
        self.set_rate("Psychotherapy", Decimal("3000"))

        data = self.workspace()
        self.assertEqual(set(data), {"has_plan", "actions", "modules", "context"})
        action = data["actions"][0]
        self.assertEqual((action["id"], action["records"], action["status"]), (activity_id, 1, "ACTIVE"))
        self.assertTrue(action["latest_by"])
        self.assertEqual(action["modules"], ["psychotherapy", "group_psychotherapy"])
        self.assertIn("Withdrawal risk", data["context"]["alerts"])
        self.assertEqual(data["context"]["goals"], ["Psychological therapy"])
        self.assertEqual(data["context"]["allergies"], "No known allergies")

        modules = {m["code"]: m for m in data["modules"]}
        self.assertEqual(len(modules), 18)
        recommended = {code for code, m in modules.items() if m["recommended"]}
        self.assertTrue(
            {"withdrawal_management", "medical_review", "admission", "psychiatric_nursing", "discharge"}
            <= recommended
        )
        self.assertNotIn("restrictive_practice", recommended)
        self.assertEqual(
            modules["withdrawal_management"]["reason"],
            "Diagnosis, alert, or flag references substance use or withdrawal",
        )
        self.assertEqual(modules["psychotherapy"]["action_id"], activity_id)
        # Group psychotherapy delivers the same therapy action (mockup actionId).
        self.assertEqual(modules["group_psychotherapy"]["action_id"], activity_id)
        self.assertEqual((modules["psychotherapy"]["rate"], modules["psychotherapy"]["delivered"]), ("3000.00", 1))
        self.assertIsNone(modules["observation_safety"]["billing_service"])
        self.assertFalse(modules["observation_safety"]["billable"])
        self.assertEqual(modules["withdrawal_management"]["group"], "Treat")

    def test_module_and_delivery_fields_are_validated(self):
        self.assertEqual(self.record(module="nope").status_code, 400)
        self.assertEqual(self.record(intervention="Not an option").status_code, 400)
        self.assertEqual(self.record(note=" ").status_code, 400)
        self.assertEqual(self.record(quantity=0).status_code, 400)
        self.assertEqual(self.record(completes_activity=True).status_code, 400)
