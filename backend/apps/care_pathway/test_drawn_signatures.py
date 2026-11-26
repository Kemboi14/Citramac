"""Signatures drawn on screen beyond consents (owner decisions 2026-11-26):

1. Mental Health Act applications and written notices — the applicant and the
   staff witness draw their signatures (the "signed in my presence" tick-box is
   gone); the paper route stays.
2. The client-held safety plan — the client signs each version with the
   clinician as witness, or is recorded as unable to sign.
3. Leaving against medical advice — the client acknowledges it against the
   facility's wording, or is recorded as unable or refusing to sign; never a
   condition of the discharge.
4. A clinician's specimen signature, printed on what they sign by
   authenticated click (the one in use when they signed).

Classes named `FhirR4Conformance*` run in CI's conformance step."""

import json
import uuid

from django.db import IntegrityError, connection, transaction
from django.db.utils import InternalError, ProgrammingError
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, SignatureSpecimen
from apps.client_registry.models import Attachment
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.documents import signatures as party_signatures
from apps.documents.models import PartySignature
from apps.documents.test_consent_signatures import drawn
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context, set_tenant_context
from apps.tenancy.models import Organization

from . import against_advice, legal_status, plan_extras
from .legal_models import LegalDocument
from .models import (
    AgainstAdviceAcknowledgement,
    ConsentTemplate,
    DischargeSummary,
    SafetyPlan,
    VisitConsent,
)
from .test_care_plan import CarePlanTestCase
from .test_discharge import DischargeFixture
from .test_legal_status import LegalStatusTestCase, drawn_signatures


def _pad():
    return {"image": drawn()}


# ── 1. Mental Health Act applications ──


class ApplicationDrawnSignatureTests(LegalStatusTestCase):
    def voluntary(self):
        doc = self.start("VOLUNTARY")
        self.save(doc, {"notice_acknowledged": True})
        return doc

    def rows(self, doc_id):
        with platform_admin_context():
            return list(
                PartySignature.objects.filter(legal_document_id=doc_id).order_by("captured_at")
            )

    def test_the_tick_box_is_refused_and_nothing_is_signed(self):
        doc = self.voluntary()
        r = self.sign_doc(doc, {"method": "ELECTRONIC", "attested": True})
        self.assertEqual(r.status_code, 400)
        self.assertIn("method", r.data)
        with platform_admin_context():
            self.assertEqual(LegalDocument.objects.get(pk=doc).status, "DRAFT")

    def test_the_applicant_and_witness_draw_bound_to_the_frozen_form_and_filed(self):
        doc = self.voluntary()
        r = self.sign_doc(doc)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["signature_method"], "DRAWN")
        self.assertEqual({s["role"] for s in r.data["party_signatures"]}, {"CLIENT", "WITNESS"})
        rows = self.rows(doc)
        with platform_admin_context():
            form = LegalDocument.objects.get(pk=doc)
            expected = party_signatures.content_sha256(legal_status.signature_content(form))
            self.assertEqual({row.content_sha256 for row in rows}, {expected})
            client = next(r for r in rows if r.role == "CLIENT")
            self.assertEqual(client.signer_name, form.patient.get_full_name())
            witness = next(r for r in rows if r.role == "WITNESS")
            self.assertEqual(witness.signer_user_id, self.nurse.pk)
            # Signed in the system: its PDF is filed in the client's attachments.
            self.assertTrue(Attachment.objects.filter(legal_document_id=doc).exists())
            # Append-only.
            with self.assertRaises(PermissionError):
                client.save()
            with self.assertRaises(PermissionError):
                client.delete()
        html = self.client.get(
            reverse("care-legal-document-print", args=[doc]), **self.auth
        ).content.decode()
        self.assertEqual(html.count('class="drawn-signature"'), 2)
        self.assertIn("drawn on screen, witnessed", html)

    def test_witness_required_and_unable_to_sign_goes_to_paper(self):
        doc = self.voluntary()
        no_witness = self.sign_doc(doc, {"method": "DRAWN", "signatures": {"party": _pad()}})
        self.assertEqual(no_witness.status_code, 400)
        unable = self.sign_doc(
            doc,
            {
                "method": "DRAWN",
                "signatures": {"party": {"unable_reason": "Hand injured"}, "witness": _pad()},
            },
        )
        self.assertEqual(unable.status_code, 400)
        self.assertIn(legal_status.PAPER_ROUTE, str(unable.data))
        blank = self.sign_doc(
            doc,
            {
                "method": "DRAWN",
                "signatures": {"party": {"image": drawn(False)}, "witness": _pad()},
            },
        )
        self.assertEqual(blank.status_code, 400)
        self.assertEqual(self.rows(doc), [])
        with platform_admin_context():
            self.assertEqual(LegalDocument.objects.get(pk=doc).status, "DRAFT")

    def test_involuntary_applicant_signs_as_the_related_person(self):
        doc, person = self.signed_involuntary_application()
        rows = self.rows(doc)
        applicant = next(r for r in rows if r.role != "WITNESS")
        self.assertEqual(applicant.role, PartySignature.ROLE_APPLICANT)
        self.assertEqual(applicant.related_person_id, person.pk)
        self.assertEqual(applicant.signer_name, person.name)

    def test_a_guardian_signs_the_application_and_the_admission_consent(self):
        from datetime import timedelta

        from apps.client_registry.models import Patient

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            patient.date_of_birth = timezone.localdate() - timedelta(days=365 * 15)
            patient.save()
        guardian = self.nok(is_guardian=True)
        doc = self.voluntary()
        r = self.sign_doc(
            doc, drawn_signatures(signer_kind="GUARDIAN", related_person_id=str(guardian.pk))
        )
        self.assertEqual(r.status_code, 200, r.data)
        with platform_admin_context():
            consent = VisitConsent.objects.get(pk=r.data["content"]["guardian_consent_id"])
            self.assertEqual(
                set(consent.signatures.values_list("role", flat=True)), {"GUARDIAN", "WITNESS"}
            )
        self.assertEqual({s["role"] for s in r.data["party_signatures"]}, {"GUARDIAN", "WITNESS"})

    def test_a_written_notice_is_drawn_by_the_client(self):
        self.admit_voluntary()
        ls_id = self.ws()["legal_status"]["id"]
        tick = self.call(
            "post",
            "care-legal-notice",
            {"method": "ELECTRONIC", "attested": True, "statement": "Leaving"},
            [ls_id],
        )
        self.assertEqual(tick.status_code, 400)
        r = self.call("post", "care-legal-notice", drawn_signatures(statement="Leaving"), [ls_id])
        self.assertEqual(r.status_code, 201, r.data)
        with platform_admin_context():
            notice_doc = LegalDocument.objects.get(template_id="LGL-NOTICE-KE", patient_id=self.pid)
            self.assertEqual(notice_doc.signature_method, "DRAWN")
            self.assertEqual(
                set(notice_doc.party_signatures.values_list("role", flat=True)),
                {"CLIENT", "WITNESS"},
            )

    def test_the_recommendation_prints_the_specimen_in_use_when_signed(self):
        application, _ = self.signed_involuntary_application()
        first = self.signed_recommendation(application)
        url = reverse("care-legal-document-print", args=[first])
        html = self.client.get(url, **self.auth).content.decode()
        self.assertIn("Signed electronically by", html)
        self.assertNotIn("Signature of Dr Senior", html)  # no specimen yet: name only
        recorded = self.client.post(
            reverse("me-professional-profile-signature"),
            {"image": drawn()},
            format="json",
            **self.psych_auth,
        )
        self.assertEqual(recorded.status_code, 201, recorded.data)
        # Recorded after the first recommendation was signed: it still prints the name only.
        html = self.client.get(url, **self.auth).content.decode()
        self.assertNotIn("Signature of Dr Senior", html)
        amended = self.call(
            "post",
            "care-legal-document-amend",
            {"reason": "Correct the grounds"},
            [first],
            self.psych_auth,
        )
        self.assertEqual(amended.status_code, 201, amended.data)
        second = amended.data["id"]
        self.assertEqual(self.sign_doc(second, {}, self.psych_auth).status_code, 200)
        html = self.client.get(
            reverse("care-legal-document-print", args=[second]), **self.auth
        ).content.decode()
        self.assertIn("Signature of Dr Senior", html)


# ── 2. Safety plan ──


class SafetyPlanSignatureTests(CarePlanTestCase):
    def draft_plan(self):
        url = reverse("care-safety-plan", args=[self.pid])
        self.client.get(url, **self.auth)
        self.client.put(url, {"warning_signs": "Not sleeping"}, format="json", **self.auth)

    def sign_plan(self, body, auth=None):
        return self.client.post(
            reverse("care-safety-plan-sign", args=[self.pid]),
            body,
            format="json",
            **(auth or self.auth),
        )

    def test_the_client_signs_with_the_witness_bound_to_the_version(self):
        self.draft_plan()
        self.assertEqual(self.sign_plan({}).status_code, 400)
        self.assertEqual(self.sign_plan({"signatures": {"client": _pad()}}).status_code, 400)
        with platform_admin_context():
            plan = SafetyPlan.objects.get(patient_id=self.pid)
            self.assertIsNone(plan.signed_at)
            self.assertFalse(plan.signatures.exists())
        r = self.sign_plan({"signatures": {"client": _pad(), "witness": _pad()}})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual({s["role"] for s in r.data["signatures"]}, {"CLIENT", "WITNESS"})
        with platform_admin_context():
            plan.refresh_from_db()
            expected = party_signatures.content_sha256(plan_extras.safety_plan_content(plan))
            self.assertEqual(
                set(plan.signatures.values_list("content_sha256", flat=True)), {expected}
            )
            entry = AuditLogEntry.objects.get(object_id=str(plan.signatures.first().pk))
            self.assertTrue(entry.field_diff["image_png"]["new"].startswith("[clinical content"))
        # The next version starts unsigned; the signed one keeps its signatures.
        revision = self.client.get(reverse("care-safety-plan", args=[self.pid]), **self.auth)
        self.assertEqual(revision.data["version"], 2)
        self.assertEqual(revision.data["signatures"], [])

    def test_a_client_unable_to_sign_is_recorded_with_the_reason_never_refused(self):
        self.draft_plan()
        refused = self.sign_plan(
            {"signatures": {"client": {"refused_reason": "Would not sign"}, "witness": _pad()}}
        )
        self.assertEqual(refused.status_code, 400)
        no_witness = self.sign_plan(
            {"signatures": {"client": {"unable_reason": "Sedated"}, "witness": {}}}
        )
        self.assertEqual(no_witness.status_code, 400)
        witness_unable = self.sign_plan(
            {
                "signatures": {
                    "client": _pad(),
                    "witness": {"unable_reason": "Witness hand injured"},
                }
            }
        )
        self.assertEqual(witness_unable.status_code, 400)
        r = self.sign_plan(
            {
                "signatures": {
                    "client": {"unable_reason": "Sedated after an injection"},
                    "witness": _pad(),
                }
            }
        )
        self.assertEqual(r.status_code, 200, r.data)
        client = next(s for s in r.data["signatures"] if s["role"] == "CLIENT")
        self.assertEqual(
            (client["method"], client["unable_reason"]), ("UNABLE", "Sedated after an injection")
        )

    def test_only_clinical_staff_sign(self):
        from apps.accounts.models import User
        from apps.accounts.tokens import issue_tokens

        self.draft_plan()
        with platform_admin_context():
            clerk = User.objects.create_user(
                email=f"clerk-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                is_active=True,
            )
        auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(clerk)[0]}"}
        r = self.sign_plan({"signatures": {"client": _pad(), "witness": _pad()}}, auth)
        self.assertEqual(r.status_code, 403)


# ── 3. Leaving against medical advice ──


class AgainstAdviceFixture(DischargeFixture):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            # Recording an acknowledgement is clinical work (clinical.care.record).
            self.doctor.roles.add(Role.objects.get(name="Doctor", organization__isnull=True))

    def set_wording(self, text="I understand the team advised me to stay. I am leaving."):
        return self.client.post(
            reverse("care-consent-templates"),
            {"consent_type": "DISCHARGE_AGAINST_ADVICE", "version": "AMA-1", "text": text},
            format="json",
            **self.auth,
        )

    def acknowledge(self, client, witness=None, auth=None):
        return self.client.post(
            reverse("care-admission-against-advice", args=[self.admission.id]),
            {"signatures": {"client": client, "witness": _pad() if witness is None else witness}},
            format="json",
            **(auth or self.auth),
        )

    def ama_draft(self):
        r = self.client.put(
            reverse("care-admission-discharge", args=[self.admission.id]),
            {"disposition": "AMA"},
            format="json",
            **self.auth,
        )
        self.assertEqual(r.status_code, 200, r.data)
        return r.data


class AgainstAdviceTests(AgainstAdviceFixture):
    def test_only_an_ama_discharge_takes_an_acknowledgement(self):
        self.assertEqual(self.set_wording().status_code, 201)
        r = self.acknowledge(_pad())
        self.assertEqual(r.status_code, 400)

    def test_without_wording_nothing_can_be_signed_and_the_discharge_still_goes_ahead(self):
        data = self.ama_draft()
        self.assertTrue(data["against_advice"]["applies"])
        self.assertIsNone(data["against_advice"]["wording"])
        self.assertEqual(data["against_advice"]["no_wording_message"], against_advice.NO_WORDING)
        self.assertEqual(self.acknowledge(_pad()).status_code, 400)
        signed = self.sign(disposition="AMA")
        self.assertEqual(signed.status_code, 200, signed.data)
        with platform_admin_context():
            self.assertFalse(AgainstAdviceAcknowledgement.objects.exists())

    def test_the_client_signs_against_the_frozen_wording_witnessed(self):
        self.ama_draft()
        self.set_wording()
        r = self.acknowledge(_pad())
        self.assertEqual(r.status_code, 201, r.data)
        [ack] = r.data["against_advice"]["acknowledgements"]
        self.assertEqual(ack["outcome"], "DRAWN")
        self.assertEqual(ack["wording_version"], "AMA-1")
        self.assertEqual({s["role"] for s in ack["signatures"]}, {"CLIENT", "WITNESS"})
        # New wording later does not change what was signed.
        self.client.post(
            reverse("care-consent-templates"),
            {"consent_type": "DISCHARGE_AGAINST_ADVICE", "version": "AMA-2", "text": "Other"},
            format="json",
            **self.auth,
        )
        with platform_admin_context():
            row = AgainstAdviceAcknowledgement.objects.get(pk=ack["id"])
            self.assertEqual(row.wording_version, "AMA-1")
            self.assertEqual(len(against_advice.signatures_for(row)), 2)
            with self.assertRaises(PermissionError):
                row.save()
            with self.assertRaises(PermissionError):
                row.delete()

    def test_refusing_or_unable_to_sign_is_recorded_with_the_reason_and_the_witness(self):
        self.ama_draft()
        self.set_wording()
        self.assertEqual(self.acknowledge({"refused_reason": "No"}).status_code, 400)  # too short
        self.assertEqual(
            self.acknowledge({"refused_reason": "Said he will not sign"}, witness={}).status_code,
            400,
        )
        refused = self.acknowledge({"refused_reason": "Said he will not sign anything"})
        self.assertEqual(refused.status_code, 201, refused.data)
        unable = self.acknowledge({"unable_reason": "Intoxicated, could not hold the pen"})
        self.assertEqual(unable.status_code, 201, unable.data)
        outcomes = [a["outcome"] for a in unable.data["against_advice"]["acknowledgements"]]
        self.assertEqual(outcomes, ["REFUSED", "UNABLE"])
        # The discharge is signed as usual and its print shows each acknowledgement.
        self.assertEqual(self.sign(disposition="AMA").status_code, 200)
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
        html = self.client.get(
            reverse("care-discharge-print", args=[summary.id]), **self.auth
        ).content.decode()
        self.assertIn("Acknowledgement of leaving against medical advice", html)
        self.assertIn("Refused to sign: Said he will not sign anything", html)
        self.assertIn("Unable to sign: Intoxicated", html)
        self.assertIn("I understand the team advised me to stay.", html)

    def test_only_clinical_staff_with_access_record_it(self):
        self.ama_draft()
        self.set_wording()
        self.assertEqual(self.acknowledge(_pad(), auth=self.nurse_auth).status_code, 403)

    def test_another_organisation_cannot_see_it(self):
        self.ama_draft()
        self.set_wording()
        ack_id = self.acknowledge(_pad()).data["against_advice"]["acknowledgements"][0]["id"]
        with platform_admin_context():
            other = Organization.objects.create(
                name="Other",
                slug=f"other-{uuid.uuid4().hex[:6]}",
                facility_type="MENTAL_HEALTH_MHP",
            )
        set_tenant_context(organization_id=other.id)
        self.assertIsNone(AgainstAdviceAcknowledgement.all_objects.filter(pk=ack_id).first())
        self.assertFalse(PartySignature.all_objects.filter(ama_acknowledgement_id=ack_id).exists())
        set_tenant_context(organization_id=self.org.id)
        self.assertIsNotNone(AgainstAdviceAcknowledgement.all_objects.filter(pk=ack_id).first())

    def test_one_signature_has_exactly_one_target(self):
        self.ama_draft()
        self.set_wording()
        self.acknowledge(_pad())
        with platform_admin_context():
            row = PartySignature.objects.filter(ama_acknowledgement__isnull=False).first()
            with self.assertRaises(IntegrityError), transaction.atomic():
                PartySignature.objects.create(
                    organization=self.org,
                    patient=self.patient,
                    ama_acknowledgement=row.ama_acknowledgement,
                    visit_consent=None,
                    document=None,
                    safety_plan=SafetyPlan.objects.create(
                        organization=self.org, patient=self.patient
                    ),
                    role="CLIENT",
                    signer_name="x",
                    method="DRAWN",
                    image_png=b"png",
                    content_sha256="0" * 64,
                )
            with self.assertRaises(IntegrityError), transaction.atomic():
                PartySignature.objects.create(
                    organization=self.org,
                    patient=self.patient,
                    ama_acknowledgement=row.ama_acknowledgement,
                    role="CLIENT",
                    signer_name="x",
                    method="REFUSED",
                    content_sha256="0" * 64,
                )


class FhirR4ConformanceAgainstAdviceTests(AgainstAdviceFixture):
    def test_the_signed_ama_discharge_carries_the_acknowledgement_provenance(self):
        self.ama_draft()
        self.set_wording()
        self.acknowledge({"refused_reason": "Said he will not sign anything"})
        self.acknowledge(_pad())
        self.assertEqual(self.sign(disposition="AMA").status_code, 200)
        with platform_admin_context():
            summary = DischargeSummary.objects.get(admission=self.admission)
        bundle = self.client.get(
            reverse("care-discharge-fhir", args=[summary.id]), **self.auth
        ).data
        self.assertEqual(validate_bundle(bundle), {})
        urls = {e["fullUrl"] for e in bundle["entry"]}
        encounter_url = next(
            e["fullUrl"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Encounter"
        )
        acks = [
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "Provenance"
            and e["resource"]["id"].startswith("ama-")
        ]
        self.assertEqual(len(acks), 2)
        refused, signed = acks
        for provenance in acks:
            self.assertEqual(provenance["target"][0]["reference"], encounter_url)
            for agent in provenance["agent"]:
                ref = agent["who"].get("reference")
                if ref:
                    self.assertIn(ref, urls)
        # Refused: only the witness signed; the client is an agent with the reason.
        self.assertEqual([s["type"][0]["code"] for s in refused["signature"]], ["witness"])
        self.assertIn(
            "Refused to sign: Said he will not sign anything",
            json.dumps(refused["agent"]),
        )
        self.assertEqual(
            sorted(s["type"][0]["code"] for s in signed["signature"]), ["client", "witness"]
        )
        for s in signed["signature"]:
            self.assertEqual(s["sigFormat"], "image/png")


# ── 4. Clinician specimen signature ──


class SignatureSpecimenTests(DischargeFixture):
    url = "me-professional-profile-signature"

    def record(self, image=None, auth=None):
        return self.client.post(
            reverse(self.url), {"image": image or drawn()}, format="json", **(auth or self.auth)
        )

    def test_recorded_on_the_profile_replaced_never_deleted_and_audited(self):
        profile = self.client.get(reverse("me-professional-profile"), **self.auth).data
        self.assertIsNone(profile["signature_specimen"]["current"])
        self.assertEqual(self.record(drawn(False)).status_code, 400)
        first = self.record()
        self.assertEqual(first.status_code, 201, first.data)
        second = self.record()
        specimen = second.data["signature_specimen"]
        self.assertEqual(specimen["versions"], 2)
        self.assertTrue(specimen["current"]["image"].startswith("data:image/png;base64,"))
        with platform_admin_context():
            rows = list(SignatureSpecimen.objects.filter(user=self.doctor))
            self.assertEqual(len(rows), 2)
            self.assertEqual(specimen["current"]["id"], str(rows[0].pk))
            with self.assertRaises(PermissionError):
                rows[0].save()
            with self.assertRaises(PermissionError):
                rows[0].delete()
            entry = AuditLogEntry.objects.get(object_id=str(rows[0].pk))
            self.assertTrue(entry.field_diff["image_png"]["new"].startswith("[clinical content"))
            # Append-only in the database too.
            with self.assertRaises((InternalError, ProgrammingError)), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE accounts_signaturespecimen SET image_sha256 = 'x' WHERE id = %s",
                        [str(rows[0].pk)],
                    )

    def test_a_document_prints_the_specimen_in_use_when_it_was_signed(self):
        self.assertEqual(self.sign().status_code, 200)  # signed with no specimen
        with platform_admin_context():
            v1 = DischargeSummary.objects.get(admission=self.admission)
        print_url = reverse("care-discharge-print", args=[v1.id])
        html = self.client.get(print_url, **self.auth).content.decode()
        self.assertNotIn('class="drawn-signature"', html)
        self.record()
        html = self.client.get(print_url, **self.auth).content.decode()
        self.assertNotIn('class="drawn-signature"', html)  # recorded after signing
        amend = self.client.post(reverse("care-discharge-amend", args=[v1.id]), **self.auth)
        self.assertEqual(amend.status_code, 201, amend.data)
        self.assertEqual(self.sign().status_code, 200)
        with platform_admin_context():
            v2 = DischargeSummary.objects.get(admission=self.admission, version=2)
        html = self.client.get(
            reverse("care-discharge-print", args=[v2.id]), **self.auth
        ).content.decode()
        self.assertIn('class="drawn-signature"', html)
        self.assertIn("Signed electronically by Doctor Test at", html)
        pdf = self.client.get(
            reverse("care-discharge-print", args=[v2.id]) + "?output=pdf", **self.auth
        )
        self.assertTrue(pdf.content.startswith(b"%PDF-"))

    def test_signing_is_never_blocked_without_a_specimen(self):
        with platform_admin_context():
            self.assertFalse(SignatureSpecimen.objects.filter(user=self.doctor).exists())
        self.assertEqual(self.sign().status_code, 200)

    def test_specimens_are_tenant_isolated(self):
        self.record()
        with platform_admin_context():
            other = Organization.objects.create(
                name="Other",
                slug=f"other-{uuid.uuid4().hex[:6]}",
                facility_type="MENTAL_HEALTH_MHP",
            )
        set_tenant_context(organization_id=other.id)
        self.assertFalse(SignatureSpecimen.all_objects.filter(user=self.doctor).exists())


class ConsentWordingTypeTests(AgainstAdviceFixture):
    def test_org_admin_lists_and_sets_the_against_advice_wording(self):
        listing = self.client.get(reverse("care-consent-templates"), **self.auth).data
        self.assertIn("DISCHARGE_AGAINST_ADVICE", {t["type"] for t in listing["types"]})
        self.assertEqual(self.set_wording().status_code, 201)
        with platform_admin_context():
            self.assertTrue(
                ConsentTemplate.objects.filter(
                    consent_type="DISCHARGE_AGAINST_ADVICE", active=True
                ).exists()
            )
        self.assertEqual(self.set_wording().status_code, 400)  # same version label again
        self.assertEqual(
            self.client.post(
                reverse("care-consent-templates"),
                {"consent_type": "DISCHARGE_AGAINST_ADVICE", "version": "v9", "text": "x"},
                format="json",
                **self.nurse_auth,
            ).status_code,
            403,
        )
