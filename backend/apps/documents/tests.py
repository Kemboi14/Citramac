"""Document generation (master prompt §6) — catalogue, rule engine, workflow and
acceptance tests AT-10…AT-13 by ID, plus the DOC-UX-03 reference flow."""

import json
import uuid

from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway import services
from apps.care_pathway.models import IntakeAssessment
from apps.client_registry.consent import capture_consent
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import (
    DiagnosisCode,
    Encounter,
    Prescription,
    PrescriptionItem,
)
from apps.dha_interop.models import IcdCodeIndex, NationalDrugIndex
from apps.ipd_ward.models import Admission, Bed, Ward
from apps.mhp_program.models import PsychotherapySession
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from . import catalogue
from .bindings import BINDINGS
from .models import DisclosureRecord, DocumentEvent, GeneratedDocument

THERAPY_SECRET = "SYNTHETIC-THERAPY-CONTENT-7731"


class CatalogueTests(SimpleTestCase):
    def test_catalogue_has_14_categories_and_111_document_types(self):
        # 108 DOC-CAT templates + the 3 statutory MH forms of LGL-DOC-01.
        specs = catalogue.templates()
        self.assertEqual(len(catalogue.CATEGORIES), 14)
        self.assertEqual(len(specs), 111)
        expected = {
            "WRK": 9,
            "EDU": 10,
            "REF": 5,
            "INV": 7,
            "MED": 6,
            "ADM": 8,
            "TRF": 5,
            "DIS": 8,
            "CON": 11,
            "FAM": 6,
            "RPT": 8,
            "INS": 8,
            "LEG": 12,
            "PAT": 8,
        }
        counts = {code: 0 for code, _ in catalogue.CATEGORIES}
        for spec in specs.values():
            counts[spec["category"]] += 1
        self.assertEqual(counts, expected)

    def test_ids_are_unique_and_follow_doc_cat_nn(self):
        for doc_id, spec in catalogue.templates().items():
            if catalogue.is_legal(spec):
                # LGL-DOC-01 keeps the legal module's own IDs.
                self.assertIn(doc_id, catalogue.LEGAL_TEMPLATE_IDS)
            else:
                self.assertRegex(doc_id, r"^DOC-[A-Z]{3}-\d{2}$")
            self.assertTrue(doc_id.startswith(f"DOC-{spec['category']}-"))

    def test_every_template_carries_all_ten_doc_spec_fields(self):
        for doc_id, spec in catalogue.templates().items():
            for field in catalogue.SPEC_FIELDS:
                self.assertIn(field, spec, f"{doc_id} missing {field}")
                self.assertTrue(spec[field], f"{doc_id} has empty {field}")
            auth = spec["authorization"]
            for action in ("generate", "review", "approve", "sign", "release"):
                if action == "sign" and catalogue.is_legal(spec):
                    # LGL-DOC-02: signed in the legal module, never here.
                    self.assertEqual(auth["sign"], [])
                    self.assertEqual(auth["signedIn"], "LEGAL_MODULE")
                    self.assertTrue(auth["signingRoles"]["sign"])
                    continue
                self.assertTrue(auth[action], f"{doc_id} has no {action} roles")
            for row in spec["autoPopulated"]:
                self.assertIn(row["key"], BINDINGS)
            for field in spec["userEntered"]:
                self.assertIn(field["key"], catalogue.USER_FIELDS)
            self.assertIn(spec["contentStatus"], ("READY", "VERIFY"))
            if spec["contentStatus"] == "VERIFY":
                self.assertIn("VERIFY", spec["verifyNote"])

    def test_doc_ux_01_each_document_in_exactly_one_category(self):
        names = [s["name"] for s in catalogue.templates().values()]
        self.assertEqual(len(names), len(set(names)))
        for spec in catalogue.templates().values():
            self.assertIsInstance(spec["category"], str)
            self.assertIn(spec["category"], catalogue.CATEGORY_NAMES)

    def test_doc_ux_02_search_by_name_and_tag(self):
        by_name = [s["documentId"] for s in catalogue.search("academic extension")]
        self.assertEqual(by_name, ["DOC-EDU-02"])
        by_tag = {s["documentId"] for s in catalogue.search("sick note")}
        self.assertIn("DOC-WRK-01", by_tag)
        self.assertEqual(len(catalogue.search("", "CON")), 11)

    def test_no_template_binds_psychotherapy_content(self):
        for spec in catalogue.templates().values():
            self.assertNotIn("PSYCHOTHERAPY", spec["boundClasses"])

    def test_legal_templates_are_high_risk_and_prescription_is_prescriber_only(self):
        for spec in catalogue.search("", "LEG"):
            self.assertTrue(spec["highRisk"])
            self.assertTrue(spec["authorization"]["mandatoryIndependentReview"])
        rx = catalogue.get("DOC-MED-01")
        self.assertTrue(rx["authorization"]["prescribingRestricted"])
        for action in ("generate", "sign", "release"):
            self.assertEqual(rx["authorization"][action], ["PRESCRIBERS"])


    def test_lgl_doc_01_statutory_forms_use_the_legal_modules_doc_spec(self):
        from apps.care_pathway import legal_config

        served = {t["documentId"]: t for t in legal_config.document_templates()}
        self.assertEqual(sorted(catalogue.LEGAL_TEMPLATE_IDS), sorted(served))
        for doc_id in catalogue.LEGAL_TEMPLATE_IDS:
            spec = catalogue.get(doc_id)
            self.assertEqual(spec["category"], "LEG")
            self.assertTrue(spec["highRisk"])
            self.assertEqual(spec["trigger"], served[doc_id]["trigger"])
            self.assertEqual(spec["legalSpec"], served[doc_id])
            self.assertEqual(
                spec["authorization"]["signingRoles"]["sign"],
                served[doc_id]["authorization"]["sign"],
            )
            # Release always goes through the DOC-CI-06 consent check.
            self.assertIn("DOC-CI-06", [r["id"] for r in spec["conditionalRules"]])
            self.assertNotIn("FILE_IN_CHART", spec["outputs"])


class DocumentFixture(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Synthetic Wellness Centre",
                slug=f"org-{uuid.uuid4().hex[:6]}",
                facility_type="MENTAL_HEALTH_MHP",
            )
            self.psychiatrist = self._user("psych", "Psychiatrist")
            self.therapist = self._user("therapist", "Therapist")
            self.nurse = self._user("nurse", "Nurse")
            self.records = self._user("records", "Records Officer")
            self.supervisor = self._user("supervisor", "Clinical Supervisor")
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Test",
                last_name="Client-Synthetic",
                gender="FEMALE",
                date_of_birth="2001-05-02",
                citramac_number="CIT-SYN-001",
                occupation="Synthetic accounts clerk",
            )
            self.episode = services.get_or_open_episode(self.patient, self.psychiatrist)
            self.encounter = Encounter.objects.create(
                organization=self.org,
                patient=self.patient,
                episode=self.episode,
                opened_by=self.psychiatrist,
                encounter_type="OUTPATIENT",
            )
            icd = IcdCodeIndex.objects.get_or_create(
                code="6A70", defaults={"description": "Single episode depressive disorder"}
            )[0]
            DiagnosisCode.objects.create(
                organization=self.org, encounter=self.encounter, icd11_code=icd, is_primary=True
            )
            drug = NationalDrugIndex.objects.get_or_create(
                code="DRUG-SYN-1",
                defaults={"generic_name": "Lithium carbonate", "strength": "400 mg"},
            )[0]
            rx = Prescription.objects.create(
                organization=self.org, encounter=self.encounter, prescribed_by=self.psychiatrist
            )
            self.item = PrescriptionItem.objects.create(
                organization=self.org,
                prescription=rx,
                drug=drug,
                dose="400 mg",
                route="Oral",
                frequency="Nocte",
                indication="Mood stabilisation",
            )
            IntakeAssessment.objects.create(
                organization=self.org,
                patient=self.patient,
                episode=self.episode,
                status="SIGNED",
                signed_at=timezone.now(),
                version=1,
                sections={
                    "sx": {"work": "SIGNIFICANTLY_AFFECTED"},
                    "edu": {
                        "education": "BSc year 2, Synthetic University",
                        "impact": "Unable to meet coursework deadlines this term",
                    },
                    "subs": {"kind": "ALCOHOL"},
                },
            )
            PsychotherapySession.objects.create(
                organization=self.org,
                patient=self.patient,
                session_type="INDIVIDUAL",
                therapist=self.therapist,
                session_notes=THERAPY_SECRET,
            )

    def _user(self, name, role):
        user = User.objects.create_user(
            email=f"{name}-{uuid.uuid4().hex[:5]}@org.test",
            password="Password123!",
            organization=self.org,
            is_active=True,
            first_name=name.title(),
            last_name="Synthetic",
        )
        user.roles.add(Role.objects.get(name=role, organization__isnull=True))
        return user

    @staticmethod
    def auth(user):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}"}

    def consent(self, consent_type, scope=(), recipient="", decision="YES"):
        with platform_admin_context():
            return capture_consent(
                self.patient,
                self.records,
                decision == "YES",
                "STRUCTURED-SCOPE-1",
                "Synthetic structured authorization",
                consent_type=consent_type,
                decision=decision,
                recipient=recipient,
                disclosure_scope=list(scope),
            )

    def generate(self, template_id, user=None, **data):
        payload = {"template_id": template_id, "patient_id": str(self.patient.id), **data}
        return self.client.post(
            reverse("documents-generated"),
            payload,
            format="json",
            **self.auth(user or self.psychiatrist),
        )

    def act(self, doc_id, action, user=None, **data):
        return self.client.post(
            reverse("documents-transition", args=[doc_id]),
            {"action": action, **data},
            format="json",
            **self.auth(user or self.psychiatrist),
        )

    def employer_letter(self, **inputs):
        return self.generate(
            "DOC-WRK-01",
            recipient_type="EMPLOYER",
            recipient_name="HR Manager",
            recipient_organization="Synthetic Logistics Ltd",
            purpose="Sick leave",
            inputs={"period_from": "2026-10-10", "period_to": "2026-10-24", **inputs},
        )

    @staticmethod
    def classes(response):
        return [s["class"] for s in response.data["content"]["sections"]]


class AcceptanceTests(DocumentFixture):
    def test_AT_10_employer_letter_without_consent_is_blocked(self):
        response = self.employer_letter()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "BLOCKED_CONSENT")
        blocked = response.data["block"]["blocked"]
        self.assertEqual(blocked["rule"], "DOC-CI-06")
        self.assertEqual(blocked["consent_type"], "EMPLOYER_COMMUNICATION")
        self.assertEqual(blocked["prompt"], "RECORD_AUTHORIZATION")
        self.assertNotIn("submit", response.data["allowed_actions"])
        refused = self.act(response.data["id"], "submit")
        self.assertEqual(refused.status_code, 400)
        # Recording the authorization (the prompt) unblocks it.
        self.client.post(
            reverse("documents-authorizations"),
            {
                "patient_id": str(self.patient.id),
                "consent_type": "EMPLOYER_COMMUNICATION",
                "disclosure_scope": ["FUNCTIONAL"],
                "evidence": "Signed form ref SYN-1",
            },
            format="json",
            **self.auth(self.records),
        )
        rechecked = self.act(response.data["id"], "recheck_consent")
        self.assertEqual(rechecked.data["status"], "DRAFT")

    def test_AT_11_consented_employer_letter_has_functional_info_only(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        response = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED")
        self.assertEqual(response.data["status"], "DRAFT")
        classes = self.classes(response)
        self.assertIn("FUNCTIONAL", classes)
        for forbidden in ("DIAGNOSIS", "MEDICATION", "SUBSTANCE_USE", "RISK", "PSYCHOTHERAPY"):
            self.assertNotIn(forbidden, classes)
        text = json.dumps(response.data["content"])
        self.assertNotIn("6A70", text)
        self.assertNotIn("depressive", text.lower())
        self.assertNotIn(THERAPY_SECRET, text)
        self.assertNotIn("Lithium", text)
        fired = {t["rule"] for t in response.data["rule_trace"] if t["fired"]}
        self.assertTrue({"DOC-CI-02", "DOC-CI-04", "DOC-CI-06"} <= fired)

    def test_AT_11_diagnosis_marked_necessary_but_outside_consent_scope_stays_out(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        response = self.employer_letter(diagnosis_disclosure="AUTHORIZED_NECESSARY")
        self.assertNotIn("DIAGNOSIS", self.classes(response))
        self.assertTrue(response.data["block"]["warnings"])

    def test_AT_12_non_prescriber_cannot_generate_a_prescription(self):
        detail = self.client.get(
            reverse("documents-template", args=["DOC-MED-01"]), **self.auth(self.therapist)
        )
        self.assertFalse(detail.data["permissions"]["generate"])
        listing = self.client.get(
            reverse("documents-catalogue") + "?category=MED", **self.auth(self.therapist)
        )
        rx = next(r for r in listing.data["results"] if r["documentId"] == "DOC-MED-01")
        self.assertFalse(rx["can_generate"])
        response = self.generate("DOC-MED-01", user=self.therapist, recipient_type="PATIENT")
        self.assertEqual(response.status_code, 403)
        self.assertIn("DOC-GOV-08", json.dumps(response.data))
        allowed = self.generate("DOC-MED-01", user=self.psychiatrist, recipient_type="PATIENT")
        self.assertEqual(allowed.status_code, 201)

    def test_AT_13_release_creates_disclosure_record(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        doc_id = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED").data["id"]
        self.assertEqual(self.act(doc_id, "submit", self.therapist).status_code, 200)
        self.assertEqual(self.act(doc_id, "sign").status_code, 200)
        released = self.act(doc_id, "release", self.records, channel="RECORDED_RELEASE")
        self.assertEqual(released.status_code, 200, released.data)
        self.assertEqual(released.data["status"], "RELEASED")
        with platform_admin_context():
            record = DisclosureRecord.objects.get(document_id=doc_id)
            doc = GeneratedDocument.objects.get(pk=doc_id)
        self.assertEqual(record.template_id, "DOC-WRK-01")
        self.assertEqual(record.document_number, doc.document_number)
        self.assertEqual(record.document_version, 1)
        self.assertEqual(record.recipient_organization, "Synthetic Logistics Ltd")
        self.assertEqual(record.purpose, "Sick leave")
        self.assertEqual(record.released_by_id, self.records.id)
        self.assertIsNotNone(record.released_at)
        self.assertEqual(record.legal_basis, "CONSENT")
        self.assertIsNotNone(record.consent_record_id)
        self.assertEqual(record.content_hash, doc.content_hash)
        log = self.client.get(
            reverse("documents-disclosures") + f"?patient={self.patient.id}",
            **self.auth(self.records),
        )
        self.assertEqual(len(log.data["results"]), 1)

    def test_release_rechecks_consent_and_blocks_if_withdrawn(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        doc_id = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED").data["id"]
        self.act(doc_id, "submit")
        self.act(doc_id, "sign")
        self.consent("EMPLOYER_COMMUNICATION", decision="NO")
        response = self.act(doc_id, "release", self.records)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["status"], "BLOCKED_CONSENT")
        self.assertEqual(response.data["blocked_from"], "SIGNED")
        with platform_admin_context():
            self.assertFalse(DisclosureRecord.objects.filter(document_id=doc_id).exists())


class ReferenceFlowTests(DocumentFixture):
    """DOC-UX-03: School & University → Academic Extension Request, end to end."""

    def test_academic_extension_request_end_to_end(self):
        spec = self.client.get(
            reverse("documents-template", args=["DOC-EDU-02"]), **self.auth(self.psychiatrist)
        ).data
        asked = {f["key"] for f in spec["userEntered"]}
        self.assertEqual(
            asked,
            {
                "recipient_name",
                "recipient_organization",
                "purpose",
                "diagnosis_disclosure",
                "extension_period",
                "clinician_comment",
            },
        )
        self.consent("SCHOOL_COMMUNICATION", scope=["FUNCTIONAL"], recipient="Synthetic University")
        response = self.generate(
            "DOC-EDU-02",
            recipient_type="SCHOOL",
            recipient_name="Dean of Students",
            recipient_organization="Synthetic University",
            purpose="Coursework extension",
            inputs={
                "extension_period": "Two weeks",
                "diagnosis_disclosure": "NOT_NECESSARY",
                "clinician_comment": "Attending weekly reviews.",
            },
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "DRAFT")
        self.assertEqual(response.data["watermark"], "DRAFT — CLINICIAN REVIEW REQUIRED")
        content = response.data["content"]
        subject = {i["key"]: i["value"] for i in content["subject"]}
        self.assertEqual(subject["patient.full_name"], "Test Client-Synthetic")
        sections = {s["class"]: {i["key"]: i for i in s["items"]} for s in content["sections"]}
        self.assertEqual(
            sections["OCCUPATION"]["intake.current_study"]["value"],
            "BSc year 2, Synthetic University",
        )
        self.assertIn("episode.period_start", sections["ADMINISTRATIVE"])
        impact = sections["FUNCTIONAL"]["intake.study_work_impact"]
        self.assertEqual(impact["source"], "CLINICIAN_OBSERVATION")
        self.assertTrue(impact["recorded_at"])
        self.assertNotIn("DIAGNOSIS", sections)
        self.assertEqual(content["facility"]["name"], "Synthetic Wellness Centre")
        self.assertEqual(content["author"]["credentials"], "Psychiatrist")
        self.assertEqual(content["request"][0]["value"], "Two weeks")
        doc_id = response.data["id"]
        for action, user in (
            ("submit", self.psychiatrist),
            ("sign", self.psychiatrist),
            ("release", self.records),
            ("file", self.records),
        ):
            step = self.act(doc_id, action, user, channel="PDF")
            self.assertEqual(step.status_code, 200, (action, step.data))
        final = self.client.get(
            reverse("documents-generated-detail", args=[doc_id]), **self.auth(self.psychiatrist)
        ).data
        self.assertEqual(final["status"], "FILED")
        self.assertEqual(final["watermark"], "")
        self.assertEqual(
            [e["action"] for e in final["events"]],
            ["generate", "submit", "sign", "release", "file"],
        )
        self.assertEqual(len(final["disclosures"]), 1)
        self.assertTrue(final["content_hash"])


class WorkflowTests(DocumentFixture):
    def _signed(self):
        doc_id = self.generate("DOC-MED-02", recipient_type="PATIENT").data["id"]
        self.act(doc_id, "submit")
        self.act(doc_id, "sign")
        return doc_id

    def test_illegal_transitions_are_refused(self):
        doc_id = self.generate("DOC-MED-02", recipient_type="PATIENT").data["id"]
        self.assertEqual(self.act(doc_id, "sign").status_code, 400)
        self.assertEqual(self.act(doc_id, "release", self.records).status_code, 400)
        self.assertEqual(self.act(doc_id, "teleport").status_code, 400)

    def test_every_transition_is_audited(self):
        doc_id = self._signed()
        with platform_admin_context():
            actions = list(
                DocumentEvent.objects.filter(document_id=doc_id).values_list(
                    "action", "from_status", "to_status"
                )
            )
        self.assertEqual(
            actions,
            [
                ("generate", "", "DRAFT"),
                ("submit", "DRAFT", "IN_REVIEW"),
                ("sign", "IN_REVIEW", "SIGNED"),
            ],
        )

    def test_signed_version_is_immutable(self):
        doc_id = self._signed()
        with platform_admin_context():
            doc = GeneratedDocument.objects.get(pk=doc_id)
            doc.content = {"title": "tampered"}
            with self.assertRaises(PermissionError):
                doc.save()
            event = DocumentEvent.objects.filter(document_id=doc_id).first()
            with self.assertRaises(PermissionError):
                event.save()
        refused = self.client.patch(
            reverse("documents-generated-detail", args=[doc_id]),
            {"inputs": {}},
            format="json",
            **self.auth(self.psychiatrist),
        )
        self.assertEqual(refused.status_code, 400)

    def test_correction_is_a_new_version_with_reason(self):
        doc_id = self._signed()
        self.assertEqual(self.act(doc_id, "amend").status_code, 400)
        response = self.act(doc_id, "amend", reason="Dose transcribed incorrectly")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["version"], 2)
        self.assertEqual(response.data["supersedes_id"], doc_id)
        self.assertEqual(response.data["status"], "DRAFT")
        self.assertEqual(self.act(doc_id, "amend", reason="again").status_code, 400)
        with platform_admin_context():
            self.assertEqual(GeneratedDocument.objects.get(pk=doc_id).status, "SIGNED")

    def test_high_risk_document_needs_independent_review(self):
        doc_id = self.generate(
            "DOC-RPT-04",
            recipient_type="INTERNAL_TEAM",
            user=self.psychiatrist,
            inputs={
                "risk_formulation": "Synthetic formulation",
                "management_plan": "Synthetic plan",
            },
        ).data["id"]
        self.act(doc_id, "submit")
        self.assertEqual(self.act(doc_id, "sign").status_code, 400)
        self.assertEqual(self.act(doc_id, "approve").status_code, 403)
        self.assertEqual(self.act(doc_id, "approve", self.supervisor).status_code, 200)
        self.assertEqual(self.act(doc_id, "sign").status_code, 200)

    def test_verify_template_stays_a_structured_draft(self):
        response = self.generate("DOC-CON-08", recipient_type="PATIENT")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["content_status"], "VERIFY")
        self.assertNotIn("submit", response.data["allowed_actions"])
        self.assertEqual(self.act(response.data["id"], "submit").status_code, 400)

    def test_nurse_cannot_sign_and_missing_fields_block_submit(self):
        response = self.generate("DOC-WRK-04", user=self.nurse, recipient_type="PATIENT")
        self.assertEqual(response.status_code, 201)
        doc_id = response.data["id"]
        submitted = self.act(doc_id, "submit", self.nurse)
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.assertEqual(self.act(doc_id, "sign", self.nurse).status_code, 403)
        missing = self.generate("DOC-EDU-03", recipient_type="PATIENT").data
        self.assertIn("examinations", missing["block"]["missing"])
        self.assertEqual(self.act(missing["id"], "submit").status_code, 400)

    def test_viewing_a_document_is_audit_logged(self):
        doc_id = self.generate("DOC-MED-02", recipient_type="PATIENT").data["id"]
        self.client.get(
            reverse("documents-generated-detail", args=[doc_id]), **self.auth(self.psychiatrist)
        )
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    action="VIEW", model="documents.generateddocument", object_id=doc_id
                ).exists()
            )


class RuleEngineTests(DocumentFixture):
    def test_doc_ci_01_admission_dates_only_when_admitted(self):
        self.consent("EMPLOYER_COMMUNICATION", scope=["FUNCTIONAL"])
        before = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED")
        self.assertNotIn("ADMISSION", self.classes(before))
        with platform_admin_context():
            ward = Ward.objects.create(organization=self.org, name="Synthetic Ward")
            bed = Bed.objects.create(
                organization=self.org, ward=ward, bed_number="S1", status="OCCUPIED"
            )
            Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=bed,
                encounter=self.encounter,
                episode=self.episode,
                admitted_by=self.psychiatrist,
            )
        after = self.employer_letter(diagnosis_disclosure="NOT_AUTHORIZED")
        self.assertIn("ADMISSION", self.classes(after))

    def test_doc_ci_03_transfer_with_risk_requires_safety_requirements(self):
        with platform_admin_context():
            IntakeAssessment.objects.filter(patient=self.patient).update(risk_level="HIGH")
        response = self.generate(
            "DOC-TRF-02",
            recipient_type="INTERNAL_TEAM",
            inputs={"transfer_reason": "Synthetic move"},
        )
        self.assertIn("RISK", self.classes(response))
        self.assertIn("immediate_safety_requirements", response.data["block"]["missing"])

    def test_doc_ci_05_treating_clinician_gets_only_authorized_selection(self):
        self.consent("RELEASE_OF_INFORMATION", scope=["MEDICATION", "ALLERGY"])
        response = self.generate(
            "DOC-TRF-05",
            recipient_type="TREATING_CLINICIAN",
            recipient_name="Dr Synthetic",
            recipient_organization="Synthetic Clinic",
            purpose="Continuity",
            inputs={"include_classes": ["MEDICATION", "ALLERGY", "RISK"]},
        )
        classes = self.classes(response)
        self.assertIn("MEDICATION", classes)
        self.assertIn("ALLERGY", classes)
        self.assertNotIn("RISK", classes)
        self.assertNotIn("DIAGNOSIS", classes)

    def test_doc_ci_07_monitoring_fields_adapt_to_the_selected_medication(self):
        response = self.generate("DOC-INV-03", recipient_type="DIAGNOSTIC_SERVICE")
        block = next(b for b in response.data["block"]["dynamic"] if b["rule"] == "DOC-CI-07")
        self.assertEqual(block["available"][0]["medication"], "Lithium carbonate 400 mg")
        self.assertEqual(block["available"][0]["configured_codes"], [])
        self.assertIn("monitoring", response.data["block"]["missing"])
        with override_settings(DOC_MEDICATION_MONITORING={"DRUG-SYN-1": ["SYN-0001"]}):
            edited = self.client.patch(
                reverse("documents-generated-detail", args=[response.data["id"]]),
                {"inputs": {"monitoring": [{"item_id": str(self.item.id), "codes": []}]}},
                format="json",
                **self.auth(self.psychiatrist),
            )
        group = edited.data["content"]["monitoring"][0]
        self.assertEqual(group["indication"], "Mood stabilisation")
        self.assertEqual(group["codes"], ["SYN-0001"])
        self.assertNotIn("monitoring", edited.data["block"]["missing"])

    def test_doc_ci_08_referral_destination_drives_content(self):
        response = self.generate(
            "DOC-REF-01",
            recipient_type="INTERNAL_TEAM",
            inputs={"referral_destination": "DIETITIAN", "referral_reason": "Synthetic"},
        )
        classes = self.classes(response)
        self.assertIn("ALLERGY", classes)
        self.assertNotIn("SUBSTANCE_USE", classes)
        self.assertNotIn("RISK", classes)
        other = self.generate(
            "DOC-REF-01",
            recipient_type="INTERNAL_TEAM",
            inputs={"referral_destination": "OTHER_SPECIALIST", "referral_reason": "Synthetic"},
        )
        self.assertIn("specialty_name", other.data["block"]["missing"])

    def test_values_carry_source_and_time_and_missing_is_not_recorded_not_denied(self):
        response = self.generate("DOC-RPT-01", recipient_type="INTERNAL_TEAM")
        for section in response.data["content"]["sections"]:
            for item in section["items"]:
                if item["value"] is not None:
                    self.assertTrue(item["source"])
        text = json.dumps(response.data["content"]).lower()
        self.assertNotIn("denies", text)
        self.assertNotIn(THERAPY_SECRET.lower(), text)

    def test_family_letter_uses_family_involvement_consent(self):
        response = self.generate(
            "DOC-FAM-02",
            recipient_type="FAMILY",
            recipient_organization="Family",
            purpose="Meeting",
            inputs={"meeting_datetime": "2026-11-01T10:00"},
        )
        self.assertEqual(response.data["status"], "BLOCKED_CONSENT")
        self.assertEqual(response.data["block"]["blocked"]["consent_type"], "FAMILY_INVOLVEMENT")


class StatutoryFormReleaseTests(DocumentFixture):
    """LGL-DOC-05: a signed statutory form is released through the documents
    workflow — consent / authorization check and a DisclosureRecord — and the
    release links the legal module's LegalDocument instead of copying it."""

    def setUp(self):
        super().setUp()
        from apps.care_pathway.legal_models import LegalDocument, LegalStatus

        with platform_admin_context():
            self.legal_status = LegalStatus.objects.create(
                organization=self.org,
                patient=self.patient,
                episode=self.episode,
                config_version="KE-MHA-FORMS-1",
                category="VOLUNTARY",
            )
            self.form = LegalDocument.objects.create(
                organization=self.org,
                legal_status=self.legal_status,
                patient=self.patient,
                template_id="DOC-LEG-STAT-VOL-KE",
                config_version="KE-MHA-FORMS-1",
                status="SIGNED",
                rendered={"title": "Synthetic signed form"},
                signer_kind="CLIENT",
                signer_name="Test Client-Synthetic",
                signed_at=timezone.now(),
                captured_by=self.psychiatrist,
            )

    def release_record(self, **data):
        return self.generate(
            "DOC-LEG-STAT-VOL-KE",
            legal_document_id=str(self.form.id),
            recipient_type="LEGAL",
            recipient_name="Registrar",
            recipient_organization="Synthetic Magistrates Court",
            purpose="Hearing bundle",
            **data,
        )

    def test_release_needs_a_signed_legal_document(self):
        response = self.generate("DOC-LEG-STAT-VOL-KE", recipient_type="LEGAL")
        self.assertEqual(response.status_code, 400)
        self.assertIn("legal_document_id", response.data)

    def test_release_record_links_the_form_and_starts_signed(self):
        response = self.release_record()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "SIGNED")
        self.assertEqual(response.data["legal_document_id"], str(self.form.id))
        self.assertEqual(response.data["source"], "LEGAL_MODULE")
        self.assertNotIn("sections", response.data["content"])
        # Never sign / approve / amend here — only release (or file).
        self.assertEqual(response.data["allowed_actions"], ["release", "file"])
        for action in ("sign", "amend", "approve"):
            self.assertEqual(self.act(response.data["id"], action).status_code, 400, action)

    def test_release_without_authorization_is_blocked_then_recorded(self):
        doc_id = self.release_record().data["id"]
        blocked = self.act(doc_id, "release", self.records)
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data["block"]["blocked"]["rule"], "DOC-CI-06")
        self.assertFalse(DisclosureRecord.objects.filter(document_id=doc_id).exists())

        self.consent("RELEASE_OF_INFORMATION", scope=["ADMISSION", "LEGAL_STATUS"])
        self.assertEqual(self.act(doc_id, "recheck_consent", self.psychiatrist).data["status"], "SIGNED")
        released = self.act(doc_id, "release", self.records)
        self.assertEqual(released.status_code, 200, released.data)
        self.assertEqual(released.data["status"], "RELEASED")
        with platform_admin_context():
            disclosure = DisclosureRecord.objects.get(document_id=doc_id)
        self.assertEqual(disclosure.template_id, "DOC-LEG-STAT-VOL-KE")
        self.assertEqual(disclosure.legal_basis, "CONSENT")
        self.assertIsNotNone(disclosure.consent_record_id)
        self.assertIn("LEGAL_STATUS", disclosure.classes_disclosed)

    def test_superseded_version_cannot_be_released(self):
        from apps.care_pathway.legal_models import LegalDocument

        with platform_admin_context():
            LegalDocument.objects.create(
                organization=self.org,
                legal_status=self.legal_status,
                patient=self.patient,
                template_id="DOC-LEG-STAT-VOL-KE",
                config_version="KE-MHA-FORMS-1",
                version=2,
                supersedes=self.form,
                amendment_reason="Synthetic correction",
            )
        response = self.release_record()
        self.assertEqual(response.status_code, 400)
        self.assertIn("legal_document_id", response.data)

    def test_recipient_the_form_may_not_reach_is_refused(self):
        response = self.generate(
            "DOC-LEG-STAT-VOL-KE",
            legal_document_id=str(self.form.id),
            recipient_type="EMPLOYER",
        )
        self.assertEqual(response.status_code, 400)


class FacilityReleaseWordingTests(DocumentFixture):
    """A release authorization snapshots the facility's published wording when
    an Org Admin has set one for that type; otherwise STRUCTURED-SCOPE-1."""

    def record(self):
        return self.client.post(
            reverse("documents-authorizations"),
            {
                "patient_id": str(self.patient.id),
                "consent_type": "EMPLOYER_COMMUNICATION",
                "decision": "YES",
                "evidence": "Signed synthetic form",
            },
            format="json",
            **self.auth(self.psychiatrist),
        )

    def test_structured_scope_without_facility_wording(self):
        response = self.record()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["consent_text_version"], "STRUCTURED-SCOPE-1")

    def test_facility_wording_is_used_when_published(self):
        from apps.care_pathway.models import ConsentTemplate
        from apps.client_registry.models import ConsentRecord

        with platform_admin_context():
            ConsentTemplate.objects.create(
                organization=self.org,
                consent_type="EMPLOYER_COMMUNICATION",
                version="EMP-SYNTH-1",
                text="SYNTHETIC FACILITY EMPLOYER WORDING",
            )
        listing = self.client.get(
            reverse("documents-authorizations") + f"?patient={self.patient.id}",
            **self.auth(self.psychiatrist),
        )
        self.assertEqual(listing.data["wording"]["EMPLOYER_COMMUNICATION"]["version"], "EMP-SYNTH-1")
        response = self.record()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["consent_text_version"], "EMP-SYNTH-1")
        with platform_admin_context():
            record = ConsentRecord.objects.get(pk=response.data["id"])
        self.assertIn("SYNTHETIC FACILITY EMPLOYER WORDING", record.consent_text_snapshot)
