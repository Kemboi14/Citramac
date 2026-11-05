"""NACADA NDO report: what it counts, small-number suppression, who may send it,
how it is sent, and its FHIR MeasureReport (owner decisions 2026-11-03)."""

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.access import set_assignments
from apps.accounts.models import Permission, Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway.models import (
    EpisodeOfCare,
    EpisodeOutcome,
    EpisodeStatusHistory,
    NaloxoneSupply,
    OatEnrolment,
    TriageAssessment,
    TriageEncounter,
)
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.ipd_ward.models import Admission, Bed, Ward
from apps.notifications.models import NotificationDelivery
from apps.notifications.tasks import deliver_notification
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import Branch, Organization

from .models import NacadaNdoReport, NacadaReportSend
from .nacada_report import SECONDARY_DISPLAY, SMALL_DISPLAY, _rows, cell

PERIOD = {"period_start": "2026-10-01", "period_end": "2026-10-31"}


def _at(day, hour=10):
    return timezone.make_aware(datetime(2026, 10, day, hour))


class SuppressionTests(SimpleTestCase):
    def test_one_to_four_is_withheld_and_zero_is_exact(self):
        self.assertEqual(cell(0)["display"], "0")
        for small in (1, 4):
            self.assertEqual(
                cell(small), {"value": None, "display": SMALL_DISPLAY, "masked": "small"}
            )
        self.assertEqual(cell(5)["value"], 5)

    def test_a_lone_small_row_takes_the_next_smallest_with_it(self):
        rows = _rows([("a", "A", 20), ("b", "B", 2), ("c", "C", 7), ("d", "D", 0)], exclusive=True)
        self.assertEqual(
            [r["display"] for r in rows], ["20", SMALL_DISPLAY, SECONDARY_DISPLAY, "0"]
        )
        self.assertIsNone(rows[2]["value"])

    def test_two_small_rows_or_overlapping_rows_need_nothing_more(self):
        both = _rows([("a", "A", 20), ("b", "B", 2), ("c", "C", 3)], exclusive=True)
        self.assertEqual([r["display"] for r in both], ["20", SMALL_DISPLAY, SMALL_DISPLAY])
        overlap = _rows([("a", "A", 20), ("b", "B", 2)], exclusive=False)
        self.assertEqual([r["display"] for r in overlap], ["20", SMALL_DISPLAY])


class NacadaTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Cafric", slug="cafric", facility_type="MENTAL_HEALTH_MHP"
            )
            self.thika = Branch.objects.create(
                organization=self.org, name="Thika", facility_level="L3"
            )
            self.ruiru = Branch.objects.create(
                organization=self.org, name="Ruiru", facility_level="L3"
            )
            org_admin = Role.objects.get(name="Org Admin", organization__isnull=True)
            nurse = Role.objects.get(name="Nurse", organization__isnull=True)
            self.admin = self._user("admin@cafric.test", [(org_admin, None)], "Grace", "Otieno")
            self.nurse = self._user("nurse@cafric.test", [(nurse, self.thika)], "Ann", "Mutua")
            self.ward = Ward.objects.create(organization=self.org, name="Ward A", branch=self.thika)
            self.bed_count = 0

    def _user(self, email, pairs, first, last):
        user = User.objects.create_user(
            email=email,
            password="Password123!",
            organization=self.org,
            is_active=True,
            first_name=first,
            last_name=last,
        )
        set_tenant_context(organization_id=self.org.id)
        set_assignments(user, pairs)
        set_tenant_context(is_platform_admin=True)
        return user

    def grant_send(self, user):
        with platform_admin_context():
            role = Role.objects.create(name="NDO reporter", organization=self.org)
            role.permissions.add(Permission.objects.get(codename="reports.nacada.send"))
            set_tenant_context(organization_id=self.org.id)
            set_assignments(
                user,
                [
                    (Role.objects.get(name="Nurse", organization__isnull=True), self.thika),
                    (role, self.thika),
                ],
            )
            set_tenant_context(is_platform_admin=True)

    def auth(self, user, branch=None):
        access, _ = issue_tokens(user)
        headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
        if branch is not None:
            headers["HTTP_X_BRANCH_ID"] = str(branch.id)
        return headers

    # ── fixtures (call inside platform_admin_context) ──

    def patient(self, gender="FEMALE", dob="1997-03-14", last="Mwangi"):
        return Patient.objects.create(
            organization=self.org,
            first_name="Faith",
            last_name=last,
            gender=gender,
            date_of_birth=dob,
        )

    def episode(self, patient, branch=None, day=5, status="active"):
        return EpisodeOfCare.objects.create(
            organization=self.org,
            patient=patient,
            branch=branch or self.thika,
            status=status,
            period_start=_at(day),
        )

    def triage(self, episode, answers, day=6):
        encounter = Encounter.objects.create(
            organization=self.org, patient=episode.patient, branch=episode.branch, episode=episode
        )
        triage = TriageEncounter.objects.create(
            organization=self.org,
            patient=episode.patient,
            episode=episode,
            encounter=encounter,
            client_request_id=str(encounter.id),
            due_at=_at(day),
        )
        return TriageAssessment.objects.create(
            organization=self.org,
            triage_encounter=triage,
            status="COMPLETED",
            answers=answers,
            signed_at=_at(day),
        )

    def admit(self, episode, kind="VOLUNTARY", day=7):
        self.bed_count += 1
        bed = Bed.objects.create(
            organization=self.org, ward=self.ward, bed_number=str(self.bed_count)
        )
        return Admission.objects.create(
            organization=self.org,
            patient=episode.patient,
            bed=bed,
            episode=episode,
            admission_type=kind,
            admitted_at=_at(day),
        )

    def compile(self, user=None, branch=None, **extra):
        user = user or self.admin
        body = {**PERIOD, **extra}
        if branch is not None:
            body["branch"] = str(branch.id)
        return self.client.post(
            reverse("nacada-ndo-report-list"), body, format="json", **self.auth(user, branch)
        )


def _section(report, code):
    return next(s for s in report["summary_data"]["sections"] if s["code"] == code)


def _rows_of(section, breakdown):
    rows = next(b for b in section["breakdowns"] if b["code"] == breakdown)["rows"]
    return {row["code"]: row["display"] for row in rows}


class CompileTests(NacadaTestCase):
    def test_counts_one_branch_withholds_small_numbers_and_keeps_no_names(self):
        with platform_admin_context():
            for _ in range(6):
                self.episode(self.patient("FEMALE", "1997-03-14"))
            for _ in range(2):
                self.episode(self.patient("MALE", "2008-06-01"))
            self.episode(self.patient(), status="cancelled")
            self.episode(self.patient(), branch=self.ruiru)
            self.episode(self.patient(), day=1)  # 1 October counts
            EpisodeOfCare.objects.create(
                organization=self.org,
                patient=self.patient(),
                branch=self.thika,
                period_start=_at(1) - timedelta(days=2),
            )
        response = self.compile(branch=self.thika)
        self.assertEqual(response.status_code, 201, response.data)
        episodes = _section(response.data, "new-episodes")
        self.assertEqual(episodes["total"]["display"], "9")
        sex = _rows_of(episodes, "sex")
        self.assertEqual(sex["MALE"], SMALL_DISPLAY)
        # 9 − 7 would give the 2 away, so the only other non-zero row goes too.
        self.assertEqual(sex["FEMALE"], SECONDARY_DISPLAY)
        self.assertEqual(response.data["branch_name"], "Thika")
        self.assertNotIn("Mwangi", str(response.data["summary_data"]))
        self.assertIn(
            "not yet matched to NACADA", response.data["summary_data"]["definition_label"]
        )

    def test_age_is_taken_when_the_episode_started(self):
        with platform_admin_context():
            for _ in range(5):
                self.episode(self.patient(dob="2011-10-20"), day=10)  # 14 on 10 Oct
        ages = _rows_of(_section(self.compile(branch=self.thika).data, "new-episodes"), "age")
        self.assertEqual(ages["lt15"], "5")
        self.assertEqual(ages["15-19"], "0")

    def test_substances_from_signed_v5_and_v4_triages_and_v3_counted_in_total_only(self):
        with platform_admin_context():
            for i in range(5):
                answers = {
                    "schema": "v5",
                    "g_opioids_last": "today",
                    "g_opioids_concern": "withdrawal",
                }
                if i == 0:
                    answers["g_alcohol_last"] = "yesterday"
                self.triage(self.episode(self.patient()), answers)
            self.triage(
                self.episode(self.patient()),
                {"schema": "v4", "subst_recent": "yes", "subst_which": ["opioids", "khat"]},
            )
            self.triage(self.episode(self.patient()), {"g_use": "yes"})
        section = _section(self.compile(branch=self.thika).data, "substances")
        self.assertEqual(section["total"]["display"], "7")
        use = _rows_of(section, "use")
        self.assertEqual(use["opioids"], "6")
        self.assertEqual(use["alcohol"], SMALL_DISPLAY)
        self.assertEqual(use["khat"], SMALL_DISPLAY)
        self.assertEqual(use["cannabis"], "0")
        self.assertEqual(_rows_of(section, "withdrawal")["opioids"], "5")
        self.assertTrue(any("1 triage(s) signed on the oldest form" in n for n in section["notes"]))

    def test_admissions_outcomes_oat_naloxone_and_waiting_time(self):
        with platform_admin_context():
            for _ in range(5):
                episode = self.episode(self.patient(), status="waitlist")
                EpisodeStatusHistory.objects.create(
                    organization=self.org, episode=episode, status="waitlist", period_start=_at(2)
                )
                EpisodeStatusHistory.objects.create(
                    organization=self.org, episode=episode, status="active", period_start=_at(12)
                )
                self.admit(episode)
                EpisodeOutcome.objects.create(
                    organization=self.org,
                    episode=episode,
                    patient=episode.patient,
                    outcome="PLANNED",
                    recorded_at=_at(20),
                )
                OatEnrolment.objects.create(
                    organization=self.org, patient=episode.patient, medicine="methadone", clinic="X"
                )
                NaloxoneSupply.objects.create(
                    organization=self.org,
                    patient=episode.patient,
                    outcome="SUPPLIED",
                    quantity=2,
                    training_given=True,
                    given_at=_at(15),
                )
            OatEnrolment.objects.update(created_at=_at(14))
        data = self.compile(branch=self.thika).data
        admissions = _section(data, "admissions")
        self.assertEqual(_rows_of(admissions, "type"), {"VOLUNTARY": "5", "INVOLUNTARY": "0"})
        self.assertEqual(_rows_of(_section(data, "episodes-closed"), "outcome")["PLANNED"], "5")
        oat = _section(data, "oat")
        self.assertEqual(oat["scope"], "organization")
        self.assertEqual(_rows_of(oat, "status")["REFERRED"], "5")
        naloxone = _section(data, "naloxone")
        self.assertEqual(_rows_of(naloxone, "supply"), {"kits": "10", "training": "5"})
        wait = _section(data, "waiting-time")
        self.assertEqual(wait["total"]["display"], "5")
        self.assertEqual(wait["median_days"]["value"], 10.0)

    def test_a_median_over_fewer_than_five_people_is_withheld(self):
        with platform_admin_context():
            episode = self.episode(self.patient())
            EpisodeStatusHistory.objects.create(
                organization=self.org, episode=episode, status="waitlist", period_start=_at(2)
            )
            EpisodeStatusHistory.objects.create(
                organization=self.org, episode=episode, status="active", period_start=_at(3)
            )
        wait = _section(self.compile(branch=self.thika).data, "waiting-time")
        self.assertEqual(wait["total"]["display"], SMALL_DISPLAY)
        self.assertIsNone(wait["median_days"]["value"])

    def test_a_branch_user_can_only_report_for_their_branch(self):
        # Working at Thika, asking for Ruiru in the body: refused by the view.
        response = self.client.post(
            reverse("nacada-ndo-report-list"),
            {**PERIOD, "branch": str(self.ruiru.id)},
            format="json",
            **self.auth(self.nurse, self.thika),
        )
        self.assertEqual(response.status_code, 400)
        # Asking to work at Ruiru at all is refused before the view.
        self.assertEqual(self.compile(self.nurse, branch=self.ruiru).status_code, 403)
        response = self.compile(self.nurse, branch=self.thika)
        self.assertEqual(response.status_code, 201, response.data)

    def test_period_must_be_in_order_and_not_in_the_future(self):
        backwards = self.compile(
            branch=self.thika, period_start="2026-10-31", period_end="2026-10-01"
        )
        self.assertEqual(backwards.status_code, 400)
        future = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self.compile(branch=self.thika, period_end=future).status_code, 400)

    def test_a_compiled_report_cannot_be_edited(self):
        report_id = self.compile(branch=self.thika).data["id"]
        url = reverse("nacada-ndo-report-detail", args=[report_id])
        for method in (self.client.patch, self.client.put, self.client.delete):
            response = method(
                url, {"period_end": "2026-10-02"}, format="json", **self.auth(self.admin)
            )
            self.assertEqual(response.status_code, 405)


class SendTests(NacadaTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            for _ in range(5):
                self.episode(self.patient())
            self.episode(self.patient("MALE"))
        self.report_id = self.compile(branch=self.thika).data["id"]

    def send(self, user, target, confirm=True):
        return self.client.post(
            reverse("nacada-ndo-report-send", args=[self.report_id]),
            {"target": target, "confirm": confirm},
            format="json",
            **self.auth(user, self.thika),
        )

    def set_address(self, user, address):
        return self.client.put(
            reverse("nacada-settings"),
            {"nacada_report_email": address},
            format="json",
            **self.auth(user),
        )

    def test_only_an_org_admin_sets_the_nacada_address(self):
        self.assertEqual(self.set_address(self.nurse, "ndo@nacada.test").status_code, 403)
        self.assertEqual(self.set_address(self.admin, "not-an-email").status_code, 400)
        response = self.set_address(self.admin, "ndo@nacada.test")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["nacada_report_email"], "ndo@nacada.test")
        settings = self.client.get(reverse("nacada-settings"), **self.auth(self.nurse)).data
        self.assertFalse(settings["can_edit"])
        self.assertFalse(settings["can_send"])

    def test_sending_needs_the_permission_unless_org_admin(self):
        self.assertEqual(self.send(self.nurse, "SELF").status_code, 403)
        self.grant_send(self.nurse)
        self.assertEqual(self.send(self.nurse, "SELF").status_code, 200)
        self.assertEqual(self.send(self.admin, "SELF").status_code, 200)

    def test_a_send_must_be_confirmed(self):
        response = self.send(self.admin, "SELF", confirm=False)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(NacadaReportSend.objects.exists())

    def test_nacada_send_needs_the_address_set(self):
        response = self.send(self.admin, "NACADA")
        self.assertEqual(response.status_code, 400)
        self.assertIn("NACADA reporting email", str(response.data))

    def test_send_to_nacada_queues_email_with_reply_to_a_copy_and_an_audit_entry(self):
        self.set_address(self.admin, "ndo@nacada.test")
        response = self.send(self.admin, "NACADA")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["sends"][0]["address"], "ndo@nacada.test")
        with platform_admin_context():
            send = NacadaReportSend.objects.get()
            self.assertEqual(send.delivery.reply_to, "admin@cafric.test")
            self.assertEqual(send.copy_delivery.address, "admin@cafric.test")
            audit = AuditLogEntry.objects.get(action=AuditLogEntry.ACTION_REPORT_SENT)
            self.assertEqual(audit.object_id, self.report_id)
            self.assertEqual(audit.field_diff["target"], "NACADA")
            delivery_id = send.delivery_id
        deliver_notification(str(delivery_id))
        message = next(m for m in mail.outbox if m.to == ["ndo@nacada.test"])
        self.assertEqual(message.reply_to, ["admin@cafric.test"])
        self.assertTrue(message.subject.startswith("NACADA NDO report — Cafric, Thika"))
        html = message.alternatives[0][0]
        self.assertIn(SMALL_DISPLAY.replace("<", "&lt;"), html)
        self.assertNotIn("Mwangi", html + message.body)
        with platform_admin_context():
            self.assertEqual(
                NotificationDelivery.objects.get(pk=delivery_id).status,
                NotificationDelivery.STATUS_SENT,
            )

    def test_an_unreachable_broker_leaves_the_send_queued_for_the_sweep(self):
        with patch(
            "apps.notifications.tasks.deliver_notification.apply_async",
            side_effect=ConnectionError("broker down"),
        ):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.send(self.admin, "SELF")
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            delivery = NacadaReportSend.objects.get().delivery
            self.assertEqual(delivery.status, NotificationDelivery.STATUS_PENDING)

    def test_send_to_myself_is_marked_as_a_test_copy(self):
        self.send(self.admin, "SELF")
        with platform_admin_context():
            send = NacadaReportSend.objects.get()
            self.assertEqual(send.address, "admin@cafric.test")
            self.assertIsNone(send.copy_delivery)
            self.assertTrue(send.delivery.subject.startswith("[Test copy]"))
            self.assertEqual(send.delivery.reply_to, "")

    def test_an_old_format_report_cannot_be_sent(self):
        with platform_admin_context():
            old = NacadaNdoReport.objects.create(
                organization=self.org,
                period_start=date(2026, 1, 1),
                period_end=date(2026, 1, 31),
                summary_data={"new_rehab_plans": 0},
            )
        self.report_id = str(old.id)
        response = self.send(self.admin, "SELF")
        self.assertEqual(response.status_code, 400)
        self.assertIn("old format", str(response.data))


class FhirR4ConformanceNacadaReportTests(NacadaTestCase):
    def test_live_report_is_a_valid_r4_measure_report_with_masked_counts(self):
        with platform_admin_context():
            for _ in range(5):
                self.episode(self.patient())
            self.episode(self.patient("MALE"))
        report_id = self.compile(branch=self.thika).data["id"]
        bundle = self.client.get(
            reverse("nacada-ndo-report-fhir", args=[report_id]), **self.auth(self.admin)
        ).json()
        self.assertEqual(validate_bundle(bundle), {})
        measure_report = bundle["entry"][0]["resource"]
        self.assertEqual(measure_report["type"], "summary")
        self.assertNotIn("subject", measure_report)
        self.assertEqual(measure_report["reporter"]["reference"], f"Organization/{self.thika.id}")
        sex = measure_report["group"][0]["stratifier"][0]["stratum"]
        male = next(s for s in sex if s["value"]["coding"][0]["code"] == "MALE")
        self.assertNotIn("count", male["population"][0])
        self.assertEqual(male["population"][0]["_count"]["extension"][0]["valueCode"], "masked")
        provenance = bundle["entry"][1]["resource"]
        self.assertEqual(provenance["agent"][0]["who"]["display"], "Grace Otieno")


class FhirR4ConformanceNacadaExamplesTests(SimpleTestCase):
    """Published examples (CLAUDE.md §3 item 8): a routine month, an edge case
    with withheld small numbers, and an omission (a month with no activity)."""

    EXAMPLES = Path(__file__).parent / "fhir_examples"

    def load(self, name):
        return json.loads((self.EXAMPLES / f"{name}.json").read_text())

    def test_there_are_at_least_three_valid_examples(self):
        paths = sorted(self.EXAMPLES.glob("nacada-ndo-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(example=path.name):
                bundle = json.loads(path.read_text())
                self.assertEqual(validate_bundle(bundle), {})
                self.assertEqual(
                    [e["resource"]["resourceType"] for e in bundle["entry"]],
                    ["MeasureReport", "Provenance"],
                )

    def test_edge_example_masks_small_and_secondary_counts(self):
        report = self.load("nacada-ndo-edge-small-numbers-withheld")["entry"][0]["resource"]
        sex = report["group"][0]["stratifier"][0]["stratum"]
        masked = {s["value"]["coding"][0]["code"] for s in sex if "_count" in s["population"][0]}
        # FEMALE 2 is small; MALE 9 is withheld so 11 − 9 can't give it away.
        self.assertEqual(masked, {"FEMALE", "MALE"})
        waiting = report["group"][-1]
        self.assertNotIn("measureScore", waiting)

    def test_omission_example_reports_zeros_not_absence(self):
        report = self.load("nacada-ndo-omission-no-activity")["entry"][0]["resource"]
        totals = [g["population"][0]["count"] for g in report["group"]]
        self.assertEqual(totals, [0] * len(report["group"]))
        self.assertNotIn("measureScore", report["group"][-1])


class NacadaPrintTests(NacadaTestCase):
    def test_report_prints_counts_only_and_downloads(self):
        report_id = self.compile(branch=self.thika).data["id"]
        url = reverse("nacada-ndo-report-print-report", args=[report_id])
        preview = self.client.get(url, **self.auth(self.admin, self.thika))
        self.assertEqual(preview.status_code, 200)
        html = preview.content.decode()
        self.assertIn("NACADA National Drug Observatory report", html)
        self.assertIn("Counts only", html)
        pdf = self.client.get(url + "?output=pdf", **self.auth(self.admin, self.thika))
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF-"))
