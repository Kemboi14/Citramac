import threading

from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter, SoapNote
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization
from apps.triage.models import VitalSigns

from .models import SyncableRecord, SyncConflictLog
from .sync_service import push_entry


class OfflineSyncTests(APITestCase):
    """docs/08-DHA-SHA-INTEGRATION.md §8.5 — idempotent push/pull, last-write-wins conflict log."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.nurse = User.objects.create_user(
                email="nurse@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
        self.access, _ = issue_tokens(self.nurse)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_push_creates_a_new_vitals_record(self):
        response = self.client.post(
            reverse("sync-push"),
            {
                "entries": [
                    {
                        "client_id": "device-a-vitals-1",
                        "entity_type": "VITALS",
                        "encounter_id": str(self.encounter.id),
                        "base_version": 0,
                        "payload": {"heart_rate": 88, "spo2": 97},
                    }
                ]
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        result = response.data["results"][0]
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual(result["version"], 1)
        with platform_admin_context():
            vitals = VitalSigns.objects.get(pk=result["server_entity_id"])
        self.assertEqual(vitals.heart_rate, 88)

    def test_replaying_the_same_client_id_is_idempotent_not_duplicated(self):
        entry = {
            "client_id": "device-a-vitals-2",
            "entity_type": "VITALS",
            "encounter_id": str(self.encounter.id),
            "base_version": 0,
            "payload": {"heart_rate": 70},
        }
        first = self.client.post(
            reverse("sync-push"), {"entries": [entry]}, format="json", **self.auth
        )
        server_id = first.data["results"][0]["server_entity_id"]

        entry["base_version"] = 1
        entry["payload"] = {"heart_rate": 75}
        second = self.client.post(
            reverse("sync-push"), {"entries": [entry]}, format="json", **self.auth
        )
        self.assertEqual(second.data["results"][0]["status"], "APPLIED")
        self.assertEqual(second.data["results"][0]["server_entity_id"], server_id)
        self.assertEqual(second.data["results"][0]["version"], 2)

        with platform_admin_context():
            self.assertEqual(VitalSigns.objects.filter(encounter=self.encounter).count(), 1)
            vitals = VitalSigns.objects.get(pk=server_id)
        self.assertEqual(vitals.heart_rate, 75)

    def test_stale_base_version_is_logged_as_a_conflict_not_overwritten(self):
        entry = {
            "client_id": "device-a-vitals-3",
            "entity_type": "VITALS",
            "encounter_id": str(self.encounter.id),
            "base_version": 0,
            "payload": {"heart_rate": 70},
        }
        self.client.post(reverse("sync-push"), {"entries": [entry]}, format="json", **self.auth)

        # A second device, offline since before the first push, replays its
        # own stale edit based on version 0 (not the current version 1).
        stale_entry = dict(entry, payload={"heart_rate": 999})
        response = self.client.post(
            reverse("sync-push"), {"entries": [stale_entry]}, format="json", **self.auth
        )
        result = response.data["results"][0]
        self.assertEqual(result["status"], "CONFLICT")

        with platform_admin_context():
            vitals = VitalSigns.objects.get(pk=result["server_entity_id"])
            self.assertEqual(vitals.heart_rate, 70)  # not overwritten with 999
            self.assertEqual(SyncConflictLog.objects.filter(organization=self.org).count(), 1)

    def test_push_to_a_signed_soap_note_is_a_conflict_not_an_error(self):
        with platform_admin_context():
            note = SoapNote.objects.create(
                organization=self.org,
                encounter=self.encounter,
                subjective="original",
                is_locked=True,
            )
            SyncableRecord.objects.create(
                organization=self.org,
                client_id="device-a-soap-1",
                entity_type="SOAP_NOTE",
                server_entity_id=note.id,
                version=1,
            )

        response = self.client.post(
            reverse("sync-push"),
            {
                "entries": [
                    {
                        "client_id": "device-a-soap-1",
                        "entity_type": "SOAP_NOTE",
                        "encounter_id": str(self.encounter.id),
                        "base_version": 1,
                        "payload": {"subjective": "edited while offline"},
                    }
                ]
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["results"][0]["status"], "CONFLICT")
        with platform_admin_context():
            self.assertEqual(SoapNote.objects.get(pk=note.id).subjective, "original")

    def test_pull_returns_records_changed_since_the_given_timestamp(self):
        cutoff = timezone.now()
        with platform_admin_context():
            VitalSigns.objects.create(
                organization=self.org, encounter=self.encounter, heart_rate=60
            )

        response = self.client.get(
            reverse("sync-pull") + f"?since={cutoff.isoformat()}", **self.auth
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["vitals"]), 1)
        self.assertIn("server_time", response.data)


class ConcurrentPushRaceTests(TransactionTestCase):
    """
    Regression test: two concurrent pushes of the same client_id (e.g. a
    flaky reconnect firing the offline-queue flush twice) used to race past
    the existence check and hit a duplicate-key IntegrityError — a 500,
    caught by a real browser walkthrough toggling network conditions. Needs
    TransactionTestCase (not TestCase) so the two threads see each other's
    commits instead of being isolated inside one wrapping transaction.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="race-org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.nurse = User.objects.create_user(
                email="nurse@race.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)

    def test_concurrent_pushes_of_the_same_client_id_do_not_crash_or_duplicate(self):
        entry = {
            "client_id": "race-client-1",
            "entity_type": "VITALS",
            "encounter_id": str(self.encounter.id),
            "base_version": 0,
            "payload": {"heart_rate": 80},
        }
        errors = []
        results = []
        barrier = threading.Barrier(2)

        def worker():
            try:
                with platform_admin_context():
                    barrier.wait(timeout=5)
                    results.append(push_entry(self.org, self.nurse, dict(entry)))
            except Exception as exc:  # noqa: BLE001 — captured to assert none occurred
                errors.append(exc)
            finally:
                clear_tenant_context()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(errors, [])  # the original bug crashed with a 500 here
        self.assertEqual(len(results), 2)
        statuses = sorted(r["status"] for r in results)
        # One wins the race and applies; the other's identical base_version
        # is now stale relative to the winner's write, so it's honestly
        # logged as a conflict rather than silently double-applied.
        self.assertEqual(statuses, ["APPLIED", "CONFLICT"])

        with platform_admin_context():
            self.assertEqual(VitalSigns.objects.filter(encounter=self.encounter).count(), 1)
            self.assertEqual(
                SyncableRecord.objects.filter(
                    organization=self.org, client_id="race-client-1"
                ).count(),
                1,
            )
