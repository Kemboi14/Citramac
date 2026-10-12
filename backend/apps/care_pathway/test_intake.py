"""Sectioned intake: served schema, draft → sign lifecycle, carry-forward, restricted content."""

import uuid

from django.urls import reverse

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import AllergyRecord, Patient
from apps.clinical_encounter.models import DiagnosisCode
from apps.dha_interop.models import IcdCodeIndex
from apps.tenancy.context import platform_admin_context

from . import intake_schema
from .models import IntakeAssessment, MedicationHistoryEntry
from .tests import CORE_NO, CarePathwayApiTestCase


class IntakeTestCase(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            role, _ = Role.objects.get_or_create(
                name="Nurse", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
        registered = self.register(allergy_status="NONE")
        self.pid = registered.data["patient_id"]
        self.te_id = registered.data["triage_encounter_id"]

    def sign_triage(self, **answers):
        response = self.sign(self.te_id, {**CORE_NO, **answers}, priority="ORANGE")
        self.assertEqual(response.status_code, 201, response.data)

    def draft(self):
        return self.client.get(reverse("care-client-intake-draft", args=[self.pid]), **self.auth)

    def save(self, sections=None, section_state=None, **extra):
        return self.client.put(
            reverse("care-client-intake-draft", args=[self.pid]),
            {"sections": sections or {}, "section_state": section_state or {}, **extra},
            format="json",
            **self.auth,
        )

    def sign_intake(self, completeness="COMPLETE"):
        return self.client.post(
            reverse("care-client-intake-sign", args=[self.pid]),
            {"completeness": completeness},
            format="json",
            **self.auth,
        )

    def complete_required(self):
        """Fill every item the completeness check demands."""
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            MedicationHistoryEntry.objects.create(
                organization=self.org, patient=patient, name="Sertraline", dose="50 mg"
            )
            code, _ = IcdCodeIndex.objects.get_or_create(
                code="6A70", defaults={"description": "Single episode depressive disorder"}
            )
            from apps.care_pathway import services

            episode = services.get_or_open_episode(patient, self.nurse)
            encounter = services.clinical_encounter_for(patient, episode, self.nurse)
            DiagnosisCode.objects.create(
                organization=self.org, encounter=encounter, icd11_code=code, is_primary=True
            )
        self.save(
            sections={
                "pres": {"own": "Low mood for two months"},
                "mse": {"mood": "Low", "thought_content": "No abnormality"},
            }
        )


class IntakeSchemaTests(IntakeTestCase):
    def test_schema_is_served_with_required_sections_and_risk_rows(self):
        response = self.client.get(reverse("care-intake-schema"), **self.auth)
        self.assertEqual(response.status_code, 200)
        keys = [s["key"] for s in response.data["sections"]]
        self.assertEqual(len(keys), 24)
        self.assertEqual(
            set(response.data["required"]), {"pres", "risk", "meds", "allergy", "mse", "form"}
        )
        self.assertEqual(len(response.data["riskRows"]), 6)

    def test_every_referenced_valueset_is_seeded_and_served(self):
        ids = {
            f["valueset"]
            for section in intake_schema.SECTIONS
            for f in section["fields"]
            if f.get("valueset")
        } | {f"mse-{k.replace('_', '-')}" for k, _l, opts in intake_schema.MSE_DOMAINS if opts}
        served = self.client.get(
            reverse("care-valuesets") + "?ids=" + ",".join(sorted(ids)), **self.auth
        ).data
        self.assertEqual(ids - set(served), set())


class IntakeLifecycleTests(IntakeTestCase):
    def test_first_draft_carries_forward_triage_with_source_and_unconfirmed(self):
        self.sign_triage(d_suicidal="yes", d_means="yes", c_concern="Low mood, drinking more")
        data = self.draft().data
        self.assertEqual(data["status"], "DRAFT")
        sections = data["sections"]
        self.assertEqual(sections["pres"]["own"], "Low mood, drinking more")
        self.assertEqual(sections["pres"]["_sources"]["own"]["stage"], "Triage")
        self.assertEqual(sections["risk"]["rows"]["suicide"], ["Thoughts", "Access to means"])
        self.assertFalse(sections["risk"]["carried"]["suicide:Thoughts"]["confirmed"])

    def test_autosave_merges_sections_and_rejects_unknown_ones(self):
        self.draft()
        self.save(sections={"sx": {"hpi": "Poor sleep"}}, section_state={"sx": "In progress"})
        self.save(sections={"sx": {"onset": "x"}})
        data = self.draft().data
        self.assertEqual(data["sections"]["sx"], {"hpi": "Poor sleep", "onset": "x"})
        self.assertEqual(data["section_overview"]["sx"], "In progress")
        self.assertEqual(self.save(sections={"nope": {}}).status_code, 400)
        self.assertEqual(self.save(section_state={"sx": "Done-ish"}).status_code, 400)

    def test_cannot_sign_complete_with_outstanding_items_and_lists_them(self):
        self.draft()
        response = self.sign_intake()
        self.assertEqual(response.status_code, 400)
        outstanding = response.data["outstanding"]
        self.assertTrue(any("Presenting concern" in item for item in outstanding))
        self.assertTrue(any("Medication" in item for item in outstanding))
        self.assertTrue(any("MSE" in item for item in outstanding))
        self.assertTrue(any("diagnosis" in item for item in outstanding))

    def test_unconfirmed_carried_risk_blocks_completion_until_confirmed(self):
        self.sign_triage(d_suicidal="yes")
        self.draft()
        self.complete_required()
        blocked = self.sign_intake()
        self.assertTrue(
            any("carried-forward" in item for item in blocked.data["outstanding"]), blocked.data
        )
        draft = self.draft().data["sections"]["risk"]
        carried = {k: {**v, "confirmed": True} for k, v in draft["carried"].items()}
        self.save(
            sections={
                "risk": {
                    "carried": carried,
                    "static": "a",
                    "dynamic": "b",
                    "protective": "c",
                    "change_72h": "d",
                    "summary": "e",
                    "formulation_signed_at": "2026-10-12T10:00:00Z",
                }
            }
        )
        self.assertEqual(self.sign_intake().status_code, 200)

    def test_complete_sign_locks_the_version_and_a_correction_is_a_new_version(self):
        self.draft()
        self.complete_required()
        signed = self.sign_intake()
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["status"], "SIGNED")
        self.assertEqual(signed.data["version"], 1)
        # No draft remains, so saving is refused…
        self.assertEqual(self.save(sections={"sx": {"hpi": "x"}}).status_code, 400)
        # …and reopening clones v1 into a v2 draft with nothing re-asked.
        again = self.draft().data
        self.assertEqual((again["status"], again["version"]), ("DRAFT", 2))
        self.assertEqual(again["sections"]["pres"]["own"], "Low mood for two months")
        with platform_admin_context():
            self.assertEqual(IntakeAssessment.objects.filter(patient_id=self.pid).count(), 2)

    def test_partial_sign_needs_a_reason_and_a_handover_message(self):
        self.draft()
        self.assertEqual(self.sign_intake("PARTIAL").status_code, 400)
        self.save(
            sections={
                "close": {"reason_incomplete": "Client left", "message": "Complete MSE tomorrow"}
            }
        )
        response = self.sign_intake("PARTIAL")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["completeness"], "PARTIAL")
        self.assertTrue(response.data["outstanding"])

    def test_unconfirmed_allergy_is_outstanding(self):
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            AllergyRecord.objects.create(
                organization=self.org,
                patient=patient,
                substance="Penicillin",
                verification_status="UNCONFIRMED",
            )
        data = self.draft().data
        self.assertTrue(any("allergy" in item.lower() for item in data["outstanding_now"]))

    def test_mse_lives_in_the_one_store_with_the_new_domains(self):
        self.draft()
        self.save(sections={"mse": {"mood": "Flat", "rapport": "Fair", "reliability": "Reliable"}})
        with platform_admin_context():
            draft = IntakeAssessment.objects.get(patient_id=self.pid, status="DRAFT")
            self.assertEqual(draft.mse.mood, "Flat")
            self.assertEqual(draft.mse.rapport, "Fair")
            first_mse = draft.mse_id
        self.save(sections={"mse": {"mood": "Brighter"}})
        with platform_admin_context():
            draft.refresh_from_db()
            self.assertEqual(draft.mse_id, first_mse)  # edited in place while draft
            self.assertEqual(draft.mse.mood, "Brighter")


class RestrictedContentTests(IntakeTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            self.front_desk = User.objects.create_user(
                email=f"fd-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            role, _ = Role.objects.get_or_create(
                name="Front Desk", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.front_desk.roles.add(role)
        self.fd_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.front_desk)[0]}"}

    def test_trauma_detail_reaches_treating_clinicians_only(self):
        self.draft()
        self.save(sections={"trauma": {"detail": "Sensitive detail", "grief": "Lost a parent"}})
        clinician = self.draft().data["sections"]["trauma"]
        self.assertEqual(clinician["detail"], "Sensitive detail")
        other = self.client.get(
            reverse("care-client-intake", args=[self.pid]), **self.fd_auth
        ).data["results"][0]["sections"]["trauma"]
        self.assertNotIn("detail", other)
        self.assertEqual(other["grief"], "Lost a parent")


class MedicationHistoryTests(IntakeTestCase):
    def test_entries_are_retired_never_deleted(self):
        url = reverse("care-client-medication-history", args=[self.pid])
        created = self.client.post(
            url, {"name": "Olanzapine", "dose": "10 mg", "frequency": "BD"}, format="json", **self.auth
        )
        self.assertEqual(created.status_code, 201)
        entry_id = created.data["id"]
        self.assertEqual(len(self.client.get(url, **self.auth).data["results"]), 1)
        gone = self.client.delete(
            reverse("care-medication-history-entry", args=[entry_id]), **self.auth
        )
        self.assertEqual(gone.status_code, 204)
        self.assertEqual(self.client.get(url, **self.auth).data["results"], [])
        with platform_admin_context():
            self.assertTrue(MedicationHistoryEntry.objects.filter(pk=entry_id).exists())


class AllergySectionTests(IntakeTestCase):
    def test_client_reported_allergy_is_confirmed_by_a_clinician(self):
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            record = AllergyRecord.objects.create(
                organization=self.org,
                patient=patient,
                substance="Penicillin",
                verification_status="UNCONFIRMED",
            )
        url = reverse("care-client-allergy", args=[self.pid])
        self.assertEqual(self.client.get(url, **self.auth).data["records"][0]["verification_status"], "UNCONFIRMED")
        done = self.client.post(
            reverse("care-allergy-verify", args=[record.pk]),
            {"verification_status": "CONFIRMED"},
            format="json",
            **self.auth,
        )
        self.assertEqual(done.data["records"][0]["verification_status"], "CONFIRMED")
        self.assertEqual(
            self.client.put(url, {"status": "ACTIVE_ALLERGIES"}, format="json", **self.auth).data["status"],
            "ACTIVE_ALLERGIES",
        )
        self.assertEqual(
            self.client.put(url, {"status": "nope"}, format="json", **self.auth).status_code, 400
        )
        bad = self.client.post(
            reverse("care-allergy-verify", args=[record.pk]),
            {"verification_status": "MAYBE"},
            format="json",
            **self.auth,
        )
        self.assertEqual(bad.status_code, 400)


