"""Electronic signatures on consents (owner decisions 2026-11-13): decision
consents and consent documents are signed on screen by the deciding party and the
staff witness, bound to the content signed, printed, and exported as FHIR R4.

Classes named `FhirR4Conformance*` run in CI's conformance step: the published
examples in `fhir_examples/consent-*.json` (guide.md §3 item 8) and bundles built
from real consents, against base R4 4.0.1 and our profiles (HL7's validator checks
the same in CI)."""

import base64
import io
import json
from datetime import date
from pathlib import Path

from django.test import SimpleTestCase
from django.urls import reverse
from PIL import Image, ImageDraw

from apps.care_pathway import psychotherapy_profiles as profiles
from apps.care_pathway.models import ConsentTemplate, VisitConsent
from apps.client_registry.models import EmergencyContact, Patient
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .consent_fhir import CONSENT_PROFILE, PROVENANCE_PROFILE
from .models import DocumentEvent, PartySignature
from .tests import DocumentFixture

EXAMPLES = Path(__file__).parent / "fhir_examples"
CONF = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"
ACT = "http://terminology.hl7.org/CodeSystem/v3-ActCode"


def drawn(stroke=True):
    image = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
    if stroke:
        ImageDraw.Draw(image).line(
            [(20, 70), (120, 20), (200, 80), (280, 30)], fill="black", width=4
        )
    out = io.BytesIO()
    image.save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def signed(name=None, **extra):
    party = {"image": drawn(), **extra}
    if name:
        party["name"] = name
    return party


class SignedConsentAssertions:
    """What every consent bundle must hold, example or built."""

    def assert_consent_bundle(self, bundle):
        self.assertEqual(validate_bundle(bundle), {})
        resources = [e["resource"] for e in bundle["entry"]]
        consent = next(r for r in resources if r["resourceType"] == "Consent")
        self.assertEqual(profiles.check(consent, CONSENT_PROFILE), [])
        urls = {e["fullUrl"] for e in bundle["entry"]}
        self.assertIn(consent["patient"]["reference"], urls)
        for resource in resources:
            if resource["resourceType"] == "Patient":
                continue
            labels = {(c["system"], c["code"]) for c in resource["meta"]["security"]}
            self.assertIn((CONF, "R"), labels)
            self.assertIn((ACT, "PSY"), labels)
        provenances = [r for r in resources if r["resourceType"] == "Provenance"]
        if consent["status"] == "proposed":
            self.assertEqual(provenances, [])
            return consent, None
        self.assertTrue(consent["performer"])
        [provenance] = provenances
        self.assertEqual(profiles.check(provenance, PROVENANCE_PROFILE), [])
        self.assertIn(provenance["target"][0]["reference"], urls)
        roles = [s["type"][0]["code"] for s in provenance["signature"]]
        self.assertIn("witness", roles)
        for s in provenance["signature"]:
            self.assertEqual(s["sigFormat"], "image/png")
            self.assertTrue(base64.b64decode(s["data"]).startswith(b"\x89PNG"))
        return consent, provenance


class VisitConsentSignatureTests(SignedConsentAssertions, DocumentFixture):
    def record(self, user=None, **body):
        payload = {"scope": "MEDICATION", "party": "PATIENT", **body}
        return self.client.post(
            reverse("care-client-visit-consents", args=[self.patient.id]),
            payload,
            format="json",
            **self.auth(user or self.psychiatrist),
        )

    def test_a_consent_needs_the_clients_and_the_witness_signatures(self):
        self.assertEqual(self.record().status_code, 400)
        self.assertEqual(self.record(signatures={"party": {"image": drawn()}}).status_code, 400)
        blank = self.record(signatures={"party": {"image": drawn(False)}, "witness": signed()})
        self.assertEqual(blank.status_code, 400)
        self.assertIn("empty", str(blank.data))
        with platform_admin_context():
            self.assertFalse(VisitConsent.objects.filter(patient=self.patient).exists())

        response = self.record(signatures={"party": {"image": drawn()}, "witness": signed()})
        self.assertEqual(response.status_code, 201, response.data)
        roles = {s["role"]: s for s in response.data["signatures"]}
        self.assertEqual(set(roles), {"CLIENT", "WITNESS"})
        self.assertEqual(roles["CLIENT"]["signer_name"], self.patient.get_full_name())
        self.assertEqual(roles["WITNESS"]["signer_name"], "Psych Synthetic")
        self.assertEqual(response.data["scope_label"], "Medication")
        with platform_admin_context():
            rows = PartySignature.objects.filter(visit_consent_id=response.data["id"])
            self.assertEqual(rows.count(), 2)
            for row in rows:
                # One entry per signature, and the image only as a fingerprint.
                entry = AuditLogEntry.objects.get(object_id=str(row.pk))
                self.assertEqual(entry.field_diff["role"]["new"], row.role)
                image = entry.field_diff["image_png"]["new"]
                self.assertTrue(image.startswith("[clinical content "), image)
                self.assertLess(len(json.dumps(entry.field_diff)), 2000)

    def test_scope_is_coded_and_other_needs_detail(self):
        sigs = {"party": {"image": drawn()}, "witness": signed()}
        self.assertEqual(self.record(scope="Medication", signatures=sigs).status_code, 400)
        self.assertEqual(self.record(scope="OTHER", signatures=sigs).status_code, 400)
        ok = self.record(scope="OTHER", scope_detail="Dental extraction", signatures=sigs)
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data["scope_label"], "Other (specify): Dental extraction")

    def test_a_guardian_signs_by_name_and_a_client_unable_to_sign_is_witnessed(self):
        guardian = self.record(
            party="GUARDIAN",
            given_by_name="Mary Synthetic",
            signatures={"party": {"image": drawn(), "relationship": "Mother"}, "witness": signed()},
        )
        self.assertEqual(guardian.status_code, 201, guardian.data)
        signer = next(s for s in guardian.data["signatures"] if s["role"] == "GUARDIAN")
        self.assertEqual(
            (signer["signer_name"], signer["relationship"]), ("Mary Synthetic", "Mother")
        )

        unable = self.record(
            signatures={
                "party": {"unable_reason": "Both hands bandaged after an injury"},
                "witness": signed(),
            }
        )
        self.assertEqual(unable.status_code, 201, unable.data)
        client = next(s for s in unable.data["signatures"] if s["role"] == "CLIENT")
        self.assertEqual(client["method"], "UNABLE")
        # The witness can never be "unable to sign".
        refused = self.record(
            signatures={"party": {"image": drawn()}, "witness": {"unable_reason": "Busy right now"}}
        )
        self.assertEqual(refused.status_code, 400)

    def test_a_deferred_consent_is_signed_when_it_is_completed(self):
        deferred = self.record(party="DEFERRED", scope="ADMISSION")
        self.assertEqual(deferred.status_code, 201, deferred.data)
        self.assertEqual(deferred.data["signatures"], [])
        url = reverse("care-visit-consent-complete", args=[deferred.data["id"]])
        auth = self.auth(self.psychiatrist)
        self.assertEqual(
            self.client.post(url, {"party": "PATIENT"}, format="json", **auth).status_code, 400
        )
        done = self.client.post(
            url,
            {"party": "PATIENT", "signatures": {"party": {"image": drawn()}, "witness": signed()}},
            format="json",
            **auth,
        )
        self.assertEqual(done.status_code, 200, done.data)
        self.assertFalse(done.data["open_deferred"])
        self.assertEqual({s["role"] for s in done.data["signatures"]}, {"CLIENT", "WITNESS"})

    def test_only_clinical_staff_record_consents(self):
        response = self.record(
            self.records, signatures={"party": {"image": drawn()}, "witness": signed()}
        )
        self.assertEqual(response.status_code, 403)


class ConsentDocumentSignatureTests(DocumentFixture):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            self.guardian = EmergencyContact.objects.create(
                organization=self.org,
                patient=self.patient,
                name="Mary Synthetic",
                relationship="Mother",
                is_guardian=True,
            )

    def wording(self, template="DOC-CON-01", text="I agree to treatment at this facility."):
        with platform_admin_context():
            ConsentTemplate.objects.create(
                organization=self.org,
                consent_type=template,
                version="2026-1",
                text=text,
                created_by=self.psychiatrist,
            )

    def sign(self, doc_id, role, party=None, user=None, witness=None):
        return self.client.post(
            reverse("documents-signatures", args=[doc_id]),
            {"role": role, "party": party or {"image": drawn()}, "witness": witness or signed()},
            format="json",
            **self.auth(user or self.psychiatrist),
        )

    def treatment_consent(self):
        response = self.generate(
            "DOC-CON-01", recipient_type="PATIENT", inputs={"valid_until": "2027-11-13"}
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_without_facility_wording_a_consent_document_cannot_be_signed(self):
        doc = self.treatment_consent()
        self.assertEqual(doc["content_status"], "VERIFY")
        self.assertNotIn("sign", doc["allowed_actions"])
        self.assertEqual(self.sign(doc["id"], "CLIENT").status_code, 400)

    def test_the_client_and_witness_sign_before_the_clinician_authorises(self):
        self.wording()
        doc = self.treatment_consent()
        self.assertEqual(doc["content_status"], "READY")
        self.assertEqual(doc["wording"]["text"], "I agree to treatment at this facility.")
        self.assertEqual(
            [(r["key"], r["satisfied"]) for r in doc["signature_requirements"]],
            [("decision", False), ("witness", False)],
        )
        self.assertEqual(self.act(doc["id"], "submit").status_code, 200)
        refused = self.act(doc["id"], "sign")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("Client", str(refused.data))

        signed_doc = self.sign(doc["id"], "CLIENT")
        self.assertEqual(signed_doc.status_code, 201, signed_doc.data)
        self.assertTrue(all(r["satisfied"] for r in signed_doc.data["signature_requirements"]))
        done = self.act(doc["id"], "sign")
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(done.data["status"], "SIGNED")
        with platform_admin_context():
            self.assertTrue(
                DocumentEvent.objects.filter(document_id=doc["id"], action="party_sign").exists()
            )
        # Signed: no more signatures on this version.
        self.assertEqual(self.sign(doc["id"], "CLIENT").status_code, 400)

    def test_editing_after_signing_needs_the_signatures_again(self):
        self.wording()
        doc = self.treatment_consent()
        self.sign(doc["id"], "CLIENT")
        edited = self.client.patch(
            reverse("documents-generated-detail", args=[doc["id"]]),
            {"inputs": {"valid_until": "2027-06-30"}},
            format="json",
            **self.auth(self.psychiatrist),
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertFalse(any(r["satisfied"] for r in edited.data["signature_requirements"]))
        self.assertFalse(any(s["current"] for s in edited.data["party_signatures"]))
        self.act(doc["id"], "submit")
        refused = self.act(doc["id"], "sign")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("signatures", str(refused.data))

    def test_a_minors_consent_is_signed_by_the_guardian_and_family_consent_by_the_family_member(
        self,
    ):
        self.wording("DOC-CON-04", "I agree that my family may be involved in my care.")
        with platform_admin_context():
            Patient.objects.filter(pk=self.patient.pk).update(
                date_of_birth=date(date.today().year - 15, 1, 1)
            )
        doc = self.generate("DOC-CON-04", recipient_type="PATIENT").data
        self.assertEqual(
            [r["key"] for r in doc["signature_requirements"]], ["decision", "related", "witness"]
        )
        self.assertEqual(self.sign(doc["id"], "CLIENT").status_code, 400)
        guardian = self.sign(
            doc["id"],
            "GUARDIAN",
            {
                "image": drawn(),
                "name": "Mary Synthetic",
                "related_person_id": str(self.guardian.pk),
            },
        )
        self.assertEqual(guardian.status_code, 201, guardian.data)
        self.assertEqual(
            self.sign(doc["id"], "RELATED_PERSON", {"image": drawn(), "name": "Uncle"}).status_code,
            400,
        )
        family = self.sign(
            doc["id"],
            "RELATED_PERSON",
            {
                "image": drawn(),
                "name": "Mary Synthetic",
                "related_person_id": str(self.guardian.pk),
            },
        )
        self.assertEqual(family.status_code, 201, family.data)
        self.assertTrue(all(r["satisfied"] for r in family.data["signature_requirements"]))

    def test_the_print_shows_the_wording_and_each_signature(self):
        self.wording()
        doc = self.treatment_consent()
        self.sign(doc["id"], "CLIENT")
        self.act(doc["id"], "submit")
        self.act(doc["id"], "sign")
        html = self.client.get(
            reverse("documents-print", args=[doc["id"]]), **self.auth(self.psychiatrist)
        ).content.decode()
        self.assertIn("I agree to treatment at this facility.", html)
        self.assertIn("Facility wording, version 2026-1", html)
        self.assertEqual(html.count('class="drawn-signature" src="data:image/png;base64,'), 2)
        self.assertIn("Staff witness", html)


class FhirR4ConformanceConsentExamplesTests(SignedConsentAssertions, SimpleTestCase):
    def test_every_example_is_a_conformant_consent(self):
        files = sorted(EXAMPLES.glob("consent-*.json"))
        self.assertEqual(len(files), 3)
        for path in files:
            with self.subTest(path.name):
                self.assert_consent_bundle(json.loads(path.read_text()))

    def test_examples_cover_routine_edge_and_omission(self):
        names = {p.name for p in EXAMPLES.glob("consent-*.json")}
        self.assertEqual({n.split("-")[1] for n in names}, {"routine", "edge", "omission"}, names)

    def test_the_omission_example_records_the_reason_not_a_signature(self):
        bundle = json.loads(
            (EXAMPLES / "consent-omission-unable-to-sign-witnessed.json").read_text()
        )
        _, provenance = self.assert_consent_bundle(bundle)
        self.assertEqual([s["type"][0]["code"] for s in provenance["signature"]], ["witness"])
        unable = [a for a in provenance["agent"] if a.get("role")]
        self.assertIn("Unable to sign", unable[0]["role"][0]["text"])


class FhirR4ConformanceConsentExportTests(SignedConsentAssertions, DocumentFixture):
    def test_a_signed_visit_consent_and_document_export_conformant_audited_bundles(self):
        consent = self.client.post(
            reverse("care-client-visit-consents", args=[self.patient.id]),
            {
                "scope": "ADMISSION",
                "party": "PATIENT",
                "signatures": {"party": {"image": drawn()}, "witness": signed()},
            },
            format="json",
            **self.auth(self.psychiatrist),
        ).data
        response = self.client.get(
            reverse("care-visit-consent-fhir", args=[consent["id"]]), **self.auth(self.psychiatrist)
        )
        self.assertEqual(response.status_code, 200, response.data)
        resource, provenance = self.assert_consent_bundle(response.data)
        self.assertEqual(resource["scope"]["coding"][0]["code"], "treatment")
        self.assertEqual(len(provenance["signature"]), 2)

        with platform_admin_context():
            ConsentTemplate.objects.create(
                organization=self.org,
                consent_type="DOC-CON-11",
                version="v3",
                text="I withdraw my consent.",
                created_by=self.psychiatrist,
            )
        doc = self.generate("DOC-CON-11", recipient_type="PATIENT").data
        self.assertEqual(
            self.client.get(
                reverse("documents-consent-fhir", args=[doc["id"]]), **self.auth(self.psychiatrist)
            ).status_code,
            400,
        )
        self.client.post(
            reverse("documents-signatures", args=[doc["id"]]),
            {"role": "CLIENT", "party": {"image": drawn()}, "witness": signed()},
            format="json",
            **self.auth(self.psychiatrist),
        )
        self.act(doc["id"], "submit")
        self.act(doc["id"], "sign")
        exported = self.client.get(
            reverse("documents-consent-fhir", args=[doc["id"]]), **self.auth(self.psychiatrist)
        )
        self.assertEqual(exported.status_code, 200, exported.data)
        resource, _ = self.assert_consent_bundle(exported.data)
        self.assertEqual(resource["provision"]["type"], "deny")
        self.assertEqual(resource["policyRule"]["text"], "Facility consent wording, version v3")
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    object_id=doc["id"], action="VIEW", field_diff__output="fhir"
                ).exists()
            )
