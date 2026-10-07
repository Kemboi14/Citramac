"""docs/15-CLINICAL-WORKSPACE-V3.md — care pathway behaviour."""

import uuid
from datetime import timedelta
from decimal import Decimal

from django.test import SimpleTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import AllergyRecord, Patient
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.ipd_ward.models import Bed, Ward
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization
from apps.triage.models import VitalSigns

from . import triage_rules
from .models import (
    BillingService,
    ChargeItem,
    ClinicalAlert,
    EpisodeStatusHistory,
    LocalValueSet,
    TriageAssessment,
    TriageEncounter,
)

CORE_NO = {
    "d_suicidal": "no",
    "e_thoughts": "no",
    "f_change": "no",
    "h_concern": "no",
    "i_safe": "yes",
    "j_concern": "no",
}


class TriageRulesTests(SimpleTestCase):
    def test_unanswered_core_screens_are_never_negative(self):
        result = triage_rules.evaluate({})
        self.assertFalse(result["ready"])
        self.assertEqual(result["recommendation"], "Review required")
        self.assertEqual(result["summary_priority"], "pending")
        self.assertEqual(len(result["unanswered"]), 6)

    def test_completed_negative_screen_is_green(self):
        result = triage_rules.evaluate(CORE_NO)
        self.assertTrue(result["ready"])
        self.assertEqual(result["recommendation"], "GREEN")

    def test_suicidal_with_intent_is_red_and_preliminary_until_complete(self):
        result = triage_rules.evaluate({"d_suicidal": "yes", "d_act_now": "yes"})
        self.assertEqual(result["recommendation"], "RED — preliminary")
        self.assertEqual(result["alerts"][0]["code"], "SUICIDE_RISK")
        complete = triage_rules.evaluate({**CORE_NO, "d_suicidal": "yes", "d_act_now": "yes"})
        self.assertEqual(complete["recommendation"], "RED")

    def test_uncertain_answer_requires_clinical_review(self):
        result = triage_rules.evaluate({**CORE_NO, "e_thoughts": "unable"})
        self.assertFalse(result["ready"])
        self.assertIn("Clinical review required", [row[0] for row in result["findings"]])

    def test_abnormal_vitals_raise_red(self):
        result = triage_rules.evaluate({**CORE_NO, "h_bp": "170/90"})
        self.assertEqual(result["priority"], "RED")
        self.assertIn("ABNORMAL_VITALS", [a["code"] for a in result["alerts"]])

    def test_functional_concern_is_yellow(self):
        self.assertEqual(
            triage_rules.evaluate({**CORE_NO, "j_concern": "yes"})["recommendation"], "YELLOW"
        )

    def test_telephone_emergency_only_counts_when_not_present(self):
        present = triage_rules.evaluate({**CORE_NO, "k_emergency": "yes"})
        self.assertEqual(present["priority"], "GREEN")
        absent = triage_rules.evaluate({**CORE_NO, "b_present": "no", "k_emergency": "yes"})
        self.assertEqual(absent["priority"], "RED")


class CarePathwayApiTestCase(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug=f"org-{uuid.uuid4().hex[:6]}", facility_type="MENTAL_HEALTH_MHP"
            )
            self.nurse = User.objects.create_user(
                email=f"nurse-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                first_name="Jane",
                last_name="Njoroge",
            )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.nurse)[0]}"}

    def register(self, **data):
        payload = {
            "client_request_id": str(uuid.uuid4()),
            "identity_status": "IDENTIFIED",
            "full_name": "Amina Wanjiku Kamau",
            "sex": "FEMALE",
            "date_of_birth": "1992-03-14",
            "reason": "Low mood, drinking more",
            **data,
        }
        return self.client.post(reverse("care-registrations"), payload, format="json", **self.auth)

    def sign(self, te_id, answers, priority="GREEN", **extra):
        return self.client.post(
            reverse("care-triage-sign", args=[te_id]),
            {"answers": answers, "final_priority": priority, "decision": "CONFIRM", **extra},
            format="json",
            **self.auth,
        )


class RegistrationTests(CarePathwayApiTestCase):
    def test_registration_opens_episode_and_triage_encounter_due_in_ten_minutes(self):
        response = self.register(
            allergy_status="ACTIVE_ALLERGIES", allergy_details="Penicillin; latex"
        )
        self.assertEqual(response.status_code, 201)
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=response.data["triage_encounter_id"])
            self.assertEqual(te.status, "AWAITING")
            self.assertEqual(te.episode.status, "waitlist")
            self.assertEqual(te.due_at - te.arrival_at, timedelta(minutes=10))
            self.assertEqual(te.encounter.episode_id, te.episode_id)
            self.assertEqual(te.patient.first_name, "Amina")
            self.assertEqual(te.patient.last_name, "Kamau")
            allergies = AllergyRecord.objects.filter(patient=te.patient)
            self.assertEqual(
                sorted(allergies.values_list("substance", flat=True)), ["Penicillin", "latex"]
            )
            self.assertTrue(all(a.verification_status == "UNCONFIRMED" for a in allergies))
            self.assertEqual(EpisodeStatusHistory.objects.filter(episode=te.episode).count(), 1)

    def test_registration_is_idempotent_on_request_id(self):
        request_id = str(uuid.uuid4())
        first = self.register(client_request_id=request_id)
        second = self.register(client_request_id=request_id)
        self.assertEqual(first.data["triage_encounter_id"], second.data["triage_encounter_id"])

    def test_identified_needs_a_name_and_unidentified_a_description(self):
        self.assertEqual(self.register(full_name="").status_code, 400)
        self.assertEqual(
            self.register(identity_status="UNIDENTIFIED", full_name="").status_code, 400
        )
        ok = self.register(
            identity_status="UNIDENTIFIED", full_name="", description="Adult in blue jacket"
        )
        self.assertEqual(ok.status_code, 201)

    def test_unknown_identity_gets_a_generated_name(self):
        response = self.register(identity_status="UNKNOWN", full_name="", date_of_birth="")
        banner = self.client.get(
            reverse("care-client-banner", args=[response.data["patient_id"]]), **self.auth
        )
        self.assertTrue(banner.data["name"].startswith("Unknown person ("))
        self.assertEqual(banner.data["allergy"]["state"], "unknown")

    def test_returning_client_gets_a_new_encounter_in_the_same_episode(self):
        first = self.register()
        second = self.register(patient_id=first.data["patient_id"])
        with platform_admin_context():
            a = TriageEncounter.objects.get(pk=first.data["triage_encounter_id"])
            b = TriageEncounter.objects.get(pk=second.data["triage_encounter_id"])
        self.assertNotEqual(a.id, b.id)
        self.assertEqual(a.episode_id, b.episode_id)
        self.assertEqual(b.visit_number, 2)

    def test_search_returns_registration_details_only(self):
        self.register(phone="+254712345678")
        response = self.client.get(
            reverse("care-registration-search"), {"q": "0712345"}, **self.auth
        )
        self.assertEqual(response.data["results"], [])
        response = self.client.get(
            reverse("care-registration-search"), {"q": "712345"}, **self.auth
        )
        row = response.data["results"][0]
        self.assertEqual(row["name"], "Amina Wanjiku Kamau")
        self.assertNotIn("diagnosis", row)


class TriageFlowTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.te_id = self.register().data["triage_encounter_id"]

    def test_draft_is_saved_server_side_and_returns_live_evaluation(self):
        response = self.client.put(
            reverse("care-triage-draft", args=[self.te_id]),
            {"answers": {"d_suicidal": "yes"}},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["evaluation"]["recommendation"], "ORANGE — preliminary")
        detail = self.client.get(reverse("care-triage", args=[self.te_id]), **self.auth)
        self.assertEqual(detail.data["status"], "IN_TRIAGE")
        self.assertEqual(detail.data["draft"]["answers"], {"d_suicidal": "yes"})

    def test_sign_is_blocked_until_core_screens_and_priority_are_complete(self):
        response = self.sign(self.te_id, {"d_suicidal": "no"})
        self.assertEqual(response.status_code, 400)
        response = self.sign(self.te_id, CORE_NO, priority="")
        self.assertEqual(response.status_code, 400)

    def test_override_requires_a_reason(self):
        response = self.sign(self.te_id, CORE_NO, priority="YELLOW", decision="OVERRIDE")
        self.assertEqual(response.status_code, 400)

    def test_signing_records_priority_alerts_vitals_allergies_and_locks(self):
        answers = {
            **CORE_NO,
            "d_suicidal": "yes",
            "h_bp": "128/82",
            "h_pulse": "88",
            "a_allergy_status": "known",
            "a_allergy_detail": "Penicillin",
            "c_concern": "Low mood and alcohol",
        }
        response = self.sign(self.te_id, answers, priority="ORANGE")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["recommendation"], "ORANGE")
        self.assertEqual(response.data["signed_by"], "Jane Njoroge")
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            self.assertEqual(
                (te.status, te.priority, te.triage_version), ("COMPLETED", "ORANGE", 1)
            )
            self.assertEqual(te.presenting_concern, "Low mood and alcohol")
            self.assertEqual(
                list(
                    ClinicalAlert.objects.filter(patient=te.patient).values_list(
                        "alert_code", flat=True
                    )
                ),
                ["SUICIDE_RISK"],
            )
            vitals = VitalSigns.objects.get(encounter=te.encounter)
            self.assertEqual((vitals.systolic_bp, vitals.heart_rate), (128, 88))
            self.assertEqual(te.patient.allergy_status, "ACTIVE_ALLERGIES")
            assessment = TriageAssessment.objects.get(triage_encounter=te)
            with self.assertRaises(PermissionError):
                assessment.save()
        # A second sign on a completed triage is refused.
        self.assertEqual(self.sign(self.te_id, CORE_NO).status_code, 400)

    def test_tasks_register_from_served_action_codes(self):
        response = self.client.post(
            reverse("care-triage-tasks", args=[self.te_id]),
            {"actions": ["safety_plan", "not_a_code"], "status": "PENDING"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual([t["action_label"] for t in response.data], ["Safety Plan"])
        self.assertEqual(response.data[0]["owner"], "Psychiatry / Nursing")

    def test_recheck_becomes_due_and_signs_measured_observations_only(self):
        self.sign(self.te_id, CORE_NO, priority="YELLOW")
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(
                next_recheck_at=timezone.now() - timedelta(minutes=1)
            )
        worklist = self.client.get(reverse("care-triage-worklist"), **self.auth)
        self.assertEqual(worklist.data["results"][0]["status"], "RECHECK_DUE")
        self.assertFalse(worklist.data["results"][0]["is_overdue"])

        bad = self.client.post(
            reverse("care-recheck-sign", args=[self.te_id]),
            {
                "change_since_last_check": "NO_CHANGE",
                "observations": {"heartRate": {"status": "MEASURED", "value": ""}},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(bad.status_code, 400)
        ok = self.client.post(
            reverse("care-recheck-sign", args=[self.te_id]),
            {
                "change_since_last_check": "NO_CHANGE",
                "distress_behaviour": "LOW",
                "observations": {
                    "heartRate": {"status": "MEASURED", "value": "92"},
                    "temperature": {"status": "NOT_REPEATED", "value": ""},
                },
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(ok.status_code, 201)
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            self.assertEqual(te.status, "RECHECK_COMPLETED")
            self.assertGreater(te.next_recheck_at, timezone.now())
            self.assertEqual(
                VitalSigns.objects.filter(encounter=te.encounter).last().heart_rate, 92
            )

    def test_psychiatry_queue_orders_by_priority_and_review_activates_episode(self):
        self.sign(self.te_id, CORE_NO, priority="GREEN")
        red_id = self.register(full_name="David Otieno").data["triage_encounter_id"]
        self.sign(red_id, {**CORE_NO, "d_suicidal": "yes", "d_act_now": "yes"}, priority="RED")
        queue = self.client.get(reverse("care-psych-queue"), **self.auth).data["results"]
        self.assertEqual([row["priority"] for row in queue], ["RED", "GREEN"])

        response = self.client.post(reverse("care-open-review", args=[red_id]), **self.auth)
        self.assertEqual(response.status_code, 200)
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=red_id)
            self.assertEqual(te.episode.status, "active")
            statuses = list(
                EpisodeStatusHistory.objects.filter(episode=te.episode).values_list(
                    "status", "period_end"
                )
            )
        self.assertEqual([s for s, _ in statuses], ["waitlist", "active"])
        self.assertIsNotNone(statuses[0][1])

    def test_open_review_requires_a_signed_triage(self):
        response = self.client.post(reverse("care-open-review", args=[self.te_id]), **self.auth)
        self.assertEqual(response.status_code, 400)

    def test_triage_fhir_bundle_is_r4_conformant(self):
        self.sign(self.te_id, {**CORE_NO, "d_suicidal": "yes"}, priority="ORANGE")
        self.client.post(
            reverse("care-triage-tasks", args=[self.te_id]),
            {"actions": ["safety_plan"]},
            format="json",
            **self.auth,
        )
        bundle = self.client.get(reverse("care-triage-fhir", args=[self.te_id]), **self.auth).data
        self.assertEqual(validate_bundle(bundle), {})
        types = sorted({entry["resource"]["resourceType"] for entry in bundle["entry"]})
        self.assertEqual(
            types,
            [
                "Encounter",
                "EpisodeOfCare",
                "Flag",
                "Patient",
                "Provenance",
                "QuestionnaireResponse",
                "RiskAssessment",
                "Task",
            ],
        )


class JourneyAndBillingTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        response = self.register()
        self.patient_id = response.data["patient_id"]
        self.te_id = response.data["triage_encounter_id"]
        self.sign(self.te_id, {**CORE_NO, "d_suicidal": "yes"}, priority="ORANGE")

    def test_care_plan_suggests_actions_from_active_alerts(self):
        plan = self.client.get(
            reverse("care-client-care-plan", args=[self.patient_id]), **self.auth
        )
        self.assertIn("suicide risk", plan.data["recommendation"])
        self.assertEqual(plan.data["suggestions"][0]["title"], "Safety plan / enhanced observation")

    def test_intake_mse_is_stored_once_in_the_mse_table(self):
        from apps.triage.models import MentalStatusExam

        response = self.client.post(
            reverse("care-client-intake", args=[self.patient_id]),
            {"mse_mood": "Anxious", "mse_affect": "Restricted"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["mse_mood"], "Anxious")
        with platform_admin_context():
            exam = MentalStatusExam.objects.get(pk=response.data["mse"])
        self.assertEqual((exam.mood, exam.affect), ("Anxious", "Restricted"))

    def test_intake_records_outcome_scores(self):
        response = self.client.post(
            reverse("care-client-intake", args=[self.patient_id]),
            {"presenting_concern": "Anxiety", "gad7_score": 14, "phq9_score": 8},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        outcomes = self.client.get(
            reverse("care-client-outcomes", args=[self.patient_id]), **self.auth
        ).data["results"]
        self.assertEqual(sorted(o["instrument"] for o in outcomes), ["GAD7", "PHQ9"])
        too_high = self.client.post(
            reverse("care-client-intake", args=[self.patient_id]),
            {"gad7_score": 30},
            format="json",
            **self.auth,
        )
        self.assertEqual(too_high.status_code, 400)

    def _activity(self):
        return self.client.post(
            reverse("care-client-activities", args=[self.patient_id]),
            {"title": "Psychological therapy", "goal": "CBT", "module": "THERAPY"},
            format="json",
            **self.auth,
        ).data["id"]

    def test_billable_intervention_creates_charge_and_unpriced_services_are_reported(self):
        activity = self._activity()
        with platform_admin_context():
            service = BillingService.objects.get(organization=self.org, name="Psychotherapy")
        response = self.client.post(
            reverse("care-client-interventions", args=[self.patient_id]),
            {
                "activity": activity,
                "intervention": "CBT session",
                "billable": True,
                "billing_service": str(service.id),
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        billing = self.client.get(reverse("care-billing"), **self.auth).data
        self.assertEqual(billing["events"], [])
        self.assertEqual(billing["unpriced_services"], ["Psychotherapy"])

        with platform_admin_context():
            service.rate = Decimal("5000")
            service.save()
        self.client.post(
            reverse("care-client-interventions", args=[self.patient_id]),
            {
                "activity": activity,
                "intervention": "CBT session 2",
                "billable": True,
                "billing_service": str(service.id),
            },
            format="json",
            **self.auth,
        )
        billing = self.client.get(reverse("care-billing"), **self.auth).data
        self.assertEqual(len(billing["events"]), 1)
        self.assertEqual(billing["events"][0]["status"], "unbilled")
        self.assertEqual(billing["summary"]["unbilled"]["amount"], "5000.00")

    def test_billable_intervention_needs_a_service(self):
        response = self.client.post(
            reverse("care-client-interventions", args=[self.patient_id]),
            {"activity": self._activity(), "intervention": "CBT", "billable": True},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 400)

    def test_only_org_admin_can_change_the_tariff(self):
        with platform_admin_context():
            service = BillingService.objects.get(organization=self.org, name="Admission")
        url = reverse("care-billing-service", args=[service.id])
        self.assertEqual(
            self.client.patch(url, {"rate": "15000"}, format="json", **self.auth).status_code, 403
        )
        with platform_admin_context():
            self.nurse.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
        self.assertEqual(
            self.client.patch(url, {"rate": "15000"}, format="json", **self.auth).status_code, 200
        )
        self.assertEqual(
            self.client.patch(url, {"rate": "-1"}, format="json", **self.auth).status_code, 400
        )

    def test_admission_joins_the_episode_and_records_an_admission_charge(self):
        with platform_admin_context():
            ward = Ward.objects.create(organization=self.org, name="Ward A")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="12")
        response = self.client.post(
            reverse("ipd-admission-list"),
            {
                "patient": self.patient_id,
                "bed": str(bed.id),
                "admission_type": "VOLUNTARY",
                "clinical_priority": "ORANGE",
                "consent_status": "OBTAINED",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNotNone(response.data["episode"])
        with platform_admin_context():
            self.assertTrue(
                ChargeItem.objects.filter(
                    patient_id=self.patient_id, service__name="Admission"
                ).exists()
            )
        banner = self.client.get(reverse("care-client-banner", args=[self.patient_id]), **self.auth)
        self.assertEqual(banner.data["setting"]["type"], "INPATIENT")
        self.assertEqual(banner.data["priority"], "ORANGE")

    def test_dashboard_reports_and_record_views_respond(self):
        for name in ("care-dashboard", "care-reports", "care-outpatients", "care-documents"):
            self.assertEqual(self.client.get(reverse(name), **self.auth).status_code, 200, name)
        for name in (
            "care-client-snapshot",
            "care-client-timeline",
            "care-client-vitals",
            "care-client-legal",
            "care-client-billing",
        ):
            response = self.client.get(reverse(name, args=[self.patient_id]), **self.auth)
            self.assertEqual(response.status_code, 200, name)
        dashboard = self.client.get(reverse("care-dashboard"), **self.auth).data
        self.assertEqual(dashboard["red_orange"], 1)
        self.assertEqual(dashboard["psychiatry_queued"], 1)

    def test_consent_needs_facility_wording_and_snapshots_it(self):
        url = reverse("care-client-consent", args=[self.patient_id])
        self.assertEqual(
            self.client.post(url, {"granted": True}, format="json", **self.auth).status_code, 409
        )
        templates = reverse("care-consent-templates")
        payload = {"version": "v1", "text": "Facility-approved wording."}
        self.assertEqual(
            self.client.post(templates, payload, format="json", **self.auth).status_code, 403
        )
        with platform_admin_context():
            self.nurse.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
        self.assertEqual(
            self.client.post(templates, payload, format="json", **self.auth).status_code, 201
        )
        response = self.client.post(url, {"granted": True}, format="json", **self.auth)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["consent_text_version"], "v1")
        legal = self.client.get(reverse("care-client-legal", args=[self.patient_id]), **self.auth)
        self.assertTrue(legal.data["current_consent"]["granted"])
        self.assertEqual(legal.data["data_sharing_consent"][0]["consent_text_version"], "v1")

    def test_alert_can_be_resolved_and_leaves_the_banner(self):
        banner = self.client.get(reverse("care-client-banner", args=[self.patient_id]), **self.auth)
        alert_id = banner.data["alerts"][0]["id"]
        response = self.client.post(reverse("care-alert-resolve", args=[alert_id]), **self.auth)
        self.assertEqual(response.data["status"], "RESOLVED")
        banner = self.client.get(reverse("care-client-banner", args=[self.patient_id]), **self.auth)
        self.assertEqual(banner.data["alerts"], [])

    def test_snapshot_reports_episode_waiting_time(self):
        self.client.post(reverse("care-open-review", args=[self.te_id]), **self.auth)
        snapshot = self.client.get(
            reverse("care-client-snapshot", args=[self.patient_id]), **self.auth
        ).data
        self.assertEqual(snapshot["episode"]["status"], "active")
        self.assertIsNotNone(snapshot["episode"]["waiting_minutes"])
        self.assertEqual(
            [h["status"] for h in snapshot["episode"]["history"]], ["waitlist", "active"]
        )

    def test_valuesets_are_served_from_the_database(self):
        response = self.client.get(
            reverse("care-valuesets"), {"ids": "triage-priority,payer"}, **self.auth
        )
        self.assertEqual(sorted(response.data), ["payer", "triage-priority"])
        self.assertTrue(LocalValueSet.objects.filter(id="triage-action").exists())


class NewOrganizationTariffTests(SimpleTestCase):
    def test_service_names_cover_the_mockup_list(self):
        from .valuesets import BILLING_SERVICE_NAMES

        self.assertEqual(len(BILLING_SERVICE_NAMES), 14)
        self.assertIn("Follow-up & After-care", BILLING_SERVICE_NAMES)


class PatientNameTests(SimpleTestCase):
    def test_unidentified_name_falls_back_to_record_number(self):
        patient = Patient(identity_status="UNIDENTIFIED", citramac_number="202610ORG-001")
        self.assertEqual(patient.get_full_name(), "Unidentified person (202610ORG-001)")
