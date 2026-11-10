"""WHO ICD-11 release import: the vendored file, the import rules, and what a
diagnosis flagged for re-coding may (not) do."""

import tempfile
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from . import icd11_import
from .models import IcdCodeIndex, TerminologySyncRun

HEADER = (
    "Foundation URI\tLinearization URI\tCode\tBlockId\tTitle\tClassKind\tDepthInKind\t"
    "IsResidual\tChapterNo\tBrowserLink\tisLeaf\tPrimary tabulation\tGrouping1\tGrouping2\t"
    "Grouping3\tGrouping4\tGrouping5\tCodingNote\tParent\tVersion:2027 Jan 15 - 05:30 UTC"
)


def _row(code, title, kind="category", chapter="06", leaf="True"):
    return "\t".join(
        [
            "http://id.who.int/icd/entity/1",
            f"http://id.who.int/icd/release/11/mms/{code or 'x'}",
            code,
            "",
            f'"- - {title}"',
            kind,
            "1",
            "False",
            chapter,
            "",
            leaf,
            "True",
        ]
        + [""] * 7
    )


class VendoredReleaseTests(TestCase):
    def test_the_vendored_file_is_whos_unchanged(self):
        self.assertEqual(
            icd11_import.file_sha256(icd11_import.VENDORED_FILE), icd11_import.VENDORED_SHA256
        )

    def test_the_index_is_the_who_release_not_the_stub(self):
        self.assertFalse(IcdCodeIndex.objects.filter(release="").exists())
        self.assertGreater(IcdCodeIndex.objects.filter(release="2026-01").count(), 35000)
        run = TerminologySyncRun.objects.get(source="ICD11", release="2026-01")
        self.assertEqual(run.source_sha256, icd11_import.VENDORED_SHA256)

    def test_stub_codes_carry_whos_titles(self):
        # The five stub codes whose titles were not WHO's (SOURCE.md).
        self.assertEqual(IcdCodeIndex.objects.get(code="6D10").description, "Personality disorder")
        self.assertEqual(
            IcdCodeIndex.objects.get(code="6C45").description, "Disorders due to use of cocaine"
        )
        dx = IcdCodeIndex.objects.get(code="6A70.0")
        self.assertEqual(dx.description, "Single episode depressive disorder, mild")
        self.assertTrue(dx.is_leaf)
        self.assertEqual(dx.chapter, "06")

    def test_command_needs_a_hash_for_a_file(self):
        with self.assertRaises(CommandError):
            call_command("import_icd11", str(icd11_import.VENDORED_FILE), release="2026-01")

    def test_a_file_whose_hash_differs_is_refused(self):
        with self.assertRaises(CommandError):
            call_command(
                "import_icd11",
                str(icd11_import.VENDORED_FILE),
                release="2026-01",
                sha256="0" * 64,
            )


class ImportRulesTests(TestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            patient = Patient.objects.create(
                organization=self.org, first_name="A", last_name="B", gender="FEMALE"
            )
            self.encounter = Encounter.objects.create(
                organization=self.org, patient=patient, encounter_type="OUTPATIENT"
            )

    def _diagnosis(self, code, display, release=""):
        with platform_admin_context():
            return DiagnosisCode.objects.create(
                organization=self.org,
                encounter=self.encounter,
                icd11_code=IcdCodeIndex.objects.get(code=code),
                icd11_display=display,
                icd11_release=release,
            )

    def _import(self, rows, release="2027-01"):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "SimpleTabulation-ICD-11-MMS-en.txt"
            path.write_text("﻿" + "\r\n".join([HEADER] + rows) + "\r\n", encoding="utf-8")
            with platform_admin_context():
                return icd11_import.import_release(
                    IcdCodeIndex,
                    DiagnosisCode,
                    TerminologySyncRun,
                    path,
                    release,
                    expected_sha256=icd11_import.file_sha256(path),
                )

    def test_stub_diagnosis_whose_code_means_something_else_is_flagged_not_rewritten(self):
        wrong = self._diagnosis("6D10", "Disorders of intellectual development")
        right = self._diagnosis("6B00", "Generalised anxiety disorder")
        from_release = self._diagnosis("6A71", "Some older WHO title", release="2026-01")
        summary = self._import(
            [
                _row("", "Mental, behavioural or neurodevelopmental disorders", kind="chapter"),
                _row("6D10", "Personality disorder", leaf="False"),
                _row("6B00", "Generalised anxiety disorder"),
                _row("6A71", "Recurrent depressive disorder", leaf="False"),
            ]
        )
        self.assertEqual([f[1] for f in summary["flagged_diagnoses"]], ["6D10"])
        with platform_admin_context():
            wrong.refresh_from_db()
            right.refresh_from_db()
            from_release.refresh_from_db()
        self.assertIn("Personality disorder", wrong.code_review_reason)
        self.assertEqual(wrong.icd11_display, "Disorders of intellectual development")
        self.assertTrue(wrong.needs_recoding)
        self.assertEqual(wrong.shown_code, "")
        self.assertEqual(right.code_review_reason, "")
        # Chosen from a WHO release: correct by construction, never re-judged on a retitle.
        self.assertEqual(from_release.code_review_reason, "")

    def test_a_code_missing_from_a_later_release_is_retired_not_deleted(self):
        self._import([_row("6B00", "Generalised anxiety disorder")])
        retired = IcdCodeIndex.objects.get(code="6A70")
        self.assertEqual(retired.retired_release, "2027-01")
        self.assertIn("no longer", retired.diagnosis_problem())

    def test_release_and_file_version_must_agree(self):
        with self.assertRaises(icd11_import.Icd11ImportError):
            self._import([_row("6B00", "Generalised anxiety disorder")], release="2026-01")


class DiagnosisCodingTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.clinician = User.objects.create_user(
                email="doc@org.test", password="Password123!", organization=self.org, is_active=True
            )
            role, _ = Role.objects.get_or_create(
                organization=None, name="Nurse", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.clinician.roles.add(role)
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.clinician)[0]}"}
        response = self.client.post(
            reverse("encounter-list"),
            {"patient": str(self.patient.id), "encounter_type": "OUTPATIENT"},
            format="json",
            **self.auth,
        )
        self.encounter_id = response.data["id"]

    def _add(self, code):
        return self.client.post(
            reverse("diagnosis-code-list"),
            {"encounter": self.encounter_id, "icd11_code": code},
            format="json",
            **self.auth,
        )

    def test_a_who_code_is_recorded_with_its_title_and_release(self):
        response = self._add("6A70.0")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data["icd11_description"], "Single episode depressive disorder, mild"
        )
        self.assertEqual(response.data["icd11_release"], "2026-01")

    def test_a_code_in_no_who_release_is_refused(self):
        IcdCodeIndex.objects.create(code="TEST-9", description="Not a WHO code")
        response = self._add("TEST-9")
        self.assertEqual(response.status_code, 400)
        self.assertIn("icd11_code", response.data)

    def test_an_extension_code_is_not_a_diagnosis(self):
        x_code = IcdCodeIndex.objects.filter(chapter="X").first()
        response = self._add(x_code.code)
        self.assertEqual(response.status_code, 400)
        self.assertIn("chapter X", str(response.data["icd11_code"]))

    def test_search_offers_only_recordable_who_codes(self):
        url = reverse("terminology-icd11-search")
        rows = self.client.get(url + "?q=depressive mild", **self.auth).data
        self.assertIn("6A70.0", [r["code"] for r in rows])
        self.assertTrue(all(r["release"] == "2026-01" for r in rows))
        self.assertTrue(all(r["chapter"] not in ("X", "V", "26") for r in rows))
        exact = self.client.get(url + "?q=6B00", **self.auth).data
        self.assertEqual(exact[0]["code"], "6B00")
        self.assertEqual(self.client.get(url, **self.auth).data, [])

    def test_a_flagged_diagnosis_is_carried_as_text_only_in_fhir(self):
        from .fhir_mapper import build_condition_resource

        with platform_admin_context():
            diagnosis = DiagnosisCode.objects.create(
                organization=self.org,
                encounter_id=self.encounter_id,
                icd11_code=IcdCodeIndex.objects.get(code="6D10"),
                icd11_display="Disorders of intellectual development",
                verification_status="CONFIRMED",
                code_review_reason="Recorded from the old list.",
            )
        condition = build_condition_resource(diagnosis, "urn:citramac:patient:x")
        self.assertIsNone(condition.code.coding)
        self.assertEqual(condition.code.text, "Disorders of intellectual development")

    def test_a_flagged_diagnosis_is_not_billed(self):
        from apps.insurance_claims.sha_claims import visit_diagnosis_codes

        with platform_admin_context():
            DiagnosisCode.objects.create(
                organization=self.org,
                encounter_id=self.encounter_id,
                icd11_code=IcdCodeIndex.objects.get(code="6D10"),
                icd11_display="Disorders of intellectual development",
                verification_status="CONFIRMED",
                code_review_reason="Recorded from the old list.",
            )
            DiagnosisCode.objects.create(
                organization=self.org,
                encounter_id=self.encounter_id,
                icd11_code=IcdCodeIndex.objects.get(code="6B00"),
                verification_status="CONFIRMED",
            )
            encounter = Encounter.objects.get(pk=self.encounter_id)

        class Visit:
            episode_id = encounter.episode_id

        class Claim:
            patient = self.patient

        with platform_admin_context():
            self.assertEqual(visit_diagnosis_codes(Claim, Visit), ["6B00"])


class FhirR4ConformanceIcd11ExamplesTests(TestCase):
    """Every ICD-11 coding in a published example is a code in the vendored WHO
    release, its display is WHO's title, and it is the most specific code."""

    def test_example_codings_are_whos(self):
        import json

        root = Path(__file__).resolve().parents[1]
        _, codes, _ = icd11_import.read_release(icd11_import.VENDORED_FILE)
        seen = []

        def walk(node, name):
            if isinstance(node, dict):
                if str(node.get("system", "")).startswith("http://id.who.int/icd/release/11"):
                    entry = codes.get(node.get("code"))
                    seen.append(node.get("code"))
                    self.assertIsNotNone(entry, f"{name}: {node.get('code')} is not a WHO code")
                    self.assertEqual(node.get("display"), entry["description"], name)
                    self.assertTrue(
                        entry["is_leaf"], f"{name}: {node['code']} has more specific codes"
                    )
                for value in node.values():
                    walk(value, name)
            elif isinstance(node, list):
                for value in node:
                    walk(value, name)

        for path in sorted(root.glob("*/fhir_examples/*.json")):
            walk(json.loads(path.read_text()), path.name)
        self.assertTrue(seen)
