"""Legal admission status — master prompt §7A acceptance tests AT-21…AT-30."""

import uuid
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Permission, PractitionerCredential, Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import EmergencyContact, Patient
from apps.clinical_encounter.models import Encounter
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Branch

from . import legal_config, legal_status
from .legal_models import LegalDocument, LegalStatus
from .models import CareTask, ClinicalAlert, TriageAssessment
from .test_care_plan import CarePlanTestCase


class LegalStatusTestCase(CarePlanTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            perm = Permission.objects.get(codename=legal_status.ADMITTING_OFFICER_PERMISSION)
            role = Role.objects.create(name=f"Admitting {uuid.uuid4().hex[:4]}", organization=self.org)
            role.permissions.add(perm)
            self.officer = User.objects.create_user(
                email=f"ao-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True, first_name="Admitting", last_name="Officer",
            )
            self.officer.roles.add(role)
            PractitionerCredential.objects.create(
                organization=self.org, user=self.psych, registration_number="REG-TEST-1",
                registration_verified_at=timezone.now(), qualifications="MBChB, MMed (Psych)",
                mha_recommendation_approved=True,
            )
            Branch.objects.create(
                organization=self.org, name="Demo Centre", facility_level="L4",
                address="1 Example Road, Testville", phone="+254700000000", email="demo@example.test",
            )
            self.encounter = Encounter.objects.create(
                organization=self.org, patient_id=self.pid, encounter_type="PSYCHIATRY_REVIEW", opened_by=self.psych,
            )
        self.officer_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.officer)[0]}"}

    # helpers
    def call(self, method, name, body=None, args=None, auth=None):
        url = reverse(name, args=args or [self.pid])
        return getattr(self.client, method)(url, body or {}, format="json", **(auth or self.auth))

    def ws(self, auth=None):
        return self.client.get(reverse("care-client-legal-status", args=[self.pid]), **(auth or self.auth)).data

    def start(self, category):
        r = self.call("post", "care-legal-application", {"category": category})
        self.assertEqual(r.status_code, 201, r.data)
        return r.data["id"]

    def save(self, doc_id, body, auth=None):
        return self.call("put", "care-legal-document", body, [doc_id], auth)

    def sign_doc(self, doc_id, body=None, auth=None):
        return self.call("post", "care-legal-document-sign", body or {"method": "ELECTRONIC", "attested": True}, [doc_id], auth)

    def decide(self, decision, reason="", auth=None):
        ls_id = self.ws()["legal_status"]["id"]
        return self.call("post", "care-legal-decision", {"decision": decision, "reason": reason}, [ls_id], auth or self.officer_auth)

    def admit_voluntary(self):
        doc = self.start("VOLUNTARY")
        self.save(doc, {"notice_acknowledged": True})
        self.assertEqual(self.sign_doc(doc).status_code, 200)
        self.assertEqual(self.decide("ADMITTED").status_code, 200)
        return doc

    def nok(self, **over):
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            person = EmergencyContact.objects.create(
                organization=self.org, patient=patient, name="Peter Kamau", relationship="SIBLING",
                phone="+254711000111", address="Box 1, Testville", **over,
            )
            patient.next_of_kin = person
            patient.save()
        return person

    def signed_involuntary_application(self):
        person = self.nok()
        doc = self.start("INVOLUNTARY")
        r = self.save(doc, {"applicant_related_person_id": str(person.pk), "assertions": ["DANGER_TO_SELF"]})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.sign_doc(doc).status_code, 200)
        return doc, person

    def signed_recommendation(self, application):
        r = self.call("post", "care-legal-recommendation", {}, [application], self.psych_auth)
        self.assertEqual(r.status_code, 201, r.data)
        rec = r.data["id"]
        grounds = {c: {"affirmed": True, "narrative": f"Clinical basis {c}"} for c in "abc"}
        self.save(rec, {"examination_date": timezone.localdate().isoformat(),
                        "examination_encounter_id": str(self.encounter.pk), "grounds": grounds}, self.psych_auth)
        signed = self.sign_doc(rec, {}, self.psych_auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        return rec


class VoluntaryTests(LegalStatusTestCase):
    def test_AT_21_sign_blocked_until_section_10_3_notice_acknowledged(self):
        doc = self.start("VOLUNTARY")
        blocked = self.sign_doc(doc)
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("notice_acknowledged", blocked.data)
        self.save(doc, {"notice_acknowledged": True})
        signed = self.sign_doc(doc)
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertTrue(signed.data["content"]["notice_acknowledged_at"])
        # The notice text shown is the config text, verbatim.
        form = self.ws()["config"]["forms"]["DOC-LEG-STAT-VOL-KE"]
        self.assertTrue(form["noticeText"]["text"].startswith("Any person received as a voluntary patient"))

    def test_AT_22_written_notice_starts_72h_countdown_and_tasks_without_conversion(self):
        self.admit_voluntary()
        ls_id = self.ws()["legal_status"]["id"]
        before = timezone.now()
        r = self.call("post", "care-legal-notice", {"method": "ELECTRONIC", "attested": True,
                                                    "statement": "I intend to leave."}, [ls_id])
        self.assertEqual(r.status_code, 201, r.data)
        banner = self.client.get(reverse("care-client-banner", args=[self.pid]), **self.auth).data["legal_status"]
        self.assertEqual(banner["category"], "VOLUNTARY")
        self.assertEqual(banner["status"], "ACTIVE")
        from datetime import datetime

        given = datetime.fromisoformat(banner["notice"]["given_at"])
        earliest = datetime.fromisoformat(banner["notice"]["earliest_departure_at"])
        self.assertEqual(earliest - given, timedelta(hours=72))
        self.assertGreaterEqual(given, before - timedelta(seconds=1))
        codes = {t["code"] for t in self.ws()["tasks"]}
        self.assertIn(legal_status.TASK_NOTICE_REVIEW, codes)
        self.assertIn(legal_status.TASK_NOTICE_DISCHARGE, codes)
        with platform_admin_context():
            self.assertTrue(ClinicalAlert.objects.filter(patient_id=self.pid, alert_code="DISCHARGE_NOTICE_ACTIVE", status="ACTIVE").exists())
            self.assertEqual(LegalStatus.all_objects.get(pk=ls_id).category, "VOLUNTARY")
        # Withdrawal clears the countdown and is audited.
        notice_id = self.ws()["notice"]["id"]
        self.assertEqual(self.call("post", "care-legal-notice-withdraw", {}, [notice_id]).status_code, 200)
        self.assertIsNone(self.ws()["banner"]["notice"])
        self.assertIn("DISCHARGE_NOTICE_WITHDRAWN", [h["event"] for h in self.ws()["history"]])

    def test_notice_with_active_risk_prompts_review_only(self):
        self.admit_voluntary()
        with platform_admin_context():
            ClinicalAlert.objects.create(organization=self.org, patient_id=self.pid, alert_code="SUICIDE_RISK", label="Suicide risk")
        ls_id = self.ws()["legal_status"]["id"]
        self.call("post", "care-legal-notice", {"method": "ELECTRONIC", "attested": True, "statement": "Leaving"}, [ls_id])
        ws = self.ws()
        self.assertEqual(ws["notice"]["risk_review_prompt"], legal_status.RISK_REVIEW_PROMPT)
        self.assertIn(legal_status.TASK_LEGAL_REVIEW, {t["code"] for t in ws["tasks"]})
        self.assertEqual(ws["legal_status"]["category"], "VOLUNTARY")

    def test_early_departure_routes_to_ama_discharge(self):
        self.admit_voluntary()
        ls_id = self.ws()["legal_status"]["id"]
        self.call("post", "care-legal-notice", {"method": "ELECTRONIC", "attested": True, "statement": "Leaving"}, [ls_id])
        r = self.call("post", "care-legal-notice-depart", {}, [self.ws()["notice"]["id"]])
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["against_medical_advice"])

    def test_AT_30_minor_self_application_routed_to_guardian_workflow(self):
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            patient.date_of_birth = timezone.localdate() - timedelta(days=365 * 15)
            patient.save()
        doc = self.start("VOLUNTARY")
        self.save(doc, {"notice_acknowledged": True})
        blocked = self.sign_doc(doc)
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.data["route"], "GUARDIAN_CONSENT")
        guardian = self.nok(is_guardian=True)
        ok = self.sign_doc(doc, {"method": "ELECTRONIC", "attested": True, "signer_kind": "GUARDIAN",
                             "related_person_id": str(guardian.pk)})
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["signer_kind"], "GUARDIAN")
        self.assertTrue(ok.data["content"]["guardian_consent_id"])

    def test_capacity_prompt_requires_clinician_confirmation_not_block(self):
        self.sign_triage(f_consciousness="drowsy")
        doc = self.start("VOLUNTARY")
        self.assertTrue(self.ws()["capacity"]["required"])
        self.save(doc, {"notice_acknowledged": True})
        blocked = self.sign_doc(doc)
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.data["capacity"], legal_status.CAPACITY_PROMPT)
        self.call("post", "care-client-capacity", {"decision": "ADMISSION", "understand": "Yes", "retain": "Yes",
                                                   "weigh": "Yes", "communicate": "Yes"})
        self.assertEqual(self.sign_doc(doc).status_code, 200)


class InvoluntaryTests(LegalStatusTestCase):
    def test_AT_23_part_a_assertion_is_third_party_report_beside_untouched_finding(self):
        self.sign_triage(d_suicidal="yes")
        with platform_admin_context():
            before = list(TriageAssessment.objects.filter(triage_encounter__patient_id=self.pid).values_list("findings", flat=True))
        doc = self.start("INVOLUNTARY")
        evidence = self.ws()["evidence"]["danger_to_self"]
        self.assertTrue(any(e["label"] == "Suicide risk" for e in evidence))
        draft = [d for d in self.ws()["documents"] if d["id"] == doc][0]
        self.assertNotIn("assertions", draft["content"])  # never auto-ticked
        person = self.nok()
        self.save(doc, {"applicant_related_person_id": str(person.pk), "assertions": ["DANGER_TO_SELF"]})
        self.assertEqual(self.sign_doc(doc).status_code, 200)
        with platform_admin_context():
            rendered = LegalDocument.all_objects.get(pk=doc).rendered
            after = list(TriageAssessment.objects.filter(triage_encounter__patient_id=self.pid).values_list("findings", flat=True))
        tick = [a for a in rendered["assertions"] if a["code"] == "DANGER_TO_SELF"][0]
        self.assertEqual((tick["ticked"], tick["source"], tick["sourceDetail"]), (True, "THIRD_PARTY_REPORT", "Peter Kamau"))
        self.assertEqual(before, after)

    def test_AT_24_non_approved_practitioner_cannot_open_or_sign(self):
        application, _ = self.signed_involuntary_application()
        r = self.call("post", "care-legal-recommendation", {}, [application])
        self.assertEqual(r.status_code, 403)
        me = self.ws()["me"]["credential"]
        self.assertFalse(me["can_sign"])
        self.assertIn("verified registration", me["reason"])

    def test_AT_25_admitted_blocked_before_recommendation_signed(self):
        self.signed_involuntary_application()
        r = self.decide("ADMITTED")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.ws()["legal_status"]["decision"], "PENDING")
        # And a non-officer can never decide.
        self.assertEqual(self.decide("REJECTED", "x", auth=self.auth).status_code, 403)

    def test_AT_26_admitted_creates_status_banner_expiry_and_review_task(self):
        application, _ = self.signed_involuntary_application()
        self.signed_recommendation(application)
        self.assertEqual(self.ws()["legal_status"]["workflow_state"], "RECOMMENDATION_SIGNED")
        self.assertEqual(self.decide("ADMITTED").status_code, 200)
        ws = self.ws()
        ls = ws["legal_status"]
        self.assertEqual((ls["category"], ls["status"], ls["decision"]), ("INVOLUNTARY", "ACTIVE", "ADMITTED"))
        from datetime import datetime

        effective, expiry = datetime.fromisoformat(ls["effective_from"]), datetime.fromisoformat(ls["max_expiry_at"])
        self.assertLessEqual(expiry, legal_status.add_months(effective, 6))
        self.assertGreater(expiry, effective + timedelta(days=170))
        banner = self.client.get(reverse("care-client-banner", args=[self.pid]), **self.auth).data["legal_status"]
        self.assertIn("INVOLUNTARY", banner["label"])
        self.assertIn("expires", banner["label"])
        review = [t for t in ws["tasks"] if t["code"] == legal_status.TASK_EXPIRY_REVIEW]
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["priority"], "urgent")
        self.assertTrue(review[0]["due_at"])
        self.assertIn(legal_status.TASK_RIGHTS, {t["code"] for t in ws["tasks"]})
        with platform_admin_context():
            self.assertTrue(ClinicalAlert.objects.filter(patient_id=self.pid, alert_code="INVOLUNTARY_STATUS", status="ACTIVE").exists())

    def test_expiry_without_decision_raises_expired_alert(self):
        application, _ = self.signed_involuntary_application()
        self.signed_recommendation(application)
        self.decide("ADMITTED")
        with platform_admin_context():
            ls = LegalStatus.all_objects.get(patient_id=self.pid)
            legal_status.sweep(ls, now=ls.max_expiry_at + timedelta(minutes=1))
            ls.refresh_from_db()
            self.assertEqual(ls.status, "EXPIRED")
            self.assertTrue(ClinicalAlert.objects.filter(patient_id=self.pid, alert_code="LEGAL_STATUS_EXPIRED", status="ACTIVE").exists())

    def test_conversion_to_voluntary_needs_a_new_signed_application(self):
        application, _ = self.signed_involuntary_application()
        self.signed_recommendation(application)
        self.decide("ADMITTED")
        self.assertEqual(self.decide("ADMITTED").status_code, 400)  # nothing pending
        vol = self.start("VOLUNTARY")
        self.assertEqual(self.ws()["legal_status"]["category"], "INVOLUNTARY")  # unchanged until decided
        self.save(vol, {"notice_acknowledged": True})
        self.sign_doc(vol)
        self.assertEqual(self.decide("ADMITTED").status_code, 200)
        ws = self.ws()
        self.assertEqual(ws["legal_status"]["category"], "VOLUNTARY")
        self.assertIn("CONVERTED", [h["event"] for h in ws["history"]])

    def test_AT_27_rejection_requires_reason_and_is_audited(self):
        self.signed_involuntary_application()
        self.assertEqual(self.decide("REJECTED").status_code, 400)
        r = self.decide("REJECTED", "Criteria not met on assessment")
        self.assertEqual(r.status_code, 200, r.data)
        ws = self.ws()
        self.assertEqual((ws["legal_status"]["decision"], ws["legal_status"]["decision_reason"]),
                         ("REJECTED", "Criteria not met on assessment"))
        rejected = [h for h in ws["history"] if h["event"] == "REJECTED"][0]
        self.assertEqual(rejected["detail"]["reason"], "Criteria not met on assessment")
        self.assertTrue(rejected["actor"])
        with platform_admin_context():
            self.assertTrue(AuditLogEntry.objects.filter(model="care_pathway.legalstatus", object_id=ws["legal_status"]["id"]).exists())

    def test_AT_28_applicant_is_existing_nok_prefilled_no_duplicate(self):
        person = self.nok()
        ws = self.ws()
        self.assertEqual(ws["next_of_kin_id"], str(person.pk))
        self.assertEqual(ws["related_persons"][0]["name"], "Peter Kamau")
        with platform_admin_context():
            count = EmergencyContact.objects.filter(patient_id=self.pid).count()
        doc = self.start("INVOLUNTARY")
        r = self.save(doc, {"applicant_related_person_id": str(person.pk), "applicant_relationship_detail": "Elder brother",
                            "applicant_id_number": "12345678"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["content"]["applicant_related_person_id"], str(person.pk))
        with platform_admin_context():
            self.assertEqual(EmergencyContact.objects.filter(patient_id=self.pid).count(), count)
            self.assertEqual(EmergencyContact.objects.get(pk=person.pk).id_number, "12345678")
        # Masked in the workspace; unmasking needs the permission.
        self.assertEqual(self.ws()["related_persons"][0]["id_number_masked"], "•••••678")
        ls_id = self.ws()["legal_status"]["id"]
        denied = self.client.get(reverse("care-legal-identity", args=[ls_id]),
                                 {"subject": "applicant", "related_person_id": str(person.pk)}, **self.auth)
        self.assertEqual(denied.status_code, 403)
        bad_phone = self.save(doc, {"applicant_related_person_id": str(person.pk), "applicant_phone": "0711 000"})
        self.assertEqual(bad_phone.status_code, 400)

    def test_AT_29_printed_form_layout_footer_and_immutability(self):
        application, _ = self.signed_involuntary_application()
        rec = self.signed_recommendation(application)
        self.decide("ADMITTED")
        html = self.client.get(reverse("care-legal-document-print", args=[application]), **self.auth).content.decode()
        form = legal_config.form("DOC-LEG-STAT-INV-APP-KE")
        for expected in (form["title"], form["statuteLine"], "FOR OFFICIAL USE ONLY", "Part A", "Part B",
                         "1 Example Road, Testville", "DOC-LEG-STAT-INV-APP-KE/", "version 1", "generated"):
            self.assertIn(expected, html)
        rec_html = self.client.get(reverse("care-legal-document-print", args=[rec]), **self.auth).content.decode()
        self.assertIn("REG-TEST-1", rec_html)
        self.assertIn("expressing willingness or unwillingness", rec_html)  # Declaration 3(b)
        self.assertIn("making informed decisions", rec_html)  # Declaration 4 — both kept (OQ-19)
        # Signed = immutable; corrections are amendments with reason; the old version is kept.
        self.assertEqual(self.save(application, {"assertions": ["OTHER"]}).status_code, 400)
        with platform_admin_context():
            doc = LegalDocument.all_objects.get(pk=application)
            doc.content = {"tampered": True}
            with self.assertRaises(PermissionError):
                doc.save()
            patient = Patient.objects.get(pk=self.pid)
            patient.first_name = "Renamed"
            patient.save()
        again = self.client.get(reverse("care-legal-document-print", args=[application]), **self.auth).content.decode()
        self.assertNotIn("Renamed", again.split("Part B")[0])  # printed from the signed snapshot
        self.assertEqual(self.call("post", "care-legal-document-amend", {}, [application]).status_code, 400)
        amended = self.call("post", "care-legal-document-amend", {"reason": "Applicant address corrected"}, [application])
        self.assertEqual(amended.status_code, 201)
        self.assertEqual((amended.data["version"], amended.data["supersedes"]), (2, application))
        docs = {d["id"]: d for d in self.ws()["documents"]}
        self.assertTrue(docs[application]["superseded"])
        self.assertEqual(docs[application]["status"], "SIGNED")

    def test_rights_text_is_never_invented(self):
        rights = self.ws()["config"]["rights"]
        self.assertEqual(rights["text"], "")
        self.assertEqual(rights["notConfiguredLabel"], "Rights text not configured — VERIFY with legal counsel")
        with platform_admin_context():
            self.assertFalse(CareTask.objects.filter(patient_id=self.pid, focus_type="LegalStatus").exists())

    def test_linked_admission_legal_fields_belong_to_the_legal_status(self):
        from apps.ipd_ward.models import Admission
        from apps.ipd_ward.serializers import AdmissionSerializer

        adm = Admission(legal_status_record_id=uuid.uuid4(), admission_type="VOLUNTARY")
        s = AdmissionSerializer(instance=adm, data={"admission_type": "INVOLUNTARY"}, partial=True)
        self.assertFalse(s.is_valid())
        self.assertIn("admission_type", s.errors)


