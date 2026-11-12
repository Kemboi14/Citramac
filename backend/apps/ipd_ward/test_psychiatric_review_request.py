from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway.models import CareTask
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context

from .models import Admission, Bed, Ward
from .tests import active_legal_status


class PsychiatricReviewRequestTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            from apps.client_registry.models import Patient
            from apps.tenancy.models import Organization

            self.org = Organization.objects.create(
                name="Review Org", slug="review-org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Amina",
                last_name="Kamau",
                gender="FEMALE",
                date_of_birth="1992-03-14",
            )
            self.nurse = User.objects.create_user(
                email="review-nurse@org.test",
                password="test-password",
                organization=self.org,
                is_active=True,
                first_name="Jane",
                last_name="Njoroge",
            )
            self.ward = Ward.objects.create(organization=self.org, name="Psychiatric Ward")
            self.bed = Bed.objects.create(organization=self.org, ward=self.ward, bed_number="R1")
            self.psych = User.objects.create_user(
                email="review-psychiatrist@org.test",
                password="test-password",
                organization=self.org,
                is_active=True,
                first_name="Wanjiru",
                last_name="Otieno",
            )
            nurse_role, _ = Role.objects.get_or_create(
                organization=None,
                name="Nurse",
                defaults={"scope": Role.SCOPE_ORG_TEMPLATE},
            )
            psychiatrist_role, _ = Role.objects.get_or_create(
                organization=None,
                name="Psychiatrist",
                defaults={"scope": Role.SCOPE_ORG_TEMPLATE},
            )
            self.nurse.roles.add(nurse_role)
            self.psych.roles.add(psychiatrist_role)
        self.nurse_access, _ = issue_tokens(self.nurse)
        self.psych_access, _ = issue_tokens(self.psych)
        self.nurse_auth = {"HTTP_AUTHORIZATION": f"Bearer {self.nurse_access}"}
        self.psych_auth = {"HTTP_AUTHORIZATION": f"Bearer {self.psych_access}"}

    def admit(self):
        active_legal_status(self.patient, self.nurse)
        response = self.client.post(
            reverse("ipd-admission-list"),
            {"patient": str(self.patient.id), "bed": str(self.bed.id)},
            format="json",
            **self.nurse_auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            return Admission.objects.get(pk=response.data["id"])

    def request_url(self, admission):
        return reverse("ipd-admission-psychiatric-review", args=[admission.id])

    def test_nurse_request_creates_one_episode_linked_task_and_hides_sbar_from_request_response(
        self,
    ):
        admission = self.admit()
        first = self.client.post(self.request_url(admission), **self.nurse_auth)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertNotIn("sbar", first.data)

        again = self.client.post(self.request_url(admission), **self.nurse_auth)
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(first.data["id"], again.data["id"])

        with platform_admin_context():
            task = CareTask.objects.get(pk=first.data["id"])
            self.assertEqual(
                (task.patient_id, task.encounter_id, task.episode_id, task.created_by_id),
                (
                    admission.patient_id,
                    admission.encounter_id,
                    admission.episode_id,
                    self.nurse.id,
                ),
            )
            self.assertTrue(task.sbar.startswith("SITUATION"))
            audit = AuditLogEntry.objects.filter(
                model="care_pathway.caretask", object_id=str(task.id)
            ).first()
        self.assertNotIn("SITUATION", str(audit.field_diff))
        self.assertIn("[clinical content ", str(audit.field_diff))

    def test_only_senior_clinicians_see_and_complete_the_request(self):
        admission = self.admit()
        created = self.client.post(self.request_url(admission), **self.nurse_auth)
        task_id = created.data["id"]

        nurse_inbox = self.client.get(reverse("care-decisions"), **self.nurse_auth)
        self.assertEqual(nurse_inbox.status_code, 200)
        self.assertNotIn(task_id, [row["id"] for row in nurse_inbox.data["results"]])

        inbox = self.client.get(reverse("care-decisions"), **self.psych_auth)
        self.assertEqual(inbox.status_code, 200, inbox.data)
        review = next(row for row in inbox.data["results"] if row["id"] == task_id)
        self.assertEqual(review["inbox_kind"], "psychiatric_review")
        self.assertTrue(review["sbar"].startswith("SITUATION"))
        generic_patch = self.client.patch(
            reverse("care-task", args=[task_id]),
            {"status": "COMPLETED"},
            format="json",
            **self.psych_auth,
        )
        self.assertEqual(generic_patch.status_code, 400)

        start_url = reverse("care-psychiatric-review-request-start", args=[task_id])
        started = self.client.post(start_url, **self.psych_auth)
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data["status"], "PENDING")
        self.assertEqual(self.client.post(start_url, **self.nurse_auth).status_code, 403)

        complete_url = reverse("care-psychiatric-review-request-complete", args=[task_id])
        self.assertEqual(
            self.client.post(
                complete_url, {"outcome": "unknown"}, format="json", **self.psych_auth
            ).status_code,
            400,
        )
        completed = self.client.post(
            complete_url,
            {"outcome": "managed_here", "outcome_note": "Reviewed in the ward."},
            format="json",
            **self.psych_auth,
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        self.assertEqual(
            (completed.data["status"], completed.data["outcome"], completed.data["decided_by"]),
            ("COMPLETED", "managed_here", "Wanjiru Otieno"),
        )
        with platform_admin_context():
            task = CareTask.objects.get(pk=task_id)
            events = [
                row.field_diff.get("event")
                for row in AuditLogEntry.objects.filter(
                    model="care_pathway.caretask", object_id=str(task.id)
                )
                if row.field_diff.get("event")
            ]
        self.assertEqual(events, ["RAISED", "STARTED", "COMPLETED"])

        nurse_bundle = self.client.get(
            reverse("ipd-admission-fhir", args=[admission.id]), **self.nurse_auth
        )
        self.assertNotIn(
            "Task", [entry["resource"]["resourceType"] for entry in nurse_bundle.data["entry"]]
        )
        psych_bundle = self.client.get(
            reverse("ipd-admission-fhir", args=[admission.id]), **self.psych_auth
        )
        self.assertEqual(validate_bundle(psych_bundle.data), {})
        task_resource = next(
            entry["resource"]
            for entry in psych_bundle.data["entry"]
            if entry["resource"]["resourceType"] == "Task"
        )
        self.assertEqual(
            task_resource["meta"]["profile"][0],
            "https://fhir.dha.go.ke/core/StructureDefinition/kenya-core-task",
        )
        self.assertEqual(task_resource["status"], "completed")
        self.assertEqual(
            task_resource["requester"]["reference"],
            f"Practitioner/{self.nurse.id}",
        )
        self.assertTrue(task_resource["meta"]["security"])
        self.assertEqual(
            task_resource["output"][0]["valueCodeableConcept"]["coding"][0]["code"],
            "managed_here",
        )

    def test_request_requires_clinical_permission_and_active_admission(self):
        admission = self.admit()
        with platform_admin_context():
            self.nurse.roles.clear()
        self.assertEqual(
            self.client.post(self.request_url(admission), **self.nurse_auth).status_code, 403
        )
        with platform_admin_context():
            admission.status = "DISCHARGED"
            admission.save(update_fields=["status"])
            self.nurse.roles.add(Role.objects.get(name="Nurse", organization=None))
        self.assertEqual(
            self.client.post(self.request_url(admission), **self.nurse_auth).status_code, 400
        )
