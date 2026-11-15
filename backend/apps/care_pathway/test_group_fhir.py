"""Group programme: programmes and session eligibility (EpisodeOfCare.type), and
one client's entry as a FHIR R4 Bundle.

`FhirR4Conformance*` classes run in CI's conformance step: the published
examples in `fhir_examples/group-session-*.json` and the bundle built from a
real confirmed session, against base R4 4.0.1 and our profiles (HL7's validator
checks the same in CI). Per-subject separation (guide.md §4) is asserted on
every bundle: nothing in it names another attendee.
"""

import json
import uuid
from pathlib import Path

from django.test import SimpleTestCase
from django.urls import reverse

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from . import group_programme as gp
from . import psychotherapy_profiles as profiles
from .group_fhir import ATTENDANCE_PROFILE, ENTRY_PROFILE
from .test_group_programme import RISK_NOTE, GroupProgrammeTestCase

EXAMPLES = Path(__file__).parent / "fhir_examples"
CONF = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"
ACT = "http://terminology.hl7.org/CodeSystem/v3-ActCode"


def _resources(bundle):
    return [e["resource"] for e in bundle["entry"]]


def _of(bundle, kind):
    return [r for r in _resources(bundle) if r["resourceType"] == kind]


def _references(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "reference" and isinstance(value, str):
                yield value
            else:
                yield from _references(value)
    elif isinstance(node, list):
        for value in node:
            yield from _references(value)


class GroupBundleAssertions:
    def assert_entry_bundle(self, bundle):
        self.assertEqual(validate_bundle(bundle), {})
        self.assertEqual(bundle["type"], "collection")
        (encounter,) = _of(bundle, "Encounter")
        (attendance,) = _of(bundle, "Observation")
        self.assertEqual(profiles.check(encounter, ENTRY_PROFILE), [])
        self.assertEqual(profiles.check(attendance, ATTENDANCE_PROFILE), [])
        (patient,) = _of(bundle, "Patient")
        # One subject only (§4): every subject / for reference is this client.
        patient_url = next(
            e["fullUrl"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Patient"
        )
        for resource in _resources(bundle):
            for key in ("subject", "for", "patient"):
                if key in resource:
                    self.assertEqual(resource[key]["reference"], patient_url)
        self.assertNotIn("Group", [r["resourceType"] for r in _resources(bundle)])
        (appointment,) = _of(bundle, "Appointment")
        self.assertEqual(
            [p["type"][0]["text"] for p in appointment["participant"]], ["Facilitator"]
        )
        urls = {e["fullUrl"] for e in bundle["entry"]}
        for ref in _references(bundle):
            self.assertIn(ref, urls)
        self.assertTrue(encounter["episodeOfCare"] and encounter["appointment"])
        for resource in _resources(bundle):
            if resource["resourceType"] == "Patient":
                continue
            labels = {(c["system"], c["code"]) for c in resource["meta"]["security"]}
            self.assertTrue({(CONF, "R"), (ACT, "PSY")} <= labels, resource["resourceType"])
        self.assertTrue(_of(bundle, "Provenance"))
        return patient


class FhirR4ConformanceGroupExamplesTests(GroupBundleAssertions, SimpleTestCase):
    """Routine (present, with an observation, on a programme), edge (risk
    disclosure with a follow-up task and alert, corrected afterwards) and
    omission (absent — no observation, no intervention)."""

    def load(self, name):
        return json.loads((EXAMPLES / f"group-session-{name}.json").read_text())

    def test_every_example_is_a_conformant_single_subject_bundle(self):
        paths = sorted(EXAMPLES.glob("group-session-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(example=path.name):
                self.assert_entry_bundle(json.loads(path.read_text()))

    def test_routine_example_is_present_with_a_procedure_and_a_programme(self):
        bundle = self.load("routine-present-observation")
        self.assertEqual(_of(bundle, "Encounter")[0]["status"], "finished")
        self.assertEqual(len(_of(bundle, "Procedure")), 1)
        self.assertTrue(_of(bundle, "EpisodeOfCare")[0]["type"])
        self.assertTrue(_of(bundle, "Observation")[0]["note"])

    def test_edge_example_carries_the_alert_task_and_correction(self):
        bundle = self.load("edge-risk-disclosure-corrected")
        self.assertEqual(len(_of(bundle, "Flag")), 1)
        self.assertEqual(len(_of(bundle, "Task")), 1)
        reasons = [p.get("reason") for p in _of(bundle, "Provenance") if p.get("reason")]
        self.assertTrue(reasons)

    def test_omission_example_records_absence_and_nothing_else(self):
        bundle = self.load("omission-absent")
        self.assertEqual(_of(bundle, "Encounter")[0]["status"], "cancelled")
        obs = _of(bundle, "Observation")[0]
        self.assertEqual(obs["valueCodeableConcept"]["coding"][0]["code"], "ABSENT")
        self.assertNotIn("note", obs)
        self.assertEqual(_of(bundle, "Procedure"), [])

    def test_attendance_codes_are_the_served_value_set(self):
        from .valuesets import VALUESETS

        self.assertEqual(
            profiles.valueset_codes("urn:citramac:valueset:group-attendance"),
            {
                ("urn:citramac:codesystem:group-attendance", code)
                for code, _ in VALUESETS["group-attendance"][1]
            },
        )


class FhirR4ConformanceGroupExportTests(GroupBundleAssertions, GroupProgrammeTestCase):
    def fhir(self, entry_id):
        return self.client.get(reverse("care-group-entry-fhir", args=[entry_id]), **self.auth)

    def test_each_entry_exports_alone_and_is_audited(self):
        session = self.standard_session()
        names = {}
        with platform_admin_context():
            for pid in (self.amina, self.brian, self.carol):
                names[pid] = Patient.objects.get(pk=pid).get_full_name()
        for pid in (self.amina, self.brian, self.carol):
            entry = self.entry_for(session, pid)
            response = self.fhir(entry["id"])
            self.assertEqual(response.status_code, 200)
            self.assert_entry_bundle(response.data)
            text = json.dumps(response.data)
            for other, name in names.items():
                if other != pid:
                    self.assertNotIn(other, text)
                    self.assertNotIn(name.split()[0], text)
            with platform_admin_context():
                self.assertTrue(
                    AuditLogEntry.objects.filter(
                        object_id=entry["id"],
                        action=AuditLogEntry.ACTION_VIEW,
                        field_diff={"output": "fhir"},
                    ).exists()
                )
        absent = self.fhir(self.entry_for(session, self.brian)["id"]).data
        self.assertEqual(_of(absent, "Encounter")[0]["status"], "cancelled")
        self.assertEqual(_of(absent, "Procedure"), [])
        risk = self.fhir(self.entry_for(session, self.carol)["id"]).data
        self.assertEqual(_of(risk, "Observation")[0]["note"][0]["text"], RISK_NOTE)
        self.assertEqual(len(_of(risk, "Flag")), 1)
        self.assertEqual(_of(risk, "Task")[0]["status"], "requested")

    def test_a_correction_is_a_provenance_with_its_reason(self):
        session = self.standard_session()
        entry = self.entry_for(session, self.amina)
        self.correct(
            entry["id"], attendance="PRESENT", observation="Shared a plan.", reason="Typo."
        )
        bundle = self.fhir(entry["id"]).data
        self.assert_entry_bundle(bundle)
        reasons = [p["reason"][0]["text"] for p in _of(bundle, "Provenance") if p.get("reason")]
        self.assertEqual(reasons, ["Typo."])
        self.assertEqual(_of(bundle, "Observation")[0]["status"], "amended")


class ProgrammeEligibilityTests(GroupProgrammeTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            admin = User.objects.create_user(
                email=f"admin-{uuid.uuid4().hex[:6]}@org.test",
                organization=self.org,
                is_active=True,
                first_name="Org",
                last_name="Admin",
            )
            role, _ = Role.objects.get_or_create(
                organization=None, name="Org Admin", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            admin.roles.add(role)
        self.admin_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(admin)[0]}"}

    def add_programme(self, display, auth=None):
        return self.client.post(
            reverse("care-programmes"),
            {"display": display},
            format="json",
            **(auth or self.admin_auth),
        )

    def set_programme(self, pid, code):
        return self.client.put(
            reverse("care-client-programme", args=[pid]),
            {"programme": code},
            format="json",
            **self.auth,
        )

    def workspace(self):
        return self.client.get(reverse("care-group-workspace"), **self.auth).data

    def test_only_an_administrator_maintains_programmes(self):
        self.assertEqual(self.add_programme("Residential rehab", auth=self.auth).status_code, 403)
        added = self.add_programme("Residential rehab")
        self.assertEqual(added.status_code, 201)
        self.assertEqual(added.data["results"][0]["code"], "residential_rehab")
        self.assertEqual(self.add_programme("residential rehab").status_code, 400)
        retired = self.client.patch(
            reverse("care-programme", args=["residential_rehab"]),
            {"active": False},
            format="json",
            **self.admin_auth,
        )
        self.assertFalse(retired.data["results"][0]["active"])
        self.assertEqual(self.set_programme(self.amina, "residential_rehab").status_code, 400)

    def test_programme_on_the_episode_shows_in_the_list_and_the_episode(self):
        self.add_programme("Residential rehab")
        response = self.set_programme(self.amina, "residential_rehab")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["programme"]["display"], "Residential rehab")
        clients = {c["id"]: c for c in self.workspace()["clients"]}
        self.assertEqual(clients[self.amina]["programme"], "Residential rehab")
        self.assertEqual(clients[self.amina]["programme_code"], "residential_rehab")
        self.assertEqual(clients[self.brian]["programme"], "Not assigned")
        self.assertEqual(self.set_programme(self.amina, None).data["programme"], None)

    def test_a_limited_category_refuses_clients_off_its_programmes(self):
        self.add_programme("Residential rehab")
        self.set_programme(self.amina, "residential_rehab")
        limited = self.client.put(
            reverse("care-group-category-programmes", args=["group_psychotherapy"]),
            {"programmes": ["residential_rehab"]},
            format="json",
            **self.admin_auth,
        )
        self.assertEqual(limited.status_code, 200)
        row = next(c for c in limited.data["results"] if c["code"] == "group_psychotherapy")
        self.assertEqual(row["programmes"], ["residential_rehab"])
        refused = self.confirm([self.entry(self.amina), self.entry(self.brian)])
        self.assertEqual(refused.status_code, 400)
        self.assertIn("not open to", str(refused.data))
        self.assertEqual(self.confirm([self.entry(self.amina)]).status_code, 201)
        # Other categories stay open to everyone.
        self.assertEqual(
            self.confirm([self.entry(self.brian)], category="psychoeducation").status_code, 201
        )
        self.assertEqual(
            self.client.put(
                reverse("care-group-category-programmes", args=["life_skills"]),
                {"programmes": ["residential_rehab"]},
                format="json",
                **self.auth,
            ).status_code,
            403,
        )

    def test_list_marks_admission_and_the_unit_logic_is_unchanged(self):
        clients = self.workspace()["clients"]
        self.assertTrue(all("admitted" in c for c in clients))
        self.assertEqual({c["unit"] for c in clients if not c["admitted"]}, {"Outpatient"})


class EligibleForUnitTests(SimpleTestCase):
    def test_open_category_takes_everyone_and_a_limited_one_only_its_programmes(self):
        class Category:
            def __init__(self, ids):
                self.ids = ids

            @property
            def programmes(self):
                outer = self

                class Manager:
                    def all(self):
                        return [type("P", (), {"pk": i}) for i in outer.ids]

                return Manager()

        self.assertTrue(gp.eligible_for(Category([]), None))
        self.assertTrue(gp.eligible_for(Category([1]), 1))
        self.assertFalse(gp.eligible_for(Category([1]), 2))
        self.assertFalse(gp.eligible_for(Category([1]), None))
