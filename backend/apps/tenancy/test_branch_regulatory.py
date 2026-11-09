"""Branch regulatory documents: as many records per branch as it needs, each
with many files (owner decision 2026-11-09). Organisation administration,
not patient data — no FHIR."""

import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.access import set_assignments
from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context

from .models import Branch, BranchRegulatoryFile, BranchRegulatoryRecord, Organization

PDF = b"%PDF-1.4\n%test\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16

_MEDIA_ROOT = tempfile.mkdtemp(prefix="branch-regulatory-tests-")


def _template(key):
    return Role.objects.get(organization__isnull=True, system_key=key)


def _pdf(name="certificate.pdf", content=PDF):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class BranchRegulatoryTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.today = timezone.localdate()
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Recovery", slug="amani-regulatory", facility_type="MENTAL_HEALTH_MHP"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Ruiru", facility_level="L3"
            )
            self.other_org = Organization.objects.create(
                name="Other Org", slug="other-regulatory", facility_type="CLINIC"
            )
            self.other_branch = Branch.objects.create(
                organization=self.other_org, name="Elsewhere", facility_level="L2"
            )
            self.admin = self._user("admin@amani-regulatory.test", self.org, "org_admin")
            self.nurse = self._user("nurse@amani-regulatory.test", self.org, "nurse", self.branch)
            self.other_admin = self._user(
                "admin@other-regulatory.test", self.other_org, "org_admin"
            )

    def _user(self, email, org, key, branch=None):
        user = User.objects.create_user(
            email=email, password="Password123!", organization=org, is_active=True
        )
        set_tenant_context(organization_id=org.id)
        set_assignments(user, [(_template(key), branch)])
        set_tenant_context(is_platform_admin=True)
        return user

    def auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def records_url(self, branch=None):
        return reverse("branch-regulatory-records", args=[(branch or self.branch).pk])

    def create(self, user=None, files=None, branch=None, **fields):
        body = {
            "regulator": "KMPDC",
            "document_type": "Facility registration certificate",
            "number": "TEST-REG-1",  # fixture value, not a real number
            "issued_on": str(self.today - timedelta(days=30)),
            "valid_until": str(self.today + timedelta(days=335)),
            **fields,
        }
        body["files"] = [_pdf()] if files is None else files
        return self.client.post(
            self.records_url(branch),
            body,
            format="multipart",
            **self.auth(user or self.admin),
        )

    def test_create_with_several_files(self):
        response = self.create(files=[_pdf("page-1.pdf"), _pdf("page-2.pdf")])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data), 1)
        record = response.data[0]
        self.assertEqual(record["regulator"], "KMPDC")
        self.assertEqual(record["status"], "VALID")
        self.assertEqual(
            sorted(f["original_name"] for f in record["files"]), ["page-1.pdf", "page-2.pdf"]
        )
        self.assertNotIn("file", record["files"][0])  # no storage path or media URL
        listed = self.client.get(self.records_url(), **self.auth(self.admin))
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data[0]["files"]), 2)
        with platform_admin_context():
            created = AuditLogEntry.objects.filter(
                organization_id=self.org.id,
                action=AuditLogEntry.ACTION_CREATE,
                model="tenancy.branchregulatoryfile",
            )
            self.assertEqual(created.count(), 2)
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    organization_id=self.org.id,
                    action=AuditLogEntry.ACTION_CREATE,
                    model="tenancy.branchregulatoryrecord",
                ).exists()
            )

    def test_a_record_needs_at_least_one_file(self):
        response = self.create(files=[])
        self.assertEqual(response.status_code, 400)
        self.assertIn("files", response.data)
        with platform_admin_context():
            self.assertFalse(BranchRegulatoryRecord.objects.exists())

    def test_add_more_files_to_a_record(self):
        record_id = self.create().data[0]["id"]
        response = self.client.post(
            reverse("branch-regulatory-files", args=[self.branch.pk, record_id]),
            {"files": [_pdf("renewal.pdf"), SimpleUploadedFile("receipt.png", PNG)]},
            format="multipart",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data[0]["files"]), 3)

    def test_bad_file_rejected_and_nothing_stored(self):
        response = self.create(
            files=[_pdf("good.pdf"), _pdf("fake.pdf", content=b"MZ not a pdf at all")]
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fake.pdf", " ".join(str(m) for m in response.data["files"]))
        wrong_type = self.create(files=[SimpleUploadedFile("notes.docx", b"PK\x03\x04")])
        self.assertEqual(wrong_type.status_code, 400)
        with platform_admin_context():
            self.assertFalse(BranchRegulatoryRecord.objects.exists())
            self.assertFalse(BranchRegulatoryFile.objects.exists())

    def test_other_regulator_needs_a_name(self):
        unnamed = self.create(regulator="OTHER", regulator_name="  ")
        self.assertEqual(unnamed.status_code, 400)
        self.assertIn("regulator_name", unnamed.data)
        named = self.create(regulator="OTHER", regulator_name="County Health Department")
        self.assertEqual(named.status_code, 201, named.data)
        self.assertEqual(named.data[0]["regulator_display"], "County Health Department")
        # A name sent with a listed regulator is not kept.
        listed = self.create(regulator="PPB", regulator_name="Ignored")
        self.assertEqual(listed.data[0]["regulator_name"], "")

    def test_field_validation(self):
        no_type = self.create(document_type="   ")
        self.assertIn("document_type", no_type.data)
        future = self.create(issued_on=str(self.today + timedelta(days=1)))
        self.assertIn("issued_on", future.data)
        backwards = self.create(
            issued_on=str(self.today - timedelta(days=10)),
            valid_until=str(self.today - timedelta(days=20)),
        )
        self.assertIn("valid_until", backwards.data)
        undated = self.create(issued_on="", valid_until="")
        self.assertEqual(undated.status_code, 201, undated.data)
        self.assertEqual(undated.data[0]["status"], "NO_EXPIRY")

    def test_expiry_status(self):
        expired = self.create(
            issued_on=str(self.today - timedelta(days=400)),
            valid_until=str(self.today - timedelta(days=1)),
        )
        self.assertEqual(expired.data[0]["status"], "EXPIRED")
        expiring = self.create(valid_until=str(self.today + timedelta(days=5)))
        self.assertEqual(expiring.data[0]["status"], "EXPIRING")

    def test_remove_file_hides_it_and_keeps_the_row(self):
        record = self.create(files=[_pdf("a.pdf"), _pdf("b.pdf")]).data[0]
        file_id = record["files"][0]["id"]
        url = reverse("branch-regulatory-file", args=[self.branch.pk, record["id"], file_id])
        response = self.client.delete(url, **self.auth(self.admin))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data[0]["files"]), 1)
        self.assertEqual(self.client.get(url, **self.auth(self.admin)).status_code, 404)
        with platform_admin_context():
            stored = BranchRegulatoryFile.objects.get(pk=file_id)
            self.assertIsNotNone(stored.removed_at)
            self.assertEqual(stored.removed_by, self.admin)

    def test_remove_record_hides_it_and_keeps_the_row(self):
        record = self.create().data[0]
        response = self.client.delete(
            reverse("branch-regulatory-record", args=[self.branch.pk, record["id"]]),
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, [])
        download = self.client.get(
            reverse(
                "branch-regulatory-file",
                args=[self.branch.pk, record["id"], record["files"][0]["id"]],
            ),
            **self.auth(self.admin),
        )
        self.assertEqual(download.status_code, 404)
        with platform_admin_context():
            kept = BranchRegulatoryRecord.objects.get(pk=record["id"])
            self.assertIsNotNone(kept.removed_at)
            self.assertEqual(kept.files.count(), 1)
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    organization_id=self.org.id,
                    action=AuditLogEntry.ACTION_UPDATE,
                    model="tenancy.branchregulatoryrecord",
                    object_id=str(kept.pk),
                ).exists()
            )

    def test_download_streams_the_file_and_is_audited(self):
        record = self.create(files=[_pdf("licence.pdf")]).data[0]
        file_id = record["files"][0]["id"]
        response = self.client.get(
            reverse("branch-regulatory-file", args=[self.branch.pk, record["id"], file_id]),
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200)
        # Consuming the stream is enough: response.close() would fire
        # request_finished, which closes the test's database connection.
        self.assertEqual(b"".join(response.streaming_content), PDF)
        with platform_admin_context():
            views = AuditLogEntry.objects.filter(
                organization_id=self.org.id,
                action=AuditLogEntry.ACTION_VIEW,
                model="tenancy.branchregulatoryfile",
                object_id=file_id,
            )
            self.assertEqual(views.count(), 1)
            self.assertEqual(views.get().field_diff["file"], "licence.pdf")

    def test_other_organisation_cannot_reach_the_branch(self):
        record = self.create().data[0]
        file_url = reverse(
            "branch-regulatory-file",
            args=[self.branch.pk, record["id"], record["files"][0]["id"]],
        )
        outsider = self.auth(self.other_admin)
        self.assertEqual(self.client.get(self.records_url(), **outsider).status_code, 404)
        self.assertEqual(self.client.get(file_url, **outsider).status_code, 404)
        self.assertEqual(self.client.delete(file_url, **outsider).status_code, 404)
        self.assertEqual(self.create(user=self.other_admin).status_code, 404)
        # Nor can a record of this branch be reached through the outsider's own branch.
        crossed = self.client.get(
            reverse(
                "branch-regulatory-file",
                args=[self.other_branch.pk, record["id"], record["files"][0]["id"]],
            ),
            **outsider,
        )
        self.assertEqual(crossed.status_code, 404)
        own = self.client.get(self.records_url(self.other_branch), **outsider)
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.data, [])

    def test_staff_who_are_not_org_admin_are_refused(self):
        record = self.create().data[0]
        nurse = self.auth(self.nurse)
        self.assertEqual(self.client.get(self.records_url(), **nurse).status_code, 403)
        self.assertEqual(self.create(user=self.nurse).status_code, 403)
        file_url = reverse(
            "branch-regulatory-file",
            args=[self.branch.pk, record["id"], record["files"][0]["id"]],
        )
        self.assertEqual(self.client.get(file_url, **nurse).status_code, 403)
        self.assertEqual(self.client.delete(file_url, **nurse).status_code, 403)
        self.assertEqual(self.client.get(self.records_url()).status_code, 401)
