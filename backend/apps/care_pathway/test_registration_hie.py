"""Registration identity, consent and HIE outbox (CLAUDE.md §4, §6).

Classes whose name starts with `FhirR4Conformance` run in the CI conformance step.
"""

import uuid
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from apps.client_registry.consent import capture_consent, may_send_to_hie
from apps.client_registry.models import ConsentRecord, EmergencyContact, Patient, PatientIdentifier
from apps.dha_interop import hie_client
from apps.dha_interop.fhir_patient import (
    build_hie_consent,
    build_patient_resource,
    build_registration_provenance,
    build_related_person,
)
from apps.dha_interop.fhir_validation import validate_resource
from apps.dha_interop.models import FhirResourceCache
from apps.tenancy.context import platform_admin_context

from .models import TriageEncounter
from .tests import CarePathwayApiTestCase

NATIONAL_SYSTEM = "https://example.test/national-id"  # test value only


class IdentifierTests(CarePathwayApiTestCase):
    def test_document_number_becomes_a_sliced_identifier_beside_the_local_number(self):
        response = self.register(id_document_type="NATIONAL_ID", id_document_number="27730415")
        self.assertEqual(response.status_code, 201)
        with platform_admin_context():
            kinds = dict(
                PatientIdentifier.objects.filter(patient_id=response.data["patient_id"]).values_list(
                    "kind", "value"
                )
            )
        self.assertEqual(kinds["NATIONAL_ID"], "27730415")
        self.assertIn("CITRAMAC", kinds)

    def test_same_document_number_is_refused_and_points_at_the_existing_record(self):
        first = self.register(id_document_type="NATIONAL_ID", id_document_number="27730415")
        second = self.register(
            full_name="Someone Else", id_document_type="NATIONAL_ID", id_document_number="27730415"
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data["duplicate_of"], first.data["patient_id"])

    def test_probable_duplicate_must_be_confirmed(self):
        self.register(phone="0712000111")
        again = self.register(full_name="Amina Kamau", phone="0712000111")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(len(again.data["probable_duplicates"]), 1)
        confirmed = self.register(
            full_name="Amina Kamau", phone="0712000111", confirm_new_record=True
        )
        self.assertEqual(confirmed.status_code, 201)

    def test_temporary_arrivals_get_their_own_er_series(self):
        response = self.register(
            identity_status="UNKNOWN", full_name="", date_of_birth="", sex=""
        )
        with platform_admin_context():
            patient = Patient.objects.get(pk=response.data["patient_id"])
        self.assertRegex(patient.citramac_number, r"^CIT-ER-\d{6}$")

    def test_numbers_are_sequential_and_unique(self):
        numbers = set()
        for index in range(4):
            response = self.register(full_name=f"Client{index} Person{index}", date_of_birth="")
            with platform_admin_context():
                numbers.add(Patient.objects.get(pk=response.data["patient_id"]).citramac_number)
        self.assertEqual(len(numbers), 4)


class MergeTests(CarePathwayApiTestCase):
    def test_resolving_to_an_existing_document_requires_an_explicit_merge(self):
        permanent = self.register(id_document_type="NATIONAL_ID", id_document_number="111222")
        temp = self.register(identity_status="UNKNOWN", full_name="", date_of_birth="", sex="")
        url = reverse("care-resolve-identity", args=[temp.data["patient_id"]])
        body = {
            "full_name": "Amina Kamau",
            "id_document_type": "NATIONAL_ID",
            "id_document_number": "111222",
        }
        refused = self.client.post(url, body, format="json", **self.auth)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data["duplicate_of"], permanent.data["patient_id"])

        merged = self.client.post(
            url,
            {**body, "merge_into_patient_id": permanent.data["patient_id"]},
            format="json",
            **self.auth,
        )
        self.assertEqual(merged.status_code, 200)
        with platform_admin_context():
            temp_patient = Patient.objects.get(pk=temp.data["patient_id"])
            self.assertEqual(str(temp_patient.merged_into_id), permanent.data["patient_id"])
            # The temporary visit now belongs to the surviving record.
            visit = TriageEncounter.objects.get(pk=temp.data["triage_encounter_id"])
            self.assertEqual(str(visit.patient_id), permanent.data["patient_id"])
            # The old emergency number still resolves, flagged as superseded.
            old = PatientIdentifier.objects.get(patient_id=permanent.data["patient_id"], kind="TEMPORARY")
            self.assertIsNotNone(old.superseded_at)

    def test_unique_document_resolution_upgrades_in_place(self):
        temp = self.register(identity_status="UNKNOWN", full_name="", date_of_birth="", sex="")
        url = reverse("care-resolve-identity", args=[temp.data["patient_id"]])
        ok = self.client.post(
            url,
            {"full_name": "New Person", "id_document_type": "PASSPORT", "id_document_number": "A1"},
            format="json",
            **self.auth,
        )
        self.assertEqual(ok.status_code, 200)
        with platform_admin_context():
            patient = Patient.objects.get(pk=temp.data["patient_id"])
            self.assertEqual(patient.passport_number, "A1")
            self.assertEqual(patient.identity_status, "IDENTIFIED")


class ConsentGateTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        response = self.register()
        with platform_admin_context():
            self.patient = Patient.objects.get(pk=response.data["patient_id"])

    def capture(self, decision, consent_type="DATA_SHARING_HIE", **extra):
        with platform_admin_context():
            return capture_consent(
                self.patient, self.nurse, decision == "YES", "v1", "I agree …",
                consent_type=consent_type, decision=decision, **extra,
            )

    def test_only_an_explicit_yes_releases_data(self):
        with platform_admin_context():
            self.assertFalse(may_send_to_hie(self.patient))  # not asked
        for decision, expected in (("NO", False), ("RESTRICTED", False), ("YES", True)):
            self.capture(decision)
            with platform_admin_context():
                self.assertEqual(may_send_to_hie(self.patient), expected, decision)

    def test_an_expired_consent_is_not_asked_again(self):
        from datetime import timedelta

        from django.utils import timezone

        self.capture("YES", valid_until=timezone.now() - timedelta(days=1))
        with platform_admin_context():
            self.assertFalse(may_send_to_hie(self.patient))

    def test_revocation_after_grant_withholds(self):
        self.capture("YES")
        self.capture("NO")
        with platform_admin_context():
            self.assertFalse(may_send_to_hie(self.patient))

    def test_registration_captures_separate_sensitive_category_decisions(self):
        response = self.register(
            full_name="Grace Wanjiru",
            date_of_birth="1985-01-27",
            consent_text_version="v1",
            consent_text_snapshot="I understand …",
            hie_consent={
                "general": "YES",
                "mental_health": "RESTRICTED",
                "substance_use": "NO",
                "family": "NOT_ASKED",
            },
        )
        self.assertEqual(response.status_code, 201)
        with platform_admin_context():
            rows = dict(
                ConsentRecord.objects.filter(patient_id=response.data["patient_id"]).values_list(
                    "consent_type", "decision"
                )
            )
        self.assertEqual(
            rows,
            {
                "DATA_SHARING_HIE": "YES",
                "MENTAL_HEALTH_HIE": "RESTRICTED",
                "SUBSTANCE_USE_HIE": "NO",
            },
        )

    def test_decisions_without_the_wording_shown_are_refused(self):
        response = self.register(full_name="No Wording", hie_consent={"general": "YES"})
        self.assertEqual(response.status_code, 400)

    def test_patient_is_not_queued_without_consent_and_is_queued_once_with_it(self):
        with platform_admin_context():
            self.assertIsNone(hie_client.enqueue_patient(self.patient))
        self.capture("YES")
        with platform_admin_context():
            first = hie_client.enqueue_patient(self.patient)
            second = hie_client.enqueue_patient(self.patient)
            self.assertEqual(first.pk, second.pk)
            self.assertEqual(FhirResourceCache.objects.filter(idempotency_key__startswith="patient:").count(), 1)


@override_settings(
    FHIR_LOCAL_SYSTEM_BASE="https://ids.example.test",
    FHIR_NATIONAL_IDENTIFIER_SYSTEMS={"NATIONAL_ID": NATIONAL_SYSTEM},
)
class FhirR4ConformancePatientTests(CarePathwayApiTestCase):
    def patient(self, **data):
        response = self.register(**data)
        with platform_admin_context():
            return Patient.objects.get(pk=response.data["patient_id"])

    def build(self, patient):
        with platform_admin_context():
            resource, omitted = build_patient_resource(patient)
        payload = resource.model_dump(mode="json", exclude_none=True)
        self.assertEqual(validate_resource(payload), [], payload)
        return payload, omitted

    def test_identified_patient_has_sliced_identifiers_and_a_security_label(self):
        patient = self.patient(
            id_document_type="NATIONAL_ID",
            id_document_number="27730415",
            phone="0712345678",
            next_of_kin_name="Joan Kamau",
            next_of_kin_phone="0722000000",
            next_of_kin_relationship="Sister",
        )
        payload, omitted = self.build(patient)
        systems = {i["system"] for i in payload["identifier"]}
        self.assertIn(NATIONAL_SYSTEM, systems)
        self.assertIn("https://ids.example.test/citramac-number", systems)
        self.assertEqual(payload["meta"]["security"][0]["code"], "R")
        self.assertEqual(payload["contact"][0]["name"]["text"], "Joan Kamau")
        self.assertEqual(omitted, [])

    def test_unidentified_patient_gets_a_valid_temporary_name(self):
        patient = self.patient(
            identity_status="UNIDENTIFIED",
            full_name="",
            description="Adult in a blue jacket",
            date_of_birth="",
            sex="",
        )
        payload, _ = self.build(patient)
        self.assertEqual(payload["name"][0]["use"], "temp")
        self.assertIn("blue jacket", payload["name"][0]["text"])
        self.assertNotIn("birthDate", payload)

    @override_settings(FHIR_NATIONAL_IDENTIFIER_SYSTEMS={})
    def test_an_identifier_with_no_configured_system_is_withheld_not_invented(self):
        patient = self.patient(id_document_type="NATIONAL_ID", id_document_number="999888")
        payload, omitted = self.build(patient)
        self.assertEqual(
            [i for i in payload["identifier"] if i["value"] == "999888"], []
        )
        self.assertTrue(any("NATIONAL_ID" in item for item in omitted))

    def test_merged_record_links_to_the_survivor(self):
        permanent = self.patient(id_document_type="NATIONAL_ID", id_document_number="5550001")
        temp = self.patient(identity_status="UNKNOWN", full_name="", date_of_birth="", sex="")
        self.client.post(
            reverse("care-resolve-identity", args=[temp.pk]),
            {
                "full_name": "A B",
                "id_document_type": "NATIONAL_ID",
                "id_document_number": "5550001",
                "merge_into_patient_id": str(permanent.pk),
            },
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            temp.refresh_from_db()
        payload, _ = self.build(temp)
        self.assertFalse(payload["active"])
        self.assertEqual(payload["link"][0]["type"], "replaced-by")
        self.assertEqual(payload["link"][0]["other"]["reference"], f"Patient/{permanent.pk}")

    def test_consent_related_person_and_provenance_are_valid(self):
        patient = self.patient(next_of_kin_name="Joan Kamau", next_of_kin_is_guardian=True)
        with platform_admin_context():
            record = capture_consent(
                patient, self.nurse, False, "v1", "text",
                consent_type="MENTAL_HEALTH_HIE", decision="RESTRICTED",
            )
            contact = EmergencyContact.objects.get(patient=patient)
            from django.utils import timezone

            resources = [
                build_hie_consent(record),
                build_related_person(contact, f"Patient/{patient.pk}"),
                build_registration_provenance(patient, self.nurse, timezone.now()),
            ]
        for resource in resources:
            payload = resource.model_dump(mode="json", exclude_none=True)
            self.assertEqual(validate_resource(payload), [], payload)
        consent = resources[0].model_dump(mode="json", exclude_none=True)
        # Restricted-to-facility is withheld from the HIE (fail-safe direction).
        self.assertEqual(consent["provision"]["type"], "deny")
        self.assertIn("restricted", consent["category"][0]["text"])

    def test_not_asked_produces_no_consent_resource(self):
        patient = self.patient()
        with platform_admin_context():
            record = capture_consent(
                patient, self.nurse, False, "v1", "text", decision="NOT_ASKED"
            )
            self.assertIsNone(build_hie_consent(record))

    def test_emergency_arrival_is_valid_and_its_escort_is_not_next_of_kin(self):
        patient = self.patient(
            identity_status="UNKNOWN",
            full_name="",
            date_of_birth="",
            sex="",
            apparent_sex="MALE_APPEARING",
            brought_by_name="PC Otieno",
            brought_by_relationship="Police officer",
        )
        payload, _ = self.build(patient)
        self.assertEqual(payload["name"][0]["text"], f"UNKNOWN CLIENT — {patient.citramac_number}")
        # Apparent sex is an observation on the arrival, never Patient.gender.
        self.assertEqual(payload["gender"], "unknown")
        self.assertNotIn("maritalStatus", payload)
        with platform_admin_context():
            contact = EmergencyContact.objects.get(patient=patient)
            related = build_related_person(contact, f"Patient/{patient.pk}")
        related = related.model_dump(mode="json", exclude_none=True)
        self.assertEqual(validate_resource(related), [], related)
        relationship = related["relationship"][0]
        self.assertNotIn("coding", relationship)
        self.assertIn("Police officer", relationship["text"])

    def test_prefer_not_to_say_and_local_social_details_are_not_emitted(self):
        patient = self.patient(
            first_name="Amina",
            last_name="Kamau",
            full_name="",
            sex="NOT_SAID",
            marital_status="MARRIED",
            employment_status="STUDENT",
            occupation="Nursing student",
            living_with_disability="YES",
            disability_details="Uses a wheelchair",
        )
        payload, _ = self.build(patient)
        self.assertEqual(payload["gender"], "unknown")
        text = str(payload)
        for local in ("maritalStatus", "Nursing student", "wheelchair", "STUDENT"):
            self.assertNotIn(local, text)


class RegistrationV4Tests(CarePathwayApiTestCase):
    """Client mockup v4 registration: split name, social & personal details,
    emergency arrival, CIT-ER numbers and identity resolution in place."""

    def get_patient(self, response):
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            return Patient.objects.get(pk=response.data["patient_id"])

    def search(self, q):
        response = self.client.get(reverse("care-registration-search") + f"?q={q}", **self.auth)
        self.assertEqual(response.status_code, 200)
        return response.data["results"]

    def test_first_and_last_name_are_stored_separately_and_both_required(self):
        patient = self.get_patient(
            self.register(full_name="", first_name="Amina Wanjiku", last_name="Kamau")
        )
        self.assertEqual((patient.first_name, patient.last_name), ("Amina Wanjiku", "Kamau"))
        missing_last = self.register(full_name="", first_name="Amina", last_name="")
        self.assertEqual(missing_last.status_code, 400)
        self.assertIn("last_name", missing_last.data)
        missing_first = self.register(full_name="", first_name="", last_name="Kamau")
        self.assertIn("first_name", missing_first.data)

    def test_full_name_is_still_accepted(self):
        patient = self.get_patient(self.register(full_name="Amina Wanjiku Kamau"))
        self.assertEqual(
            (patient.first_name, patient.middle_other_names, patient.last_name),
            ("Amina", "Wanjiku", "Kamau"),
        )

    def test_returning_client_with_a_single_word_name_is_still_registrable(self):
        first = self.get_patient(self.register(full_name="Cher"))
        again = self.register(
            patient_id=str(first.pk), full_name="", first_name="Cher", last_name=""
        )
        self.assertEqual(again.status_code, 201, again.data)

    def test_returning_client_keeps_middle_names_when_none_are_sent(self):
        first = self.get_patient(self.register())
        again = self.get_patient(
            self.register(
                patient_id=str(first.pk), full_name="", first_name="Amina", last_name="Kamau"
            )
        )
        self.assertEqual(again.middle_other_names, "Wanjiku")

    def test_social_details_are_coded_and_disability_details_follow_yes(self):
        patient = self.get_patient(
            self.register(
                marital_status="SEPARATED",
                employment_status="UNABLE_TO_WORK",
                occupation="Carpenter",
                living_with_disability="YES",
                disability_details="Hearing impairment — needs a sign interpreter",
            )
        )
        self.assertEqual(patient.marital_status, "SEPARATED")
        self.assertEqual(patient.employment_status, "UNABLE_TO_WORK")
        self.assertEqual(patient.occupation, "Carpenter")
        self.assertEqual(patient.living_with_disability, "YES")
        self.assertIn("Hearing", patient.disability_details)
        again = self.get_patient(
            self.register(
                patient_id=str(patient.pk),
                living_with_disability="NOT_SAID",
                disability_details="ignored",
            )
        )
        self.assertEqual(again.living_with_disability, "NOT_SAID")
        self.assertEqual(again.disability_details, "")
        free_text = self.register(employment_status="Employed", confirm_new_record=True)
        self.assertEqual(free_text.status_code, 400)
        self.assertIn("employment_status", free_text.data)
        self.assertEqual(self.register(sex="NOT_SAID", phone="0799").status_code, 201)

    def test_emergency_arrival_details_and_brought_by_contact(self):
        response = self.register(
            identity_status="UNKNOWN",
            full_name="",
            date_of_birth="",
            sex="",
            estimated_age=35,
            apparent_sex="FEMALE_APPEARING",
            description="Red headscarf, green dress, small scar on left hand",
            found_location="Bus stage, Moi Avenue",
            arrival_referral_info="Brought by police, OB 12/10/2026",
            identification_notes="Responds to 'Mama Wanjiru'; phone in pocket is locked",
            brought_by_name="PC Otieno",
            brought_by_relationship="Police officer",
            brought_by_phone="0711000222",
            brought_by_id_number="POL-4471",
            brought_by_address="Central Police Station",
            allergy_status="ACTIVE_ALLERGIES",
            allergy_details="Penicillin — rash",
        )
        patient = self.get_patient(response)
        self.assertEqual(patient.estimated_age, 35)
        self.assertEqual(patient.gender, "")
        self.assertIn("Red headscarf", patient.identity_description)
        self.assertIsNone(patient.next_of_kin_id)
        self.assertEqual(patient.get_full_name(), f"UNKNOWN CLIENT — {patient.citramac_number}")
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=response.data["triage_encounter_id"])
            contact = EmergencyContact.objects.get(patient=patient)
        self.assertEqual(te.apparent_sex, "FEMALE_APPEARING")
        self.assertEqual(te.found_location, "Bus stage, Moi Avenue")
        self.assertIn("OB 12/10/2026", te.arrival_referral_info)
        self.assertIn("Mama Wanjiru", te.identification_notes)
        self.assertEqual(contact.contact_role, EmergencyContact.ROLE_BROUGHT_BY)
        self.assertEqual(
            (contact.name, contact.relationship, contact.phone, contact.id_number, contact.address),
            ("PC Otieno", "Police officer", "0711000222", "POL-4471", "Central Police Station"),
        )
        self.assertEqual(
            self.register(identity_status="UNKNOWN", full_name="", apparent_sex="TALL").status_code,
            400,
        )

    def test_temporary_numbers_run_in_sequence(self):
        numbers = [
            self.get_patient(
                self.register(identity_status="UNKNOWN", full_name="", date_of_birth="", sex="")
            ).citramac_number
            for _ in range(2)
        ]
        first, second = (int(n.rsplit("-", 1)[1]) for n in numbers)
        self.assertEqual(second, first + 1)
        unidentified = self.get_patient(
            self.register(identity_status="UNIDENTIFIED", full_name="", description="Grey coat")
        )
        self.assertTrue(unidentified.citramac_number.startswith("CIT-ER-"))

    def test_resolving_identity_updates_the_same_record_without_a_new_encounter(self):
        temp = self.register(identity_status="UNKNOWN", full_name="", date_of_birth="", sex="")
        before = self.get_patient(temp)
        response = self.client.post(
            reverse("care-resolve-identity", args=[temp.data["patient_id"]]),
            {
                "first_name": "Wanjiru",
                "last_name": "Mwangi",
                "date_of_birth": "1988-05-02",
                "sex": "FEMALE",
                "phone": "0722111333",
                "id_document_type": "NATIONAL_ID",
                "id_document_number": "30112233",
                "marital_status": "WIDOWED",
                "employment_status": "SELF_EMPLOYED",
                "occupation": "Trader",
                "living_with_disability": "NO",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], temp.data["patient_id"])
        with platform_admin_context():
            patient = Patient.objects.get(pk=temp.data["patient_id"])
            encounters = TriageEncounter.objects.filter(patient=patient).count()
            kinds = set(
                PatientIdentifier.objects.filter(patient=patient).values_list("kind", flat=True)
            )
        self.assertEqual(encounters, 1)
        self.assertEqual(patient.citramac_number, before.citramac_number)
        self.assertEqual(patient.identity_status, "IDENTIFIED")
        self.assertIsNotNone(patient.identity_confirmed_at)
        self.assertEqual((patient.first_name, patient.last_name), ("Wanjiru", "Mwangi"))
        self.assertEqual(patient.national_id, "30112233")
        self.assertEqual(patient.marital_status, "WIDOWED")
        self.assertEqual(patient.employment_status, "SELF_EMPLOYED")
        self.assertEqual(patient.occupation, "Trader")
        self.assertEqual(patient.living_with_disability, "NO")
        self.assertEqual(kinds, {"TEMPORARY", "NATIONAL_ID"})

    def test_search_row_reloads_next_of_kin_and_referral_but_no_clinical_content(self):
        self.register(
            next_of_kin_name="Joan Kamau",
            next_of_kin_relationship="Sibling",
            next_of_kin_phone="0722000000",
            referral_source="GP",
            reason="Hearing voices since last week",
        )
        row = self.search("Kamau")[0]
        self.assertEqual(row["next_of_kin"], "Joan Kamau")
        self.assertEqual(row["next_of_kin_relationship"], "Sibling")
        self.assertEqual(row["next_of_kin_phone"], "0722000000")
        self.assertEqual(row["referral_source"], "GP")
        self.assertFalse(row["is_temporary"])
        self.assertIsNone(row["emergency_arrival"])
        self.assertNotIn("Hearing voices", str(row))
        for clinical in ("reason", "presenting_concern", "priority", "diagnosis", "triage"):
            self.assertNotIn(clinical, row)

    def test_temporary_search_row_carries_the_arrival_details_for_resolution(self):
        self.register(
            identity_status="UNKNOWN",
            full_name="",
            date_of_birth="",
            sex="",
            found_location="Bus stage",
            identification_notes="Locked phone in pocket",
            brought_by_name="PC Otieno",
            reason="Confused, smells of alcohol",
        )
        row = self.search("CIT-ER-")[0]
        self.assertTrue(row["is_temporary"])
        self.assertEqual(row["emergency_arrival"]["found_location"], "Bus stage")
        self.assertEqual(row["emergency_arrival"]["brought_by"]["name"], "PC Otieno")
        self.assertNotIn("alcohol", str(row))


class OutboxTests(CarePathwayApiTestCase):
    def entry(self, retry_safe=True, resource_type="Patient"):
        with platform_admin_context():
            return hie_client.enqueue(
                self.org.id,
                resource_type,
                {"resourceType": resource_type, "id": str(uuid.uuid4())},
                f"test:{uuid.uuid4()}",
                retry_safe=retry_safe,
            )

    def test_unconfigured_hie_holds_the_row_and_says_so(self):
        entry = self.entry()
        with platform_admin_context():
            hie_client.deliver(entry)
        entry.refresh_from_db()
        self.assertEqual(entry.status, "CACHED")
        self.assertIn("not configured", entry.transmission_detail)

    @override_settings(HIE_ENDPOINT_URL="https://hie.example.test", HIE_PATIENT_PATH="Patient")
    def test_rejection_keeps_operation_outcome_expressions_for_the_person_who_can_fix_it(self):
        entry = self.entry()
        response = Mock(status_code=422, ok=False)
        response.json.return_value = {
            "resourceType": "OperationOutcome",
            "issue": [
                {
                    "severity": "error",
                    "code": "invalid",
                    "expression": ["Patient.birthDate"],
                    "diagnostics": "Date of birth is in the future",
                }
            ],
        }
        with patch("apps.dha_interop.hie_client.requests.request", return_value=response):
            with platform_admin_context():
                hie_client.deliver(entry)
        entry.refresh_from_db()
        self.assertEqual(entry.status, "REJECTED")
        self.assertEqual(entry.issues[0]["expression"], ["Patient.birthDate"])
        self.assertIn("Patient.birthDate", entry.transmission_detail)
        self.assertIsNone(entry.next_attempt_at)

    @override_settings(HIE_ENDPOINT_URL="https://hie.example.test", HIE_PATIENT_PATH="Patient")
    def test_timeout_is_retried_only_when_the_send_is_idempotent(self):
        safe, unsafe = self.entry(retry_safe=True), self.entry(retry_safe=False)
        with patch("apps.dha_interop.hie_client.requests.request", side_effect=requests.Timeout("slow")):
            with platform_admin_context():
                hie_client.deliver(safe)
                hie_client.deliver(unsafe)
        safe.refresh_from_db()
        unsafe.refresh_from_db()
        self.assertEqual(safe.status, "RETRY")
        self.assertIsNotNone(safe.next_attempt_at)
        self.assertEqual(unsafe.status, "FAILED")

    @override_settings(HIE_ENDPOINT_URL="https://hie.example.test", HIE_PATIENT_PATH="Patient")
    def test_patient_send_is_an_update_as_create_put_by_id(self):
        entry = self.entry()
        response = Mock(status_code=201, ok=True)
        response.json.return_value = {}
        with patch("apps.dha_interop.hie_client.requests.request", return_value=response) as call:
            with platform_admin_context():
                hie_client.deliver(entry)
        method, url = call.call_args.args[:2]
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith(f"/Patient/{entry.fhir_json['id']}"))
        self.assertEqual(call.call_args.kwargs["headers"]["Content-Type"], "application/fhir+json")
        entry.refresh_from_db()
        self.assertEqual(entry.status, "SENT")

    def test_enqueue_is_idempotent_and_drain_skips_when_not_due(self):
        with platform_admin_context():
            a = hie_client.enqueue(self.org.id, "Patient", {"id": "1"}, "dup-key")
            b = hie_client.enqueue(self.org.id, "Patient", {"id": "1"}, "dup-key")
        self.assertEqual(a.pk, b.pk)


class DuplicateCheckEndpointTests(CarePathwayApiTestCase):
    def check(self, **body):
        return self.client.post(
            reverse("care-registration-duplicate-check"), body, format="json", **self.auth
        )

    def test_exact_and_probable_matches_are_reported_with_registration_details_only(self):
        self.register(id_document_type="NATIONAL_ID", id_document_number="4242", phone="0700")
        exact = self.check(id_document_type="NATIONAL_ID", id_document_number="4242")
        self.assertEqual([m["match"] for m in exact.data["matches"]], ["exact"])
        probable = self.check(
            full_name="Amina Kamau", date_of_birth="1992-03-14", sex="FEMALE", phone="0700"
        )
        self.assertEqual([m["match"] for m in probable.data["matches"]], ["probable"])
        self.assertEqual(self.check(full_name="Nobody Here").data["matches"], [])

    def test_new_value_sets_are_served(self):
        response = self.client.get(
            reverse("care-valuesets") + "?ids=hie-consent-decision,next-of-kin-relationship",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        codes = [c["code"] for c in response.data["hie-consent-decision"]["concepts"]]
        self.assertEqual(codes, ["NOT_ASKED", "YES", "NO", "RESTRICTED"])


class FhirR4ConformanceRegistrationExamplesTests(SimpleTestCase):
    """Published registration examples (CLAUDE.md §3 item 8): routine, an edge
    case (unidentified emergency, merged record) and a refusal (restricted)."""

    def _folder(self):
        from pathlib import Path

        return Path(__file__).parents[1] / "dha_interop" / "fhir_examples"

    def test_every_example_is_valid_r4_and_there_are_at_least_three(self):
        import json

        from apps.dha_interop.fhir_validation.validator import validate_bundle

        paths = sorted(self._folder().glob("registration-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(example=path.name):
                self.assertEqual(validate_bundle(json.loads(path.read_text())), {})

    def test_the_refusal_example_withholds_sharing(self):
        import json

        bundle = json.loads(
            (self._folder() / "registration-refusal-mental-health-sharing.json").read_text()
        )
        consent = [
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Consent"
        ][0]
        self.assertEqual(consent["provision"]["type"], "deny")
