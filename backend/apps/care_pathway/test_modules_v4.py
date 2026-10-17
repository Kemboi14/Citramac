"""Intervention modules v4: withdrawal chart series/history, structured prescribing
with allergy hard stop, MAR orders (slots, unscheduled doses, PRN maximum),
restrictive-practice co-sign/debrief/end time, therapy sessions and labs result entry."""

import uuid
from datetime import timedelta

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import AllergyRecord, InsuranceCoverage, Patient
from apps.clinical_encounter.models import Encounter, Prescription, PrescriptionItem
from apps.dha_interop.models import NationalDrugIndex
from apps.ipd_ward.models import Admission, Bed, MedicationAdministration, Ward
from apps.tenancy.context import platform_admin_context

from . import interventions as iv
from .models import CosignRequest, OutcomeScore
from .test_records import RecordsTestCase


class ModulesTestCase(RecordsTestCase):
    def setUp(self):
        super().setUp()
        self.doctor, self.doctor_auth = self.user_with_role("Doctor", "Junior", "Doctor")
        self.clerk, self.clerk_auth = self.user_with_role(None, "Front", "Desk")

    def user_with_role(self, role_name, first, last):
        with platform_admin_context():
            user = User.objects.create_user(
                email=f"{first.lower()}-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True, first_name=first, last_name=last,
            )
            if role_name:
                role, _ = Role.objects.get_or_create(name=role_name, defaults={"scope": Role.SCOPE_ORG_TEMPLATE})
                user.roles.add(role)
        return user, {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}"}

    def as_(self, auth, name, body=None, *args):
        url = reverse(name, args=args or [self.pid])
        if body is None:
            return self.client.get(url, **auth)
        return self.client.post(url, body, format="json", **auth)

    def patient(self):
        return Patient.objects.get(pk=self.pid)

    def other_client(self):
        registered = self.register(allergy_status="NONE", full_name="Otieno Baraka Mwangi", sex="MALE",
                                   date_of_birth="1985-07-02")
        self.assertEqual(registered.status_code, 201, registered.data)
        return registered.data["patient_id"]


class WithdrawalChartTests(ModulesTestCase):
    def assess(self, answers):
        return self.post("care-client-assessments", {"instrument": "CIWA", "answers": answers})

    def test_series_history_and_threshold_line_come_from_the_record_and_protocol(self):
        self.assess([1] * 10)
        self.assess([2] * 9 + [1])
        self.post("care-client-withdrawal", {"instrument": "CIWA", "reason": "CONFUSED"})
        with override_settings(WITHDRAWAL_PROTOCOL={"CIWA": {"prn_threshold": 8}}):
            scale = self.get("care-client-withdrawal").data["scales"][0]
        self.assertEqual([p["score"] for p in scale["series"]], [10, 19])
        self.assertEqual(scale["prnThreshold"], 8)
        self.assertIsNone(scale["severeThreshold"])
        self.assertEqual(scale["history"][0]["unable"], "Confused — possible delirium")
        self.assertIsNone(scale["history"][0]["score"])
        self.assertEqual([h["score"] for h in scale["history"][1:]], [19, 10])
        self.assertEqual(scale["history"][1]["by"], "Jane Njoroge")

    def test_no_protocol_means_no_threshold_line(self):
        self.assess([1] * 10)
        scale = self.get("care-client-withdrawal").data["scales"][0]
        self.assertIsNone(scale["prnThreshold"])

    def test_the_main_substance_drives_the_suggested_scale_and_is_reported(self):
        data = self.get("care-client-withdrawal").data
        self.assertIsNone(data["recommended"])
        self.assertEqual(data["substance"], "")
        self.draft()
        self.save(sections={"subs": {"kind": "OPIOIDS"}})
        data = self.get("care-client-withdrawal").data
        self.assertEqual(data["recommended"], "COWS")
        self.assertTrue(data["substance"])


class PrescribingOrderTests(ModulesTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            self.drug = NationalDrugIndex.objects.create(code="TEST-DRUG-1", generic_name="Testamine")
            self.penicillin = NationalDrugIndex.objects.create(code="TEST-DRUG-2", generic_name="Penicillin V")
            InsuranceCoverage.objects.create(
                organization=self.org, patient=self.patient(), scheme_type="SHA_SHIF",
                sha_verified=True, sha_premium_compliant=True,
            )

    def order(self, auth=None, **over):
        body = {"drug": self.drug.code, "dose": "5 mg", "route": "ORAL", "frequency": "BD", **over}
        return self.as_(auth or self.psych_auth, "care-prescribing", body)

    def test_the_route_list_is_a_served_value_set(self):
        served = self.client.get(reverse("care-valuesets") + "?ids=medication-route", **self.auth).data
        codes = [c["code"] for c in served["medication-route"]["concepts"]]
        self.assertIn("ORAL", codes)

    def test_unknown_allergy_status_locks_prescribing(self):
        with platform_admin_context():
            Patient.objects.filter(pk=self.pid).update(allergy_status="UNKNOWN")
        self.assertTrue(self.as_(self.psych_auth, "care-prescribing").data["locked"])
        response = self.order()
        self.assertEqual(response.status_code, 400)
        self.assertIn("Prescribing locked", str(response.data))

    def test_only_prescribers_place_orders_and_the_order_is_structured(self):
        state = self.as_(self.auth, "care-prescribing").data
        self.assertFalse(state["can_prescribe"])
        self.assertFalse(state["is_senior"])
        self.assertEqual(self.order(self.auth).status_code, 403)
        for over in ({"drug": "NOPE"}, {"dose": ""}, {"route": "EAR"}, {"frequency": "hourly"},
                     {"is_prn": True, "indication": "Agitation"}, {"is_prn": True, "prn_max_per_24h": 2}):
            self.assertEqual(self.order(**over).status_code, 400, over)
        placed = self.order(is_prn=True, prn_max_per_24h=2, indication="Acute agitation", frequency="")
        self.assertEqual(placed.status_code, 201, placed.data)
        row = placed.data["orders"][0]
        self.assertEqual((row["route"], row["is_prn"], row["prn_max_per_24h"], row["prescribed_by"]),
                         ("Oral", True, 2, "Dr Senior"))

    def test_warnings_must_be_acknowledged(self):
        with platform_admin_context():
            Patient.objects.filter(pk=self.pid).update(allergy_status="ACTIVE_ALLERGIES")
            AllergyRecord.objects.create(
                organization=self.org, patient=self.patient(), substance="Testamine", allergy_type="INTOLERANCE",
            )
        self.assertEqual(self.order().status_code, 400)
        placed = self.order(acknowledged_warnings=True)
        self.assertEqual(placed.status_code, 201, placed.data)
        self.assertEqual(placed.data["orders"][0]["findings"][0]["level"], "WARN")

    def test_a_true_allergy_hard_stops_and_an_override_by_a_junior_requests_cosign(self):
        with platform_admin_context():
            Patient.objects.filter(pk=self.pid).update(allergy_status="ACTIVE_ALLERGIES")
            AllergyRecord.objects.create(
                organization=self.org, patient=self.patient(), substance="Penicillin", verification_status="CONFIRMED",
            )
        body = {"drug": self.penicillin.code, "acknowledged_warnings": True}
        self.assertEqual(self.order(self.doctor_auth, **body).status_code, 400)
        placed = self.order(self.doctor_auth, override_reason="Desensitised under supervision", **body)
        self.assertEqual(placed.status_code, 201, placed.data)
        self.assertEqual(placed.data["orders"][0]["allergy_override_reason"], "Desensitised under supervision")
        with platform_admin_context():
            item = PrescriptionItem.objects.get(pk=placed.data["orders"][0]["id"])
            self.assertFalse(item.allergy_check_passed)
            cosign = CosignRequest.objects.get(subject_type="PrescriptionItem", subject_id=str(item.pk))
        self.assertEqual(cosign.kind, "PRESCRIBING_OVERRIDE")
        senior = self.order(override_reason="Senior decision, documented", **body)
        self.assertEqual(senior.status_code, 201)
        with platform_admin_context():
            self.assertEqual(CosignRequest.objects.filter(kind="PRESCRIBING_OVERRIDE").count(), 1)

    def test_no_cleared_payment_blocks_the_order(self):
        with platform_admin_context():
            InsuranceCoverage.objects.filter(patient_id=self.pid).delete()
        self.assertEqual(self.order().status_code, 402)


class MarOrderTests(ModulesTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            patient = self.patient()
            ward = Ward.objects.create(organization=self.org, name="Ward")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="1", status="OCCUPIED")
            encounter = Encounter.objects.create(organization=self.org, patient=patient, opened_by=self.nurse)
            self.admission = Admission.objects.create(
                organization=self.org, patient=patient, bed=bed, admitted_by=self.nurse, encounter=encounter,
                admitted_at=timezone.now() - timedelta(days=1),
            )
            drug = NationalDrugIndex.objects.create(code="TEST-DRUG-3", generic_name="Calmazine")
            rx = Prescription.objects.create(organization=self.org, encounter=encounter, prescribed_by=self.psych)
            self.regular = PrescriptionItem.objects.create(
                organization=self.org, prescription=rx, drug=drug, dose="10 mg", route="Oral", frequency="QDS",
            )
            self.prn = PrescriptionItem.objects.create(
                organization=self.org, prescription=rx, drug=drug, dose="5 mg", route="Oral", is_prn=True,
                prn_max_per_24h=1, indication="Agitation", controlled_drug=True,
            )

    def give(self, item, **body):
        return self.post("care-mar-order-administer", {"outcome": "ADMINISTERED", **body}, self.pid, item.pk)

    def order_row(self, data, item):
        return next(o for o in data["orders"] if o["id"] == str(item.pk))

    def test_regular_orders_show_todays_dose_times_and_a_slot_dose_is_charted_on_it(self):
        row = self.order_row(self.get("care-mar").data, self.regular)
        self.assertEqual(len(row["slots"]), 4)
        self.assertTrue(all(s["entry"] is None for s in row["slots"]))
        first = row["slots"][0]["time"]
        done = self.give(self.regular, slot=first.isoformat())
        self.assertEqual(done.status_code, 201, done.data)
        slot = self.order_row(done.data, self.regular)["slots"][0]
        self.assertEqual(slot["state"], "given")
        self.assertEqual(self.give(self.regular, slot=first.isoformat()).status_code, 400)  # already recorded
        odd = (first + timedelta(minutes=7)).isoformat()
        self.assertEqual(self.give(self.regular, slot=odd).status_code, 400)

    def test_an_unscheduled_dose_is_charted_now(self):
        done = self.give(self.regular)
        self.assertEqual(done.status_code, 201, done.data)
        with platform_admin_context():
            entry = MedicationAdministration.objects.get(prescription_item=self.regular)
        self.assertEqual(entry.status, "ADMINISTERED")
        self.assertLess(abs((entry.scheduled_time - timezone.now()).total_seconds()), 60)

    def test_prn_maximum_per_24h_needs_an_override_reason_once_reached(self):
        self.assertEqual(self.give(self.prn, prn_indication="Agitation").status_code, 400)  # controlled: witness
        first = self.give(self.prn, prn_indication="Agitation", witness_name="K. Mutua")
        self.assertEqual(first.status_code, 201, first.data)
        row = self.order_row(first.data, self.prn)
        self.assertEqual((row["given_24h"], row["at_max"]), (1, True))
        blocked = self.give(self.prn, prn_indication="Agitation", witness_name="K. Mutua")
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("override_reason", blocked.data)
        over = self.give(self.prn, prn_indication="Agitation", witness_name="K. Mutua",
                         override_reason="Prescriber consulted by phone")
        self.assertEqual(over.status_code, 201, over.data)
        self.assertTrue(any(e["prn_max_override_reason"] for e in over.data["entries"]))

    def test_an_order_for_another_client_is_not_found(self):
        other = self.other_client()
        response = self.client.post(
            reverse("care-mar-order-administer", args=[other, self.regular.pk]), {"outcome": "ADMINISTERED"},
            format="json", **self.auth,
        )
        self.assertEqual(response.status_code, 400)  # the other client is not admitted


class RestrictivePracticeV4Tests(ModulesTestCase):
    def body(self, **over):
        return {
            "kind": "RESTRAINT", "de_escalation": ["Verbal de-escalation"], "authorised_by": str(self.psych.pk),
            "start_at": (timezone.now() - timedelta(minutes=30)).isoformat(), "injury_check": "NONE", **over,
        }

    def test_authorisers_are_served_with_their_seniority(self):
        listed = {a["name"]: a["senior"] for a in self.get("care-restrictive").data["authorisers"]}
        self.assertEqual(listed, {"Dr Senior": True, "Junior Doctor": False})
        self.assertEqual(self.post("care-restrictive", self.body(authorised_by=str(self.clerk.pk))).status_code, 400)

    def test_a_non_senior_authoriser_raises_a_cosign_request(self):
        senior = self.post("care-restrictive", self.body())
        self.assertIsNone(senior.data["cosign_status"])
        junior = self.post("care-restrictive", self.body(authorised_by=str(self.doctor.pk)))
        self.assertEqual(junior.status_code, 201, junior.data)
        self.assertEqual(junior.data["cosign_status"], "REQUESTED")

    def test_client_debrief_can_be_done_at_creation(self):
        self.assertEqual(self.post("care-restrictive", self.body(client_debrief="MAYBE")).status_code, 400)
        self.assertIsNone(self.post("care-restrictive", self.body(client_debrief="PENDING")).data["client_debrief_at"])
        self.assertIsNotNone(self.post("care-restrictive", self.body(client_debrief="DONE")).data["client_debrief_at"])

    def test_the_recorded_end_time_is_kept_and_checked(self):
        eid = self.post("care-restrictive", self.body()).data["id"]
        future = (timezone.now() + timedelta(hours=1)).isoformat()
        self.assertEqual(self.post("care-restrictive-end", {"end_at": future}, eid).status_code, 400)
        before = (timezone.now() - timedelta(hours=2)).isoformat()
        self.assertEqual(self.post("care-restrictive-end", {"end_at": before}, eid).status_code, 400)
        end = timezone.now() - timedelta(minutes=10)
        ended = self.post("care-restrictive-end", {"end_at": end.isoformat()}, eid)
        self.assertEqual(ended.status_code, 200, ended.data)
        self.assertLess(abs((ended.data["end_at"] - end).total_seconds()), 1)


class TherapyV4Tests(ModulesTestCase):
    def start(self, auth=None, **over):
        return self.as_(auth or self.auth, "care-client-therapy", {
            "modality": "TF_CBT", "planned_sessions": 8, "frequency": "Weekly", "trauma_phase": 1,
            "consent_to_record": True, "under_supervision": True, **over,
        })

    def session(self, eid, auth=None, **body):
        return self.as_(auth or self.auth, "care-client-therapy-session", {"episode": eid, "session_notes": "Grounding", **body})

    def test_contract_fields_sessions_and_measure_are_kept_in_one_store(self):
        eid = self.start().data["id"]
        self.post("care-therapy-confidentiality", {}, eid)
        self.assertEqual(self.session(eid, session_notes=" ").status_code, 400)
        score = self.post("care-client-assessments", {"instrument": "GAD7", "answers": [1] * 7, "context": "THERAPY"}).data
        self.assertEqual(self.session(eid, homework="Breathing practice", score_id=score["id"]).status_code, 201)
        self.session(eid, process_notes="Restricted reflection")
        data = self.get("care-client-therapy").data
        episode = data["results"][0]
        self.assertEqual((episode["frequency"], episode["trauma_phase"], episode["consent_to_record"],
                          episode["under_supervision"]), ("Weekly", 1, True, True))
        first, second = episode["sessions"]
        self.assertEqual((first["n"], first["homework"], first["measure"]["total"]), (1, "Breathing practice", 7))
        self.assertEqual(second["process_notes"], "Restricted reflection")
        self.assertTrue(data["can_view_process_notes"])
        with platform_admin_context():
            self.assertEqual(OutcomeScore.objects.filter(patient_id=self.pid, instrument="GAD7").count(), 1)

    def test_process_notes_are_hidden_from_and_refused_for_roles_without_restricted_access(self):
        eid = self.start().data["id"]
        self.post("care-therapy-confidentiality", {}, eid)
        self.session(eid, process_notes="Restricted reflection")
        data = self.as_(self.clerk_auth, "care-client-therapy").data
        self.assertFalse(data["can_view_process_notes"])
        row = data["results"][0]["sessions"][0]
        self.assertNotIn("process_notes", row)
        self.assertTrue(row["has_process_notes"])
        self.assertEqual(self.session(eid, self.clerk_auth, process_notes="x").status_code, 403)

    def test_a_score_or_care_plan_action_from_another_client_is_refused(self):
        other = self.other_client()
        foreign = self.as_(self.auth, "care-client-assessments", {"instrument": "GAD7", "answers": [0] * 7}, other).data
        eid = self.start().data["id"]
        self.post("care-therapy-confidentiality", {}, eid)
        self.assertEqual(self.session(eid, score_id=foreign["id"]).status_code, 400)
        self.assertEqual(self.start(activity=str(uuid.uuid4())).status_code, 400)


class LabResultEntryTests(ModulesTestCase):
    def setUp(self):
        super().setUp()
        from apps.dha_interop.models import LoincCodeIndex

        with platform_admin_context():
            LoincCodeIndex.objects.get_or_create(code="TEST-1", defaults={"description": "Test analyte"})
        self.post("care-client-labs", {"codes": ["TEST-1"]})
        self.order_id = self.get("care-client-labs").data["orders"][0]["id"]

    def enter(self, **body):
        return self.post("care-lab-result", {"value": "6.9", "interpretation": "CRITICAL", **body}, self.order_id)

    def validate(self):
        from apps.lims.models import LabResult

        with platform_admin_context():
            LabResult.objects.filter(lab_order_id=self.order_id).update(is_validated=True, validated_at=timezone.now())

    def test_an_entered_result_waits_for_validation_then_shows_flagged_with_who_ordered_it(self):
        self.assertEqual(self.enter(value="").status_code, 400)
        self.assertEqual(self.enter(interpretation="HIGHISH").status_code, 400)
        entered = self.enter(unit="mmol/L")
        self.assertEqual(entered.status_code, 201, entered.data)
        self.assertEqual(entered.data["orders"][0]["status"], "RESULT_PENDING")
        self.assertEqual(entered.data["orders"][0]["ordered_by"], "Jane Njoroge")
        self.assertEqual(entered.data["results"], [])  # not visible until validated
        self.assertEqual(self.enter().status_code, 400)  # one result per order here
        self.validate()
        result = self.get("care-client-labs").data["results"][0]
        self.assertEqual((result["value"], result["abnormal"], result["critical"]), ("6.9", True, True))

    def test_only_prescribers_acknowledge(self):
        self.enter()
        self.validate()
        data = self.get("care-client-labs").data
        self.assertFalse(data["can_acknowledge"])
        rid = data["results"][0]["id"]
        self.assertEqual(self.post("care-lab-acknowledge", {}, rid).status_code, 403)
        self.assertEqual(self.as_(self.psych_auth, "care-lab-acknowledge", {}, rid).status_code, 200)
        result = self.as_(self.psych_auth, "care-client-labs").data["results"][0]
        self.assertEqual(result["acknowledged_by"], "Dr Senior")


class SlotTimesTests(ModulesTestCase):
    def test_prn_and_stat_orders_have_no_scheduled_times(self):
        prn = PrescriptionItem(is_prn=True, frequency="BD")
        stat = PrescriptionItem(frequency="Stat (once)")
        bd = PrescriptionItem(frequency="BD")
        self.assertEqual((iv.slot_times(prn), iv.slot_times(stat), len(iv.slot_times(bd))), ([], [], 2))
