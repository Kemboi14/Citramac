"""docs/16-DATA-PROTECTION-COMPLIANCE.md — legal opinion of 2 Oct 2026."""

import uuid
from datetime import timedelta

from django.contrib import admin
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.notifications.models import Notification
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import (
    BreachIncident,
    BreachNotification,
    PlatformComplianceSettings,
    SupportAccessGrant,
)
from .tasks import remind_breach_notification_deadlines


class ComplianceTestCase(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = self._org("alpha")
            self.other_org = self._org("beta")
            self.admin = self._user("admin", self.org, org_admin=True)
            self.clinician = self._user("nurse", self.org)
            self.platform = User.objects.create_superuser(
                email=f"ops-{uuid.uuid4().hex[:6]}@platform.test", password="Password123!"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Grace",
                last_name="Alpha",
                gender="FEMALE",
                date_of_birth="1990-01-01",
            )
            Patient.objects.create(
                organization=self.other_org,
                first_name="Brian",
                last_name="Beta",
                gender="MALE",
                date_of_birth="1980-01-01",
            )

    def _org(self, slug):
        return Organization.objects.create(
            name=slug.title(),
            slug=f"{slug}-{uuid.uuid4().hex[:6]}",
            facility_type="MENTAL_HEALTH_MHP",
        )

    def _user(self, prefix, org, org_admin=False):
        user = User.objects.create_user(
            email=f"{prefix}-{uuid.uuid4().hex[:6]}@{org.slug}.test",
            password="Password123!",
            organization=org,
            is_active=True,
        )
        if org_admin:
            user.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
        return user

    def auth(self, user, **extra):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}", **extra}


class SupportAccessTests(ComplianceTestCase):
    def _approved_grant(self):
        response = self.client.post(
            reverse("support-grants"),
            {
                "organization": str(self.org.id),
                "reason": "Ticket 42: sync fault",
                "duration_hours": 2,
            },
            format="json",
            **self.auth(self.platform),
        )
        self.assertEqual(response.status_code, 201, response.data)
        grant_id = response.data["id"]
        decided = self.client.post(
            reverse("support-grant-decision", args=[grant_id]),
            {"decision": "APPROVE"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(decided.data["status"], "APPROVED")
        return grant_id

    def test_platform_staff_cannot_read_clinical_records_without_a_grant(self):
        response = self.client.get(reverse("patient-list"), **self.auth(self.platform))
        self.assertEqual(response.status_code, 403)

    def test_grant_scopes_platform_staff_to_that_facility_and_is_audited(self):
        grant_id = self._approved_grant()
        response = self.client.get(
            reverse("patient-list"), **self.auth(self.platform, HTTP_X_SUPPORT_GRANT=grant_id)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p["last_name"] for p in response.data["results"]], ["Alpha"])
        self.assertTrue(
            AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_SUPPORT_ACCESS,
                organization_id=self.org.id,
                actor_user_id=self.platform.id,
            ).exists()
        )

    def test_expired_or_revoked_grant_is_refused(self):
        grant_id = self._approved_grant()
        with platform_admin_context():
            SupportAccessGrant.all_objects.filter(pk=grant_id).update(
                expires_at=timezone.now() - timedelta(minutes=1)
            )
        response = self.client.get(
            reverse("patient-list"), **self.auth(self.platform, HTTP_X_SUPPORT_GRANT=grant_id)
        )
        self.assertEqual(response.status_code, 403)

    def test_another_staff_members_grant_cannot_be_borrowed(self):
        grant_id = self._approved_grant()
        with platform_admin_context():
            colleague = User.objects.create_superuser(
                email=f"ops2-{uuid.uuid4().hex[:6]}@platform.test", password="Password123!"
            )
        response = self.client.get(
            reverse("patient-list"), **self.auth(colleague, HTTP_X_SUPPORT_GRANT=grant_id)
        )
        self.assertEqual(response.status_code, 403)

    def test_platform_routes_without_patient_data_stay_open(self):
        response = self.client.get(reverse("compliance-tenants"), **self.auth(self.platform))
        self.assertEqual(response.status_code, 200)

    def test_only_the_facility_org_admin_decides(self):
        response = self.client.post(
            reverse("support-grants"),
            {"organization": str(self.org.id), "reason": "Ticket 7"},
            format="json",
            **self.auth(self.platform),
        )
        decided = self.client.post(
            reverse("support-grant-decision", args=[response.data["id"]]),
            {"decision": "APPROVE"},
            format="json",
            **self.auth(self.clinician),
        )
        self.assertEqual(decided.status_code, 403)

    def test_clinical_models_are_not_in_django_admin(self):
        self.assertNotIn(Patient, admin.site._registry)


class BreachIncidentTests(ComplianceTestCase):
    def _create(self, user, **extra):
        payload = {
            "title": "Laptop with exported reports stolen",
            "description": "Encrypted laptop taken from the records office.",
            "risk_level": "RISK",
            "became_aware_at": (timezone.now() - timedelta(hours=1)).isoformat(),
            **extra,
        }
        return self.client.post(
            reverse("breach-incidents"), payload, format="json", **self.auth(user)
        )

    def test_controller_incident_creates_regulator_tracks_with_statutory_deadlines(self):
        response = self._create(self.admin)
        self.assertEqual(response.status_code, 201, response.data)
        tracks = {t["track"]: t for t in response.data["tracks"]}
        with platform_admin_context():
            aware = BreachIncident.all_objects.get(pk=response.data["id"]).became_aware_at
        self.assertTrue(tracks["ODPC"]["required"])
        self.assertTrue(tracks["DHA"]["required"])
        # DPA s.43(1): a real risk of harm triggers the Commissioner and the data subjects alike.
        self.assertTrue(tracks["DATA_SUBJECTS"]["required"])
        self.assertTrue(tracks["DHA_FOLLOWUP"]["required"])
        self.assertNotIn("TENANT_CONTROLLER", tracks)
        with platform_admin_context():
            odpc = BreachNotification.all_objects.get(incident_id=response.data["id"], track="ODPC")
            dha = BreachNotification.all_objects.get(incident_id=response.data["id"], track="DHA")
        self.assertEqual(odpc.due_at - aware, timedelta(hours=72))
        self.assertEqual(dha.due_at - aware, timedelta(hours=48))

    def test_processor_incident_adds_the_facility_track_and_notifies_admins(self):
        response = self._create(
            self.platform, organization=str(self.org.id), risk_level="HIGH_RISK"
        )
        tracks = {t["track"]: t for t in response.data["tracks"]}
        self.assertTrue(tracks["TENANT_CONTROLLER"]["required"])
        self.assertTrue(tracks["DATA_SUBJECTS"]["required"])
        self.assertEqual(response.data["reported_role"], "PROCESSOR")
        self.assertTrue(Notification.objects.filter(recipient=self.admin).exists())

    def test_closing_requires_every_required_notification(self):
        incident_id = self._create(self.admin).data["id"]
        url = reverse("breach-incident", args=[incident_id])
        self.assertEqual(
            self.client.patch(
                url, {"status": "CLOSED"}, format="json", **self.auth(self.admin)
            ).status_code,
            400,
        )
        detail = self.client.get(url, **self.auth(self.admin)).data
        for track in detail["tracks"]:
            if not track["required"]:
                continue
            missing_method = self.client.post(
                reverse("breach-notification-record", args=[track["id"]]),
                {},
                format="json",
                **self.auth(self.admin),
            )
            self.assertEqual(missing_method.status_code, 400)
            self.client.post(
                reverse("breach-notification-record", args=[track["id"]]),
                {"method": "Prescribed form by email", "reference": "REF-1"},
                format="json",
                **self.auth(self.admin),
            )
        closed = self.client.patch(
            url, {"status": "CLOSED"}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(closed.status_code, 200, closed.data)

    def test_clinician_cannot_see_incidents(self):
        response = self.client.get(reverse("breach-incidents"), **self.auth(self.clinician))
        self.assertEqual(response.status_code, 403)

    def test_reminders_are_sent_once_per_stage(self):
        self._create(self.admin, became_aware_at=(timezone.now() - timedelta(hours=50)).isoformat())
        first = remind_breach_notification_deadlines()
        second = remind_breach_notification_deadlines()
        self.assertGreater(first, 0)
        self.assertEqual(second, 0)


class BreachAssessmentTests(ComplianceTestCase):
    """Notifiability (reg. 37), late notices (s.43(2)), the DHA follow-up, notices and register."""

    _create = BreachIncidentTests._create

    def _tracks(self, data):
        return {t["track"]: t for t in data["tracks"]}

    def _patch(self, incident_id, payload, user=None):
        return self.client.patch(
            reverse("breach-incident", args=[incident_id]),
            payload,
            format="json",
            **self.auth(user or self.admin),
        )

    def _record(self, track_id, payload, user=None):
        return self.client.post(
            reverse("breach-notification-record", args=[track_id]),
            payload,
            format="json",
            **self.auth(user or self.admin),
        )

    def test_names_with_mental_health_data_are_notifiable_whatever_the_risk_level(self):
        incident_id = self._create(self.admin, risk_level="UNLIKELY").data["id"]
        self.assertFalse(self._tracks(self._patch(incident_id, {}).data)["ODPC"]["required"])
        data = self._patch(
            incident_id, {"identifies_subjects": True, "schedule_categories": ["MENTAL_DISORDER"]}
        ).data
        self.assertTrue(data["is_notifiable"])
        tracks = self._tracks(data)
        self.assertTrue(tracks["ODPC"]["required"])
        self.assertTrue(tracks["DATA_SUBJECTS"]["required"])
        self.assertFalse(tracks["DATA_SUBJECTS"]["has_deadline"])
        public = self._patch(incident_id, {"publicly_available_only": True}).data
        self.assertFalse(public["is_notifiable"])
        self.assertFalse(self._tracks(public)["ODPC"]["required"])

    def test_unknown_schedule_categories_are_dropped(self):
        incident_id = self._create(self.admin).data["id"]
        data = self._patch(incident_id, {"schedule_categories": ["SUBSTANCE_ABUSE", "MADE_UP"]}).data
        self.assertEqual(data["schedule_categories"], ["SUBSTANCE_ABUSE"])

    def test_not_telling_data_subjects_needs_a_lawful_ground_stated(self):
        incident_id = self._create(self.admin, risk_level="HIGH_RISK").data["id"]
        no_grounds = self._patch(incident_id, {"subjects_exemption": "SAFEGUARDS"})
        self.assertEqual(no_grounds.status_code, 400)
        exempt = self._patch(
            incident_id,
            {
                "subjects_exemption": "SAFEGUARDS",
                "subjects_exemption_grounds": "Full-disk encryption; the key was not taken.",
            },
        )
        self.assertEqual(exempt.status_code, 200, exempt.data)
        self.assertFalse(self._tracks(exempt.data)["DATA_SUBJECTS"]["required"])
        # Delay for an investigation postpones the letter; it does not remove it.
        delayed = self._patch(
            incident_id,
            {"subjects_exemption": "INVESTIGATION", "subjects_exemption_grounds": "Police request."},
        ).data
        self.assertTrue(self._tracks(delayed)["DATA_SUBJECTS"]["required"])

    def test_a_late_notice_must_give_reasons(self):
        aware = (timezone.now() - timedelta(hours=80)).isoformat()
        tracks = self._tracks(self._create(self.admin, became_aware_at=aware).data)
        odpc = tracks["ODPC"]
        self.assertTrue(odpc["is_overdue"])
        missing = self._record(odpc["id"], {"method": "ODPC online form"})
        self.assertEqual(missing.status_code, 400)
        self.assertIn("late_reason", missing.data)
        recorded = self._record(
            odpc["id"], {"method": "ODPC online form", "late_reason": "DPO was on leave."}
        )
        self.assertEqual(recorded.status_code, 200, recorded.data)
        self.assertEqual(recorded.data["late_reason"], "DPO was on leave.")

    def test_dha_follow_up_runs_72_hours_from_the_dha_notice(self):
        data = self._create(self.admin).data
        tracks = self._tracks(data)
        notified_at = timezone.now() - timedelta(minutes=30)
        self._record(
            tracks["DHA"]["id"], {"method": "Form HMIS 1 by email", "notified_at": notified_at.isoformat()}
        )
        with platform_admin_context():
            follow_up = BreachNotification.all_objects.get(incident_id=data["id"], track="DHA_FOLLOWUP")
        self.assertEqual(follow_up.due_at, notified_at + timedelta(hours=72))

    def test_steps_are_kept_in_order(self):
        incident_id = self._create(self.admin).data["id"]
        url = reverse("breach-incident-events", args=[incident_id])
        self.assertEqual(
            self.client.post(url, {"note": " "}, format="json", **self.auth(self.admin)).status_code,
            400,
        )
        response = self.client.post(
            url, {"note": "Revoked the shared password."}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(response.status_code, 201, response.data)
        notes = [e["note"] for e in response.data["events"]]
        self.assertEqual(notes, ["Incident recorded.", "Revoked the shared password."])

    def test_every_notice_renders_escaped_and_unknown_kinds_are_refused(self):
        incident_id = self._create(
            self.admin, title="<script>alert(1)</script>", description="Laptop & files"
        ).data["id"]
        for kind in ("odpc", "dha_hmis1", "dha_followup", "subject_letter"):
            response = self.client.get(
                reverse("breach-incident-report", args=[incident_id, kind]), **self.auth(self.admin)
            )
            self.assertEqual(response.status_code, 200, kind)
            self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
            body = response.content.decode()
            self.assertNotIn("<script>alert(1)</script>", body, kind)
        unknown = self.client.get(
            reverse("breach-incident-report", args=[incident_id, "nope"]), **self.auth(self.admin)
        )
        self.assertEqual(unknown.status_code, 400)
        clinician = self.client.get(
            reverse("breach-incident-report", args=[incident_id, "odpc"]), **self.auth(self.clinician)
        )
        self.assertEqual(clinician.status_code, 403)

    def test_register_lists_only_the_admins_own_organisation(self):
        self._create(self.admin, title="Alpha breach")
        with platform_admin_context():
            other_admin = self._user("admin", self.other_org, org_admin=True)
        self._create(other_admin, title="Beta breach")
        body = self.client.get(reverse("breach-register"), **self.auth(self.admin)).content.decode()
        self.assertIn("Alpha breach", body)
        self.assertNotIn("Beta breach", body)
        missing_org = self.client.get(reverse("breach-register"), **self.auth(self.platform))
        self.assertEqual(missing_org.status_code, 404)
        platform = self.client.get(
            f"{reverse('breach-register')}?organization={self.other_org.id}", **self.auth(self.platform)
        ).content.decode()
        self.assertIn("Beta breach", platform)
        self.assertNotIn("Alpha breach", platform)


class SubjectRequestTests(ComplianceTestCase):
    def _log(self, request_type="ACCESS"):
        return self.client.post(
            reverse("subject-requests"),
            {"patient": str(self.patient.id), "request_type": request_type},
            format="json",
            **self.auth(self.clinician),
        ).data["id"]

    def test_access_request_export_needs_approval_and_is_audited(self):
        request_id = self._log()
        export_url = reverse("subject-request-export", args=[request_id])
        decision_url = reverse("subject-request-decision", args=[request_id])
        self.assertEqual(self.client.get(export_url, **self.auth(self.admin)).status_code, 400)
        self.assertEqual(
            self.client.post(
                decision_url, {"decision": "APPROVE"}, format="json", **self.auth(self.clinician)
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                decision_url, {"decision": "APPROVE"}, format="json", **self.auth(self.admin)
            ).status_code,
            400,
        )
        approved = self.client.post(
            decision_url,
            {"decision": "APPROVE", "identity_verification": "National ID sighted"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(approved.data["status"], "APPROVED")
        export = self.client.get(export_url, **self.auth(self.admin))
        self.assertEqual(export.status_code, 200)
        self.assertEqual(export.data["record"]["demographics"]["name"], "Grace Alpha")
        self.assertEqual(validate_bundle(export.data["fhir"]), {})
        self.assertTrue(
            AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_EXPORT, object_id=str(self.patient.id)
            ).exists()
        )
        listed = self.client.get(
            reverse("subject-requests"), {"patient": str(self.patient.id)}, **self.auth(self.admin)
        )
        self.assertEqual(listed.data["results"][0]["status"], "FULFILLED")

    def test_correction_request_is_fulfilled_with_notes(self):
        request_id = self._log("CORRECTION")
        decision_url = reverse("subject-request-decision", args=[request_id])
        self.client.post(
            decision_url,
            {"decision": "APPROVE", "identity_verification": "In person"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(
            self.client.post(
                decision_url, {"decision": "FULFIL"}, format="json", **self.auth(self.admin)
            ).status_code,
            400,
        )
        done = self.client.post(
            decision_url,
            {"decision": "FULFIL", "notes": "Phone number corrected"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(done.data["status"], "FULFILLED")

    def test_platform_staff_cannot_read_subject_requests_without_a_grant(self):
        response = self.client.get(reverse("subject-requests"), **self.auth(self.platform))
        self.assertEqual(response.status_code, 403)


class ComplianceProfileTests(ComplianceTestCase):
    def test_profile_lists_gaps_until_complete(self):
        profile = self.client.get(reverse("compliance-profile"), **self.auth(self.admin)).data
        self.assertIn("ODPC registration not verified", profile["gaps"])
        self.assertIn("Platform compliance warranty wording not published", profile["gaps"])

        settings_url = reverse("compliance-platform-settings")
        self.client.put(
            settings_url,
            {"warranty_version": "W1", "warranty_text": "Counsel-approved wording."},
            format="json",
            **self.auth(self.platform),
        )
        changed_same_label = self.client.put(
            settings_url,
            {"warranty_version": "W1", "warranty_text": "Different wording."},
            format="json",
            **self.auth(self.platform),
        )
        self.assertEqual(changed_same_label.status_code, 400)

        self.client.post(
            reverse("compliance-accept-warranty"),
            {"version": "W1"},
            format="json",
            **self.auth(self.admin),
        )
        self.client.patch(
            reverse("compliance-profile"),
            {"dpo_email": "dpo@alpha.test"},
            format="json",
            **self.auth(self.admin),
        )
        self.client.patch(
            reverse("compliance-tenant", args=[self.org.id]),
            {
                "odpc_registration_number": "ODPC-123",
                "odpc_registration_expires_on": "2030-01-01",
                "dpa_version": "DPA-1",
                "dpa_signed_on": "2026-10-01",
                "verify_odpc": True,
            },
            format="json",
            **self.auth(self.platform),
        )
        profile = self.client.get(reverse("compliance-profile"), **self.auth(self.admin)).data
        self.assertEqual(profile["gaps"], [])

    def test_public_dpo_contact_needs_no_login(self):
        settings_ = PlatformComplianceSettings.get_solo()
        settings_.dpo_email = "dpo@cafric.test"
        settings_.save()
        response = self.client.get(reverse("compliance-public-dpo"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["dpo_email"], "dpo@cafric.test")


class ComplianceHardeningTests(ComplianceTestCase):
    def test_invalid_dpo_email_is_a_400_not_a_crash(self):
        response = self.client.patch(
            reverse("compliance-profile"),
            {"dpo_email": "not-an-email"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 400)

    def test_changing_a_verified_number_clears_verification(self):
        url = reverse("compliance-tenant", args=[self.org.id])
        self.client.patch(
            url,
            {"odpc_registration_number": "ODPC-1", "verify_odpc": True},
            format="json",
            **self.auth(self.platform),
        )
        response = self.client.patch(
            url, {"odpc_registration_number": "ODPC-2"}, format="json", **self.auth(self.platform)
        )
        self.assertIsNone(response.data["odpc_verified_at"])
        self.assertIn("ODPC registration not verified", response.data["gaps"])

    def test_evidence_downloads_only_with_authorisation(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile(
            "odpc.pdf", b"%PDF-1.4 evidence", content_type="application/pdf"
        )
        uploaded = self.client.patch(
            reverse("compliance-profile"),
            {"odpc_evidence": upload},
            format="multipart",
            **self.auth(self.admin),
        )
        self.assertEqual(uploaded.data["odpc_evidence_url"], "/compliance/profile/evidence/")
        own = self.client.get(reverse("compliance-own-evidence"), **self.auth(self.admin))
        self.assertEqual(own.status_code, 200)
        self.assertEqual(b"".join(own.streaming_content), b"%PDF-1.4 evidence")
        self.assertEqual(
            self.client.get(
                reverse("compliance-own-evidence"), **self.auth(self.clinician)
            ).status_code,
            403,
        )
        platform = self.client.get(
            reverse("compliance-tenant-evidence", args=[self.org.id]), **self.auth(self.platform)
        )
        self.assertEqual(platform.status_code, 200)

    def test_facility_cannot_record_the_platforms_own_notification(self):
        response = self.client.post(
            reverse("breach-incidents"),
            {
                "organization": str(self.org.id),
                "title": "Backup exposed",
                "description": "Misconfigured bucket.",
                "risk_level": "RISK",
            },
            format="json",
            **self.auth(self.platform),
        )
        track = next(t for t in response.data["tracks"] if t["track"] == "TENANT_CONTROLLER")
        denied = self.client.post(
            reverse("breach-notification-record", args=[track["id"]]),
            {"method": "Email"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(denied.status_code, 403)

    def test_evidence_must_be_a_document_image(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.patch(
            reverse("compliance-profile"),
            {"odpc_evidence": SimpleUploadedFile("run.exe", b"MZ")},
            format="multipart",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 400)
