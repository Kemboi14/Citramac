"""Group programme: per-client entries, linked interventions, risk follow-up, corrections,
per-subject separation, aggregate-only utilisation, category administration, tenancy."""

import json
import uuid
from datetime import date, datetime, time
from datetime import timezone as dt_timezone
from types import SimpleNamespace

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Appointment, Patient
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Organization

from . import facility_time, group_programme
from .interventions import slot_times
from .models import CareTask, GroupSessionEntry, InterventionRecord
from .tests import CarePathwayApiTestCase

RISK_NOTE = "Disclosed thoughts of self-harm during the check-in round."


class GroupProgrammeTestCase(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.amina = self.register().data["patient_id"]
        self.brian = self.register(full_name="Brian Otieno Ouma", sex="MALE").data["patient_id"]
        self.carol = self.register(full_name="Carol Achieng Odhiambo").data["patient_id"]

    def entry(self, patient, attendance="PRESENT", **extra):
        return {"patient": patient, "attendance": attendance, **extra}

    def confirm(self, entries, auth=None, **details):
        payload = {
            "client_request_id": str(uuid.uuid4()),
            "category": "group_psychotherapy",
            "topic": "Coping with cravings",
            "session_date": timezone.localdate().isoformat(),
            "start_time": "10:00",
            "end_time": "11:00",
            "location": "Group room 2",
            "description": "Shared psychoeducation on the craving cycle.",
            "entries": entries,
            **details,
        }
        return self.client.post(
            reverse("care-group-sessions"), payload, format="json", **(auth or self.auth)
        )

    def standard_session(self):
        response = self.confirm(
            [
                self.entry(self.amina, observation="Shared a relapse-prevention plan."),
                self.entry(self.brian, "ABSENT"),
                self.entry(
                    self.carol,
                    observation=RISK_NOTE,
                    risk_disclosure=True,
                    follow_up=True,
                ),
            ]
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def entry_for(self, session, patient):
        return next(e for e in session["entries"] if e["patient_id"] == patient)

    def correct(self, entry_id, **body):
        return self.client.patch(
            reverse("care-group-entry", args=[entry_id]), body, format="json", **self.auth
        )


class ConfirmTests(GroupProgrammeTestCase):
    def test_each_client_gets_an_entry_and_only_present_clients_an_intervention(self):
        session = self.standard_session()
        self.assertEqual(len(session["entries"]), 3)
        with platform_admin_context():
            self.assertEqual(GroupSessionEntry.objects.filter(session_id=session["id"]).count(), 3)
            records = InterventionRecord.objects.filter(module="group_psychotherapy")
            self.assertEqual(
                sorted(str(r.patient_id) for r in records), sorted([self.amina, self.carol])
            )
            amina = records.get(patient_id=self.amina)
            self.assertFalse(amina.billable)
            self.assertEqual(amina.intervention, "Group therapy")
            self.assertEqual(amina.response, "Shared a relapse-prevention plan.")
            self.assertIn("Coping with cravings · Group psychotherapy", amina.note)
            entry = GroupSessionEntry.objects.get(patient_id=self.amina)
            self.assertIsNotNone(entry.episode_id)
        self.assertFalse(self.entry_for(session, self.brian)["intervention_linked"])

    def test_risk_disclosure_needs_an_observation_and_a_follow_up_task(self):
        no_note = self.confirm([self.entry(self.amina, risk_disclosure=True, follow_up=True)])
        self.assertEqual(no_note.status_code, 400)
        self.assertIn("entries.0.observation", no_note.data)
        no_task = self.confirm(
            [self.entry(self.amina, observation=RISK_NOTE, risk_disclosure=True)]
        )
        self.assertEqual(no_task.status_code, 400)
        self.assertIn("entries.0.follow_up", no_task.data)

        session = self.standard_session()
        carol = self.entry_for(session, self.carol)
        self.assertEqual(carol["follow_up_status"], "Open")
        with platform_admin_context():
            task = CareTask.objects.get(pk=carol["follow_up_task_id"])
        self.assertEqual(str(task.patient_id), self.carol)
        self.assertEqual(task.action_code, "group_follow_up")
        self.assertEqual(task.status, "INITIATED")
        self.assertEqual(task.owner, "Jane Njoroge")

    def test_end_time_must_follow_start_and_nothing_is_saved_on_failure(self):
        response = self.confirm([self.entry(self.amina)], start_time="11:00", end_time="10:30")
        self.assertEqual(response.status_code, 400)
        self.assertIn("end_time", response.data)
        bad_attendance = self.confirm([self.entry(self.amina, "MAYBE")])
        self.assertEqual(bad_attendance.status_code, 400)
        with platform_admin_context():
            self.assertFalse(GroupSessionEntry.objects.exists())
            self.assertFalse(InterventionRecord.objects.exists())

    def test_a_retried_confirm_returns_the_same_session(self):
        request_id = str(uuid.uuid4())
        first = self.confirm([self.entry(self.amina)], client_request_id=request_id)
        second = self.confirm([self.entry(self.amina)], client_request_id=request_id)
        self.assertEqual(first.data["id"], second.data["id"])
        with platform_admin_context():
            self.assertEqual(InterventionRecord.objects.count(), 1)

    def test_reading_a_saved_session_is_audit_logged(self):
        session = self.standard_session()
        before = AuditLogEntry.objects.filter(
            action=AuditLogEntry.ACTION_VIEW, model="care_pathway.groupsessionentry"
        ).count()
        self.client.get(reverse("care-group-session", args=[session["id"]]), **self.auth)
        after = AuditLogEntry.objects.filter(
            action=AuditLogEntry.ACTION_VIEW, model="care_pathway.groupsessionentry"
        ).count()
        self.assertEqual(after - before, 3)


class CorrectionTests(GroupProgrammeTestCase):
    def test_correcting_present_to_absent_voids_the_intervention_but_keeps_it(self):
        session = self.standard_session()
        amina = self.entry_for(session, self.amina)
        self.assertEqual(self.correct(amina["id"], attendance="ABSENT").status_code, 400)
        response = self.correct(amina["id"], attendance="ABSENT", reason="Marked in error")
        self.assertEqual(response.status_code, 200, response.data)
        corrected = self.entry_for(response.data, self.amina)
        self.assertEqual(corrected["version"], 2)
        self.assertFalse(corrected["intervention_linked"])
        with platform_admin_context():
            record = InterventionRecord.objects.get(patient_id=self.amina)
            entry = GroupSessionEntry.objects.get(pk=amina["id"])
        self.assertIsNotNone(record.voided_at)
        self.assertEqual(record.void_reason, "Marked in error")
        self.assertEqual(entry.audit[-1]["before"]["attendance"], "PRESENT")
        self.assertEqual(entry.audit[-1]["after"]["attendance"], "ABSENT")

    def test_correcting_absent_to_present_creates_an_intervention(self):
        session = self.standard_session()
        brian = self.entry_for(session, self.brian)
        response = self.correct(
            brian["id"], attendance="PRESENT", observation="Arrived late", reason="Late arrival"
        )
        self.assertTrue(self.entry_for(response.data, self.brian)["intervention_linked"])
        with platform_admin_context():
            record = InterventionRecord.objects.get(patient_id=self.brian)
        self.assertEqual(record.response, "Arrived late")
        self.assertEqual(record.corrections[0]["reason"], "Late arrival")

    def test_session_correction_updates_linked_intervention_notes(self):
        session = self.standard_session()
        body = {
            "category": "psychoeducation",
            "topic": "Managing triggers",
            "session_date": session["session_date"],
            "start_time": "10:00",
            "end_time": "11:30",
            "facilitator": session["facilitator_id"],
            "location": "Group room 2",
            "description": "Shared psychoeducation on triggers.",
        }
        url = reverse("care-group-session", args=[session["id"]])
        self.assertEqual(self.client.patch(url, body, format="json", **self.auth).status_code, 400)
        response = self.client.patch(
            url, {**body, "reason": "Wrong topic recorded"}, format="json", **self.auth
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["audit_trail"][0]["label"], "Session amended")
        with platform_admin_context():
            record = InterventionRecord.objects.get(patient_id=self.amina)
        self.assertIn("Managing triggers · Psychoeducation", record.note)
        self.assertEqual(record.corrections[-1]["reason"], "Wrong topic recorded")

    def test_an_open_follow_up_cannot_be_withdrawn_but_can_be_completed(self):
        session = self.standard_session()
        carol = self.entry_for(session, self.carol)
        withdrawn = self.correct(
            carol["id"], attendance="PRESENT", observation="Settled", reason="Recorded in error"
        )
        self.assertEqual(withdrawn.status_code, 400)
        response = self.client.post(
            reverse("care-group-entry-follow-up-complete", args=[carol["id"]]), **self.auth
        )
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["follow_up_status"], "Completed")
        self.assertEqual(row["version"], 2)
        with platform_admin_context():
            entry = GroupSessionEntry.objects.get(pk=carol["id"])
        self.assertEqual(entry.audit[-1]["reason"], "Individual follow-up task marked completed")


class SeparationTests(GroupProgrammeTestCase):
    def test_a_client_record_shows_only_that_clients_entries(self):
        self.standard_session()
        response = self.client.get(
            reverse("care-client-group-entries", args=[self.amina]), **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        body = json.dumps(response.data)
        self.assertNotIn(RISK_NOTE, body)
        self.assertNotIn(self.carol, body)
        self.assertNotIn(self.brian, body)
        self.assertIn("Shared a relapse-prevention plan.", body)

    def test_shared_lists_and_utilisation_carry_no_observation_or_risk_detail(self):
        self.standard_session()
        workspace = json.dumps(self.client.get(reverse("care-group-workspace"), **self.auth).data)
        utilisation = self.client.get(reverse("care-group-utilisation"), **self.auth).data
        for body in (workspace, json.dumps(utilisation)):
            self.assertNotIn(RISK_NOTE, body)
            self.assertNotIn("relapse-prevention", body)
            self.assertNotIn('"observation"', body)
        self.assertEqual(utilisation["confirmed_sessions"], 1)
        self.assertEqual(utilisation["recorded_attendances"], 2)
        self.assertEqual(utilisation["follow_ups_outstanding"], 1)
        self.assertEqual(utilisation["linked_intervention_records"], 2)
        self.assertEqual(utilisation["risk_disclosures_flagged"], 1)
        row = utilisation["by_category"][0]
        self.assertEqual(
            (row["category"], row["present"], row["absent"]), ("Group psychotherapy", 2, 1)
        )
        self.assertEqual(row["attendance_percent"], 67)

    def test_dashboard_counts_sessions_and_open_follow_ups(self):
        self.standard_session()
        data = self.client.get(reverse("care-dashboard"), **self.auth).data
        self.assertEqual(data["group_session_count"], 1)
        self.assertEqual(data["group_follow_up_open"], 1)


class CategoryTests(GroupProgrammeTestCase):
    def test_defaults_are_seeded_once_and_changes_need_an_administrator(self):
        url = reverse("care-group-categories")
        listed = self.client.get(url, **self.auth).data
        self.assertEqual(len(listed["results"]), 7)
        self.assertFalse(listed["can_configure"])
        self.assertEqual(len(self.client.get(url, **self.auth).data["results"]), 7)
        refused = self.client.post(url, {"display": "Art therapy"}, format="json", **self.auth)
        self.assertEqual(refused.status_code, 403)

        with platform_admin_context():
            admin = User.objects.create_user(
                email=f"admin-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                first_name="Org",
                last_name="Admin",
            )
            role, _ = Role.objects.get_or_create(
                name="Org Admin", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            admin.roles.add(role)
        admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(admin)[0]}"}
        added = self.client.post(url, {"display": "Art therapy"}, format="json", **admin_auth)
        self.assertEqual(added.status_code, 201)
        self.assertIn("art_therapy", [c["code"] for c in added.data["results"]])
        duplicate = self.client.post(url, {"display": "art therapy"}, format="json", **admin_auth)
        self.assertEqual(duplicate.status_code, 400)

        modified = self.client.patch(
            reverse("care-group-category", args=["life_skills"]),
            {"display": "Life skills and recovery"},
            format="json",
            **admin_auth,
        )
        row = next(c for c in modified.data["results"] if c["code"] == "life_skills")
        self.assertEqual(row["display"], "Life skills and recovery")


class TenancyTests(GroupProgrammeTestCase):
    def test_another_organisation_cannot_see_the_session(self):
        session = self.standard_session()
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other",
                slug=f"other-{uuid.uuid4().hex[:6]}",
                facility_type="MENTAL_HEALTH_MHP",
            )
            outsider = User.objects.create_user(
                email=f"out-{uuid.uuid4().hex[:6]}@other.test",
                password="Password123!",
                organization=other_org,
                is_active=True,
            )
        auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(outsider)[0]}"}
        detail = self.client.get(reverse("care-group-session", args=[session["id"]]), **auth)
        self.assertEqual(detail.status_code, 404)
        workspace = self.client.get(reverse("care-group-workspace"), **auth).data
        self.assertEqual(workspace["sessions"], [])
        self.assertEqual(workspace["clients"], [])


class FacilityTimeTests(GroupProgrammeTestCase):
    """Facility wall-clock times are read in settings.FACILITY_TIME_ZONE
    (Africa/Nairobi, UTC+3), not in UTC."""

    def test_a_1400_nairobi_session_is_stored_as_1100z_and_reads_back_as_1400(self):
        with override_settings(FACILITY_TIME_ZONE="Africa/Nairobi"):
            response = self.confirm(
                [self.entry(self.amina, observation="Engaged throughout.")],
                session_date="2026-10-14",
                start_time="14:00",
                end_time="15:30",
            )
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(response.data["start_time"], "14:00")
            with platform_admin_context():
                record = InterventionRecord.objects.get(module="group_psychotherapy")
            self.assertEqual(
                record.performed_at, datetime(2026, 10, 14, 11, 0, tzinfo=dt_timezone.utc)
            )
            detail = self.client.get(
                reverse("care-group-session", args=[response.data["id"]]), **self.auth
            ).data
            self.assertEqual(
                (detail["session_date"], detail["start_time"]), ("2026-10-14", "14:00")
            )

    def test_scheduled_appointments_are_grouped_by_facility_date_and_time(self):
        with override_settings(FACILITY_TIME_ZONE="Africa/Nairobi"), platform_admin_context():
            for pid, at in (
                (self.amina, datetime(2026, 10, 14, 11, 0, tzinfo=dt_timezone.utc)),
                # 22:30Z on the 14th is 01:30 on the 15th in Nairobi.
                (self.brian, datetime(2026, 10, 14, 22, 30, tzinfo=dt_timezone.utc)),
            ):
                Appointment.objects.create(
                    organization=self.org,
                    patient=Patient.objects.get(pk=pid),
                    scheduled_for=at,
                    duration_minutes=60,
                    status="SCHEDULED",
                    appointment_type="Group psychotherapy",
                )
            items = group_programme.scheduled_sessions(today=date(2026, 10, 14))
        slots = sorted((i["date"], i["time"], i["end_time"]) for i in items)
        self.assertEqual(
            slots, [("2026-10-14", "14:00", "15:00"), ("2026-10-15", "01:30", "02:30")]
        )
        first = next(i for i in items if i["time"] == "14:00")
        self.assertEqual(
            datetime.fromisoformat(first["starts_at"]),
            datetime(2026, 10, 14, 11, 0, tzinfo=dt_timezone.utc),
        )


class FacilityTimeHelperTests(GroupProgrammeTestCase):
    def test_round_trip_and_mar_slots(self):
        with override_settings(FACILITY_TIME_ZONE="Africa/Nairobi"):
            moment = facility_time.combine_local(date(2026, 10, 14), time(14, 0))
            self.assertEqual(moment, datetime(2026, 10, 14, 11, 0, tzinfo=dt_timezone.utc))
            self.assertEqual(facility_time.local_time(moment), time(14, 0))
            self.assertEqual(facility_time.local_date(moment), date(2026, 10, 14))
            naive = facility_time.make_local_aware(datetime(2026, 10, 14, 14, 0))
            self.assertEqual(naive, moment)
            # 23:30Z is already the next day in Nairobi.
            late = datetime(2026, 10, 14, 23, 30, tzinfo=dt_timezone.utc)
            self.assertEqual(facility_time.local_date(late), date(2026, 10, 15))
            bd = SimpleNamespace(is_prn=False, frequency="BD")
            self.assertEqual(
                slot_times(bd, now=datetime(2026, 10, 14, 6, 0, tzinfo=dt_timezone.utc)),
                [
                    datetime(2026, 10, 14, 5, 0, tzinfo=dt_timezone.utc),
                    datetime(2026, 10, 14, 17, 0, tzinfo=dt_timezone.utc),
                ],
            )


class RiskScreenTests(GroupProgrammeTestCase):
    """Owner decision 2026-10-22: risk language in an observation is flagged
    automatically; the clinician may untick it only with a recorded reason."""

    def alerts(self, patient):
        from .models import ClinicalAlert

        with platform_admin_context():
            return list(
                ClinicalAlert.objects.filter(patient_id=patient, alert_code="GROUP_RISK_DISCLOSURE")
                .values_list("status", flat=True)
            )

    def test_screen_reports_possible_risk_language_and_stores_nothing(self):
        response = self.client.post(
            reverse("care-group-screen"),
            {"entries": [{"patient": self.amina, "observation": RISK_NOTE},
                         {"patient": self.brian, "observation": "Spoke about cutting down drinking."}]},
            format="json", **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        amina, brian = response.data["results"]
        self.assertTrue(amina["flags"])
        self.assertEqual(brian["flags"], [])  # a reduction goal, not self-harm

    def test_detected_risk_needs_the_disclosure_or_a_reason_not_to(self):
        refused = self.confirm([self.entry(self.amina, observation=RISK_NOTE)])
        self.assertEqual(refused.status_code, 400)
        self.assertIn("entries.0.risk_disclosure", refused.data)
        self.assertEqual(self.alerts(self.amina), [])
        overridden = self.confirm([self.entry(
            self.amina, observation=RISK_NOTE,
            risk_override_reason="Quoting a film the group discussed; no personal disclosure.",
        )])
        self.assertEqual(overridden.status_code, 201, overridden.data)
        entry = self.entry_for(overridden.data, self.amina)
        self.assertTrue(entry["risk_detected"])
        self.assertIn("Quoting a film", entry["risk_override_reason"])
        self.assertEqual(self.alerts(self.amina), [])

    def test_a_disclosure_alerts_only_that_clients_record_and_a_correction_resolves_it(self):
        session = self.standard_session()
        self.assertEqual(self.alerts(self.carol), ["ACTIVE"])
        self.assertEqual(self.alerts(self.amina), [])
        banner = self.client.get(reverse("care-client-banner", args=[self.carol]), **self.auth)
        self.assertEqual(banner.status_code, 200)
        carol = self.entry_for(session, self.carol)
        with platform_admin_context():
            CareTask.objects.filter(pk=carol["follow_up_task_id"]).update(status="COMPLETED")
        corrected = self.correct(
            carol["id"], attendance="PRESENT", observation="Discussed sleep routines.",
            risk_disclosure=False, follow_up=False, reason="Observation recorded against the wrong client",
        )
        self.assertEqual(corrected.status_code, 200, corrected.data)
        self.assertEqual(self.alerts(self.carol), ["RESOLVED"])
