"""Professional profiles: what each role must fill in, submit → verify / return,
who is told, expiry reminders, and the expired-licence signing block
(owner decisions 2026-11-05). Also the Org Admin setup checklist and the
organisation-scoped audit of the NACADA reporting email."""

from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from django.db.utils import DatabaseError
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITestCase

from apps.accounts import practitioner_notify, practitioner_profile
from apps.accounts.access import set_assignments
from apps.accounts.models import (
    PractitionerCredential,
    PractitionerCredentialDocument,
    PractitionerCredentialItem,
    PractitionerCredentialReview,
    Role,
    User,
)
from apps.accounts.tokens import issue_tokens
from apps.notifications.models import Notification
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import Branch, Organization

PDF = b"%PDF-1.4\n%test\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


def _template(key):
    return Role.objects.get(organization__isnull=True, system_key=key)


class ProfileTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Cafric", slug="cafric", facility_type="MENTAL_HEALTH_MHP"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Thika", facility_level="L3"
            )
            self.admin = self._user("admin@cafric.test", "org_admin", "Grace", "Otieno")
            self.nurse = self._user("nurse@cafric.test", "nurse", "Ann", "Mutua", self.branch)
            self.supervisor = self._user(
                "sup@cafric.test", "clinical_supervisor", "Peter", "Kamau", self.branch
            )
            self.desk = self._user("desk@cafric.test", "front_desk", "Mary", "Wanjiru", self.branch)

    def _user(self, email, key, first, last, branch=None):
        user = User.objects.create_user(
            email=email,
            password="Password123!",
            organization=self.org,
            is_active=True,
            first_name=first,
            last_name=last,
        )
        set_tenant_context(organization_id=self.org.id)
        set_assignments(user, [(_template(key), branch)])
        set_tenant_context(is_platform_admin=True)
        return user

    def auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def put_profile(self, user, data):
        return self.client.put(
            reverse("me-professional-profile"), data, format="json", **self.auth(user)
        )

    def upload(self, user, kind, content=PDF, name="doc.pdf"):
        return self.client.post(
            reverse("me-professional-profile-document", args=[kind]),
            {"file": SimpleUploadedFile(name, content, content_type="application/pdf")},
            format="multipart",
            **self.auth(user),
        )

    def add_item(self, user, data, content=PDF, name="doc.pdf"):
        body = dict(data)
        if content is not None:
            body["file"] = SimpleUploadedFile(name, content, content_type="application/pdf")
        return self.client.post(
            reverse("me-professional-profile-items"), body, format="multipart", **self.auth(user)
        )

    def add_licence(self, user, expires_on, issuer="Nursing Council of Kenya (NCK)", **extra):
        response = self.add_item(
            user,
            {
                "kind": "LICENCE",
                "issuer": issuer,
                "number": extra.pop("number", "LIC-2026-1"),
                "issued_on": str(min(timezone.localdate(), expires_on) - timedelta(days=300)),
                "expires_on": str(expires_on),
            },
            **extra,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def item_ids(self, data, kind=None):
        return [i["id"] for i in data["items"] if kind is None or i["kind"] == kind]

    def submit(self, user):
        return self.client.post(reverse("me-professional-profile-submit"), **self.auth(user))

    def complete_profile(self, user, expires_on=None):
        expires_on = expires_on or (timezone.localdate() + timedelta(days=365))
        response = self.put_profile(
            user,
            {
                "phone": "+254700000001",
                "regulator": "NCK",
                "registration_number": "NCK-123",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.upload(user, "registration").status_code, 200)
        self.add_licence(user, expires_on)
        response = self.add_item(
            user, {"kind": "DEGREE", "title": "BSc Nursing", "issuer": "University of Nairobi"}
        )
        self.assertEqual(response.status_code, 201, response.data)

    def licence_on_file(self, user, expires_on, number="LIC-1", issuer="NCK"):
        cred = practitioner_profile.credential_for(user, create=True)
        return PractitionerCredentialItem.objects.create(
            organization_id=cred.organization_id,
            credential=cred,
            kind="LICENCE",
            issuer=issuer,
            number=number,
            expires_on=expires_on,
        )

    def notices(self, user):
        with platform_admin_context():
            return list(
                Notification.objects.filter(
                    recipient=user, category=Notification.CATEGORY_PRACTITIONER_PROFILE
                )
            )


class RequirementTests(ProfileTestCase):
    def test_a_clinician_needs_registration_licence_and_documents(self):
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        self.assertTrue(data["credentials_required"])
        self.assertEqual(data["suggested_regulators"], ["NCK"])
        keys = {i["key"] for i in data["missing_items"]}
        self.assertTrue(
            {"phone", "regulator", "registration_number", "registration_evidence", "licence"}
            <= keys
        )
        self.assertIn("qualification", keys)
        self.assertTrue(data["needs_action"])

    def test_front_desk_needs_only_a_phone_number(self):
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.desk)).data
        self.assertFalse(data["credentials_required"])
        self.assertEqual([i["key"] for i in data["missing_items"]], ["phone"])
        self.put_profile(self.desk, {"phone": "+254700000009"})
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.desk)).data
        self.assertFalse(data["needs_action"])
        self.assertEqual(self.submit(self.desk).status_code, 400)

    def test_my_profile_carries_the_summary(self):
        data = self.client.get(reverse("me-profile"), **self.auth(self.nurse)).data
        self.assertTrue(data["professional_profile"]["needs_action"])


class EditingTests(ProfileTestCase):
    def test_the_practitioner_cannot_verify_their_own_entries(self):
        self.complete_profile(self.nurse)
        self.put_profile(self.nurse, {"registration_verified": True, "nacada": {"verified": True}})
        with platform_admin_context():
            cred = PractitionerCredential.objects.get(user=self.nurse)
        self.assertIsNone(cred.registration_verified_at)
        self.assertFalse(cred.items.filter(verified_at__isnull=False).exists())
        self.assertEqual(cred.profile_status, "DRAFT")

    def test_an_unknown_regulator_and_bad_dates_are_refused(self):
        self.assertEqual(self.put_profile(self.nurse, {"regulator": "XYZ"}).status_code, 400)
        self.assertEqual(
            self.add_item(self.nurse, {"kind": "LICENCE", "expires_on": "soon"}).status_code, 400
        )
        response = self.add_item(
            self.nurse, {"kind": "LICENCE", "issued_on": "2026-05-01", "expires_on": "2026-04-01"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.add_item(self.nurse, {"kind": "PHD"}).status_code, 400)
        with platform_admin_context():
            self.assertFalse(PractitionerCredentialItem.objects.exists())

    def test_uploads_must_be_small_and_what_they_say_they_are(self):
        self.assertEqual(self.upload(self.nurse, "registration", PDF, "x.exe").status_code, 400)
        self.assertEqual(self.upload(self.nurse, "registration", PNG, "x.pdf").status_code, 400)
        big = b"%PDF-" + b"0" * (10 * 1024 * 1024)
        self.assertEqual(self.upload(self.nurse, "registration", big, "x.pdf").status_code, 400)
        self.assertEqual(self.upload(self.nurse, "registration", PNG, "x.png").status_code, 200)
        self.assertEqual(self.upload(self.nurse, "unknown").status_code, 400)
        self.assertEqual(self.upload(self.nurse, "licence").status_code, 400)  # an entry now
        # An entry's document is checked the same way, and a bad one adds nothing.
        bad = self.add_item(self.nurse, {"kind": "DEGREE", "title": "BSc"}, PNG, "x.pdf")
        self.assertEqual(bad.status_code, 400)
        with platform_admin_context():
            self.assertFalse(PractitionerCredentialItem.objects.exists())

    def test_documents_open_for_their_owner_and_reviewers_only_and_are_audited(self):
        self.upload(self.nurse, "registration")
        data = self.add_licence(self.nurse, timezone.localdate() + timedelta(days=100))
        (item,) = data["items"]
        (reg_file,) = data["documents"]["registration"]["files"]
        (item_file,) = item["files"]
        for file_id in (reg_file["id"], item_file["id"]):
            own = self.client.get(
                reverse("me-professional-profile-file", args=[file_id]), **self.auth(self.nurse)
            )
            self.assertEqual(own.status_code, 200)
            url = reverse("staff-credential-file", args=[self.nurse.pk, file_id])
            self.assertEqual(self.client.get(url, **self.auth(self.desk)).status_code, 403)
            self.assertEqual(self.client.get(url, **self.auth(self.admin)).status_code, 200)
            # Someone else's file is not reachable through my own profile.
            other = self.client.get(
                reverse("me-professional-profile-file", args=[file_id]),
                **self.auth(self.supervisor),
            )
            self.assertEqual(other.status_code, 404)
        with platform_admin_context():
            views = AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_VIEW,
                model="accounts.practitionercredential",
                organization_id=self.org.id,
            )
            self.assertEqual(views.count(), 4)


class ManyDocumentsTests(ProfileTestCase):
    """Every slot takes many files (owner decision 2026-11-09)."""

    def pdf(self, name):
        return SimpleUploadedFile(name, PDF, content_type="application/pdf")

    def test_a_slot_takes_several_files_at_once_and_more_later(self):
        response = self.client.post(
            reverse("me-professional-profile-document", args=["registration"]),
            {"files": [self.pdf("page1.pdf"), self.pdf("page2.pdf")]},
            format="multipart",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.upload(self.nurse, "registration", name="renewal-letter.pdf")
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        names = [f["name"] for f in data["documents"]["registration"]["files"]]
        self.assertEqual(names, ["page1.pdf", "page2.pdf", "renewal-letter.pdf"])
        self.assertNotIn("registration_evidence", {m["key"] for m in data["missing_items"]})

    def test_one_bad_file_adds_none_of_them(self):
        response = self.client.post(
            reverse("me-professional-profile-document", args=["nacada"]),
            {"files": [self.pdf("ok.pdf"), SimpleUploadedFile("bad.pdf", PNG)]},
            format="multipart",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 400)
        with platform_admin_context():
            self.assertFalse(PractitionerCredentialDocument.objects.exists())

    def test_an_entry_takes_several_files_when_added_and_after(self):
        response = self.add_item(
            self.nurse, {"kind": "DEGREE", "title": "BSc Nursing", "issuer": "UoN"}, None
        )
        item_id = response.data["items"][0]["id"]
        response = self.client.post(
            reverse("me-professional-profile-item-document", args=[item_id]),
            {"files": [self.pdf("degree.pdf"), self.pdf("transcript.pdf")]},
            format="multipart",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [f["name"] for f in response.data["items"][0]["files"]],
            ["degree.pdf", "transcript.pdf"],
        )

    def test_removing_a_file_hides_it_keeps_it_and_needs_verifying_again(self):
        self.complete_profile(self.nurse)
        self.upload(self.nurse, "registration", name="second.pdf")
        self.submit(self.nurse)
        self.client.post(
            reverse("staff-credential-verify", args=[self.nurse.pk]), **self.auth(self.admin)
        )
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        first = data["documents"]["registration"]["files"][0]["id"]
        response = self.client.delete(
            reverse("me-professional-profile-file", args=[first]), **self.auth(self.nurse)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["documents"]["registration"]["files"]), 1)
        self.assertEqual(response.data["status"], "DRAFT")
        with platform_admin_context():
            removed = PractitionerCredentialDocument.objects.get(pk=first)
            cred = PractitionerCredential.objects.get(user=self.nurse)
        self.assertIsNotNone(removed.removed_at)
        self.assertTrue(removed.file)
        self.assertIsNone(cred.registration_verified_at)
        # The last file gone: the slot asks for a document again.
        last = response.data["documents"]["registration"]["files"][0]["id"]
        response = self.client.delete(
            reverse("me-professional-profile-file", args=[last]), **self.auth(self.nurse)
        )
        self.assertIn("registration_evidence", {m["key"] for m in response.data["missing_items"]})

    def test_a_practitioner_records_registrations_with_more_regulators(self):
        self.complete_profile(self.nurse)
        response = self.add_item(
            self.nurse, {"kind": "REGISTRATION", "regulator": "CPB", "number": "CPB-77"}
        )
        self.assertEqual(response.status_code, 201, response.data)
        (reg,) = [i for i in response.data["items"] if i["kind"] == "REGISTRATION"]
        # Named by the choice, never by what was typed.
        self.assertEqual(reg["issuer"], "Counsellors and Psychologists Board")
        self.assertEqual(reg["regulator"], "CPB")
        self.assertEqual(response.data["missing_items"], [])
        # A registration is not a qualification: the MHA qualifications line ignores it.
        with platform_admin_context():
            cred = PractitionerCredential.objects.get(user=self.nurse)
        self.assertEqual(cred.qualifications, "BSc Nursing")
        # "Other" needs the body's name; an unknown code is refused.
        other = self.add_item(self.nurse, {"kind": "REGISTRATION", "regulator": "OTHER"})
        self.assertEqual(other.status_code, 400)
        bad = self.add_item(self.nurse, {"kind": "REGISTRATION", "regulator": "XYZ"})
        self.assertEqual(bad.status_code, 400)
        named = self.add_item(
            self.nurse,
            {"kind": "REGISTRATION", "regulator": "OTHER", "issuer": "A Board", "number": "1"},
            None,
        )
        self.assertEqual(named.status_code, 201)
        self.assertIn(
            "Registration A Board 1 (upload)", [m["label"] for m in named.data["missing_items"]]
        )

    def test_the_org_admin_adds_several_nacada_certificates(self):
        url = reverse("care-practitioner-nacada-evidence", args=[self.nurse.pk])
        response = self.client.post(
            url,
            {"files": [self.pdf("nacada-1.pdf"), self.pdf("nacada-2.pdf")]},
            format="multipart",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        files = response.data["nacada"]["files"]
        self.assertEqual([f["name"] for f in files], ["nacada-1.pdf", "nacada-2.pdf"])
        one = self.client.get(f"{url}?file={files[0]['id']}", **self.auth(self.admin))
        self.assertEqual(one.status_code, 200)
        self.assertIn("nacada-1", one["Content-Disposition"])
        # They are the practitioner's own NACADA slot.
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        self.assertEqual(len(data["documents"]["nacada"]["files"]), 2)


class ManyCredentialsTests(ProfileTestCase):
    def test_every_licence_and_qualification_has_its_own_document(self):
        today = timezone.localdate()
        self.complete_profile(self.nurse)
        # A second licence and two more qualifications, one without its document yet.
        self.add_licence(
            self.nurse,
            today + timedelta(days=200),
            issuer="Counsellors and Psychologists Board",
            number="CPB-9",
        )
        self.add_item(self.nurse, {"kind": "DIPLOMA", "title": "Dip. Addiction Counselling"})
        data = self.add_item(
            self.nurse, {"kind": "CERTIFICATE", "title": "Motivational interviewing"}, None
        ).data
        self.assertEqual(len(data["items"]), 5)
        self.assertEqual(len(self.item_ids(data, "LICENCE")), 2)
        waiting = [i for i in data["items"] if not i["document_uploaded"]]
        self.assertEqual([i["title"] for i in waiting], ["Motivational interviewing"])
        self.assertIn(
            "Motivational interviewing (upload)", [m["label"] for m in data["missing_items"]]
        )
        self.assertEqual(self.submit(self.nurse).status_code, 400)
        url = reverse("me-professional-profile-item-document", args=[waiting[0]["id"]])
        response = self.client.post(
            url,
            {"file": SimpleUploadedFile("c.pdf", PDF, content_type="application/pdf")},
            format="multipart",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["missing_items"], [])
        self.assertEqual(self.submit(self.nurse).status_code, 200)
        # The Mental Health Act forms' qualifications line follows the entries.
        with platform_admin_context():
            cred = PractitionerCredential.objects.get(user=self.nurse)
        self.assertEqual(
            cred.qualifications,
            "BSc Nursing, Dip. Addiction Counselling, Motivational interviewing",
        )
        # Verifying stamps every entry.
        self.client.post(
            reverse("staff-credential-verify", args=[self.nurse.pk]), **self.auth(self.admin)
        )
        with platform_admin_context():
            self.assertFalse(cred.items.filter(verified_at__isnull=True).exists())

    def test_a_licence_and_a_qualification_are_both_needed(self):
        self.complete_profile(self.nurse)
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        for item_id in self.item_ids(data, "DEGREE"):
            self.client.delete(
                reverse("me-professional-profile-item", args=[item_id]), **self.auth(self.nurse)
            )
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        self.assertEqual([m["key"] for m in data["missing_items"]], ["qualification"])
        # Removed, not deleted: the row and its document are kept.
        with platform_admin_context():
            removed = PractitionerCredentialItem.objects.get(kind="DEGREE")
            self.assertTrue(removed.documents.exists())
        self.assertIsNotNone(removed.removed_at)

    def test_a_renewal_supersedes_the_expired_licence_from_the_same_regulator(self):
        today = timezone.localdate()
        with platform_admin_context():
            self.licence_on_file(self.nurse, today - timedelta(days=5), "OLD", "NCK")
            self.assertIn("expired", practitioner_profile.signing_block_reason(self.nurse))
            self.licence_on_file(self.nurse, today + timedelta(days=360), "NEW", " nck ")
            self.assertIsNone(practitioner_profile.signing_block_reason(self.nurse))
            # A licence from another regulator that has lapsed still blocks.
            self.licence_on_file(self.nurse, today - timedelta(days=1), "CPB-1", "CPB")
            self.assertIn("CPB", practitioner_profile.signing_block_reason(self.nurse))
            cred = PractitionerCredential.objects.get(user=self.nurse)
            self.assertEqual(sorted(i.number for i in cred.current_licences()), ["CPB-1", "NEW"])
            self.assertEqual(cred.licence_status, "EXPIRED")

    def test_editing_an_entry_clears_its_verification_only(self):
        self.complete_profile(self.nurse)
        self.submit(self.nurse)
        self.client.post(
            reverse("staff-credential-verify", args=[self.nurse.pk]), **self.auth(self.admin)
        )
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        (licence_id,) = self.item_ids(data, "LICENCE")
        response = self.client.patch(
            reverse("me-professional-profile-item", args=[licence_id]),
            {"number": "LIC-2027-1"},
            format="json",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 200, response.data)
        items = {i["kind"]: i for i in response.data["items"]}
        self.assertIsNone(items["LICENCE"]["verified_at"])
        self.assertIsNotNone(items["DEGREE"]["verified_at"])
        self.assertEqual(response.data["status"], "DRAFT")


class WorkflowTests(ProfileTestCase):
    def test_submitting_needs_everything_required(self):
        response = self.submit(self.nurse)
        self.assertEqual(response.status_code, 400)
        self.assertIn("A practising licence;", response.data["error"]["message"])

    def test_an_expired_licence_cannot_be_submitted(self):
        self.complete_profile(self.nurse, expires_on=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.submit(self.nurse).status_code, 400)

    def test_submission_tells_admins_and_verifiers_but_not_the_submitter(self):
        self.complete_profile(self.nurse)
        response = self.submit(self.nurse)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "SUBMITTED")
        self.assertEqual(len(self.notices(self.admin)), 1)
        self.assertEqual(len(self.notices(self.supervisor)), 1)  # staff.credentials.verify
        self.assertEqual(len(self.notices(self.desk)), 0)
        self.assertFalse([n for n in self.notices(self.nurse) if "submitted" in n.title.lower()])
        self.assertIn(str(self.nurse.pk), self.notices(self.admin)[0].link)
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    action=AuditLogEntry.ACTION_CREDENTIAL_SUBMIT, organization_id=self.org.id
                ).exists()
            )
        self.assertEqual(self.submit(self.nurse).status_code, 400)  # already awaiting

    def test_only_a_reviewer_verifies_and_never_their_own(self):
        self.complete_profile(self.nurse)
        self.submit(self.nurse)
        verify = reverse("staff-credential-verify", args=[self.nurse.pk])
        self.assertEqual(self.client.post(verify, **self.auth(self.desk)).status_code, 403)
        response = self.client.post(verify, **self.auth(self.supervisor))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "VERIFIED")
        with platform_admin_context():
            cred = PractitionerCredential.objects.get(user=self.nurse)
        self.assertEqual(cred.registration_verified_by_id, self.supervisor.pk)
        with platform_admin_context():
            self.assertEqual(cred.licence_status, "VALID")
        self.assertTrue([n for n in self.notices(self.nurse) if "verified" in n.title])

        self.complete_profile(self.supervisor)
        self.submit(self.supervisor)
        own = reverse("staff-credential-verify", args=[self.supervisor.pk])
        self.assertEqual(self.client.post(own, **self.auth(self.supervisor)).status_code, 403)

    def test_returning_needs_a_reason_and_tells_the_practitioner(self):
        self.complete_profile(self.nurse)
        self.submit(self.nurse)
        url = reverse("staff-credential-return", args=[self.nurse.pk])
        self.assertEqual(
            self.client.post(
                url, {"reason": ""}, format="json", **self.auth(self.admin)
            ).status_code,
            400,
        )
        response = self.client.post(
            url,
            {"reason": "The licence scan is unreadable."},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "RETURNED")
        returned = [n for n in self.notices(self.nurse) if "returned" in n.title]
        self.assertEqual(len(returned), 1)
        self.assertIn("unreadable", returned[0].body)
        # Fix it and submit again.
        self.upload(self.nurse, "registration")
        self.assertEqual(self.submit(self.nurse).status_code, 200)

    def test_changing_a_verified_licence_needs_verifying_again(self):
        self.complete_profile(self.nurse)
        self.submit(self.nurse)
        self.client.post(
            reverse("staff-credential-verify", args=[self.nurse.pk]), **self.auth(self.admin)
        )
        data = self.client.get(reverse("me-professional-profile"), **self.auth(self.nurse)).data
        (licence_id,) = self.item_ids(data, "LICENCE")
        self.client.patch(
            reverse("me-professional-profile-item", args=[licence_id]),
            {"expires_on": str(timezone.localdate() + timedelta(days=700))},
            format="json",
            **self.auth(self.nurse),
        )
        with platform_admin_context():
            cred = PractitionerCredential.objects.get(user=self.nurse)
            self.assertIsNone(cred.items.get(kind="LICENCE").verified_at)
        self.assertIsNotNone(cred.registration_verified_at)
        self.assertEqual(cred.profile_status, "DRAFT")

    def test_the_review_history_is_append_only(self):
        self.complete_profile(self.nurse)
        self.submit(self.nurse)
        with platform_admin_context():
            review = PractitionerCredentialReview.objects.get(user=self.nurse)
            numbers = [i["number"] for i in review.snapshot["items"] if i["kind"] == "LICENCE"]
            self.assertEqual(numbers, ["LIC-2026-1"])
            with self.assertRaises(DatabaseError), transaction.atomic():
                PractitionerCredentialReview.objects.filter(pk=review.pk).update(reason="x")
            with self.assertRaises(DatabaseError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "DELETE FROM accounts_practitionercredentialreview WHERE id = %s",
                        [review.pk],
                    )


class SigningBlockTests(ProfileTestCase):
    def test_only_an_expired_licence_blocks_signing(self):
        with platform_admin_context():
            # Nothing recorded, and an incomplete profile: no block.
            self.assertIsNone(practitioner_profile.signing_block_reason(self.nurse))
            licence = self.licence_on_file(self.nurse, timezone.localdate())
            self.assertIsNone(practitioner_profile.signing_block_reason(self.nurse))
            licence.expires_on = timezone.localdate() - timedelta(days=1)
            licence.save()
            self.assertIn("expired", practitioner_profile.signing_block_reason(self.nurse))
            with self.assertRaises(PermissionDenied):
                practitioner_profile.require_current_licence(self.nurse)
            # Front desk holds no clinical role: never blocked.
            self.assertIsNone(practitioner_profile.signing_block_reason(self.desk))

    def test_signing_a_progress_note_is_refused_on_an_expired_licence(self):
        from apps.care_pathway.records import sign_note

        class Note:
            status = "DRAFT"
            text = "Seen today."

        with platform_admin_context():
            self.licence_on_file(self.nurse, timezone.localdate() - timedelta(days=3))
            with self.assertRaises(PermissionDenied):
                sign_note(Note(), self.nurse)


class ReminderTests(ProfileTestCase):
    def test_sign_in_reminder_is_sent_once_per_state(self):
        with platform_admin_context():
            self.assertEqual(practitioner_notify.remind_at_sign_in(self.nurse), 1)
            self.assertEqual(practitioner_notify.remind_at_sign_in(self.nurse), 0)
        self.assertEqual(self.notices(self.nurse)[0].link, "/clinical/profile#professional-profile")

    def test_signing_in_creates_the_reminder(self):
        codes = []

        def capture(user, code, purpose):
            codes.append(code)
            return "EMAIL"

        with patch("apps.accounts.auth_views._dispatch_login_otp", side_effect=capture):
            response = self.client.post(
                reverse("auth-login"),
                {"email": self.nurse.email, "password": "Password123!"},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.data)
        if response.data.get("requires_otp"):
            response = self.client.post(
                reverse("auth-login-verify-otp"),
                {"otp_token": response.data["otp_token"], "otp": codes[-1]},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertEqual(len(self.notices(self.nurse)), 1)

    @override_settings(PRACTITIONER_LICENCE_REMINDER_DAYS=[60, 30, 7, 0])
    def test_expiry_reminders_go_once_per_stage(self):
        today = timezone.localdate()
        with platform_admin_context():
            cred = self.licence_on_file(self.nurse, today + timedelta(days=25)).credential
            first = practitioner_notify.remind_all(today)
            again = practitioner_notify.remind_all(today)
        self.assertEqual(first[str(cred.pk)], ["licence:T-30"])
        self.assertEqual(again[str(cred.pk)], ["licence:T-30"])
        self.assertEqual(len(self.notices(self.nurse)), 1)
        self.assertEqual(len(self.notices(self.admin)), 1)
        with platform_admin_context():
            practitioner_notify.remind_all(today + timedelta(days=26))
        self.assertTrue([n for n in self.notices(self.nurse) if "expired" in n.title])


class OrganisationSetupTests(ProfileTestCase):
    def test_checklist_is_for_the_org_admin_only(self):
        url = reverse("platform-organization-setup-checklist", args=[self.org.pk])
        self.assertEqual(self.client.get(url, **self.auth(self.nurse)).status_code, 403)
        response = self.client.get(url, **self.auth(self.admin))
        self.assertEqual(response.status_code, 200)
        items = {i["key"]: i for i in response.data["items"]}
        self.assertFalse(items["nacada_report_email"]["done"])
        self.assertEqual(items["profiles_not_submitted"]["count"], 2)  # nurse + supervisor

    def test_nacada_email_change_is_in_the_organisations_audit_log(self):
        response = self.client.put(
            reverse("nacada-settings"),
            {"nacada_report_email": "ndo@nacada.test"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200)
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                model="tenancy.organization", organization_id=self.org.id
            ).latest("timestamp")
        self.assertEqual(entry.field_diff["nacada_report_email"]["new"], "ndo@nacada.test")
        items = {
            i["key"]: i
            for i in self.client.get(
                reverse("platform-organization-setup-checklist", args=[self.org.pk]),
                **self.auth(self.admin),
            ).data["items"]
        }
        self.assertTrue(items["nacada_report_email"]["done"])

    def test_encrypted_settings_never_reach_the_audit_trail(self):
        with platform_admin_context():
            self.org.email_host_password_encrypted = "ciphertext-value"
            self.org.save()
            entry = AuditLogEntry.objects.filter(
                model="tenancy.organization", organization_id=self.org.id
            ).latest("timestamp")
        value = entry.field_diff["email_host_password_encrypted"]["new"]
        self.assertTrue(value.startswith("[encrypted "))
        self.assertNotIn("ciphertext", value)


class StaffListPrintTests(ProfileTestCase):
    def test_org_admin_prints_the_filtered_roster(self):
        url = reverse("staff-print-list")
        self.assertEqual(self.client.get(url, **self.auth(self.nurse)).status_code, 403)
        preview = self.client.get(
            url + f"?ids={self.nurse.pk},{self.desk.pk}&described=role: Nurse",
            **self.auth(self.admin),
        )
        self.assertEqual(preview.status_code, 200)
        html = preview.content.decode()
        self.assertIn("Ann Mutua", html)
        self.assertIn("Mary Wanjiru", html)
        self.assertNotIn("Peter Kamau", html)  # not among the filtered rows
        self.assertIn("role: Nurse", html)
        pdf = self.client.get(url + "?output=pdf", **self.auth(self.admin))
        self.assertTrue(pdf.content.startswith(b"%PDF-"))
