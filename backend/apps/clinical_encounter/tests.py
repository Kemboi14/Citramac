from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.models import IcdCodeIndex
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Encounter


class ClinicalEncounterAndTriageTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.2-7.3, docs/10-API-SPECIFICATION.md §10.5."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.clinician = User.objects.create_user(
                email="doc@org.test", password="Password123!", organization=self.org, is_active=True
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def _open_encounter(self):
        response = self.client.post(
            reverse("encounter-list"),
            {"patient": str(self.patient.id), "encounter_type": "OUTPATIENT"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def _add_diagnosis(self, encounter_id, code, primary=True):
        return self.client.post(
            reverse("diagnosis-code-list"),
            {"encounter": encounter_id, "icd11_code": code, "is_primary": primary},
            format="json",
            **self.auth,
        )

    def test_outpatient_encounter_joins_the_clients_episode(self):
        """CLAUDE.md §4: every encounter hangs off an EpisodeOfCare."""
        from apps.care_pathway.models import EpisodeOfCare

        first = self._open_encounter()
        second = self._open_encounter()
        with platform_admin_context():
            episodes = EpisodeOfCare.objects.filter(patient=self.patient)
            self.assertEqual(episodes.count(), 1)
            for encounter_id in (first, second):
                self.assertEqual(Encounter.objects.get(pk=encounter_id).episode, episodes.get())

    def test_only_an_outpatient_visit_can_be_opened_here(self):
        response = self.client.post(
            reverse("encounter-list"),
            {"patient": str(self.patient.id), "encounter_type": "PSYCHOTHERAPY"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("encounter_type", response.data)

    def test_encounter_who_and_type_cannot_be_changed(self):
        """The SHR decides what may leave the facility from these; no update path."""
        encounter_id = self._open_encounter()
        url = reverse("encounter-detail", args=[encounter_id])
        for method in (self.client.patch, self.client.put):
            response = method(url, {"encounter_type": "INPATIENT"}, format="json", **self.auth)
            self.assertEqual(response.status_code, 405)

    def test_close_sets_finished_time(self):
        encounter_id = self._open_encounter()
        response = self.client.post(reverse("encounter-close", args=[encounter_id]), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "CLOSED")
        self.assertIsNotNone(response.data["closed_at"])

    def test_reading_an_encounter_is_audited(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        encounter_id = self._open_encounter()
        self.client.get(reverse("encounter-detail", args=[encounter_id]), **self.auth)
        self.client.get(reverse("encounter-list") + f"?patient={self.patient.id}", **self.auth)
        with platform_admin_context():
            views = AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_VIEW, model="clinical_encounter.encounter"
            )
            self.assertTrue(views.filter(object_id=encounter_id).exists())
            self.assertTrue(views.filter(object_id="list").exists())

    def test_diagnosis_requires_valid_icd11_fk(self):
        encounter_id = self._open_encounter()
        with platform_admin_context():
            code = IcdCodeIndex.objects.get(code="6A70")
        response = self._add_diagnosis(encounter_id, code.code)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["recorded_by"], self.clinician.id)

        bad_response = self._add_diagnosis(encounter_id, "NOT-A-REAL-CODE", False)
        self.assertEqual(bad_response.status_code, 400)

    def test_encounter_is_tenant_isolated(self):
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other", slug="other", facility_type="CLINIC"
            )
            other_clinician = User.objects.create_user(
                email="other@other.test",
                password="Password123!",
                organization=other_org,
                is_active=True,
            )
        other_access, _ = issue_tokens(other_clinician)

        encounter_id = self._open_encounter()
        response = self.client.get(
            reverse("encounter-detail", args=[encounter_id]),
            HTTP_AUTHORIZATION=f"Bearer {other_access}",
        )
        self.assertEqual(response.status_code, 404)

    def test_diagnosis_list_is_filterable_by_patient_across_encounters(self):
        """Diagnoses tab — cross-encounter, patient-scoped diagnosis list."""
        with platform_admin_context():
            code = IcdCodeIndex.objects.get(code="6A70")

        self._add_diagnosis(self._open_encounter(), code.code)
        self._add_diagnosis(self._open_encounter(), code.code, False)

        response = self.client.get(
            reverse("diagnosis-code-list") + f"?patient={self.patient.id}", **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["results"][0]["patient"], str(self.patient.id))

    def test_diagnosis_detail_fields_are_editable_after_creation(self):
        with platform_admin_context():
            code = IcdCodeIndex.objects.get(code="6A70")
        encounter_id = self._open_encounter()
        diagnosis_id = self._add_diagnosis(encounter_id, code.code).data["id"]

        response = self.client.patch(
            reverse("diagnosis-code-detail", args=[diagnosis_id]),
            {
                "clinical_notes": "Client presents with excessive worry more days than not.",
                "diagnostic_criteria_met": "Excessive anxiety; difficulty controlling worry.",
                "status": "HISTORICAL",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "HISTORICAL")
        self.assertIn("excessive worry", response.data["clinical_notes"])

        with platform_admin_context():
            other = IcdCodeIndex.objects.exclude(code=code.code).first()
        for field, value in (("icd11_code", other.code), ("encounter", self._open_encounter())):
            response = self.client.patch(
                reverse("diagnosis-code-detail", args=[diagnosis_id]),
                {field: value},
                format="json",
                **self.auth,
            )
            self.assertEqual(response.status_code, 400, field)

    def test_encounter_list_filters_by_patient(self):
        self._open_encounter()
        with platform_admin_context():
            other_patient = Patient.objects.create(
                organization=self.org,
                first_name="Other",
                last_name="Client",
                gender="MALE",
                date_of_birth="1990-01-01",
                citramac_number="TEST-OTHER-001",
            )
        self.client.post(
            reverse("encounter-list"),
            {"patient": str(other_patient.id), "encounter_type": "OUTPATIENT"},
            format="json",
            **self.auth,
        )

        response = self.client.get(
            reverse("encounter-list") + f"?patient={self.patient.id}", **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(str(response.data["results"][0]["patient"]), str(self.patient.id))


class EnteredInErrorTests(ClinicalEncounterAndTriageTests):
    """R4 entered-in-error: the only correction for a record whose subject or code
    is fixed. Needs a reason, is audited, and takes it out of what is shared."""

    def _mark(self, name, pk, reason="Opened on the wrong client"):
        return self.client.post(
            reverse(name, args=[pk]), {"reason": reason}, format="json", **self.auth
        )

    def test_an_encounter_in_error_takes_its_diagnoses_with_it_and_is_audited(self):
        from apps.dha_interop.fhir_mapper import build_condition_resource
        from apps.sysadmin_audit.models import AuditLogEntry

        from .models import DiagnosisCode

        encounter_id = self._open_encounter()
        dx = self._add_diagnosis(encounter_id, "6A70").data
        self.assertEqual(
            self._mark("encounter-entered-in-error", encounter_id, "x").status_code, 400
        )
        marked = self._mark("encounter-entered-in-error", encounter_id)
        self.assertEqual(marked.status_code, 200, marked.data)
        self.assertEqual(marked.data["status"], "ENTERED_IN_ERROR")
        self.assertEqual(self._mark("encounter-entered-in-error", encounter_id).status_code, 400)
        closed = self.client.post(reverse("encounter-close", args=[encounter_id]), **self.auth)
        self.assertEqual(closed.status_code, 400)
        with platform_admin_context():
            diagnosis = DiagnosisCode.objects.get(pk=dx["id"])
            self.assertEqual(diagnosis.verification_status, "ENTERED_IN_ERROR")
            condition = build_condition_resource(diagnosis, "urn:citramac:patient:x")
            self.assertEqual(condition.verificationStatus.coding[0].code, "entered-in-error")
            self.assertIsNone(condition.clinicalStatus)
            entry = AuditLogEntry.objects.get(
                model="clinical_encounter.encounter",
                object_id=encounter_id,
                field_diff__has_key="entered_in_error",
            )
            self.assertEqual(entry.field_diff["entered_in_error"], "Opened on the wrong client")
            self.assertEqual(entry.field_diff["diagnoses"], [dx["id"]])

    def test_a_diagnosis_in_error_needs_the_action_and_is_then_frozen(self):
        encounter_id = self._open_encounter()
        dx = self._add_diagnosis(encounter_id, "6A70").data
        url = reverse("diagnosis-code-detail", args=[dx["id"]])
        direct = self.client.patch(
            url, {"verification_status": "ENTERED_IN_ERROR"}, format="json", **self.auth
        )
        self.assertEqual(direct.status_code, 400)
        marked = self._mark("diagnosis-code-entered-in-error", dx["id"], "Wrong code chosen")
        self.assertEqual(marked.data["verification_status"], "ENTERED_IN_ERROR")
        self.assertEqual(marked.data["error_reason"], "Wrong code chosen")
        edit = self.client.patch(url, {"clinical_notes": "x"}, format="json", **self.auth)
        self.assertEqual(edit.status_code, 400)
