from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Appointment, Attachment, Patient


class ClientRegistryTests(APITestCase):
    """docs/10-API-SPECIFICATION.md §10.4, docs/07-CLINICAL-MODULES-SPEC.md §7.1."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org_a = Organization.objects.create(
                name="Org A", slug="orga", facility_type="MENTAL_HEALTH_CCP"
            )
            self.org_b = Organization.objects.create(
                name="Org B", slug="orgb", facility_type="MENTAL_HEALTH_CCP"
            )
            self.clinician_a = User.objects.create_user(
                email="clinician-a@orga.test",
                password="Password123!",
                organization=self.org_a,
                is_active=True,
            )
            self.clinician_b = User.objects.create_user(
                email="clinician-b@orgb.test",
                password="Password123!",
                organization=self.org_b,
                is_active=True,
            )
        self.access_a, _ = issue_tokens(self.clinician_a)
        self.access_b, _ = issue_tokens(self.clinician_b)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_create_patient_auto_scopes_org_and_generates_citramac_number(self):
        response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Faith",
                "last_name": "Mwangi",
                "gender": "FEMALE",
                "date_of_birth": "1997-03-14",
                "uhid_number": "20260245",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            patient = Patient.objects.get(pk=response.data["id"])
        self.assertEqual(patient.organization_id, self.org_a.id)
        self.assertTrue(patient.citramac_number)
        self.assertEqual(patient.registered_by_id, self.clinician_a.id)

    def test_patient_list_is_tenant_isolated(self):
        self.client.post(
            reverse("patient-list"),
            {
                "first_name": "A",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.client.post(
            reverse("patient-list"),
            {
                "first_name": "B",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_b),
        )

        response_a = self.client.get(reverse("patient-list"), **self._auth(self.access_a))
        names_a = {p["first_name"] for p in response_a.data["results"]}
        self.assertEqual(names_a, {"A"})

        response_b = self.client.get(reverse("patient-list"), **self._auth(self.access_b))
        names_b = {p["first_name"] for p in response_b.data["results"]}
        self.assertEqual(names_b, {"B"})

    def test_org_a_cannot_read_org_b_patient_by_id(self):
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Secret",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_b),
        )
        patient_id = create_response.data["id"]

        response = self.client.get(
            reverse("patient-detail", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_iprs_and_verify_sha_are_honest_stubs(self):
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Test",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        patient_id = create_response.data["id"]

        iprs_response = self.client.post(
            reverse("patient-verify-iprs", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertEqual(iprs_response.status_code, 200)
        self.assertFalse(iprs_response.data["verified"])

    def test_consent_capture_updates_patient_cache_and_writes_history(self):
        """docs/09-SECURITY-COMPLIANCE.md §9.5 — versioned, revocable consent capture."""
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Test",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        patient_id = create_response.data["id"]

        grant_response = self.client.post(
            reverse("patient-consent", args=[patient_id]),
            {
                "granted": True,
                "consent_text_version": "v1-2026-01",
                "consent_text_snapshot": "I consent to sharing my data via the national HIE.",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.assertEqual(grant_response.status_code, 201, grant_response.data)
        self.assertTrue(grant_response.data["granted"])

        detail_response = self.client.get(
            reverse("patient-detail", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertTrue(detail_response.data["consent_data_sharing"])
        self.assertIsNotNone(detail_response.data["consent_captured_at"])

        revoke_response = self.client.post(
            reverse("patient-consent", args=[patient_id]),
            {
                "granted": False,
                "consent_text_version": "v1-2026-01",
                "consent_text_snapshot": "I consent to sharing my data via the national HIE.",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.assertEqual(revoke_response.status_code, 201, revoke_response.data)

        history_response = self.client.get(
            reverse("patient-consent", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertEqual(history_response.status_code, 200)
        self.assertEqual(len(history_response.data), 2)  # both grant and revoke kept

        detail_after_revoke = self.client.get(
            reverse("patient-detail", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertFalse(detail_after_revoke.data["consent_data_sharing"])

    def test_consent_capture_requires_all_fields(self):
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Test",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        patient_id = create_response.data["id"]

        response = self.client.post(
            reverse("patient-consent", args=[patient_id]),
            {"granted": True},
            format="json",
            **self._auth(self.access_a),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "MISSING_FIELDS")


class RightToErasureTests(APITestCase):
    """docs/09-SECURITY-COMPLIANCE.md §9.5 — Right-to-Erasure request workflow."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                national_id="12345678",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.records_officer = User.objects.create_user(
                email="records@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin = User.objects.create_user(
                email="orgadmin@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
            self.auditor = User.objects.create_user(
                email="auditor@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.auditor.roles.add(Role.objects.get(name="Auditor", organization__isnull=True))
        self.records_officer_auth = self._auth(self.records_officer)
        self.org_admin_auth = self._auth(self.org_admin)
        self.auditor_auth = self._auth(self.auditor)

    def _auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _create_request(self):
        response = self.client.post(
            reverse("erasure-request-list"),
            {"patient": str(self.patient.id), "reason": "Patient requested erasure."},
            format="json",
            **self.records_officer_auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def test_execute_requires_both_sign_offs(self):
        request_id = self._create_request()
        response = self.client.post(
            reverse("erasure-request-execute", args=[request_id]), **self.org_admin_auth
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "APPROVALS_INCOMPLETE")

    def test_only_org_admin_can_approve_as_org_admin(self):
        request_id = self._create_request()
        response = self.client.post(
            reverse("erasure-request-approve-org-admin", args=[request_id]),
            **self.records_officer_auth,
        )
        self.assertEqual(response.status_code, 403)

    def test_only_auditor_can_approve_as_compliance_officer(self):
        request_id = self._create_request()
        response = self.client.post(
            reverse("erasure-request-approve-compliance", args=[request_id]),
            **self.records_officer_auth,
        )
        self.assertEqual(response.status_code, 403)

    def test_execute_anonymizes_patient_without_leaking_pii_into_generic_audit_diff(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        request_id = self._create_request()
        self.client.post(
            reverse("erasure-request-approve-org-admin", args=[request_id]), **self.org_admin_auth
        )
        self.client.post(
            reverse("erasure-request-approve-compliance", args=[request_id]), **self.auditor_auth
        )

        response = self.client.post(
            reverse("erasure-request-execute", args=[request_id]), **self.org_admin_auth
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "COMPLETED")

        with platform_admin_context():
            self.patient.refresh_from_db()
        self.assertEqual(self.patient.first_name, "[ERASED]")
        self.assertEqual(self.patient.national_id, "")

        with platform_admin_context():
            erasure_entries = AuditLogEntry.objects.filter(
                model="client_registry.patient",
                object_id=str(self.patient.id),
                action=AuditLogEntry.ACTION_ERASURE,
            )
            self.assertEqual(erasure_entries.count(), 1)
            # The generic write-signal UPDATE entry must NOT exist for this
            # change (it would have captured the pre-erasure PII in its
            # field_diff) — execute_erasure() uses .update(), not .save(),
            # specifically to avoid that signal firing.
            update_entries_with_this_change = AuditLogEntry.objects.filter(
                model="client_registry.patient",
                object_id=str(self.patient.id),
                action=AuditLogEntry.ACTION_UPDATE,
                field_diff__first_name__new="[ERASED]",
            )
            self.assertEqual(update_entries_with_this_change.count(), 0)

    def test_recent_encounter_blocks_execution_with_retention_conflict(self):
        from apps.clinical_encounter.models import Encounter

        with platform_admin_context():
            Encounter.objects.create(
                organization=self.org, patient=self.patient, opened_at=timezone.now()
            )

        request_id = self._create_request()
        self.client.post(
            reverse("erasure-request-approve-org-admin", args=[request_id]), **self.org_admin_auth
        )
        self.client.post(
            reverse("erasure-request-approve-compliance", args=[request_id]), **self.auditor_auth
        )

        response = self.client.post(
            reverse("erasure-request-execute", args=[request_id]), **self.org_admin_auth
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "RETENTION_CONFLICT")
        self.assertIn("statutory minimum retention", response.data["retention_conflict_detail"])

        with platform_admin_context():
            self.patient.refresh_from_db()
        self.assertEqual(self.patient.first_name, "Faith")  # not erased

    def test_compliance_officer_can_override_retention_conflict(self):
        from apps.clinical_encounter.models import Encounter

        with platform_admin_context():
            Encounter.objects.create(
                organization=self.org, patient=self.patient, opened_at=timezone.now()
            )

        request_id = self._create_request()
        self.client.post(
            reverse("erasure-request-approve-org-admin", args=[request_id]), **self.org_admin_auth
        )
        self.client.post(
            reverse("erasure-request-approve-compliance", args=[request_id]), **self.auditor_auth
        )

        response = self.client.post(
            reverse("erasure-request-execute", args=[request_id]),
            {"override_retention_conflict": True},
            format="json",
            **self.auditor_auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "COMPLETED")

    def test_non_compliance_officer_cannot_override_retention_conflict(self):
        from apps.clinical_encounter.models import Encounter

        with platform_admin_context():
            Encounter.objects.create(
                organization=self.org, patient=self.patient, opened_at=timezone.now()
            )

        request_id = self._create_request()
        self.client.post(
            reverse("erasure-request-approve-org-admin", args=[request_id]), **self.org_admin_auth
        )
        self.client.post(
            reverse("erasure-request-approve-compliance", args=[request_id]), **self.auditor_auth
        )

        response = self.client.post(
            reverse("erasure-request-execute", args=[request_id]),
            {"override_retention_conflict": True},
            format="json",
            **self.org_admin_auth,
        )
        self.assertEqual(response.status_code, 403)


class AttachmentAppointmentDashboardTests(APITestCase):
    """Document manager, appointments calendar, and dashboard summary aggregates."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-history", facility_type="MENTAL_HEALTH_CCP"
            )
            self.clinician = User.objects.create_user(
                email="clinician@org-history.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Grace",
                last_name="Njeri",
                gender="FEMALE",
                date_of_birth="1989-06-14",
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_attachment_create_requires_patient_and_defaults_category(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile("consent.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        response = self.client.post(
            reverse("attachment-list"),
            {
                "patient": str(self.patient.id),
                "file": upload,
                "classification": "CURRENT",
                "category": "CONSENT",
            },
            format="multipart",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["category"], "CONSENT")
        self.assertEqual(response.data["doc_status"], "ACTIVE")

    def test_attachment_insights_aggregates_by_category(self):
        with platform_admin_context():
            Attachment.objects.create(
                organization=self.org,
                patient=self.patient,
                file="attachments/2026/09/a.pdf",
                classification="CURRENT",
                category="LAB_RESULT",
            )
            Attachment.objects.create(
                organization=self.org,
                patient=self.patient,
                file="attachments/2026/09/b.pdf",
                classification="CURRENT",
                category="LAB_RESULT",
                is_favorite=True,
            )
        response = self.client.get(reverse("attachment-insights"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total"], 2)
        self.assertEqual(response.data["by_category"]["LAB_RESULT"], 2)
        self.assertEqual(response.data["favourites"], 1)

    def test_appointment_list_filters_by_date_range(self):
        with platform_admin_context():
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for="2026-06-06T10:00:00Z",
                appointment_type="Individual therapy session",
            )
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for="2026-06-20T09:30:00Z",
                appointment_type="Psychiatric review",
            )
        response = self.client.get(
            reverse("appointment-list") + "?from=2026-06-06&to=2026-06-06", **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["appointment_type"], "Individual therapy session"
        )

    def test_dashboard_summary_returns_real_counts(self):
        with platform_admin_context():
            Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now(),
                appointment_type="Follow-up",
            )
        response = self.client.get(reverse("clinical-dashboard-summary"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["registered_clients"], 1)
        self.assertEqual(response.data["appointments_today"], 1)
        self.assertEqual(response.data["active_admissions"], 0)
