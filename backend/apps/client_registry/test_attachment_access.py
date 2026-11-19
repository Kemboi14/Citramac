"""Client attachments: preview for staff; download / print only with an Org Admin's
approval (once, within 24 hours); Org Admins download directly."""

import uuid
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway.tests import CarePathwayApiTestCase
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .models import AttachmentDownloadRequest

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


class AttachmentAccessTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.make_clinical()
        self.pid = self.register().data["patient_id"]
        with platform_admin_context():
            self.admin = User.objects.create_user(
                email=f"admin-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                is_active=True,
                first_name="Org",
                last_name="Admin",
            )
            self.admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
        self.admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.admin)[0]}"}
        uploaded = self.client.post(
            reverse("patient-attachments", args=[self.pid]),
            {
                "file": SimpleUploadedFile("scan.pdf", PDF, content_type="application/pdf"),
                "classification": "CURRENT",
                "category": "CLINICAL",
                "description": "Referral letter.pdf",
            },
            format="multipart",
            **self.auth,
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        self.att = uploaded.data["id"]

    def url(self, name):
        return reverse(name, args=[self.att])

    def request_copy(self, auth=None, reason="Needed for the court hearing"):
        return self.client.post(
            self.url("attachment-request-download"),
            {"reason": reason},
            format="json",
            **(auth or self.auth),
        )

    def decide(self, req_id, decision, reason="", auth=None):
        return self.client.post(
            reverse("attachment-download-decide", args=[req_id]),
            {"decision": decision, "reason": reason},
            format="json",
            **(auth or self.admin_auth),
        )

    def pending_id(self):
        with platform_admin_context():
            return str(AttachmentDownloadRequest.objects.get(status="PENDING").pk)

    def test_list_never_exposes_the_storage_url_and_names_the_file(self):
        rows = self.client.get(reverse("patient-attachments", args=[self.pid]), **self.auth).data
        self.assertNotIn("file", rows[0])
        self.assertEqual(rows[0]["name"], "Referral letter.pdf")
        self.assertEqual(rows[0]["content_type"], "application/pdf")
        self.assertEqual(rows[0]["access"], {"download": "request"})

    def test_preview_is_inline_and_audited(self):
        response = self.client.get(self.url("attachment-preview"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertIn("inline", response["Content-Disposition"])
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    object_id=self.att, field_diff__event="attachment_previewed"
                ).exists()
            )

    def test_download_needs_approval_and_works_once(self):
        self.assertEqual(
            self.client.get(self.url("attachment-download"), **self.auth).status_code, 403
        )
        self.assertEqual(self.request_copy().status_code, 201)
        self.assertEqual(self.request_copy().status_code, 400)  # one open request at a time
        req = self.pending_id()
        self.assertEqual(self.decide(req, "APPROVED").status_code, 200)
        first = self.client.get(self.url("attachment-download"), **self.auth)
        self.assertEqual(first.status_code, 200)
        self.assertIn("attachment", first["Content-Disposition"])
        self.assertEqual(b"".join(first.streaming_content), PDF)
        self.assertEqual(
            self.client.get(self.url("attachment-download"), **self.auth).status_code, 403
        )
        with platform_admin_context():
            self.assertEqual(AttachmentDownloadRequest.objects.get(pk=req).status, "USED")

    def test_an_approval_expires_after_24_hours(self):
        self.request_copy()
        req = self.pending_id()
        self.decide(req, "APPROVED")
        with platform_admin_context():
            AttachmentDownloadRequest.objects.filter(pk=req).update(
                expires_at=timezone.now() - timedelta(minutes=1)
            )
        self.assertEqual(
            self.client.get(self.url("attachment-download"), **self.auth).status_code, 403
        )

    def test_decline_needs_a_reason_and_only_an_org_admin_decides(self):
        self.request_copy()
        req = self.pending_id()
        self.assertEqual(self.decide(req, "APPROVED", auth=self.auth).status_code, 403)
        self.assertEqual(self.decide(req, "DECLINED").status_code, 400)
        self.assertEqual(self.decide(req, "DECLINED", "Not needed for care").status_code, 200)
        state = self.client.get(reverse("patient-attachments", args=[self.pid]), **self.auth).data
        self.assertEqual(state[0]["access"]["download"], "declined")

    def test_an_org_admin_downloads_directly(self):
        response = self.client.get(self.url("attachment-download"), **self.admin_auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request_copy(auth=self.admin_auth).status_code, 400)
        queue = self.client.get(reverse("attachment-download-requests"), **self.admin_auth)
        self.assertEqual(queue.status_code, 200)
        self.assertEqual(
            self.client.get(reverse("attachment-download-requests"), **self.auth).status_code, 403
        )
