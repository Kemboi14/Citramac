from datetime import timedelta

from django.apps import apps as django_apps
from django.contrib import admin
from django.db import models
from django.db.models import ProtectedError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.notifications.models import Notification, NotificationDelivery
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from . import services
from .guards import RecordArchivedError
from .models import ArchiveBatch, RetentionPlatformSettings
from .registry import PATIENT_PATHS

CLINICAL_APPS = {
    "client_registry",
    "clinical_encounter",
    "triage",
    "lims",
    "pharmacy",
    "ipd_ward",
    "mhp_program",
    "billing",
    "insurance_claims",
}


def _backdate(patient, years):
    """Make every row of this client's record look `years` old."""
    moment = timezone.now() - timedelta(days=365 * years + 10)
    for label, path in PATIENT_PATHS.items():
        model = django_apps.get_model(label)
        lookup = {"pk": patient.pk} if not path else {f"{path}": patient.pk}
        model.all_objects.filter(**lookup).update(updated_at=moment)


class RetentionFixtureMixin:
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani", facility_type="MENTAL_HEALTH_MHP"
            )
            self.org_admin = User.objects.create_user(
                email="admin@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                phone="0712345678",
            )
            self.org_admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
            self.clinician = User.objects.create_user(
                email="doctor@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
            self.old_patient = self._patient("Zawadi", "Kiprono")
            self.recent_patient = self._patient("Recent", "Record")
            _backdate(self.old_patient, 10)
        self.admin_auth = self._auth(self.org_admin)
        self.clinician_auth = self._auth(self.clinician)
        self.super_auth = self._auth(self.super_admin)

    def _patient(self, first, last, **extra):
        return Patient.objects.create(
            organization=self.org,
            first_name=first,
            last_name=last,
            gender="FEMALE",
            date_of_birth="1970-01-01",
            **extra,
        )

    def _auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _verify_floor(self):
        platform = RetentionPlatformSettings.get_solo()
        platform.floor_verified = True
        platform.floor_source = "Test fixture — not a real citation"
        platform.save()

    def _scan(self):
        with platform_admin_context():
            return services.scan_organization(self.org)


class RegistryCoverageTests(TestCase):
    def test_every_model_linked_to_a_patient_is_in_the_registry(self):
        """A new clinical table must be added to PATIENT_PATHS, or it would
        silently fall outside archiving and the never-delete guard."""
        patient_model = django_apps.get_model("client_registry.Patient")

        def reaches_patient(model, depth=0):
            if model is patient_model:
                return True
            if depth > 4:
                return False
            for field in model._meta.concrete_fields:
                if (
                    isinstance(field, models.ForeignKey)
                    and not field.null
                    and field.related_model._meta.app_label in CLINICAL_APPS
                    and reaches_patient(field.related_model, depth + 1)
                ):
                    return True
            return False

        missing = [
            model._meta.label
            for model in django_apps.get_models()
            if model._meta.app_label in CLINICAL_APPS
            and reaches_patient(model)
            and model._meta.label not in PATIENT_PATHS
        ]
        self.assertEqual(missing, [])

    def test_every_registry_path_resolves_to_patient(self):
        for label, path in PATIENT_PATHS.items():
            model = django_apps.get_model(label)
            with platform_admin_context():
                # Building the query is enough to prove the path exists.
                str(model.all_objects.filter(**{f"{path}__pk" if path else "pk": None}).query)


class NeverHardDeleteTests(RetentionFixtureMixin, APITestCase):
    def test_delete_is_not_offered_on_clinical_endpoints(self):
        with platform_admin_context():
            encounter = Encounter.objects.create(organization=self.org, patient=self.recent_patient)
        for url in (
            reverse("patient-detail", args=[self.recent_patient.id]),
            reverse("encounter-detail", args=[encounter.id]),
        ):
            response = self.client.delete(url, **self.admin_auth)
            self.assertEqual(response.status_code, 405, url)
        with platform_admin_context():
            self.assertTrue(Patient.objects.filter(pk=self.recent_patient.pk).exists())
            self.assertTrue(Encounter.objects.filter(pk=encounter.pk).exists())

    def test_deleting_a_patient_no_longer_cascades_through_the_chart(self):
        with platform_admin_context():
            Encounter.objects.create(organization=self.org, patient=self.recent_patient)
            with self.assertRaises(ProtectedError):
                self.recent_patient.delete()

    def test_django_admin_cannot_delete_clinical_records(self):
        model_admin = admin.site._registry[Patient]
        self.assertFalse(model_admin.has_delete_permission(request=None))


class ArchiveGuardTests(RetentionFixtureMixin, APITestCase):
    def _archive(self, patient):
        with platform_admin_context():
            patient.archived_at = timezone.now()
            patient.archive_reason = Patient.ARCHIVE_REASON_RETENTION
            patient.save(update_fields=["archived_at", "archive_reason", "updated_at"])

    def test_nothing_can_be_added_under_an_archived_record(self):
        self._archive(self.old_patient)
        with platform_admin_context(), self.assertRaises(RecordArchivedError):
            Encounter.objects.create(organization=self.org, patient=self.old_patient)

    def test_archived_record_is_read_only_over_the_api(self):
        self._archive(self.old_patient)
        url = reverse("patient-detail", args=[self.old_patient.id])
        response = self.client.patch(
            url, {"occupation": "Teacher"}, format="json", **self.clinician_auth
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "RECORD_ARCHIVED")
        # Still readable in full.
        self.assertEqual(self.client.get(url, **self.clinician_auth).status_code, 200)

    def test_registry_hides_archived_by_default_and_can_show_them(self):
        self._archive(self.old_patient)
        url = reverse("patient-list")
        ids = lambda r: {row["id"] for row in r.data["results"]}  # noqa: E731
        default = self.client.get(url, **self.clinician_auth)
        self.assertNotIn(str(self.old_patient.id), ids(default))
        only = self.client.get(url, {"archived": "only"}, **self.clinician_auth)
        self.assertEqual(ids(only), {str(self.old_patient.id)})
        both = self.client.get(url, {"archived": "include"}, **self.clinician_auth)
        self.assertEqual(ids(both), {str(self.old_patient.id), str(self.recent_patient.id)})


class RegistryFilterTests(RetentionFixtureMixin, APITestCase):
    def test_registry_search_and_legal_hold_filter(self):
        with platform_admin_context():
            Patient.objects.filter(pk=self.recent_patient.pk).update(legal_hold=True)
        url = reverse("patient-list")
        found = self.client.get(url, {"q": "zawa"}, **self.clinician_auth)
        self.assertEqual([r["id"] for r in found.data["results"]], [str(self.old_patient.id)])
        held = self.client.get(url, {"legal_hold": "true"}, **self.clinician_auth)
        self.assertEqual([r["id"] for r in held.data["results"]], [str(self.recent_patient.id)])


class RetentionScanTests(RetentionFixtureMixin, APITestCase):
    def test_scan_proposes_only_records_past_retention(self):
        run = self._scan()
        self.assertEqual(run.due_count, 1)
        with platform_admin_context():
            items = list(run.batch.items.values_list("patient_id", flat=True))
        self.assertEqual(items, [self.old_patient.id])

    def test_scan_never_archives_on_its_own(self):
        self._scan()
        with platform_admin_context():
            self.old_patient.refresh_from_db()
        self.assertIsNone(self.old_patient.archived_at)

    def test_scan_is_idempotent_and_notifies_org_admins_once(self):
        self._scan()
        self._scan()
        with platform_admin_context():
            self.assertEqual(ArchiveBatch.objects.count(), 1)
            notices = Notification.objects.filter(
                recipient=self.org_admin, category=Notification.CATEGORY_RETENTION
            )
            self.assertEqual(notices.count(), 1)
            channels = set(
                NotificationDelivery.objects.filter(organization=self.org).values_list(
                    "channel", flat=True
                )
            )
        self.assertEqual(channels, {"EMAIL", "SMS"})

    def test_notices_never_name_a_client(self):
        self._scan()
        with platform_admin_context():
            texts = [
                f"{n.title} {n.body}" for n in Notification.objects.filter(organization=self.org)
            ] + [
                f"{d.subject} {d.body_text}"
                for d in NotificationDelivery.objects.filter(organization=self.org)
            ]
        self.assertTrue(texts)
        for text in texts:
            self.assertNotIn("Zawadi", text)
            self.assertNotIn("Kiprono", text)

    def test_legal_hold_and_active_care_are_never_proposed(self):
        with platform_admin_context():
            held = self._patient("Held", "Client", legal_hold=True, legal_hold_reason="Litigation")
            in_care = self._patient("InCare", "Client")
            Encounter.objects.create(organization=self.org, patient=in_care, status="OPEN")
            _backdate(held, 10)
            _backdate(in_care, 10)
        run = self._scan()
        with platform_admin_context():
            items = set(run.batch.items.values_list("patient_id", flat=True))
        self.assertEqual(items, {self.old_patient.id})

    def test_forecast_counts_records_coming_due(self):
        with platform_admin_context():
            soon = self._patient("Soon", "Due")
            moment = timezone.now() - timedelta(days=365 * 7 - 60)
            Patient.all_objects.filter(pk=soon.pk).update(updated_at=moment)
        run = self._scan()
        self.assertEqual(run.forecast.get("90"), 1)
        self.assertEqual(run.forecast.get("30"), 0)

    def test_org_policy_can_lengthen_but_not_shorten_retention(self):
        url = reverse("retention-policy")
        too_short = self.client.patch(url, {"clinical_years": 2}, format="json", **self.admin_auth)
        self.assertEqual(too_short.status_code, 400)
        longer = self.client.patch(url, {"clinical_years": 15}, format="json", **self.admin_auth)
        self.assertEqual(longer.status_code, 200, longer.data)
        self.assertEqual(longer.data["effective"]["clinical"], 15)
        run = self._scan()
        self.assertEqual(run.due_count, 0)  # 10 years old < 15-year policy

    def test_only_org_admin_can_run_the_lifecycle(self):
        response = self.client.get(reverse("archive-batch-list"), **self.clinician_auth)
        self.assertEqual(response.status_code, 403)


class ApprovalAndRestoreTests(RetentionFixtureMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.batch = self._scan().batch

    def _approve(self):
        return self.client.post(
            reverse("archive-batch-approve", args=[self.batch.id]),
            {"note": "Reviewed"},
            format="json",
            **self.admin_auth,
        )

    def test_approval_is_refused_until_the_floor_is_verified(self):
        response = self._approve()
        self.assertEqual(response.status_code, 400)
        self.assertIn("floor_verified", response.data)
        with platform_admin_context():
            self.old_patient.refresh_from_db()
        self.assertIsNone(self.old_patient.archived_at)

    def test_approval_archives_and_audits(self):
        self._verify_floor()
        response = self._approve()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["archived_count"], 1)
        with platform_admin_context():
            self.old_patient.refresh_from_db()
            self.assertIsNotNone(self.old_patient.archived_at)
            self.assertEqual(self.old_patient.archived_by, self.org_admin)
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    action=AuditLogEntry.ACTION_ARCHIVE, object_id=str(self.old_patient.id)
                ).exists()
            )

    def test_new_activity_after_proposal_skips_the_record(self):
        self._verify_floor()
        with platform_admin_context():
            Encounter.objects.create(
                organization=self.org, patient=self.old_patient, status="CLOSED"
            )
        response = self._approve()
        self.assertEqual(response.data["archived_count"], 0)
        self.assertEqual(response.data["skipped_count"], 1)
        with platform_admin_context():
            self.old_patient.refresh_from_db()
        self.assertIsNone(self.old_patient.archived_at)

    def test_restore_requires_a_reason_and_is_audited(self):
        self._verify_floor()
        self._approve()
        url = reverse("retention-patient-restore", args=[self.old_patient.id])
        no_reason = self.client.post(url, {}, format="json", **self.admin_auth)
        self.assertEqual(no_reason.status_code, 400)
        clinician = self.client.post(
            url, {"reason": "Returned"}, format="json", **self.clinician_auth
        )
        self.assertEqual(clinician.status_code, 403)
        restored = self.client.post(
            url, {"reason": "Client returned for care"}, format="json", **self.admin_auth
        )
        self.assertEqual(restored.status_code, 200, restored.data)
        with platform_admin_context():
            self.old_patient.refresh_from_db()
            self.assertIsNone(self.old_patient.archived_at)
            entry = AuditLogEntry.objects.get(
                action=AuditLogEntry.ACTION_RESTORE, object_id=str(self.old_patient.id)
            )
        self.assertEqual(entry.field_diff["reason"]["new"], "Client returned for care")
        history = self.client.get(
            reverse("retention-patient-history", args=[self.old_patient.id]), **self.admin_auth
        )
        self.assertEqual([h["action"] for h in history.data], ["RESTORE", "ARCHIVE"])

    def test_reject_requires_a_note(self):
        url = reverse("archive-batch-reject", args=[self.batch.id])
        self.assertEqual(
            self.client.post(url, {}, format="json", **self.admin_auth).status_code, 400
        )
        response = self.client.post(
            url, {"note": "Records still needed"}, format="json", **self.admin_auth
        )
        self.assertEqual(response.data["status"], "REJECTED")

    def test_legal_hold_blocks_future_proposals(self):
        self.client.post(
            reverse("archive-batch-reject", args=[self.batch.id]),
            {"note": "Hold pending"},
            format="json",
            **self.admin_auth,
        )
        hold = self.client.post(
            reverse("retention-patient-legal-hold", args=[self.old_patient.id]),
            {"on": True, "reason": "Court order"},
            format="json",
            **self.admin_auth,
        )
        self.assertEqual(hold.status_code, 200, hold.data)
        self.assertEqual(self._scan().due_count, 0)


class PlatformSettingsTests(RetentionFixtureMixin, APITestCase):
    def test_verification_requires_a_recorded_source(self):
        url = reverse("retention-platform-settings")
        response = self.client.patch(
            url, {"floor_verified": True}, format="json", **self.super_auth
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("floor_source", response.data)
        ok = self.client.patch(
            url,
            {"floor_verified": True, "floor_source": "Confirmed with counsel, ref ABC"},
            format="json",
            **self.super_auth,
        )
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertTrue(ok.data["floor_verified"])
        self.assertIsNotNone(ok.data["verified_at"])

    def test_changing_a_floor_clears_verification(self):
        self._verify_floor()
        response = self.client.patch(
            reverse("retention-platform-settings"),
            {"clinical_floor_years": 10},
            format="json",
            **self.super_auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["floor_verified"])

    def test_changing_the_recorded_source_clears_verification(self):
        self._verify_floor()
        response = self.client.patch(
            reverse("retention-platform-settings"),
            {"floor_source": "Something else"},
            format="json",
            **self.super_auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["floor_verified"])

    def test_org_admin_cannot_change_the_floor(self):
        response = self.client.patch(
            reverse("retention-platform-settings"),
            {"clinical_floor_years": 1},
            format="json",
            **self.admin_auth,
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(RetentionPlatformSettings.get_solo().clinical_floor_years, 7)
