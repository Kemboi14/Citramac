from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import CareTeamMembership, PsychotherapySession


class CcpCareTeamRestrictionTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — elevated privacy for CCP records."""

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
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.assigned_therapist = User.objects.create_user(
                email="therapist@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.other_clinician = User.objects.create_user(
                email="other-clinician@org.test",
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
            org_admin_role = Role.objects.get(name="Org Admin", organization__isnull=True)
            self.org_admin.roles.add(org_admin_role)

            CareTeamMembership.objects.create(
                organization=self.org,
                patient=self.patient,
                user=self.assigned_therapist,
                role="THERAPIST",
            )
            self.session = PsychotherapySession.objects.create(
                organization=self.org,
                patient=self.patient,
                session_type="INDIVIDUAL",
                therapist=self.assigned_therapist,
                session_notes="Highly sensitive trauma-processing content.",
            )

        self.access_assigned, _ = issue_tokens(self.assigned_therapist)
        self.access_other, _ = issue_tokens(self.other_clinician)
        self.access_org_admin, _ = issue_tokens(self.org_admin)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_assigned_therapist_sees_full_session_notes(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_assigned),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_notes", response.data)
        self.assertEqual(
            response.data["session_notes"], "Highly sensitive trauma-processing content."
        )

    def test_unrelated_clinician_sees_existence_only(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_other),
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("session_notes", response.data)
        self.assertEqual(
            set(response.data.keys()), {"id", "patient", "session_type", "session_date"}
        )

    def test_org_admin_sees_full_session_notes(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_org_admin),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_notes", response.data)

    def test_list_view_also_restricts_per_object(self):
        response = self.client.get(
            reverse("psychotherapy-session-list"), **self._auth(self.access_other)
        )
        self.assertEqual(response.status_code, 200)
        for row in response.data["results"]:
            self.assertNotIn("session_notes", row)


class CcpExtensionsTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.4-§7.14.6."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Kevin",
                last_name="Otieno",
                gender="MALE",
                date_of_birth="1990-06-01",
            )
            self.case_manager = User.objects.create_user(
                email="casemanager@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.supervisor = User.objects.create_user(
                email="supervisor@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        self.access, _ = issue_tokens(self.case_manager)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_create_sud_rehab_plan_defaults_to_intake_phase(self):
        from .models import SudRehabPlan

        response = self.client.post(
            reverse("sud-rehab-plan-list"),
            {"patient": str(self.patient.id), "substances_of_concern": "Alcohol"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["current_phase"], "INTAKE")
        with platform_admin_context():
            plan = SudRehabPlan.objects.get(pk=response.data["id"])
            self.assertEqual(plan.case_manager_id, self.case_manager.id)

    def test_urine_drug_screen_stores_panel_results_as_json(self):
        from .models import SudRehabPlan

        with platform_admin_context():
            plan = SudRehabPlan.objects.create(organization=self.org, patient=self.patient)
        response = self.client.post(
            reverse("urine-drug-screen-list"),
            {
                "plan": str(plan.id),
                "panel_results": {"amphetamine": "negative", "cannabinoids": "positive"},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["panel_results"]["cannabinoids"], "positive")

    def test_supervision_request_lifecycle(self):
        create_response = self.client.post(
            reverse("supervision-request-list"),
            {"patient": str(self.patient.id), "topic": "Risk escalation review"},
            format="json",
            **self.auth,
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        request_id = create_response.data["id"]

        access_supervisor, _ = issue_tokens(self.supervisor)
        schedule_response = self.client.post(
            reverse("supervision-request-schedule", args=[request_id]),
            **{"HTTP_AUTHORIZATION": f"Bearer {access_supervisor}"},
        )
        self.assertEqual(schedule_response.status_code, 200)
        self.assertEqual(schedule_response.data["status"], "SCHEDULED")

        complete_response = self.client.post(
            reverse("supervision-request-complete", args=[request_id]),
            {"notes": "Reviewed and closed."},
            format="json",
            **{"HTTP_AUTHORIZATION": f"Bearer {access_supervisor}"},
        )
        self.assertEqual(complete_response.status_code, 200)
        self.assertEqual(complete_response.data["status"], "COMPLETED")

    def test_nacada_ndo_report_auto_compiles_summary_on_create(self):
        from .models import SudRehabPlan

        with platform_admin_context():
            SudRehabPlan.objects.create(organization=self.org, patient=self.patient)
        response = self.client.post(
            reverse("nacada-ndo-report-list"),
            {"period_start": "2026-01-01", "period_end": "2026-12-31"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["summary_data"]["new_rehab_plans"], 1)
        self.assertEqual(response.data["status"], "DRAFT")

    def test_nacada_ndo_report_export_action_marks_exported(self):
        create_response = self.client.post(
            reverse("nacada-ndo-report-list"),
            {"period_start": "2026-01-01", "period_end": "2026-12-31"},
            format="json",
            **self.auth,
        )
        export_response = self.client.post(
            reverse("nacada-ndo-report-export", args=[create_response.data["id"]]), **self.auth
        )
        self.assertEqual(export_response.status_code, 200)
        self.assertEqual(export_response.data["status"], "EXPORTED")

    def test_ccp_team_roster_reports_caseload_from_care_team_memberships(self):
        with platform_admin_context():
            CareTeamMembership.objects.create(
                organization=self.org,
                patient=self.patient,
                user=self.case_manager,
                role="THERAPIST",
            )
        response = self.client.get(reverse("ccp-team-roster"), **self.auth)
        self.assertEqual(response.status_code, 200)
        emails = {row["email"]: row["caseload_count"] for row in response.data}
        self.assertEqual(emails["casemanager@org.test"], 1)

    def test_urine_drug_screen_restricted_for_non_care_team_and_audit_logged_for_care_team(self):
        """
        docs/09-SECURITY-COMPLIANCE.md §9.3 names UrineDrugScreen explicitly
        alongside PsychotherapySession/SudRehabPlan/BiopsychosocialAssessment
        for the elevated CCP privacy tier; §9.4 requires the *view* itself
        (not just edits) to be audit-logged when full content is returned.
        """
        from apps.sysadmin_audit.models import AuditLogEntry

        from .models import SudRehabPlan, UrineDrugScreen

        with platform_admin_context():
            plan = SudRehabPlan.objects.create(organization=self.org, patient=self.patient)
            screen = UrineDrugScreen.objects.create(
                organization=self.org,
                plan=plan,
                panel_results={"cannabinoids": "positive"},
                collected_by=self.case_manager,
            )
            CareTeamMembership.objects.create(
                organization=self.org,
                patient=self.patient,
                user=self.case_manager,
                role="THERAPIST",
            )

        outsider_response = self.client.get(
            reverse("urine-drug-screen-detail", args=[screen.id]),
            **{"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.supervisor)[0]}"},
        )
        self.assertEqual(outsider_response.status_code, 200)
        self.assertNotIn("panel_results", outsider_response.data)
        self.assertEqual(set(outsider_response.data.keys()), {"id", "plan", "collected_at"})

        with platform_admin_context():
            view_count_before = AuditLogEntry.objects.filter(
                model="ccp_program.urinedrugscreen", action=AuditLogEntry.ACTION_VIEW
            ).count()

        care_team_response = self.client.get(
            reverse("urine-drug-screen-detail", args=[screen.id]), **self.auth
        )
        self.assertEqual(care_team_response.status_code, 200)
        self.assertEqual(care_team_response.data["panel_results"], {"cannabinoids": "positive"})

        with platform_admin_context():
            view_count_after = AuditLogEntry.objects.filter(
                model="ccp_program.urinedrugscreen", action=AuditLogEntry.ACTION_VIEW
            ).count()
        self.assertEqual(view_count_after, view_count_before + 1)
