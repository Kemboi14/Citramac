"""Signed paper copies of statutory admission forms, uploaded in the admission flow."""

import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Attachment
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .legal_models import LegalDocument
from .test_legal_status import LegalStatusTestCase

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


class LegalDocumentCopyTests(LegalStatusTestCase):
    def upload(self, doc_id, content=PDF, name="signed-application.pdf", auth=None):
        return self.client.post(
            reverse("care-legal-document-copies", args=[doc_id]),
            {"file": SimpleUploadedFile(name, content, content_type="application/pdf")},
            format="multipart",
            **(auth or self.auth),
        )

    def copy_url(self, doc_id, copy_id):
        return reverse("care-legal-document-copy", args=[doc_id, copy_id])

    def test_upload_on_a_draft_is_evidence_only_and_audited(self):
        doc_id = self.start("VOLUNTARY")
        response = self.upload(doc_id)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "DRAFT")  # a copy never signs the form
        [copy] = response.data["copies"]
        self.assertEqual(copy["name"], "signed-application.pdf")
        with platform_admin_context():
            stored = Attachment.objects.get(pk=copy["id"])
            self.assertEqual(str(stored.legal_document_id), doc_id)
            self.assertEqual(str(stored.patient_id), self.pid)
            self.assertEqual(LegalDocument.objects.get(pk=doc_id).status, "DRAFT")
            entry = AuditLogEntry.objects.filter(
                model="care_pathway.legaldocument", object_id=doc_id
            ).latest("timestamp")
        self.assertEqual(entry.field_diff["event"], "signed_copy_uploaded")
        self.assertEqual(len(entry.field_diff["sha256"]), 64)
        # The workspace lists the copy with the form.
        row = next(d for d in self.ws()["documents"] if d["id"] == doc_id)
        self.assertEqual([c["id"] for c in row["copies"]], [copy["id"]])

    def test_download_returns_the_file_and_is_audited(self):
        doc_id = self.start("VOLUNTARY")
        copy_id = self.upload(doc_id).data["copies"][0]["id"]
        response = self.client.get(self.copy_url(doc_id, copy_id), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PDF)
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    model="care_pathway.legaldocument",
                    object_id=doc_id,
                    action=AuditLogEntry.ACTION_VIEW,
                    field_diff__event="signed_copy_downloaded",
                ).exists()
            )

    def test_only_pdf_png_or_jpeg_whose_content_matches(self):
        doc_id = self.start("VOLUNTARY")
        self.assertEqual(self.upload(doc_id, name="notes.docx").status_code, 400)
        self.assertEqual(self.upload(doc_id, content=b"not a pdf").status_code, 400)
        self.assertEqual(self.ws()["documents"][0]["copies"], [])

    def test_remove_needs_a_reason_and_the_uploader_and_keeps_the_file(self):
        doc_id = self.start("VOLUNTARY")
        copy_id = self.upload(doc_id).data["copies"][0]["id"]
        url = self.copy_url(doc_id, copy_id)
        self.assertEqual(self.client.post(url, {}, format="json", **self.auth).status_code, 400)
        # Someone else (not the uploader, not an Org Admin) cannot remove it.
        refused = self.client.post(
            url, {"reason": "Wrong client"}, format="json", **self.psych_auth
        )
        self.assertEqual(refused.status_code, 403)
        removed = self.client.post(url, {"reason": "Wrong client"}, format="json", **self.auth)
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertEqual(removed.data["copies"], [])
        with platform_admin_context():
            self.assertEqual(Attachment.objects.get(pk=copy_id).doc_status, "ARCHIVED")
        self.assertEqual(self.client.get(url, **self.auth).status_code, 404)

    def test_only_clinical_staff_may_upload_or_download(self):
        doc_id = self.start("VOLUNTARY")
        copy_id = self.upload(doc_id).data["copies"][0]["id"]
        with platform_admin_context():
            clerk = User.objects.create_user(
                email=f"clerk-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        clerk_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(clerk)[0]}"}
        self.assertEqual(self.upload(doc_id, auth=clerk_auth).status_code, 403)
        self.assertEqual(
            self.client.get(self.copy_url(doc_id, copy_id), **clerk_auth).status_code, 403
        )


class UploadSignsTheApplicationTests(LegalDocumentCopyTests):
    def upload_and_sign(self, doc_id, **fields):
        return self.client.post(
            reverse("care-legal-document-copies", args=[doc_id]),
            {
                "file": SimpleUploadedFile("signed.pdf", PDF, content_type="application/pdf"),
                "sign": "true",
                **fields,
            },
            format="multipart",
            **self.auth,
        )

    def test_uploading_the_signed_involuntary_application_signs_it_by_the_applicant(self):
        person = self.nok()
        doc_id = self.start("INVOLUNTARY")
        self.save(
            doc_id,
            {"applicant_related_person_id": str(person.pk), "assertions": ["DANGER_TO_SELF"]},
        )
        response = self.upload_and_sign(doc_id)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "SIGNED")
        self.assertEqual(response.data["signature_method"], "WET_SCAN")
        self.assertEqual(response.data["signer_name"], "Peter Kamau")
        self.assertEqual(response.data["signer_kind"], "RELATED_PERSON")
        [copy] = response.data["copies"]
        with platform_admin_context():
            doc = LegalDocument.objects.get(pk=doc_id)
            self.assertEqual(str(doc.signature_attachment_id), copy["id"])

    def test_uploading_the_signed_voluntary_application_signs_it_by_the_client(self):
        doc_id = self.start("VOLUNTARY")
        self.save(doc_id, {"notice_acknowledged": True})
        response = self.upload_and_sign(doc_id, signer_kind="CLIENT")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            (response.data["status"], response.data["signer_kind"]), ("SIGNED", "CLIENT")
        )

    def test_an_incomplete_form_is_not_signed_and_the_upload_is_not_kept(self):
        doc_id = self.start("INVOLUNTARY")  # Part A/B not filled in
        response = self.upload_and_sign(doc_id)
        self.assertEqual(response.status_code, 400)
        with platform_admin_context():
            self.assertEqual(LegalDocument.objects.get(pk=doc_id).status, "DRAFT")
            self.assertFalse(Attachment.objects.filter(legal_document_id=doc_id).exists())

    def test_a_recommendation_is_not_signed_by_upload(self):
        application, _ = self.signed_involuntary_application()
        rec = self.call("post", "care-legal-recommendation", {}, [application], self.psych_auth)
        self.assertEqual(self.upload_and_sign(rec.data["id"]).status_code, 400)


class ChangeApplicationTypeTests(LegalStatusTestCase):
    def change(self, category, reason=""):
        return self.call("post", "care-legal-change-type", {"category": category, "reason": reason})

    def test_an_unsigned_draft_switches_type_and_is_kept_as_withdrawn(self):
        old = self.start("VOLUNTARY")
        response = self.change("INVOLUNTARY")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["template_id"], "DOC-LEG-STAT-INV-APP-KE")
        ws = self.ws()
        self.assertEqual(ws["legal_status"]["category"], "INVOLUNTARY")
        self.assertEqual(ws["legal_status"]["pending_application"], response.data["id"])
        with platform_admin_context():
            self.assertEqual(LegalDocument.objects.get(pk=old).status, "VOID")

    def test_a_signed_application_needs_a_reason_and_takes_its_recommendations(self):
        application, _ = self.signed_involuntary_application()
        rec = self.signed_recommendation(application)
        self.assertEqual(self.change("VOLUNTARY").status_code, 400)
        response = self.change("VOLUNTARY", "Client agrees to admission and has capacity")
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            self.assertEqual(LegalDocument.objects.get(pk=application).status, "VOID")
            self.assertEqual(LegalDocument.objects.get(pk=rec).status, "VOID")
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    model="care_pathway.legalstatus",
                    field_diff__legal_event="APPLICATION_WITHDRAWN",
                ).exists()
            )
        # Nothing waits on the admitting officer for the withdrawn application.
        self.assertEqual(self.decide("ADMITTED").status_code, 400)

    def test_cannot_change_once_admitted_or_to_the_same_type(self):
        self.start("VOLUNTARY")
        self.assertEqual(self.change("VOLUNTARY").status_code, 400)
        self.change("INVOLUNTARY")  # back to a fresh state for the admitted case
        self.change("VOLUNTARY")
        with platform_admin_context():
            pending = LegalDocument.objects.filter(status="DRAFT").get()
        self.save(str(pending.pk), {"notice_acknowledged": True})
        self.assertEqual(self.sign_doc(str(pending.pk)).status_code, 200)
        self.assertEqual(self.decide("ADMITTED").status_code, 200)
        self.assertEqual(self.change("INVOLUNTARY").status_code, 400)


class OfficialUseBlockTests(LegalStatusTestCase):
    def printed(self, doc_id):
        response = self.client.get(reverse("care-legal-document-print", args=[doc_id]), **self.auth)
        self.assertEqual(response.status_code, 200)
        return response.content.decode()

    def test_left_off_until_the_admitting_officer_decides_then_printed_filled_in(self):
        doc_id = self.start("VOLUNTARY")
        self.save(doc_id, {"notice_acknowledged": True})
        self.assertEqual(self.sign_doc(doc_id).status_code, 200)
        self.assertNotIn("FOR OFFICIAL USE ONLY", self.printed(doc_id))
        self.assertEqual(self.decide("ADMITTED").status_code, 200)
        after = self.printed(doc_id)
        self.assertIn("FOR OFFICIAL USE ONLY", after)
        self.assertIn("Admitting Officer", after)
