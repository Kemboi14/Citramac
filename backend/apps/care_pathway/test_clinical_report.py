"""Clinical Report (clinical_report.py): what it counts, branch scope, who may
open it, the printable document, and its FHIR MeasureReport (owner, 2026-11-10)."""

import json
from datetime import date
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.mhp_program.nacada_report import SMALL_DISPLAY
from apps.mhp_program.test_nacada import PERIOD, NacadaTestCase, _at
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from . import psychiatric_review
from .clinical_report_views import last_month
from .models import CareTask, ClinicalAlert


def _section(report, code):
    return next(s for s in report["sections"] if s["code"] == code)


def _rows(section, breakdown):
    rows = next(b for b in section["breakdowns"] if b["code"] == breakdown)["rows"]
    return {row["code"]: row["display"] for row in rows}


class ClinicalReportTestCase(NacadaTestCase):
    def report(self, user=None, branch=None, working=None, **params):
        user = user or self.admin
        query = {**PERIOD, **params}
        if branch is not None:
            query["branch"] = str(branch.id)
        return self.client.get(
            reverse("care-clinical-report"),
            query,
            **self.auth(user, working or branch or self.thika),
        )

    def triaged(self, priority, branch=None, day=6):
        episode = self.episode(self.patient(), branch=branch)
        assessment = self.triage(episode, {}, day=day)
        self.prioritise(assessment, priority)
        return episode, assessment

    def prioritise(self, assessment, priority):
        # A signed assessment is locked; set the fixture's priority directly.
        type(assessment).objects.filter(pk=assessment.pk).update(final_priority=priority)

    def diagnose(self, episode, code, day=8, **extra):
        encounter = Encounter.objects.create(
            organization=self.org, patient=episode.patient, branch=episode.branch, episode=episode
        )
        dx = DiagnosisCode.objects.create(
            organization=self.org,
            encounter=encounter,
            icd11_code_id=code,
            verification_status=extra.pop("verification_status", "CONFIRMED"),
            **extra,
        )
        DiagnosisCode.objects.filter(pk=dx.pk).update(created_at=_at(day))
        return dx


class CountTests(ClinicalReportTestCase):
    def test_clients_are_counted_once_by_their_latest_triage_and_only_at_this_branch(self):
        with platform_admin_context():
            for _ in range(6):
                self.triaged("ORANGE")
            for _ in range(5):
                self.triaged("GREEN")
            # Triaged twice: GREEN early, then RED — counted once, as RED (small, withheld).
            episode, _ = self.triaged("GREEN", day=3)
            self.prioritise(self.triage(episode, {}, day=20), "RED")
            self.triaged("RED", branch=self.ruiru)  # another branch
            self.triaged("RED", day=1)
            self.triage(self.episode(self.patient()), {}, day=6)  # no priority recorded
        response = self.report(branch=self.thika)
        self.assertEqual(response.status_code, 200, response.data)
        section = _section(response.data, "clients-triaged")
        self.assertEqual(section["total"]["display"], "14")
        rows = _rows(section, "priority")
        self.assertEqual((rows["ORANGE"], rows["GREEN"], rows["RED"]), ("6", "5", SMALL_DISPLAY))
        self.assertEqual(rows["YELLOW"], "0")

    def test_diagnoses_are_who_codes_by_client_without_errors_or_unverified_codes(self):
        with platform_admin_context():
            for _ in range(5):
                episode = self.episode(self.patient())
                self.diagnose(episode, "6A70.1")
                self.diagnose(episode, "6A70.1", day=9)  # same client, counted once
            wrong = self.episode(self.patient())
            self.diagnose(wrong, "6A70.1", verification_status="ENTERED_IN_ERROR")
            self.diagnose(wrong, "6A70.1", verification_status="RULED_OUT")
            flagged = self.episode(self.patient())
            self.diagnose(flagged, "6C40.20", code_review_reason="stub code")
            self.diagnose(self.episode(self.patient(), branch=self.ruiru), "6C40.20")
        report = self.report(branch=self.thika).data
        section = _section(report, "diagnoses")
        self.assertEqual(section["total"]["display"], "6")
        rows = next(b for b in section["breakdowns"] if b["code"] == "icd11")["rows"]
        first = rows[0]
        self.assertEqual(first["code"], "6A70.1")
        self.assertTrue(first["label"].startswith("6A70.1 "))
        self.assertEqual(first["display"], "5")
        under_review = next(r for r in rows if r["code"] == "under-review")
        self.assertEqual(under_review["display"], SMALL_DISPLAY)
        self.assertNotIn("6C40.20", [r["code"] for r in rows])

    def test_alerts_reviews_and_discharges_count_for_the_branch(self):
        with platform_admin_context():
            for _ in range(5):
                episode, assessment = self.triaged("ORANGE")
                ClinicalAlert.objects.create(
                    organization=self.org,
                    patient=episode.patient,
                    alert_code="SUICIDE_RISK",
                    label="Suicide risk",
                    raised_at=_at(10),
                )
                CareTask.objects.create(
                    organization=self.org,
                    patient=episode.patient,
                    triage_encounter=assessment.triage_encounter,
                    action_code="psychiatric_review_withdrawal",
                    action_label="Psychiatric review — withdrawal",
                    owner="Psychiatry",
                    focus_type=psychiatric_review.FOCUS,
                )
                admission = self.admit(episode)
                admission.discharged_at = _at(15)
                admission.status = "DISCHARGED"
                admission.save()
            elsewhere = self.episode(self.patient(), branch=self.ruiru)
            ClinicalAlert.objects.create(
                organization=self.org,
                patient=elsewhere.patient,
                alert_code="SUICIDE_RISK",
                label="Suicide risk",
                raised_at=_at(10),
            )
            CareTask.objects.filter(focus_type=psychiatric_review.FOCUS).update(created_at=_at(11))
        report = self.report(branch=self.thika).data
        alerts = _section(report, "risk-alerts")
        self.assertEqual(alerts["total"]["display"], "5")
        self.assertEqual(_rows(alerts, "type"), {"SUICIDE_RISK": "5"})
        reviews = _section(report, "psychiatric-reviews")
        self.assertEqual(reviews["total"]["display"], "5")
        self.assertEqual(_rows(reviews, "status")["INITIATED"], "5")
        self.assertEqual(_section(report, "discharges")["total"]["display"], "5")
        self.assertEqual(_section(report, "admissions")["total"]["display"], "5")

    def test_default_period_is_last_month(self):
        self.assertEqual(last_month(date(2026, 11, 10)), (date(2026, 10, 1), date(2026, 10, 31)))
        self.assertEqual(last_month(date(2026, 1, 3)), (date(2025, 12, 1), date(2025, 12, 31)))


class AccessTests(ClinicalReportTestCase):
    def test_clinical_staff_see_their_own_branches_only(self):
        self.assertEqual(self.report(user=self.nurse, branch=self.thika).status_code, 200)
        # Asking for a branch they can't open, from their own working branch.
        refused = self.report(user=self.nurse, branch=self.ruiru, working=self.thika)
        self.assertEqual(refused.status_code, 400)
        # Switching the working branch to it is refused before the report runs.
        self.assertEqual(self.report(user=self.nurse, branch=self.ruiru).status_code, 403)

    def test_staff_without_clinical_access_are_refused(self):
        with platform_admin_context():
            front_desk = Role.objects.get(name="Front Desk", organization__isnull=True)
            clerk = self._user("desk@cafric.test", [(front_desk, self.thika)], "Joy", "Kamau")
        self.assertEqual(self.report(user=clerk, branch=self.thika).status_code, 403)

    def test_a_future_or_reversed_period_is_refused(self):
        self.assertEqual(
            self.report(period_start="2026-10-31", period_end="2026-10-01").status_code, 400
        )
        with patch("apps.care_pathway.facility_time.local_date", return_value=date(2026, 10, 15)):
            self.assertEqual(self.report().status_code, 400)

    def test_every_compile_is_audited_with_its_period_and_output(self):
        self.report(branch=self.thika)
        self.client.get(
            reverse("care-clinical-report-print"),
            {**PERIOD, "branch": str(self.thika.id)},
            **self.auth(self.admin, self.thika),
        )
        with platform_admin_context():
            outputs = list(
                AuditLogEntry.objects.filter(
                    model="care_pathway.clinicalreport", action=AuditLogEntry.ACTION_VIEW
                )
                .order_by("timestamp")
                .values_list("field_diff", flat=True)
            )
        self.assertEqual([o["output"] for o in outputs], ["screen", "preview"])
        self.assertEqual(outputs[0]["period_start"], "2026-10-01")

    def test_print_preview_uses_the_shared_document_layout(self):
        response = self.client.get(
            reverse("care-clinical-report-print"),
            {**PERIOD, "branch": str(self.thika.id)},
            **self.auth(self.admin, self.thika),
        )
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("Clinical report", html)
        self.assertIn("Clients triaged", html)


class FhirR4ConformanceClinicalReportTests(ClinicalReportTestCase):
    def test_live_report_is_a_valid_r4_measure_report(self):
        with platform_admin_context():
            for _ in range(5):
                self.triaged("ORANGE")
            self.triaged("RED")
        response = self.client.get(
            reverse("care-clinical-report-fhir"),
            {**PERIOD, "branch": str(self.thika.id)},
            **self.auth(self.admin, self.thika),
        )
        self.assertEqual(response.status_code, 200)
        bundle = response.json()
        self.assertEqual(validate_bundle(bundle), {})
        report = bundle["entry"][0]["resource"]
        self.assertEqual(report["type"], "summary")
        self.assertTrue(report["measure"].startswith("urn:citramac:measure:clinical-report:"))
        self.assertEqual(report["reporter"]["reference"], f"Organization/{self.thika.id}")
        triaged = next(
            g for g in report["group"] if g["code"]["coding"][0]["code"] == "clients-triaged"
        )
        red = next(
            s
            for s in triaged["stratifier"][0]["stratum"]
            if s["value"]["coding"][0]["code"] == "RED"
        )
        self.assertEqual(red["population"][0]["_count"]["extension"][0]["valueCode"], "masked")
        self.assertEqual(bundle["entry"][1]["resource"]["resourceType"], "Provenance")


class FhirR4ConformanceClinicalReportExamplesTests(SimpleTestCase):
    """Published examples (guide.md §3 item 8): a routine month, an edge case
    with withheld small numbers, and an omission (a month with no activity)."""

    EXAMPLES = Path(__file__).parent / "fhir_examples"

    def load(self, name):
        return json.loads((self.EXAMPLES / f"{name}.json").read_text())

    def test_there_are_at_least_three_valid_examples(self):
        paths = sorted(self.EXAMPLES.glob("clinical-report-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(example=path.name):
                bundle = json.loads(path.read_text())
                self.assertEqual(validate_bundle(bundle), {})
                self.assertEqual(
                    [e["resource"]["resourceType"] for e in bundle["entry"]],
                    ["MeasureReport", "Provenance"],
                )

    def test_edge_example_masks_small_counts(self):
        report = self.load("clinical-report-edge-small-numbers-withheld")["entry"][0]["resource"]
        masked = [
            s
            for g in report["group"]
            for st in g.get("stratifier", [])
            for s in st["stratum"]
            if "_count" in s["population"][0]
        ]
        self.assertTrue(masked)
        for stratum in masked:
            self.assertEqual(
                stratum["population"][0]["_count"]["extension"][0]["valueCode"], "masked"
            )

    def test_omission_example_reports_zeros_not_absence(self):
        report = self.load("clinical-report-omission-no-activity")["entry"][0]["resource"]
        totals = [g["population"][0]["count"] for g in report["group"]]
        self.assertEqual(totals, [0] * len(report["group"]))


class OperationalOverviewTests(ClinicalReportTestCase):
    def test_counts_clients_in_care_and_each_clients_latest_priority_once(self):
        with platform_admin_context():
            episode, _ = self.triaged("GREEN", day=3)
            later = self.triage(episode, {}, day=9)
            type(later.triage_encounter).objects.filter(pk=later.triage_encounter_id).update(
                priority="RED", triage_version=1, last_triaged_at=_at(9)
            )
            first = (
                type(later.triage_encounter)
                .objects.exclude(pk=later.triage_encounter_id)
                .get(episode=episode)
            )
            type(first).objects.filter(pk=first.pk).update(
                priority="GREEN", triage_version=1, last_triaged_at=_at(3)
            )
            self.episode(self.patient(), status="finished")  # not in care
        data = self.client.get(reverse("care-reports"), **self.auth(self.admin, self.thika)).data
        self.assertEqual(data["clients_in_care"], 1)
        counts = {row["priority"]: row["count"] for row in data["priority_distribution"]}
        self.assertEqual((counts["RED"], counts["GREEN"]), (1, 0))
        self.assertNotIn("registered_clients", data)
